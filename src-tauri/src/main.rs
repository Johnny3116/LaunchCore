// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Phase 1: window shell only. The UI runs entirely on mock data.
// Phase 2 adds commands: get_environment, load_catalog, detect, install.
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running LaunchCore");
}
