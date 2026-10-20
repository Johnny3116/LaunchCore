//! Run one installer: stage → lock → hash → elevate → wait.
//!
//! Local installers are copied to a per-user staging folder, then reopened with a share mode that
//! denies writers *for the whole install*. The hash is computed through that locked handle, so the
//! bytes that were verified are the bytes that run. Running from local disk also avoids elevated
//! processes not seeing the user's mapped drives.

use super::{pcwstr, system_dir, wide, winget_path};
use crate::logger::{utc_now, Logger};
use crate::types::{InstallEvent, InstallOutcome, InstallPhase, LogLevel};
use launchcore_core::catalog::{Installer, LocalInstaller, Package, WingetInstaller, WingetScope};
use launchcore_core::{hash, paths};
use std::fs::{self, File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::Instant;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::Storage::FileSystem::FILE_SHARE_READ;
use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
use windows::Win32::UI::Shell::{
    ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

pub struct Ctx<'a> {
    pub kit: &'a Path,
    pub logger: &'a Logger,
    pub emit: &'a dyn Fn(InstallEvent),
}

impl Ctx<'_> {
    fn phase(&self, phase: InstallPhase) {
        (self.emit)(InstallEvent::Phase { phase });
    }
    fn log(&self, pkg: &Package, level: LogLevel, message: impl Into<String>) {
        let message = message.into();
        self.logger.log(level, Some(&pkg.id), &message);
        (self.emit)(InstallEvent::Log { level, message });
    }
}

pub fn install(pkg: &Package, ctx: &Ctx) -> InstallOutcome {
    let start = Instant::now();
    let ms = || start.elapsed().as_millis() as u64;
    let fail = |reason: String| InstallOutcome::Failed { exit_code: None, reason, duration_ms: ms() };

    match &pkg.installer {
        Installer::Winget(w) => run_winget(pkg, w, ctx, start),
        Installer::Msi(l) | Installer::Exe(l) => {
            let is_msi = matches!(pkg.installer, Installer::Msi(_));
            ctx.phase(InstallPhase::Verifying);
            let staged = match stage_and_verify(pkg, l, ctx) {
                Ok(Staged::Ok(s)) => s,
                Ok(Staged::Mismatch { expected, actual }) => return InstallOutcome::HashMismatch { expected, actual },
                Err(e) => {
                    ctx.log(pkg, LogLevel::Error, &e);
                    return fail(e);
                }
            };

            let (file, params) = if is_msi {
                let msi_log = ctx.logger.dir().join(format!("msi-{}-{}.log", pkg.id, utc_now().1.replace(':', "")));
                ctx.log(pkg, LogLevel::Info, format!("MSI verbose log: {}", msi_log.display()));
                (
                    system_dir().join("msiexec.exe"),
                    format!("/i \"{}\" {} /l*v \"{}\"", staged.path.display(), l.args, msi_log.display()),
                )
            } else {
                (staged.path.clone(), l.args.clone())
            };

            let outcome = launch_and_wait(pkg, ctx, &file, &params, staged.dir.as_path(), true, start);
            drop(staged.lock); // release the write-deny lock before cleanup
            if let Err(e) = fs::remove_dir_all(&staged.dir) {
                ctx.log(pkg, LogLevel::Warn, format!("could not remove staging folder {}: {e}", staged.dir.display()));
            }
            outcome
        }
    }
}

struct StagedFile {
    dir: PathBuf,
    path: PathBuf,
    /// Held for the whole install: share mode denies writers so the verified bytes can't change.
    lock: File,
}

enum Staged {
    Ok(StagedFile),
    Mismatch { expected: String, actual: String },
}

fn stage_and_verify(pkg: &Package, l: &LocalInstaller, ctx: &Ctx) -> Result<Staged, String> {
    let source = paths::resolve_in_kit(ctx.kit, &l.path).map_err(|e| e.to_string())?;
    let file_name = source.file_name().ok_or("installer path has no file name")?.to_owned();

    let base = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is not set")?;
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = PathBuf::from(base).join("LaunchCore").join("staging").join(format!("{}-{nonce}", pkg.id));
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create staging folder: {e}"))?;
    let path = dir.join(&file_name);

    ctx.log(pkg, LogLevel::Info, format!("Staging {} → {}", l.path, path.display()));
    fs::copy(&source, &path).map_err(|e| {
        let _ = fs::remove_dir_all(&dir);
        format!("cannot copy installer to staging: {e}")
    })?;

    // Reopen read-only, denying writers (and deleters) until we drop this handle.
    let lock = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ.0)
        .open(&path)
        .map_err(|e| format!("cannot lock staged installer: {e}"))?;

    ctx.log(pkg, LogLevel::Info, "Verifying SHA-256");
    let actual = hash::sha256_hex(&lock).map_err(|e| format!("cannot hash staged installer: {e}"))?;
    if !hash::hashes_match(&l.sha256, &actual) {
        drop(lock);
        let _ = fs::remove_dir_all(&dir);
        ctx.log(
            pkg,
            LogLevel::Error,
            format!("Hash mismatch — expected {}, got {actual}. Installer NOT run.", l.sha256),
        );
        return Ok(Staged::Mismatch { expected: l.sha256.to_lowercase(), actual });
    }
    ctx.log(pkg, LogLevel::Info, "Hash verified");
    Ok(Staged::Ok(StagedFile { dir, path, lock }))
}

fn run_winget(pkg: &Package, w: &WingetInstaller, ctx: &Ctx, start: Instant) -> InstallOutcome {
    let Some(winget) = winget_path() else {
        let reason = "winget is not available for this user (App Installer missing)".to_string();
        ctx.log(pkg, LogLevel::Error, &reason);
        return InstallOutcome::Failed { exit_code: None, reason, duration_ms: start.elapsed().as_millis() as u64 };
    };
    // Every token here is validated by the catalog (package id + version charsets); nothing is free text.
    let mut params = format!("install --id {} --exact", w.package_id);
    if w.pin_version {
        params.push_str(&format!(" --version {}", pkg.version));
    }
    params.push_str(match w.scope {
        WingetScope::Machine => " --scope machine",
        WingetScope::User => " --scope user",
    });
    params.push_str(" --silent --accept-package-agreements --accept-source-agreements --disable-interactivity");
    ctx.log(pkg, LogLevel::Info, format!("winget source: {}", w.package_id));
    // User-scope installs must run as the signed-in user, not an elevated (possibly different) admin.
    let elevate = w.scope == WingetScope::Machine;
    let cwd = winget.parent().map(Path::to_path_buf).unwrap_or_default();
    launch_and_wait(pkg, ctx, &winget, &params, &cwd, elevate, start)
}

fn launch_and_wait(pkg: &Package, ctx: &Ctx, file: &Path, params: &str, cwd: &Path, elevate: bool, start: Instant) -> InstallOutcome {
    let ms = || start.elapsed().as_millis() as u64;
    let timeout_min = pkg.installer.timeout_minutes();

    ctx.phase(InstallPhase::WaitingElevation);
    ctx.log(pkg, LogLevel::Info, format!("Running{}: \"{}\" {params}", if elevate { " elevated" } else { "" }, file.display()));

    let (wfile, wparams, wcwd) = (wide(file), wide(params), wide(cwd));
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
        lpVerb: if elevate { w!("runas") } else { PCWSTR::null() },
        lpFile: pcwstr(&wfile),
        lpParameters: pcwstr(&wparams),
        lpDirectory: pcwstr(&wcwd),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    // SAFETY: all strings outlive the call; struct is fully initialized.
    if let Err(e) = unsafe { ShellExecuteExW(&mut info) } {
        let reason = if e.code() == ERROR_CANCELLED.to_hresult() {
            "UAC prompt was declined — nothing was installed".to_string()
        } else {
            format!("could not start installer: {e}")
        };
        ctx.log(pkg, LogLevel::Error, &reason);
        return InstallOutcome::Failed { exit_code: None, reason, duration_ms: ms() };
    }
    let process = info.hProcess;
    if process.is_invalid() {
        let reason = "installer started but no process handle was returned".to_string();
        ctx.log(pkg, LogLevel::Error, &reason);
        return InstallOutcome::Failed { exit_code: None, reason, duration_ms: ms() };
    }
    let _guard = HandleGuard(process);

    ctx.phase(InstallPhase::Installing);
    // SAFETY: valid process handle.
    let wait = unsafe { WaitForSingleObject(process, timeout_min.saturating_mul(60_000)) };
    if wait == WAIT_TIMEOUT {
        // Deliberately not killed: terminating msiexec mid-install leaves machines half-configured.
        let reason = format!("timed out after {timeout_min} min — installer is still running and was not stopped");
        ctx.log(pkg, LogLevel::Error, &reason);
        return InstallOutcome::Failed { exit_code: None, reason, duration_ms: ms() };
    }
    if wait != WAIT_OBJECT_0 {
        let reason = format!("waiting for installer failed (wait result {})", wait.0);
        ctx.log(pkg, LogLevel::Error, &reason);
        return InstallOutcome::Failed { exit_code: None, reason, duration_ms: ms() };
    }

    let mut code: u32 = 0;
    // SAFETY: process has exited; valid handle.
    if let Err(e) = unsafe { GetExitCodeProcess(process, &mut code) } {
        let reason = format!("could not read exit code: {e}");
        ctx.log(pkg, LogLevel::Error, &reason);
        return InstallOutcome::Failed { exit_code: None, reason, duration_ms: ms() };
    }

    classify(pkg, ctx, code, ms())
}

/// Exit codes from installers are u32; catalogs may list them as unsigned (3010) or as signed
/// HRESULTs (-1978335212). Accept either spelling.
fn code_matches(list: &[i64], code: u32) -> bool {
    list.iter().any(|&c| c == code as i64 || c == code as i32 as i64)
}

fn classify(pkg: &Package, ctx: &Ctx, code: u32, duration_ms: u64) -> InstallOutcome {
    let shown = if code > 0xFFFF { format!("{code} (0x{code:08X})") } else { code.to_string() };
    if !code_matches(pkg.installer.success_codes(), code) {
        let reason = format!("installer exited with {shown}");
        ctx.log(pkg, LogLevel::Error, &reason);
        return InstallOutcome::Failed { exit_code: Some(code as i64), reason, duration_ms };
    }
    let reboot_required = code_matches(pkg.installer.reboot_codes(), code);
    ctx.log(
        pkg,
        if reboot_required { LogLevel::Warn } else { LogLevel::Info },
        format!("Exited with {shown}{}", if reboot_required { " — reboot required" } else { "" }),
    );
    InstallOutcome::Success { exit_code: code as i64, reboot_required, duration_ms }
}

struct HandleGuard(HANDLE);
impl Drop for HandleGuard {
    fn drop(&mut self) {
        // SAFETY: handle came from ShellExecuteExW with SEE_MASK_NOCLOSEPROCESS; closed once.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
