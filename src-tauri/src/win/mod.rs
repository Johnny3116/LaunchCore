//! Win32 helpers. All `unsafe` FFI in LaunchCore lives under this module.

pub mod detect;
pub mod env;
pub mod install;

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_SUCCESS};
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO};
use windows::Win32::System::Environment::ExpandEnvironmentStringsW;
use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6464KEY};
use windows::Win32::System::SystemInformation::GetSystemDirectoryW;

/// Null-terminated UTF-16. Keep the Vec alive while the PCWSTR is in use.
pub fn wide<S: AsRef<OsStr>>(s: S) -> Vec<u16> {
    s.as_ref().encode_wide().chain(std::iter::once(0)).collect()
}

pub fn pcwstr(w: &[u16]) -> PCWSTR {
    PCWSTR(w.as_ptr())
}

/// Registry string under HKLM, 64-bit view (the catalog path is taken literally).
/// Ok(None) when the key or value doesn't exist.
pub fn hklm_string(subkey: &str, value: &str) -> Result<Option<String>, String> {
    let (k, v) = (wide(subkey), wide(value));
    let flags = RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY;
    let mut size: u32 = 0;
    // SAFETY: valid null-terminated strings; size query with no buffer.
    let rc = unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, pcwstr(&k), pcwstr(&v), flags, None, None, Some(&mut size)) };
    if rc == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if rc != ERROR_SUCCESS && rc != ERROR_MORE_DATA {
        return Err(format!("registry read failed (error {})", rc.0));
    }
    let mut buf = vec![0u16; (size as usize).div_ceil(2) + 1];
    let mut bytes = (buf.len() * 2) as u32;
    // SAFETY: buffer is `bytes` long; RegGetValueW null-terminates REG_SZ with RRF_RT_REG_SZ.
    let rc = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            pcwstr(&k),
            pcwstr(&v),
            flags,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut bytes),
        )
    };
    if rc == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if rc != ERROR_SUCCESS {
        return Err(format!("registry read failed (error {})", rc.0));
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Ok(Some(String::from_utf16_lossy(&buf[..len])))
}

/// Expand %VARS% the way Windows does.
pub fn expand_env(s: &str) -> Result<String, String> {
    let src = wide(s);
    // SAFETY: size query.
    let needed = unsafe { ExpandEnvironmentStringsW(pcwstr(&src), None) };
    if needed == 0 {
        return Err("could not expand environment variables".into());
    }
    let mut buf = vec![0u16; needed as usize];
    // SAFETY: buffer sized from the query above.
    let n = unsafe { ExpandEnvironmentStringsW(pcwstr(&src), Some(&mut buf)) };
    if n == 0 || n as usize > buf.len() {
        return Err("could not expand environment variables".into());
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Ok(String::from_utf16_lossy(&buf[..len]))
}

/// C:\Windows\System32 — used to launch msiexec by absolute path (no search-path hijack).
pub fn system_dir() -> PathBuf {
    let mut buf = vec![0u16; 260];
    // SAFETY: buffer provided.
    let n = unsafe { GetSystemDirectoryW(Some(&mut buf)) } as usize;
    if n == 0 || n > buf.len() {
        return PathBuf::from(r"C:\Windows\System32");
    }
    PathBuf::from(String::from_utf16_lossy(&buf[..n]))
}

/// File version from the version resource, as "a.b.c.d". Ok(None) if the file has none.
pub fn file_version(path: &Path) -> Result<Option<String>, String> {
    let p = wide(path);
    // SAFETY: valid path string.
    let size = unsafe { GetFileVersionInfoSizeW(pcwstr(&p), None) };
    if size == 0 {
        return Ok(None);
    }
    let mut data = vec![0u8; size as usize];
    // SAFETY: buffer of `size` bytes.
    unsafe { GetFileVersionInfoW(pcwstr(&p), None, size, data.as_mut_ptr().cast()) }
        .map_err(|e| format!("cannot read version info: {e}"))?;
    let mut info: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut len: u32 = 0;
    let root = wide("\\");
    // SAFETY: `data` outlives `info`; VerQueryValueW points into `data`.
    let ok = unsafe { VerQueryValueW(data.as_ptr().cast(), pcwstr(&root), &mut info, &mut len) };
    if !ok.as_bool() || info.is_null() || (len as usize) < std::mem::size_of::<VS_FIXEDFILEINFO>() {
        return Ok(None);
    }
    // SAFETY: checked non-null and large enough above.
    let fi = unsafe { &*(info as *const VS_FIXEDFILEINFO) };
    Ok(Some(format!(
        "{}.{}.{}.{}",
        fi.dwFileVersionMS >> 16,
        fi.dwFileVersionMS & 0xffff,
        fi.dwFileVersionLS >> 16,
        fi.dwFileVersionLS & 0xffff
    )))
}

/// winget is an App Execution Alias in the *current user's* WindowsApps folder.
pub fn winget_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let p = PathBuf::from(base).join(r"Microsoft\WindowsApps\winget.exe");
    // The alias is a reparse point: check it exists without following it.
    std::fs::symlink_metadata(&p).ok().map(|_| p)
}
