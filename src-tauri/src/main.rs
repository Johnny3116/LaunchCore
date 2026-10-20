// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod kit;
mod logger;
mod types;
#[cfg(windows)]
mod win;

use logger::Logger;

/// Release builds have no console, so startup failures go to a message box (and the log)
/// instead of the app silently doing nothing.
fn fatal(logger: &Logger, msg: &str) -> ! {
    logger.log(types::LogLevel::Error, None, &format!("Startup failed: {msg}"));
    #[cfg(windows)]
    win::startup::error_box("LaunchCore can't start", msg);
    #[cfg(not(windows))]
    eprintln!("LaunchCore can't start: {msg}");
    std::process::exit(1);
}

fn main() {
    let state = commands::AppState::new();
    let logger = std::sync::Arc::clone(&state.logger);
    logger.log(
        types::LogLevel::Info,
        None,
        &format!("LaunchCore {} started from {}", env!("CARGO_PKG_VERSION"), state.kit.display()),
    );

    #[cfg(windows)]
    if let Err(msg) = win::startup::require_webview2() {
        fatal(&logger, &msg);
    }

    let result = tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::get_environment,
            commands::load_catalog,
            commands::detect,
            commands::install,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        fatal(&logger, &e.to_string());
    }
}
