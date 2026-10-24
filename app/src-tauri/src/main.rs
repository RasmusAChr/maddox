// Hides the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// The .maddox file the app was started with: opening one from the file
/// manager (it is registered as the app for .maddox) passes its path as an
/// argument. The page asks for it once at startup.
#[tauri::command]
fn launch_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|arg| arg.to_lowercase().ends_with(".maddox"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Updates: latest.json on the newest GitHub Release (tauri.conf.json).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![launch_file])
        .run(tauri::generate_context!())
        .expect("error while running Maddox");
}
