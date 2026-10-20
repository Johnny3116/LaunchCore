//! Tauri commands. The UI only ever passes a package *id*: paths, args and hashes always come from
//! the backend's own signature-verified catalog, never from the webview.

use crate::kit;
use crate::logger::Logger;
use crate::types::*;
use launchcore_core::catalog::{Catalog, Package};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

pub struct AppState {
    pub kit: PathBuf,
    pub logger: Arc<Logger>,
    pub catalog: Mutex<Option<Catalog>>,
    pub installing: Arc<AtomicBool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            kit: kit::kit_dir(),
            logger: Arc::new(Logger::new()),
            catalog: Mutex::new(None),
            installing: Arc::new(AtomicBool::new(false)),
        }
    }

    fn package(&self, id: &str) -> Result<Package, String> {
        let guard = self.catalog.lock().map_err(|_| "internal state poisoned".to_string())?;
        let catalog = guard.as_ref().ok_or("catalog not loaded")?;
        catalog.packages.iter().find(|p| p.id == id).cloned().ok_or_else(|| format!("unknown package '{id}'"))
    }
}

#[tauri::command]
pub fn get_environment(state: State<'_, AppState>) -> Environment {
    let log_path = state.logger.current_path();
    #[cfg(windows)]
    {
        crate::win::env::environment(&state.kit, &log_path)
    }
    #[cfg(not(windows))]
    {
        Environment {
            hostname: "unsupported-os".into(),
            username: String::new(),
            os_version: std::env::consts::OS.into(),
            app_dir: state.kit.display().to_string(),
            log_path: log_path.display().to_string(),
            webview2_version: None,
            winget_available: false,
        }
    }
}

#[tauri::command]
pub fn load_catalog(state: State<'_, AppState>) -> CatalogLoad {
    let source_path = state.kit.join(kit::CATALOG_FILE).display().to_string();
    match kit::load_catalog(&state.kit) {
        Ok(catalog) => {
            state.logger.log(LogLevel::Info, None, &format!("Loaded signed catalog ({} packages) from {source_path}", catalog.packages.len()));
            if let Ok(mut g) = state.catalog.lock() {
                *g = Some(catalog.clone());
            }
            CatalogLoad { ok: true, source_path, catalog: Some(catalog), errors: None }
        }
        Err(errors) => {
            state.logger.log(LogLevel::Error, None, &format!("Catalog rejected: {}", errors.join("; ")));
            if let Ok(mut g) = state.catalog.lock() {
                *g = None; // fail closed: nothing installable from a bad catalog
            }
            CatalogLoad { ok: false, source_path, catalog: None, errors: Some(errors) }
        }
    }
}

#[tauri::command]
pub async fn detect(state: State<'_, AppState>, package_id: String) -> Result<DetectionResult, String> {
    let pkg = state.package(&package_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            crate::win::detect::detect(&pkg)
        }
        #[cfg(not(windows))]
        {
            let _ = pkg;
            DetectionResult::unknown("detection is only supported on Windows")
        }
    })
    .await
    .map_err(|e| format!("detection task failed: {e}"))
}

#[tauri::command]
pub async fn install(
    state: State<'_, AppState>,
    package_id: String,
    on_event: Channel<InstallEvent>,
) -> Result<InstallOutcome, String> {
    let pkg = state.package(&package_id)?;
    // One installer at a time, enforced here too (not just in the UI).
    if state.installing.swap(true, Ordering::SeqCst) {
        return Err("the previous installer is still running — wait for it to finish, then queue this again".into());
    }
    let kit = state.kit.clone();
    let logger = Arc::clone(&state.logger);
    let busy = Arc::clone(&state.installing);
    logger.log(LogLevel::Info, Some(&pkg.id), &format!("Install requested: {} {}", pkg.name, pkg.version));

    let result = tauri::async_runtime::spawn_blocking(move || {
        let emit = |e: InstallEvent| {
            let _ = on_event.send(e);
        };
        #[cfg(windows)]
        {
            let ctx = crate::win::install::Ctx { kit: &kit, logger: &logger, emit: &emit, busy: &busy };
            crate::win::install::install(&pkg, &ctx)
        }
        #[cfg(not(windows))]
        {
            let _ = (&kit, &logger, &emit, &busy);
            InstallOutcome::Failed {
                exit_code: None,
                reason: "installing is only supported on Windows".into(),
                duration_ms: 0,
                still_running: false,
            }
        }
    })
    .await
    .map_err(|e| format!("install task failed: {e}"));

    // After a timeout the watcher thread owns the flag and clears it when the installer exits.
    let still_running = matches!(&result, Ok(InstallOutcome::Failed { still_running: true, .. }));
    if !still_running {
        state.installing.store(false, Ordering::SeqCst);
    }
    result
}
