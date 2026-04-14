#![windows_subsystem = "windows"]

use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct SidecarState(Mutex<Option<Child>>);

fn runtime_sidecar_path() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "Unable to determine executable directory".to_string())?;

    let binary_name = if cfg!(target_os = "windows") {
        "vai-runtime.exe"
    } else {
        "vai-runtime"
    };

    let sidecar = exe_dir.join(binary_name);
    if sidecar.exists() {
        return Ok(sidecar);
    }

    Err(format!(
        "Engine sidecar was not found next to the app executable: {}",
        sidecar.display()
    ))
}

fn executable_dir() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    exe_path
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Unable to determine executable directory".to_string())
}

fn load_env_file(path: &PathBuf) -> Result<Vec<(String, String)>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let contents = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut values = Vec::new();

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        let parsed = value.trim().trim_matches('"').trim_matches('\'');
        values.push((key.trim().to_string(), parsed.to_string()));
    }

    Ok(values)
}

fn runtime_entry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled_from_exe = executable_dir()?
        .join("resources")
        .join("runtime")
        .join("dist")
        .join("bundle.cjs");

    if bundled_from_exe.exists() {
        return Ok(bundled_from_exe);
    }

    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("runtime")
        .join("dist")
        .join("bundle.cjs");

    if bundled.exists() {
        return Ok(bundled);
    }

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("runtime")
        .join("dist")
        .join("bundle.cjs");

    if dev.exists() {
        return Ok(dev);
    }

    Err("Runtime bundle was not found in Tauri resources".to_string())
}

#[tauri::command]
async fn open_external(target: String) -> Result<(), String> {
    if target.trim().is_empty() {
        return Err("External target URL is required".to_string());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", &target]);
        cmd
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&target);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&target);
        cmd
    };

    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

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

    if let Some(db_dir) = db_path.parent() {
        std::fs::create_dir_all(db_dir).map_err(|e| e.to_string())?;
    }

    let runtime_entry = runtime_entry_path(&app)?;

    let sidecar_path = runtime_sidecar_path()?;
    let exe_dir = executable_dir()?;
    let env_file = exe_dir.join(".env");
    let env_values = load_env_file(&env_file)?;
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    let stdout_log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("runtime.stdout.log"))
        .map_err(|e| e.to_string())?;

    let stderr_log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("runtime.stderr.log"))
        .map_err(|e| e.to_string())?;

    let mut command = Command::new(sidecar_path);
    command
        .arg(runtime_entry)
        .current_dir(exe_dir)
        .envs(env_values)
        .env("VAI_PORT", "3006")
        .env("VAI_DB_PATH", db_path)
        .env("VAI_ENV_FILE", env_file)
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log));

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command.spawn().map_err(|e| e.to_string())?;

    *child_guard = Some(child);

    Ok(())
}

#[tauri::command]
async fn stop_engine(state: State<'_, SidecarState>) -> Result<(), String> {
    let mut child_guard = state.0.lock().unwrap();
    if let Some(mut child) = child_guard.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_engine, stop_engine, open_external])
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
