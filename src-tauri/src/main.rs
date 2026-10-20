// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod kit;
mod logger;
mod types;
#[cfg(windows)]
mod win;

fn main() {
    let state = commands::AppState::new();
    state.logger.log(
        types::LogLevel::Info,
        None,
        &format!("LaunchCore {} started from {}", env!("CARGO_PKG_VERSION"), state.kit.display()),
    );

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::get_environment,
            commands::load_catalog,
            commands::detect,
            commands::install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LaunchCore");
}
