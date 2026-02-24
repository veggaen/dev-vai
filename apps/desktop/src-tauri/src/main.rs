#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct SidecarState(Mutex<Option<CommandChild>>);

#[tauri::command]
async fn start_engine(
    app: tauri::AppHandle,
    state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut child_guard = state.0.lock().unwrap();

    if child_guard.is_some() {
        return Ok(()); // already running
    }

    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("vai.db");

    let sidecar_command = app
        .shell()
        .sidecar("vai-runtime")
        .map_err(|e| e.to_string())?
        .env("VAI_PORT", "3001")
        .env("VAI_DB_PATH", db_path.to_string_lossy().to_string());

    let (_, child) = sidecar_command.spawn().map_err(|e| e.to_string())?;

    *child_guard = Some(child);
    Ok(())
}

#[tauri::command]
async fn stop_engine(state: State<'_, SidecarState>) -> Result<(), String> {
    let mut child_guard = state.0.lock().unwrap();
    if let Some(child) = child_guard.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_engine, stop_engine])
        .setup(|app| {
            // Auto-start the AI engine when the app opens
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state: State<'_, SidecarState> = app_handle.state();
                if let Err(e) = start_engine(app_handle.clone(), state).await {
                    eprintln!("[VAI] Failed to start engine: {}", e);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
