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
struct DevServerState(Mutex<Option<Child>>);

const DESKTOP_SESSION_TOKEN_FILE: &str = "session-token.dpapi";
const MAX_DESKTOP_SESSION_TOKEN_BYTES: usize = 16 * 1024;

fn current_executable_path() -> Option<String> {
    let path = std::env::current_exe().ok()?;
    Some(
        path.canonicalize()
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned(),
    )
}

fn desktop_session_token_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("auth")
        .join(DESKTOP_SESSION_TOKEN_FILE))
}

#[cfg(target_os = "windows")]
fn protect_desktop_session_token(token: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if token.is_empty() || token.len() > MAX_DESKTOP_SESSION_TOKEN_BYTES {
        return Err("Desktop session token length is invalid".to_string());
    }

    let input = CRYPT_INTEGER_BLOB {
        cbData: token.len() as u32,
        pbData: token.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let protected = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if protected == 0 {
        return Err(format!(
            "Windows could not protect the desktop session: {}",
            std::io::Error::last_os_error()
        ));
    }

    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(bytes)
}

#[cfg(target_os = "windows")]
fn unprotect_desktop_session_token(protected: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if protected.is_empty() {
        return Err("Protected desktop session is empty".to_string());
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: protected.len() as u32,
        pbData: protected.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let unprotected = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if unprotected == 0 {
        return Err(format!(
            "Windows could not restore the desktop session: {}",
            std::io::Error::last_os_error()
        ));
    }

    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    if bytes.is_empty() || bytes.len() > MAX_DESKTOP_SESSION_TOKEN_BYTES {
        return Err("Restored desktop session token length is invalid".to_string());
    }
    Ok(bytes)
}

#[tauri::command]
fn load_desktop_session_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let path = desktop_session_token_path(&app)?;
        if !path.exists() {
            return Ok(None);
        }
        let protected = std::fs::read(path).map_err(|error| error.to_string())?;
        let token = unprotect_desktop_session_token(&protected)?;
        return String::from_utf8(token)
            .map(Some)
            .map_err(|_| "Restored desktop session token was not UTF-8".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(None)
    }
}

#[tauri::command]
fn save_desktop_session_token(app: tauri::AppHandle, token: Option<String>) -> Result<(), String> {
    let path = desktop_session_token_path(&app)?;
    let Some(token) = token.filter(|value| !value.is_empty()) else {
        if path.exists() {
            std::fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        return Ok(());
    };

    #[cfg(target_os = "windows")]
    {
        let protected = protect_desktop_session_token(token.as_bytes())?;
        let parent = path
            .parent()
            .ok_or_else(|| "Desktop session path has no parent".to_string())?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        return std::fs::write(path, protected).map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = token;
        Ok(())
    }
}

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
async fn start_engine(app: tauri::AppHandle, state: State<'_, SidecarState>) -> Result<(), String> {
    let mut child_guard = state.0.lock().unwrap();

    if child_guard.is_some() {
        return Ok(()); // already running
    }

    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(env!("VAI_DATABASE_FILENAME"));

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
        .env("VAI_PORT", env!("VAI_RUNTIME_PORT"))
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

// ── Global release-targeted dictation ───────────────────────────────────────────
//
// Windows owns the configurable down edge via RegisterHotKey. At key-up we snapshot
// foreground HWND/PID, focused control, and editability evidence under a release ID.
// After STT, delivery may send exactly one scan-code Ctrl+V to that same target or
// leave the transcript on the clipboard. Character-by-character game input is absent.

#[cfg(target_os = "windows")]
const DEFAULT_DICTATION_SHORTCUT: &str = "Win+Alt";
#[cfg(target_os = "windows")]
const DICTATION_HOTKEY_ID: i32 = 0x5641;
#[cfg(target_os = "windows")]
const DICTATION_GAME_PASTE_DEADLINE_MS: u64 = 1_400;
#[cfg(target_os = "windows")]
const DICTATION_NORMAL_PASTE_DEADLINE_MS: u64 = 30_000;
#[cfg(target_os = "windows")]
const DICTATION_OPEN_AND_PASTE_DEADLINE_MS: u64 = 1_200;

#[cfg(target_os = "windows")]
#[derive(Clone, Debug)]
struct DictationHotkey {
    shortcut: String,
    modifiers: u32,
    key: u16,
    version: u64,
}

#[cfg(target_os = "windows")]
impl Default for DictationHotkey {
    fn default() -> Self {
        parse_dictation_hotkey(DEFAULT_DICTATION_SHORTCUT, 1).expect("default hotkey is valid")
    }
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DictationMonitorBounds {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DictationTargetSnapshot {
    release_id: u64,
    released_at_ms: u64,
    hwnd: isize,
    focus_hwnd: isize,
    process_id: u32,
    process_created_ticks: Option<u64>,
    process_name: Option<String>,
    window_class: Option<String>,
    focused_class: Option<String>,
    monitor: Option<DictationMonitorBounds>,
    window_mode: String,
    is_game: bool,
    target_self: bool,
    text_field_plausible: bool,
    field_detection: String,
    input_evidence_sequence: u64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DictationDeliveryReport {
    route: String,
    release_id: u64,
    release_to_paste_ms: u64,
    latency_budget_met: bool,
    stt_quality: String,
    target_window_class: Option<String>,
    focused_control_class: Option<String>,
    target_process: Option<String>,
    game: bool,
    text_field_plausible: bool,
    field_detection: String,
    clipboard_restore_scheduled: bool,
}

#[cfg(target_os = "windows")]
static DICTATION_HOTKEY: std::sync::OnceLock<std::sync::Mutex<DictationHotkey>> =
    std::sync::OnceLock::new();
#[cfg(target_os = "windows")]
static DICTATION_TARGETS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::BTreeMap<u64, DictationTargetSnapshot>>,
> = std::sync::OnceLock::new();
#[cfg(target_os = "windows")]
static DICTATION_RELEASE_SEQUENCE: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
#[cfg(target_os = "windows")]
static DICTATION_INPUT_EVIDENCE: std::sync::OnceLock<std::sync::Mutex<DictationInputEvidence>> =
    std::sync::OnceLock::new();
#[cfg(target_os = "windows")]
static DICTATION_BUBBLE_MONITOR: std::sync::OnceLock<
    std::sync::Mutex<std::collections::BTreeMap<u64, DictationMonitorBounds>>,
> = std::sync::OnceLock::new();
#[cfg(all(
    target_os = "windows",
    any(debug_assertions, feature = "dangerous-ptt-fixture")
))]
static DICTATION_ACCEPTANCE_LOG: std::sync::OnceLock<std::sync::Mutex<Option<std::fs::File>>> =
    std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
fn key_down(vk: u16) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    unsafe { (GetAsyncKeyState(vk as i32) as u16) & 0x8000 != 0 }
}

/// True when the shortcut is a pure-modifier chord (e.g. Win+Alt) with no
/// non-modifier trigger key. `key == 0` is the sentinel. RegisterHotKey cannot
/// bind these, so the watcher polls for them instead.
#[cfg(target_os = "windows")]
fn hotkey_is_modifier_chord(hotkey: &DictationHotkey) -> bool {
    hotkey.key == 0
}

#[cfg(target_os = "windows")]
fn hotkey_is_operational(registered: bool, modifier_chord_active: bool) -> bool {
    registered || modifier_chord_active
}

/// Poll whether every modifier a pure-modifier chord requires is currently held.
/// Passive read only (GetAsyncKeyState): installs no keyboard hook and swallows
/// no keys, so games and anti-cheat see nothing injected or intercepted.
#[cfg(target_os = "windows")]
fn modifier_chord_down(hotkey: &DictationHotkey) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    if hotkey.modifiers == 0 {
        return false;
    }
    modifier_state_matches(
        hotkey,
        key_down(VK_CONTROL),
        key_down(VK_SHIFT),
        key_down(VK_MENU),
        key_down(VK_LWIN) || key_down(VK_RWIN),
    )
}

#[cfg(target_os = "windows")]
fn modifier_state_matches(
    hotkey: &DictationHotkey,
    control_down: bool,
    shift_down: bool,
    alt_down: bool,
    win_down: bool,
) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_WIN,
    };
    let expected = |flag: u32| hotkey.modifiers & flag != 0;
    control_down == expected(MOD_CONTROL)
        && shift_down == expected(MOD_SHIFT)
        && alt_down == expected(MOD_ALT)
        && win_down == expected(MOD_WIN)
}

/// The window that was foreground when the user RELEASED the dictation chord —
/// the window they were speaking into. Transcription takes seconds; if the user
/// clicks somewhere else meanwhile, the transcript must NOT be injected into
/// that unrelated window (it stays on the clipboard instead).
#[cfg(target_os = "windows")]
fn foreground_hwnd_value() -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe { GetForegroundWindow() as isize }
}

#[cfg(target_os = "windows")]
fn parse_dictation_hotkey(shortcut: &str, version: u64) -> Result<DictationHotkey, String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_WIN, VK_F12, VK_MENU, VK_SPACE,
    };

    let normalized = shortcut
        .split('+')
        .map(|part| part.trim().to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("+");
    // NOTE: a `key` of 0 marks a PURE-MODIFIER chord (no non-modifier trigger key).
    // RegisterHotKey cannot bind these — Alt/Win are modifiers, not trigger keys —
    // so the watcher detects them by polling key state instead (see
    // `modifier_chord_down`). This is what makes Win+Alt work again.
    let _ = VK_MENU;
    let (label, modifiers, key) = match normalized.as_str() {
        "win+alt" | "alt+win" => ("Win+Alt", MOD_WIN | MOD_ALT, 0u16),
        "ctrl+shift+space" => ("Ctrl+Shift+Space", MOD_CONTROL | MOD_SHIFT, VK_SPACE),
        "ctrl+alt+space" => ("Ctrl+Alt+Space", MOD_CONTROL | MOD_ALT, VK_SPACE),
        "alt+shift+space" => ("Alt+Shift+Space", MOD_ALT | MOD_SHIFT, VK_SPACE),
        "ctrl+shift+f12" => ("Ctrl+Shift+F12", MOD_CONTROL | MOD_SHIFT, VK_F12),
        _ => return Err("Unsupported dictation shortcut".to_string()),
    };
    Ok(DictationHotkey {
        shortcut: label.to_string(),
        modifiers,
        key,
        version,
    })
}

#[cfg(target_os = "windows")]
fn dictation_keys_clear(hotkey: &DictationHotkey) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    !key_down(VK_CONTROL)
        && !key_down(VK_SHIFT)
        && !key_down(VK_MENU)
        && !key_down(VK_LWIN)
        && !key_down(VK_RWIN)
        && !key_down(hotkey.key)
}

#[cfg(target_os = "windows")]
fn active_dictation_keys_clear() -> bool {
    DICTATION_HOTKEY
        .get_or_init(|| std::sync::Mutex::new(DictationHotkey::default()))
        .lock()
        .map(|hotkey| dictation_keys_clear(&hotkey))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn window_class_is_shell(class: &str) -> bool {
    // Progman / WorkerW = the desktop wallpaper window: there is nowhere to type.
    class == "Progman" || class == "WorkerW"
}

#[cfg(target_os = "windows")]
fn window_class_name(hwnd: windows_sys::Win32::Foundation::HWND) -> Option<String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;
    if hwnd.is_null() {
        return None;
    }
    let mut buf = [0u16; 128];
    let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if len <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

#[cfg(target_os = "windows")]
fn target_display_details(hwnd: isize) -> (Option<DictationMonitorBounds>, String) {
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, GetWindowRect, GWL_STYLE, WS_CAPTION,
    };
    if hwnd == 0 {
        return (None, "no-window".to_string());
    }
    let mut rect = unsafe { std::mem::zeroed::<windows_sys::Win32::Foundation::RECT>() };
    if unsafe { GetWindowRect(hwnd as _, &mut rect) } == 0 {
        return (None, "unknown".to_string());
    }
    let monitor = unsafe { MonitorFromWindow(hwnd as _, MONITOR_DEFAULTTONEAREST) };
    let mut info = unsafe { std::mem::zeroed::<MONITORINFO>() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return (None, "unknown".to_string());
    }
    let bounds = DictationMonitorBounds {
        left: info.rcMonitor.left,
        top: info.rcMonitor.top,
        right: info.rcMonitor.right,
        bottom: info.rcMonitor.bottom,
    };
    let style = unsafe { GetWindowLongW(hwnd as _, GWL_STYLE) } as u32;
    let covers_monitor = rect.left <= bounds.left
        && rect.top <= bounds.top
        && rect.right >= bounds.right
        && rect.bottom >= bounds.bottom;
    let mode = if covers_monitor && style & WS_CAPTION != WS_CAPTION {
        "borderless-or-exclusive"
    } else if style & WS_CAPTION == WS_CAPTION {
        "windowed"
    } else {
        "undecorated-windowed"
    };
    (Some(bounds), mode.to_string())
}

#[cfg(target_os = "windows")]
fn foreground_window_class_name() -> Option<String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    window_class_name(unsafe { GetForegroundWindow() })
}

#[cfg(target_os = "windows")]
fn process_image_path(process_id: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    if process_id == 0 {
        return None;
    }

    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if process.is_null() {
        return None;
    }

    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(process, 0, buf.as_mut_ptr(), &mut len) };
    unsafe { CloseHandle(process) };
    if ok == 0 || len == 0 {
        return None;
    }

    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

#[cfg(target_os = "windows")]
fn foreground_process_image_name() -> Option<String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let foreground = unsafe { GetForegroundWindow() };
    process_image_name_for_hwnd(foreground as isize)
}

#[cfg(target_os = "windows")]
fn process_id_for_hwnd(hwnd: isize) -> u32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    if hwnd == 0 {
        return 0;
    }
    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd as _, &mut process_id) };
    process_id
}

#[cfg(target_os = "windows")]
fn process_creation_ticks(process_id: u32) -> Option<u64> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    if process_id == 0 {
        return None;
    }
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if process.is_null() {
        return None;
    }
    let mut creation = unsafe { std::mem::zeroed::<FILETIME>() };
    let mut exit = unsafe { std::mem::zeroed::<FILETIME>() };
    let mut kernel = unsafe { std::mem::zeroed::<FILETIME>() };
    let mut user = unsafe { std::mem::zeroed::<FILETIME>() };
    let ok = unsafe { GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) };
    unsafe { CloseHandle(process) };
    if ok == 0 {
        return None;
    }
    Some(((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64)
}

#[cfg(target_os = "windows")]
fn process_image_name_for_hwnd(hwnd: isize) -> Option<String> {
    if hwnd == 0 {
        return None;
    }
    let process_id = process_id_for_hwnd(hwnd);
    if let Some(path) = process_image_path(process_id) {
        return std::path::Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_ascii_lowercase());
    }
    process_image_name_from_snapshot(process_id)
}

#[cfg(target_os = "windows")]
fn process_image_name_from_snapshot(process_id: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    if process_id == 0 {
        return None;
    }
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }
    let mut entry = unsafe { std::mem::zeroed::<PROCESSENTRY32W>() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut found = None;
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        if entry.th32ProcessID == process_id {
            let len = entry
                .szExeFile
                .iter()
                .position(|value| *value == 0)
                .unwrap_or(entry.szExeFile.len());
            found = Some(String::from_utf16_lossy(&entry.szExeFile[..len]).to_ascii_lowercase());
            break;
        }
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    found
}

#[cfg(target_os = "windows")]
fn system_time_ms() -> u64 {
    static ORIGIN: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    ORIGIN
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[cfg(target_os = "windows")]
fn class_looks_like_text_host(class_name: &str) -> bool {
    let class_name = class_name.to_ascii_lowercase();
    class_name == "edit"
        || class_name.starts_with("richedit")
        || class_name.starts_with("windowsforms10.edit")
        || class_name.contains("chrome_renderwidgethosthwnd")
        || class_name.contains("chrome_widgetwin")
        || class_name.contains("webview")
        || class_name.contains("cef")
        || class_name.contains("mozilla")
        || class_name.contains("internet explorer_server")
        || class_name.contains("applicationframeinputsinkwindow")
        // Consoles / terminals — no GUI caret, but they accept paste and typed input.
        || class_name == "consolewindowclass"
        || class_name.contains("cascadia")
        || class_name.contains("mintty")
        || class_name.contains("virtualconsoleclass")
        || class_name.contains("tty")
}

#[cfg(target_os = "windows")]
fn class_is_native_edit(class_name: &str) -> bool {
    let class_name = class_name.to_ascii_lowercase();
    class_name == "edit"
        || class_name.starts_with("richedit")
        || class_name.starts_with("windowsforms10.edit")
}

/// Foreground is a terminal or CLI REPL (cmd, PowerShell, Windows Terminal, Grok CLI…).
#[cfg(target_os = "windows")]
fn foreground_is_console_or_cli_host() -> bool {
    if foreground_window_class_name().as_deref().is_some_and(|c| {
        let c = c.to_ascii_lowercase();
        c == "consolewindowclass"
            || c.contains("cascadia")
            || c.contains("mintty")
            || c.contains("virtualconsoleclass")
    }) {
        return true;
    }
    matches!(
        foreground_process_image_name().as_deref(),
        Some(
            "wt.exe"
                | "windowsterminal.exe"
                | "cmd.exe"
                | "powershell.exe"
                | "pwsh.exe"
                | "conhost.exe"
                | "grok.exe"
                | "node.exe"
                | "python.exe"
                | "python3.exe"
        )
    )
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, Default)]
struct DictationInputEvidence {
    sequence: u64,
    league_chat_armed: bool,
    league_chat_hwnd: isize,
    last_enter_at_ms: u64,
    last_enter_hwnd: isize,
    last_click_at_ms: u64,
    last_click_hwnd: isize,
    last_click_in_chat_region: bool,
    last_disarm_at_ms: u64,
    last_disarm_hwnd: isize,
}

#[cfg(target_os = "windows")]
fn record_enter_evidence(
    evidence: &mut DictationInputEvidence,
    hwnd: isize,
    is_league: bool,
    now: u64,
) {
    evidence.sequence = evidence.sequence.saturating_add(1);
    if is_league && evidence.league_chat_armed && evidence.league_chat_hwnd == hwnd {
        evidence.league_chat_armed = false;
        evidence.last_disarm_at_ms = now;
        evidence.last_disarm_hwnd = hwnd;
        return;
    }
    evidence.last_enter_at_ms = now;
    evidence.last_enter_hwnd = hwnd;
    if is_league {
        evidence.league_chat_armed = true;
        evidence.league_chat_hwnd = hwnd;
    }
}

#[cfg(target_os = "windows")]
fn record_disarm_evidence(evidence: &mut DictationInputEvidence, hwnd: isize, now: u64) {
    evidence.sequence = evidence.sequence.saturating_add(1);
    if evidence.league_chat_hwnd == hwnd {
        evidence.league_chat_armed = false;
    }
    evidence.last_disarm_at_ms = now;
    evidence.last_disarm_hwnd = hwnd;
}

#[cfg(target_os = "windows")]
fn focus_details_for_hwnd(foreground: isize) -> (isize, Option<String>, bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO,
    };
    if foreground == 0 {
        return (0, None, false);
    }
    let thread_id = unsafe { GetWindowThreadProcessId(foreground as _, std::ptr::null_mut()) };
    if thread_id == 0 {
        return (0, None, false);
    }
    let mut info = unsafe { std::mem::zeroed::<GUITHREADINFO>() };
    info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
    if unsafe { GetGUIThreadInfo(thread_id, &mut info) } == 0 {
        return (0, None, false);
    }
    let focus_hwnd = info.hwndFocus as isize;
    let caret = info.rcCaret;
    let has_caret = !info.hwndCaret.is_null()
        || caret.left != 0
        || caret.top != 0
        || caret.right != 0
        || caret.bottom != 0;
    (focus_hwnd, window_class_name(info.hwndFocus), has_caret)
}

#[cfg(target_os = "windows")]
fn stable_foreground_focus_details() -> (isize, isize, Option<String>, bool) {
    // GetForegroundWindow and GetGUIThreadInfo are separate Win32 calls. Verify
    // the same top-level window still owns foreground around the focus snapshot;
    // otherwise a cross-window race could pair one app's HWND with another app's
    // focused control and incorrectly authorize delivery.
    for _ in 0..3 {
        let before = foreground_hwnd_value();
        let (focus, class, caret) = focus_details_for_hwnd(before);
        if before != 0 && foreground_hwnd_value() == before {
            return (before, focus, class, caret);
        }
    }
    (0, 0, None, false)
}

#[cfg(target_os = "windows")]
fn is_known_game_process(process_name: Option<&str>) -> bool {
    matches!(
        process_name,
        Some(
            "league of legends.exe"
                | "valorant-win64-shipping.exe"
                | "cs2.exe"
                | "overwatch.exe"
                | "fortniteclient-win64-shipping.exe"
                | "r5apex.exe"
                | "rocketleague.exe"
                | "dota2.exe"
        )
    )
}

/// Desktop chat/launcher apps that are NOT gameplay surfaces. They often run
/// borderless-fullscreen (so the generic "borderless == game" heuristic wrongly
/// flags them) and render their chat box in an embedded browser with no native
/// Win32 caret. Pasting into them is SAFE — there are no gameplay keybinds a
/// stray Ctrl+V could trigger — so they get normal-app paste treatment: the
/// League *client* here, distinct from the in-match `league of legends.exe`.
#[cfg(target_os = "windows")]
fn is_desktop_chat_client(process_name: Option<&str>) -> bool {
    matches!(
        process_name
            .map(|name| name.to_ascii_lowercase())
            .as_deref(),
        Some("leagueclientux.exe" | "discord.exe" | "teamspeak3.exe")
    )
}

#[cfg(target_os = "windows")]
fn class_looks_like_game_host(class_name: &str) -> bool {
    let class_name = class_name.to_ascii_lowercase();
    class_name.contains("riotwindowclass")
        || class_name.contains("unitywndclass")
        || class_name.contains("unrealwindow")
        || class_name.contains("sdl_app")
        || class_name.contains("glfw")
        || class_name.contains("cryengine")
        || class_name.contains("valve001")
        || class_name.contains("respawn")
        || class_name.contains("gamewindow")
        || class_name == "vaipttdeterministicgametarget"
}

#[cfg(target_os = "windows")]
fn foreground_looks_like_game() -> bool {
    let hwnd = foreground_hwnd_value();
    is_known_game_process(process_image_name_for_hwnd(hwnd).as_deref())
        || window_class_name(hwnd as _)
            .as_deref()
            .is_some_and(class_looks_like_game_host)
        || target_display_details(hwnd).1 == "borderless-or-exclusive"
}

#[cfg(target_os = "windows")]
fn determine_text_field(
    has_target: bool,
    has_caret: bool,
    focused_class_text: bool,
    focused_native_edit: bool,
    is_game: bool,
    is_league_game: bool,
    _recent_chat_click: bool,
    recent_enter: bool,
    foreground_text_host: bool,
    trusted_chat_app: bool,
) -> (bool, &'static str) {
    if !has_target {
        (false, "no-foreground-target")
    } else if has_caret {
        (true, "win32-caret")
    } else if trusted_chat_app {
        // A trusted, non-gameplay chat client (League client, Discord). It renders
        // its input in an embedded browser with no native caret, so caret/native-
        // edit detection can't prove the field — but paste is harmless here, so
        // grant it rather than falling back to clipboard-only.
        (true, "trusted-chat-app")
    } else if is_game && focused_native_edit {
        (true, "focused-text-control")
    } else if is_league_game && recent_enter {
        (true, "recent-enter-chat-arm")
    } else if is_game {
        // User directive: "if I'm active in an input, paste there — even in a
        // fullscreen game." Games render their own chat and expose no native
        // caret, so the OS can't PROVE a field is focused; we trust that the user
        // opened chat before speaking. This pastes plain text (Ctrl+V) on release
        // with NO auto-Enter — the user presses Enter to send. Newlines are
        // stripped upstream so the paste itself can never submit. The remaining
        // runtime guards still hold: same focused window at delivery, modifiers
        // released, and within the latency budget.
        (true, "focused-window-user-trusted")
    } else if focused_class_text {
        (true, "focused-text-control")
    } else if foreground_text_host {
        (true, "foreground-text-host")
    } else {
        (false, "no-editable-focus-evidence")
    }
}

#[cfg(target_os = "windows")]
fn dictation_paste_deadline_ms(snapshot: &DictationTargetSnapshot, open_and_paste: bool) -> u64 {
    if open_and_paste {
        DICTATION_OPEN_AND_PASTE_DEADLINE_MS
    } else if snapshot.is_game {
        DICTATION_GAME_PASTE_DEADLINE_MS
    } else {
        // Local/cloud transcription normally completes after the old 1.4 second
        // game-safety window. Normal applications are still protected by exact
        // HWND, process-generation, focused-control, modifier, and clipboard
        // checks, so let the finished transcript reach the field the user kept
        // focused instead of turning almost every browser dictation into a copy card.
        DICTATION_NORMAL_PASTE_DEADLINE_MS
    }
}

#[cfg(target_os = "windows")]
fn capture_dictation_target(
    evidence: &DictationInputEvidence,
    main_hwnd: isize,
) -> DictationTargetSnapshot {
    let release_id =
        DICTATION_RELEASE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let released_at_ms = system_time_ms();
    inspect_dictation_target(evidence, main_hwnd, release_id, released_at_ms)
}

#[cfg(target_os = "windows")]
fn inspect_dictation_target(
    evidence: &DictationInputEvidence,
    main_hwnd: isize,
    release_id: u64,
    released_at_ms: u64,
) -> DictationTargetSnapshot {
    let (hwnd, focus_hwnd, focused_class, has_caret) = stable_foreground_focus_details();
    let process_id = process_id_for_hwnd(hwnd);
    let process_created_ticks = process_creation_ticks(process_id);
    let process_name = process_image_name_for_hwnd(hwnd);
    let window_class = window_class_name(hwnd as _);
    let (monitor, window_mode) = target_display_details(hwnd);
    // A trusted desktop chat client (League client, Discord, …) is never a
    // gameplay surface even when it's borderless-fullscreen — so it must not be
    // gated like a game. This is the fix for "paste only copies to clipboard in
    // the League client".
    let trusted_chat_app = is_desktop_chat_client(process_name.as_deref());
    let is_game = !trusted_chat_app
        && (is_known_game_process(process_name.as_deref())
            || window_class
                .as_deref()
                .is_some_and(class_looks_like_game_host)
            || window_mode == "borderless-or-exclusive");
    let is_league_game = process_name.as_deref() == Some("league of legends.exe");
    let focused_class_text = focused_class
        .as_deref()
        .is_some_and(class_looks_like_text_host);
    let focused_native_edit = focused_class.as_deref().is_some_and(class_is_native_edit);
    let window_class_text = window_class
        .as_deref()
        .is_some_and(class_looks_like_text_host);
    let recent_enter = evidence.league_chat_armed
        && evidence.league_chat_hwnd == hwnd
        && evidence.last_enter_hwnd == hwnd
        && evidence.last_enter_at_ms > evidence.last_disarm_at_ms
        && released_at_ms.saturating_sub(evidence.last_enter_at_ms) <= 10_000;
    let (text_field_plausible, field_detection) = determine_text_field(
        hwnd != 0 && !window_class.as_deref().is_some_and(window_class_is_shell),
        has_caret,
        focused_class_text,
        focused_native_edit,
        is_game,
        is_league_game,
        false,
        recent_enter,
        window_class_text || foreground_is_console_or_cli_host(),
        trusted_chat_app,
    );

    DictationTargetSnapshot {
        release_id,
        released_at_ms,
        hwnd,
        focus_hwnd,
        process_id,
        process_created_ticks,
        process_name,
        window_class,
        focused_class,
        monitor,
        window_mode,
        is_game,
        target_self: hwnd != 0 && hwnd == main_hwnd,
        text_field_plausible,
        field_detection: field_detection.to_string(),
        input_evidence_sequence: evidence.sequence,
    }
}

/// Inject Ctrl+V as HARDWARE SCAN CODES (not virtual keys). Many games and some
/// Electron apps poll scan codes / DirectInput and never see VK-only synthetic
/// input — this is the difference between "paste works in the League lobby" and
/// "paste works in the game too".
#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
enum DictationInputSequence {
    CtrlV,
    Enter,
}

#[cfg(target_os = "windows")]
fn send_dictation_scancodes(sequence: DictationInputSequence) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE,
        VK_RETURN, VK_V,
    };

    if !active_dictation_keys_clear()
        || match sequence {
            DictationInputSequence::CtrlV => key_down(VK_V),
            DictationInputSequence::Enter => key_down(VK_RETURN),
        }
    {
        return Err("A physical key required by dictation input is still held".to_string());
    }

    const SC_LCTRL: u16 = 0x1D;
    const SC_V: u16 = 0x2F;
    const SC_ENTER: u16 = 0x1C;

    let key = |scan: u16, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
            ki: KEYBDINPUT {
                wVk: 0,
                wScan: scan,
                dwFlags: KEYEVENTF_SCANCODE | if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let (inputs, cleanup) = match sequence {
        DictationInputSequence::CtrlV => (
            vec![
                key(SC_LCTRL, false),
                key(SC_V, false),
                key(SC_V, true),
                key(SC_LCTRL, true),
            ],
            vec![key(SC_V, true), key(SC_LCTRL, true)],
        ),
        DictationInputSequence::Enter => (
            vec![key(SC_ENTER, false), key(SC_ENTER, true)],
            vec![key(SC_ENTER, true)],
        ),
    };
    let send_inputs = |events: &[INPUT]| unsafe {
        SendInput(
            events.len() as u32,
            events.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    let sent = send_inputs(&inputs);
    if sent != inputs.len() as u32 {
        // SendInput may accept only a prefix. Always attempt key-up cleanup so a
        // failed paste cannot leave Ctrl/V logically held for the player's next input.
        let _ = send_inputs(&cleanup);
        return Err(format!("SendInput injected {sent}/{} events", inputs.len()));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn send_ctrl_v_scancode() -> Result<(), String> {
    send_dictation_scancodes(DictationInputSequence::CtrlV)
}

#[cfg(target_os = "windows")]
fn send_enter_scancode() -> Result<(), String> {
    send_dictation_scancodes(DictationInputSequence::Enter)
}

// ── Standalone dictation bubble ─────────────────────────────────────────────────────
//
// When the user dictates while ANOTHER app is focused, the in-app overlay is
// invisible (Vai may be minimized). This small always-on-top, taskbar-less
// window shows the listening/transcribing/result states on the monitor the
// user is actually working on. It never steals focus — the target app keeps
// receiving the Ctrl+V paste. Phase updates arrive via eval (same no-ACL
// pattern as the chord watcher).

#[cfg(target_os = "windows")]
fn emit_dictation_event(app: &tauri::AppHandle, payload: &serde_json::Value) {
    if let (Some(window), Ok(detail)) = (
        app.get_webview_window("main"),
        serde_json::to_string(payload),
    ) {
        let _ = window.eval(&format!(
            "window.dispatchEvent(new CustomEvent('vai:global-dictation',{{detail:{detail}}}))"
        ));
    }
}

#[cfg(target_os = "windows")]
fn emit_dictation_hotkey_status(app: &tauri::AppHandle, payload: &serde_json::Value) {
    if let (Some(window), Ok(detail)) = (
        app.get_webview_window("main"),
        serde_json::to_string(payload),
    ) {
        let _ = window.eval(&format!(
            "window.dispatchEvent(new CustomEvent('vai:dictation-hotkey-status',{{detail:{detail}}}))"
        ));
    }
}

fn valid_ptt_acceptance_run_id(value: &str) -> bool {
    (8..=96).contains(&value.len())
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && b"._-".contains(&byte))
        })
}

#[cfg(all(
    target_os = "windows",
    any(debug_assertions, feature = "dangerous-ptt-fixture")
))]
fn dictation_acceptance_log() -> &'static std::sync::Mutex<Option<std::fs::File>> {
    DICTATION_ACCEPTANCE_LOG.get_or_init(|| {
        let file = (|| {
            let run_id = std::env::var("VAI_PTT_ACCEPTANCE_RUN_ID").ok()?;
            if !valid_ptt_acceptance_run_id(run_id.trim()) {
                return None;
            }
            let path = std::env::var("VAI_PTT_ACCEPTANCE_LOG_PATH").ok()?;
            let path = std::path::PathBuf::from(path.trim());
            if !path.is_absolute()
                || path.extension().and_then(|value| value.to_str()) != Some("jsonl")
            {
                return None;
            }
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).ok()?;
            }
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .ok()
        })();
        std::sync::Mutex::new(file)
    })
}

#[cfg(all(
    target_os = "windows",
    any(debug_assertions, feature = "dangerous-ptt-fixture")
))]
fn dictation_acceptance_log_available() -> bool {
    dictation_acceptance_log()
        .lock()
        .map(|file| file.is_some())
        .unwrap_or(false)
}

#[cfg(not(all(
    target_os = "windows",
    any(debug_assertions, feature = "dangerous-ptt-fixture")
)))]
fn dictation_acceptance_log_available() -> bool {
    false
}

fn append_dictation_log(app: &tauri::AppHandle, mut value: serde_json::Value) {
    use std::io::Write;
    if cfg!(any(debug_assertions, feature = "dangerous-ptt-fixture")) {
        if let Ok(run_id) = std::env::var("VAI_PTT_ACCEPTANCE_RUN_ID") {
            let run_id = run_id.trim();
            if valid_ptt_acceptance_run_id(run_id) {
                if let Some(object) = value.as_object_mut() {
                    object.insert("runId".to_string(), serde_json::json!(run_id));
                }
            }
        }
    }
    let Ok(log_dir) = app.path().app_log_dir() else {
        return;
    };
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("dictation-releases.jsonl"))
    else {
        return;
    };
    if let Ok(line) = serde_json::to_string(&value) {
        let _ = writeln!(file, "{line}");
        #[cfg(all(
            target_os = "windows",
            any(debug_assertions, feature = "dangerous-ptt-fixture")
        ))]
        if let Ok(mut acceptance_file) = dictation_acceptance_log().lock() {
            if let Some(acceptance_file) = acceptance_file.as_mut() {
                let _ = writeln!(acceptance_file, "{line}");
                let _ = acceptance_file.flush();
            }
        }
    }
}

#[cfg(any(debug_assertions, feature = "dangerous-ptt-fixture"))]
fn dictation_acceptance_fixture_text_from_env() -> Option<String> {
    std::env::var("VAI_PTT_ACCEPTANCE_TEXT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value.len() <= 512)
}

#[cfg(not(any(debug_assertions, feature = "dangerous-ptt-fixture")))]
fn dictation_acceptance_fixture_text_from_env() -> Option<String> {
    None
}

#[cfg(any(debug_assertions, feature = "dangerous-ptt-fixture"))]
fn dictation_acceptance_fixture_is_armed() -> bool {
    dictation_acceptance_fixture_text_from_env().is_some()
        && dictation_acceptance_log_available()
        && std::env::var("VAI_PTT_ACCEPTANCE_RUN_ID")
            .ok()
            .map(|value| valid_ptt_acceptance_run_id(value.trim()))
            .unwrap_or(false)
}

#[cfg(not(any(debug_assertions, feature = "dangerous-ptt-fixture")))]
fn dictation_acceptance_fixture_is_armed() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn league_or_armed_acceptance_target(hwnd: isize) -> bool {
    process_image_name_for_hwnd(hwnd).as_deref() == Some("league of legends.exe")
        || (dictation_acceptance_fixture_is_armed()
            && process_image_name_for_hwnd(hwnd).as_deref() == Some("vai_ptt_target.exe")
            && window_class_name(hwnd as _).as_deref() == Some("VaiPttDeterministicGameTarget"))
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GameDictationCue {
    Listening,
    Released,
    Pasted,
    ClipboardReady,
    NoSpeech,
    Error,
}

#[cfg(target_os = "windows")]
fn game_dictation_cue_for_route(route: &str) -> GameDictationCue {
    if route == "sendinput-accepted" || route == "open-and-paste-input-accepted" {
        GameDictationCue::Pasted
    } else if route.starts_with("clipboard-ready") || route == "no-target" {
        GameDictationCue::ClipboardReady
    } else {
        GameDictationCue::Error
    }
}

#[cfg(target_os = "windows")]
fn play_game_dictation_cue(cue: GameDictationCue) {
    use windows_sys::Win32::System::Diagnostics::Debug::MessageBeep;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MB_ICONASTERISK, MB_ICONEXCLAMATION, MB_ICONHAND, MB_OK,
    };
    let sound = match cue {
        GameDictationCue::Listening | GameDictationCue::Pasted => MB_ICONASTERISK,
        GameDictationCue::Released | GameDictationCue::NoSpeech => MB_OK,
        GameDictationCue::ClipboardReady => MB_ICONEXCLAMATION,
        GameDictationCue::Error => MB_ICONHAND,
    };
    unsafe {
        let _ = MessageBeep(sound);
    }
}

/// Windows owns the press edge through RegisterHotKey. We poll only the selected
/// keys for release and lightweight input evidence; no hook enters the game.
fn spawn_dictation_chord_watcher(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    std::thread::spawn(move || {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT, VK_ESCAPE, VK_LBUTTON, VK_RETURN,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            PeekMessageW, MSG, PM_NOREMOVE, PM_REMOVE, WM_HOTKEY,
        };

        let hotkey_state =
            DICTATION_HOTKEY.get_or_init(|| std::sync::Mutex::new(DictationHotkey::default()));
        let targets = DICTATION_TARGETS
            .get_or_init(|| std::sync::Mutex::new(std::collections::BTreeMap::new()));
        let evidence_state = DICTATION_INPUT_EVIDENCE
            .get_or_init(|| std::sync::Mutex::new(DictationInputEvidence::default()));
        let mut active_hotkey = DictationHotkey::default();
        let mut registered_version = 0u64;
        let mut registered = false;
        // True when the active shortcut is a pure-modifier chord (Win+Alt) detected
        // by polling rather than RegisterHotKey. Tracks the press rising edge.
        let mut chord_active = false;
        let mut chord_was_down = false;
        let mut held = false;
        let mut evidence = DictationInputEvidence::default();
        let mut enter_was_down = false;
        let mut escape_was_down = false;
        let mut click_was_down = false;
        let mut last_heartbeat = std::time::Instant::now();
        // RegisterHotKey targets this thread's queue. Force the queue to exist
        // before registration so startup cannot fail nondeterministically.
        let mut queue_probe = unsafe { std::mem::zeroed::<MSG>() };
        unsafe { PeekMessageW(&mut queue_probe, std::ptr::null_mut(), 0, 0, PM_NOREMOVE) };

        loop {
            let configured = hotkey_state
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default();
            // Never swap the activation key underneath a live hold. A rebind is
            // applied on the first idle loop after release, so the falling edge is
            // always paired with the key that produced the registered rising edge.
            if configured.version != registered_version && !held {
                let previous_hotkey = active_hotkey.clone();
                let previous_registered = registered;
                if registered {
                    unsafe { UnregisterHotKey(std::ptr::null_mut(), DICTATION_HOTKEY_ID) };
                    registered = false;
                }
                // Pure-modifier chord (Win+Alt): no RegisterHotKey — poll for it.
                // Always "registers" successfully since polling can't be refused
                // by another app the way a RegisterHotKey binding can.
                let requested_registered = if hotkey_is_modifier_chord(&configured) {
                    active_hotkey = configured.clone();
                    true
                } else if unsafe {
                    RegisterHotKey(
                        std::ptr::null_mut(),
                        DICTATION_HOTKEY_ID,
                        configured.modifiers | MOD_NOREPEAT,
                        configured.key as u32,
                    )
                } != 0
                {
                    active_hotkey = configured.clone();
                    registered = true;
                    true
                } else {
                    false
                };
                if !requested_registered {
                    // A rejected rebind must not silently destroy the working
                    // shortcut. Roll back to the previous registration and surface
                    // the requested shortcut as rejected in the status event.
                    registered = previous_registered
                        && unsafe {
                            RegisterHotKey(
                                std::ptr::null_mut(),
                                DICTATION_HOTKEY_ID,
                                previous_hotkey.modifiers | MOD_NOREPEAT,
                                previous_hotkey.key as u32,
                            )
                        } != 0;
                    active_hotkey = previous_hotkey;
                    if !registered && configured.shortcut != "Ctrl+Shift+Space" {
                        if let Ok(fallback) = parse_dictation_hotkey("Ctrl+Shift+Space", 0) {
                            registered = unsafe {
                                RegisterHotKey(
                                    std::ptr::null_mut(),
                                    DICTATION_HOTKEY_ID,
                                    fallback.modifiers | MOD_NOREPEAT,
                                    fallback.key as u32,
                                )
                            } != 0;
                            if registered {
                                active_hotkey = fallback;
                            }
                        }
                    }
                }
                // Single source of truth after all branches: a modifier chord is
                // "active" via polling (registered stays false); a keyed shortcut is
                // active via RegisterHotKey.
                chord_active = hotkey_is_modifier_chord(&active_hotkey) && !registered;
                chord_was_down = chord_active && modifier_chord_down(&active_hotkey);
                registered_version = configured.version;
                emit_dictation_hotkey_status(
                    &app,
                    &serde_json::json!({
                        "shortcut": configured.shortcut,
                        "activeShortcut": if hotkey_is_operational(registered, chord_active) {
                            serde_json::Value::String(active_hotkey.shortcut.clone())
                        } else {
                            serde_json::Value::Null
                        },
                        "registered": requested_registered,
                        "error": if requested_registered {
                            serde_json::Value::Null
                        } else {
                            serde_json::Value::String(
                                if hotkey_is_operational(registered, chord_active) {
                                    format!(
                                        "Windows rejected {}; {} remains active",
                                        configured.shortcut, active_hotkey.shortcut
                                    )
                                } else {
                                    format!(
                                        "Windows rejected {}; no dictation shortcut is active",
                                        configured.shortcut
                                    )
                                }
                            )
                        },
                    }),
                );
                append_dictation_log(
                    &app,
                    serde_json::json!({
                        "event": "hotkey-ready",
                        "requestedShortcut": configured.shortcut,
                        "activeShortcut": if hotkey_is_operational(registered, chord_active) {
                            serde_json::Value::String(active_hotkey.shortcut.clone())
                        } else {
                            serde_json::Value::Null
                        },
                        "active": hotkey_is_operational(registered, chord_active),
                        "binaryPath": current_executable_path(),
                        "sourceFingerprint": env!("VAI_PTT_SOURCE_FINGERPRINT"),
                        "version": configured.version,
                    }),
                );
            }

            let now = system_time_ms();
            let current_hwnd = foreground_hwnd_value();
            let mut evidence_changed = false;
            let enter_down = key_down(VK_RETURN);
            if enter_down && !enter_was_down {
                let is_league = league_or_armed_acceptance_target(current_hwnd);
                // In League, Enter is a toggle: when chat is already armed it
                // submits/closes. Treating every Enter as "open" could authorize
                // a later Ctrl+V into gameplay.
                record_enter_evidence(&mut evidence, current_hwnd, is_league, now);
                evidence_changed = true;
            }
            enter_was_down = enter_down;

            let escape_down = key_down(VK_ESCAPE);
            if escape_down && !escape_was_down {
                record_disarm_evidence(&mut evidence, current_hwnd, now);
                evidence_changed = true;
            }
            escape_was_down = escape_down;

            let click_down = key_down(VK_LBUTTON);
            if click_down && !click_was_down {
                evidence.last_click_at_ms = now;
                evidence.last_click_hwnd = current_hwnd;
                // Screen-coordinate "chat regions" proved too broad: an ordinary
                // movement click could be mistaken for a text field. Every click now
                // invalidates heuristic game-chat evidence. League Open & paste uses
                // its own post-transcript, app-owned Enter contract instead.
                evidence.last_click_in_chat_region = false;
                record_disarm_evidence(&mut evidence, current_hwnd, now);
                evidence_changed = true;
            }
            click_was_down = click_down;
            if evidence_changed {
                if let Ok(mut shared) = evidence_state.lock() {
                    *shared = evidence.clone();
                }
            }

            let mut message = unsafe { std::mem::zeroed::<MSG>() };
            while unsafe {
                PeekMessageW(
                    &mut message,
                    std::ptr::null_mut(),
                    WM_HOTKEY,
                    WM_HOTKEY,
                    PM_REMOVE,
                )
            } != 0
            {
                if registered && message.wParam as i32 == DICTATION_HOTKEY_ID && !held {
                    held = true;
                    last_heartbeat = std::time::Instant::now();
                    emit_dictation_event(
                        &app,
                        &serde_json::json!({
                            "phase": "down",
                            "shortcut": active_hotkey.shortcut,
                        }),
                    );
                    if foreground_looks_like_game() {
                        play_game_dictation_cue(GameDictationCue::Listening);
                    }
                }
            }

            // Pure-modifier chord (Win+Alt): RegisterHotKey can't bind it, so the
            // press edge comes from polling both modifiers. Rising edge = both held
            // now, not both held last tick, and not already in a hold.
            if chord_active {
                let chord_down_now = modifier_chord_down(&active_hotkey);
                if chord_down_now && !chord_was_down && !held {
                    held = true;
                    last_heartbeat = std::time::Instant::now();
                    emit_dictation_event(
                        &app,
                        &serde_json::json!({
                            "phase": "down",
                            "shortcut": active_hotkey.shortcut,
                        }),
                    );
                    if foreground_looks_like_game() {
                        play_game_dictation_cue(GameDictationCue::Listening);
                    }
                }
                chord_was_down = chord_down_now;
            }

            // RegisterHotKey owns the rising edge for keyed shortcuts; the chord
            // poll owns it for Win+Alt. Either way the falling edge is the physical
            // release: for a keyed shortcut the trigger key goes up; for a chord any
            // required modifier goes up. Games/test drivers can briefly perturb a
            // modifier mid-hold, so keyed shortcuts still watch their trigger key.
            let release_edge = if chord_active {
                !modifier_chord_down(&active_hotkey)
            } else {
                !key_down(active_hotkey.key)
            };
            if held && release_edge {
                held = false;
                let main_hwnd = app
                    .get_webview_window("main")
                    .and_then(|window| window.hwnd().ok())
                    .map(|hwnd| hwnd.0 as isize)
                    .unwrap_or_default();
                let snapshot = capture_dictation_target(&evidence, main_hwnd);
                if let Ok(mut monitor) = DICTATION_BUBBLE_MONITOR
                    .get_or_init(|| std::sync::Mutex::new(std::collections::BTreeMap::new()))
                    .lock()
                {
                    if let Some(bounds) = snapshot.monitor.clone() {
                        monitor.insert(snapshot.release_id, bounds);
                    }
                    while monitor.len() > 32 {
                        if let Some(oldest) = monitor.keys().next().copied() {
                            monitor.remove(&oldest);
                        }
                    }
                }
                if snapshot.is_game {
                    play_game_dictation_cue(GameDictationCue::Released);
                }
                append_dictation_log(
                    &app,
                    serde_json::json!({
                        "event": "released",
                        "shortcut": active_hotkey.shortcut,
                        "release": &snapshot,
                    }),
                );
                if let Ok(mut map) = targets.lock() {
                    map.insert(snapshot.release_id, snapshot.clone());
                    while map.len() > 32 {
                        if let Some(oldest) = map.keys().next().copied() {
                            map.remove(&oldest);
                        }
                    }
                }
                emit_dictation_event(
                    &app,
                    &serde_json::json!({
                        "phase": "up",
                        "releaseId": snapshot.release_id,
                        "targetSelf": snapshot.target_self,
                        "textFieldPlausible": snapshot.text_field_plausible,
                        "fieldDetection": snapshot.field_detection,
                    }),
                );
            } else if held && last_heartbeat.elapsed() >= std::time::Duration::from_millis(250) {
                last_heartbeat = std::time::Instant::now();
                emit_dictation_event(
                    &app,
                    &serde_json::json!({
                        "phase": "hold",
                        "shortcut": active_hotkey.shortcut,
                    }),
                );
            }

            std::thread::sleep(std::time::Duration::from_millis(12));
        }
    });
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

#[tauri::command]
async fn configure_dictation_hotkey(shortcut: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let state =
            DICTATION_HOTKEY.get_or_init(|| std::sync::Mutex::new(DictationHotkey::default()));
        let mut state = state
            .lock()
            .map_err(|_| "Hotkey state unavailable".to_string())?;
        let next = parse_dictation_hotkey(&shortcut, state.version.saturating_add(1))?;
        let label = next.shortcut.clone();
        *state = next;
        return Ok(label);
    }
    #[cfg(not(target_os = "windows"))]
    Ok(shortcut)
}

/// Deterministic native acceptance only. Release builds always return `None`, and
/// debug builds require an explicit per-process environment value. Transcript text
/// is never written to the diagnostic log.
#[tauri::command]
fn dictation_acceptance_fixture_text(app: tauri::AppHandle) -> Option<String> {
    let text = dictation_acceptance_fixture_text_from_env();
    if let Some(value) = text.as_ref() {
        append_dictation_log(
            &app,
            serde_json::json!({
                "event": "acceptance-fixture-enabled",
                "textLength": value.len(),
            }),
        );
    }
    text
}

#[tauri::command(rename_all = "camelCase")]
fn dictation_acceptance_adapter_ready(app: tauri::AppHandle, text_length: usize) -> bool {
    let Some(text) = dictation_acceptance_fixture_text_from_env() else {
        return false;
    };
    if !dictation_acceptance_fixture_is_armed() || text.len() != text_length {
        return false;
    }
    append_dictation_log(
        &app,
        serde_json::json!({
            "event": "acceptance-adapter-ready",
            "textLength": text_length,
            "sourceFingerprint": env!("VAI_PTT_SOURCE_FINGERPRINT"),
        }),
    );
    true
}

#[tauri::command(rename_all = "camelCase")]
async fn complete_dictation_release(
    app: tauri::AppHandle,
    release_id: u64,
    outcome: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let snapshot = DICTATION_TARGETS
            .get_or_init(|| std::sync::Mutex::new(std::collections::BTreeMap::new()))
            .lock()
            .map_err(|_| "Dictation target state unavailable".to_string())?
            .remove(&release_id);
        let elapsed_ms = snapshot
            .as_ref()
            .map(|item| system_time_ms().saturating_sub(item.released_at_ms));
        append_dictation_log(
            &app,
            serde_json::json!({
                "event": "completed-without-delivery",
                "releaseId": release_id,
                "outcome": outcome,
                "release": snapshot.as_ref(),
                "elapsedMs": elapsed_ms,
            }),
        );
        if snapshot.as_ref().is_some_and(|item| item.is_game) {
            let cue = if outcome == "no-speech" {
                GameDictationCue::NoSpeech
            } else {
                GameDictationCue::Error
            };
            play_game_dictation_cue(cue);
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
enum ClipboardBackup {
    Global { format: u32, bytes: Vec<u8> },
    Empty,
}

#[cfg(target_os = "windows")]
struct OpenClipboardGuard;

#[cfg(target_os = "windows")]
impl OpenClipboardGuard {
    fn acquire(owner_hwnd: isize) -> Result<Self, String> {
        use windows_sys::Win32::System::DataExchange::OpenClipboard;
        use windows_sys::Win32::UI::WindowsAndMessaging::IsWindow;
        if owner_hwnd == 0 || unsafe { IsWindow(owner_hwnd as _) } == 0 {
            return Err("Vai has no valid clipboard-owner window".to_string());
        }
        for _ in 0..10 {
            if unsafe { OpenClipboard(owner_hwnd as _) } != 0 {
                return Ok(Self);
            }
            std::thread::sleep(std::time::Duration::from_millis(8));
        }
        Err("Clipboard is busy; refusing to overwrite it".to_string())
    }
}

#[cfg(target_os = "windows")]
impl Drop for OpenClipboardGuard {
    fn drop(&mut self) {
        use windows_sys::Win32::System::DataExchange::CloseClipboard;
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

#[cfg(target_os = "windows")]
struct OwnedGlobal(windows_sys::Win32::Foundation::HGLOBAL);

#[cfg(target_os = "windows")]
impl OwnedGlobal {
    fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        use windows_sys::Win32::System::Memory::{
            GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
        };
        let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes.len()) };
        if handle.is_null() {
            return Err("GlobalAlloc failed for clipboard data".to_string());
        }
        let owned = Self(handle);
        let pointer = unsafe { GlobalLock(handle) };
        if pointer.is_null() {
            return Err("GlobalLock failed for clipboard data".to_string());
        }
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast::<u8>(), bytes.len());
            let _ = GlobalUnlock(handle);
        }
        Ok(owned)
    }

    fn transfer(mut self) -> windows_sys::Win32::Foundation::HANDLE {
        let handle = self.0;
        self.0 = std::ptr::null_mut();
        handle as windows_sys::Win32::Foundation::HANDLE
    }
}

#[cfg(target_os = "windows")]
impl Drop for OwnedGlobal {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::GlobalFree;
        if !self.0.is_null() {
            unsafe {
                let _ = GlobalFree(self.0);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn clipboard_formats_while_open() -> Result<Vec<u32>, String> {
    use windows_sys::Win32::Foundation::{GetLastError, SetLastError, ERROR_SUCCESS};
    use windows_sys::Win32::System::DataExchange::EnumClipboardFormats;
    let mut formats = Vec::new();
    let mut previous = 0u32;
    loop {
        unsafe { SetLastError(ERROR_SUCCESS) };
        let next = unsafe { EnumClipboardFormats(previous) };
        if next == 0 {
            let error = unsafe { GetLastError() };
            if error != ERROR_SUCCESS {
                return Err(format!(
                    "Cannot enumerate clipboard formats safely (Windows error {error})"
                ));
            }
            return Ok(formats);
        }
        formats.push(next);
        if formats.len() > 32 {
            return Err("Clipboard exposes too many formats for lossless preservation".to_string());
        }
        previous = next;
    }
}

#[cfg(target_os = "windows")]
fn copy_clipboard_global_while_open(format: u32) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::System::DataExchange::GetClipboardData;
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    let handle = unsafe { GetClipboardData(format) };
    if handle.is_null() {
        return Err(format!("GetClipboardData failed for format {format}"));
    }
    let global = handle as windows_sys::Win32::Foundation::HGLOBAL;
    let size = unsafe { GlobalSize(global) };
    if size == 0 || size > 64 * 1024 * 1024 {
        return Err(format!(
            "Unsafe clipboard payload size {size} for format {format}"
        ));
    }
    let pointer = unsafe { GlobalLock(global) };
    if pointer.is_null() {
        return Err(format!("GlobalLock failed for clipboard format {format}"));
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), size).to_vec() };
    unsafe {
        let _ = GlobalUnlock(global);
    }
    Ok(bytes)
}

#[cfg(target_os = "windows")]
fn set_clipboard_global_while_open(format: u32, allocation: OwnedGlobal) -> Result<(), String> {
    use windows_sys::Win32::System::DataExchange::SetClipboardData;
    let result = unsafe { SetClipboardData(format, allocation.0 as _) };
    if result.is_null() {
        return Err(format!("SetClipboardData failed for format {format}"));
    }
    let _ = allocation.transfer();
    Ok(())
}

#[cfg(target_os = "windows")]
enum PreparedClipboardBackup {
    Global {
        format: u32,
        allocation: OwnedGlobal,
    },
    Empty,
}

#[cfg(target_os = "windows")]
fn prepare_clipboard_backup(backup: &ClipboardBackup) -> Result<PreparedClipboardBackup, String> {
    match backup {
        ClipboardBackup::Global { format, bytes } => Ok(PreparedClipboardBackup::Global {
            format: *format,
            allocation: OwnedGlobal::from_bytes(bytes)?,
        }),
        ClipboardBackup::Empty => Ok(PreparedClipboardBackup::Empty),
    }
}

#[cfg(target_os = "windows")]
fn restore_prepared_clipboard_backup_while_open(
    prepared: PreparedClipboardBackup,
) -> Result<(), String> {
    use windows_sys::Win32::System::DataExchange::EmptyClipboard;
    if unsafe { EmptyClipboard() } == 0 {
        return Err("EmptyClipboard failed".to_string());
    }
    match prepared {
        PreparedClipboardBackup::Global { format, allocation } => {
            set_clipboard_global_while_open(format, allocation)
        }
        PreparedClipboardBackup::Empty => Ok(()),
    }
}

#[cfg(target_os = "windows")]
fn restore_clipboard_backup_while_open(backup: &ClipboardBackup) -> Result<(), String> {
    let prepared = prepare_clipboard_backup(backup)?;
    restore_prepared_clipboard_backup_while_open(prepared)
}

#[cfg(target_os = "windows")]
fn clipboard_unicode_text_while_open() -> Result<String, String> {
    const CF_UNICODETEXT: u32 = 13;
    let bytes = copy_clipboard_global_while_open(CF_UNICODETEXT)?;
    if bytes.len() % 2 != 0 {
        return Err("Clipboard Unicode text has an invalid byte length".to_string());
    }
    let units = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .take_while(|value| *value != 0)
        .collect::<Vec<_>>();
    String::from_utf16(&units).map_err(|_| "Clipboard Unicode text is invalid".to_string())
}

#[cfg(target_os = "windows")]
fn put_transcript_on_clipboard(
    text: &str,
    owner_hwnd: isize,
) -> Result<(ClipboardBackup, u32), String> {
    use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
    const CF_DIB: u32 = 8;
    const CF_UNICODETEXT: u32 = 13;
    const CF_DIBV5: u32 = 17;

    let mut encoded = text.encode_utf16().collect::<Vec<_>>();
    encoded.push(0);
    let transcript_bytes = encoded
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect::<Vec<_>>();
    // Allocate the value that will be transferred before EmptyClipboard. Once
    // emptied, allocation failure would otherwise destroy the previous value.
    let transcript_allocation = OwnedGlobal::from_bytes(&transcript_bytes)?;

    let guard = OpenClipboardGuard::acquire(owner_hwnd)?;
    let formats = clipboard_formats_while_open()?;
    let backup = match formats.as_slice() {
        [] => ClipboardBackup::Empty,
        [format] if matches!(*format, CF_UNICODETEXT | CF_DIB | CF_DIBV5) => {
            ClipboardBackup::Global {
                format: *format,
                bytes: copy_clipboard_global_while_open(*format)?,
            }
        }
        _ => {
            return Err(
                "Clipboard contains multiple or unsupported formats; refusing lossy overwrite"
                    .to_string(),
            )
        }
    };
    // Rollback storage is also allocated before the first destructive call.
    let rollback = prepare_clipboard_backup(&backup)?;

    use windows_sys::Win32::System::DataExchange::EmptyClipboard;
    if unsafe { EmptyClipboard() } == 0 {
        return Err("EmptyClipboard failed".to_string());
    }
    if let Err(error) = set_clipboard_global_while_open(CF_UNICODETEXT, transcript_allocation) {
        let rollback_result = restore_prepared_clipboard_backup_while_open(rollback);
        return Err(match rollback_result {
            Ok(()) => error,
            Err(rollback_error) => {
                format!("{error}; clipboard rollback also failed: {rollback_error}")
            }
        });
    }
    drop(guard);
    Ok((backup, unsafe { GetClipboardSequenceNumber() }))
}

#[cfg(target_os = "windows")]
fn replace_clipboard_with_transcript(transcript: &str) -> Result<u32, String> {
    use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;

    // Some ordinary clipboard owners publish several formats for one value
    // (Chrome commonly exposes Unicode text + HTML). If Vai cannot preserve that
    // entire payload losslessly, direct dictation must still work: explicitly
    // replace it with the transcript and leave the transcript there after paste.
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard
        .set_text(transcript.to_string())
        .map_err(|error| error.to_string())?;
    Ok(unsafe { GetClipboardSequenceNumber() })
}

#[cfg(target_os = "windows")]
fn clipboard_still_contains_transcript(
    owner_hwnd: isize,
    expected_sequence: u32,
    transcript: &str,
) -> bool {
    use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
    if unsafe { GetClipboardSequenceNumber() } != expected_sequence {
        return false;
    }
    let Ok(_guard) = OpenClipboardGuard::acquire(owner_hwnd) else {
        return false;
    };
    (unsafe { GetClipboardSequenceNumber() }) == expected_sequence
        && clipboard_unicode_text_while_open().as_deref() == Ok(transcript)
}

#[cfg(target_os = "windows")]
fn schedule_clipboard_restore(
    app: tauri::AppHandle,
    release_id: u64,
    text: String,
    backup: ClipboardBackup,
    expected_sequence: u32,
    owner_hwnd: isize,
) {
    std::thread::spawn(move || {
        use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
        std::thread::sleep(std::time::Duration::from_millis(900));
        let current_sequence = unsafe { GetClipboardSequenceNumber() };
        if current_sequence != expected_sequence {
            append_dictation_log(
                &app,
                serde_json::json!({
                    "event": "clipboard-restore",
                    "releaseId": release_id,
                    "result": "skipped-user-clipboard-changed",
                }),
            );
            return;
        }
        let Ok(_guard) = OpenClipboardGuard::acquire(owner_hwnd) else {
            append_dictation_log(
                &app,
                serde_json::json!({
                    "event": "clipboard-restore",
                    "releaseId": release_id,
                    "result": "clipboard-unavailable",
                }),
            );
            return;
        };
        let observed_sequence = unsafe { GetClipboardSequenceNumber() };
        let current_text = clipboard_unicode_text_while_open().ok();
        let restored = if should_restore_clipboard(
            observed_sequence,
            expected_sequence,
            current_text.as_deref(),
            text.as_str(),
        ) {
            restore_clipboard_backup_while_open(&backup)
        } else {
            Err("clipboard ownership changed".to_string())
        };
        append_dictation_log(
            &app,
            serde_json::json!({
                "event": "clipboard-restore",
                "releaseId": release_id,
                "result": if restored.is_ok() {
                    "restored"
                } else if observed_sequence != expected_sequence || current_text.as_deref() != Some(text.as_str()) {
                    "skipped-user-clipboard-changed"
                } else {
                    "restore-failed"
                },
            }),
        );
    });
}

fn should_restore_clipboard(
    current_sequence: u32,
    expected_sequence: u32,
    current_text: Option<&str>,
    temporary_text: &str,
) -> bool {
    current_sequence == expected_sequence && current_text == Some(temporary_text)
}

fn normalize_game_transcript(text: &str) -> String {
    // A newline can submit chat in some games. Game-bound dictation is always a
    // single message, so collapse every whitespace run before touching clipboard.
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(target_os = "windows")]
fn release_identity_still_active(snapshot: &DictationTargetSnapshot) -> bool {
    let (hwnd, focus_hwnd, _, _) = stable_foreground_focus_details();
    hwnd == snapshot.hwnd
        && process_id_for_hwnd(hwnd) == snapshot.process_id
        && (snapshot.process_created_ticks.is_none()
            || process_creation_ticks(snapshot.process_id) == snapshot.process_created_ticks)
        && focus_hwnd == snapshot.focus_hwnd
}

#[cfg(target_os = "windows")]
fn final_input_boundary_route(
    snapshot: &DictationTargetSnapshot,
    expected_evidence_sequence: u64,
    released_at_ms: u64,
    deadline_ms: u64,
) -> Option<&'static str> {
    let current_evidence_sequence = DICTATION_INPUT_EVIDENCE
        .get_or_init(|| std::sync::Mutex::new(DictationInputEvidence::default()))
        .lock()
        .map(|value| value.sequence)
        .unwrap_or_default();
    if current_evidence_sequence != expected_evidence_sequence {
        Some("clipboard-ready-input-changed")
    } else if system_time_ms().saturating_sub(released_at_ms) > deadline_ms {
        Some("clipboard-ready-latency-exceeded")
    } else if !active_dictation_keys_clear() {
        Some("clipboard-ready-modifiers-held")
    } else if !release_identity_still_active(snapshot) {
        Some("clipboard-ready-focus-changed")
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn same_release_process(
    snapshot: &DictationTargetSnapshot,
    current: &DictationTargetSnapshot,
) -> bool {
    current.hwnd == snapshot.hwnd
        && current.process_id == snapshot.process_id
        && (snapshot.process_created_ticks.is_none()
            || current.process_created_ticks == snapshot.process_created_ticks)
}

#[cfg(target_os = "windows")]
fn league_open_and_paste_eligible(
    snapshot: &DictationTargetSnapshot,
    closed_chat_workflow_enabled: bool,
    acceptance_fixture_armed: bool,
) -> bool {
    let concrete_game_target = snapshot.hwnd != 0
        && snapshot.process_id != 0
        && snapshot.process_created_ticks.is_some()
        && snapshot
            .window_class
            .as_deref()
            .is_some_and(class_looks_like_game_host)
        && matches!(
            snapshot.window_mode.as_str(),
            "windowed" | "borderless-or-exclusive"
        )
        && snapshot.field_detection == "game-without-text-focus-evidence";
    closed_chat_workflow_enabled
        && snapshot.is_game
        && !snapshot.text_field_plausible
        && concrete_game_target
        && (snapshot.process_name.as_deref() == Some("league of legends.exe")
            || (acceptance_fixture_armed
                && snapshot.process_name.as_deref() == Some("vai_ptt_target.exe")
                && snapshot.window_class.as_deref() == Some("VaiPttDeterministicGameTarget")))
}

#[cfg(target_os = "windows")]
fn concrete_post_open_field(target: &DictationTargetSnapshot) -> bool {
    target.text_field_plausible
        && matches!(
            target.field_detection.as_str(),
            "win32-caret" | "focused-text-control"
        )
}

#[cfg(target_os = "windows")]
fn owned_open_enter_was_uncontested(
    snapshot: &DictationTargetSnapshot,
    evidence: &DictationInputEvidence,
    enter_sent_at_ms: u64,
) -> bool {
    evidence.sequence == snapshot.input_evidence_sequence
        || (evidence.sequence == snapshot.input_evidence_sequence.saturating_add(1)
            && evidence.league_chat_armed
            && evidence.league_chat_hwnd == snapshot.hwnd
            && evidence.last_enter_hwnd == snapshot.hwnd
            && evidence.last_enter_at_ms >= enter_sent_at_ms
            && evidence.last_disarm_at_ms < enter_sent_at_ms)
}

#[cfg(target_os = "windows")]
fn delivery_preflight_route(
    snapshot: &DictationTargetSnapshot,
    current_hwnd: isize,
    current_process_id: u32,
    current_process_created_ticks: Option<u64>,
    current_focus_hwnd: isize,
    current_text_field_plausible: bool,
    current_input_evidence_sequence: u64,
    shell: bool,
    elapsed_ms: u64,
    allow_missing_release_field: bool,
    deadline_ms: u64,
) -> &'static str {
    if snapshot.hwnd == 0 || shell {
        "no-target"
    } else if !snapshot.text_field_plausible && !allow_missing_release_field {
        "clipboard-ready-no-field"
    } else if current_hwnd != snapshot.hwnd
        || current_process_id != snapshot.process_id
        || snapshot.process_created_ticks.is_some()
            && current_process_created_ticks != snapshot.process_created_ticks
        || current_focus_hwnd != snapshot.focus_hwnd
    {
        "clipboard-ready-focus-changed"
    } else if snapshot.is_game
        && current_input_evidence_sequence != snapshot.input_evidence_sequence
    {
        "clipboard-ready-input-changed"
    } else if snapshot.is_game && !current_text_field_plausible && !allow_missing_release_field {
        "clipboard-ready-field-closed"
    } else if elapsed_ms > deadline_ms {
        "clipboard-ready-latency-exceeded"
    } else {
        "pending"
    }
}

#[cfg(target_os = "windows")]
fn report_for_snapshot(
    snapshot: &DictationTargetSnapshot,
    route: &str,
    clipboard_restore_scheduled: bool,
    stt_quality: &str,
) -> DictationDeliveryReport {
    let release_to_paste_ms = system_time_ms().saturating_sub(snapshot.released_at_ms);
    DictationDeliveryReport {
        route: route.to_string(),
        release_id: snapshot.release_id,
        release_to_paste_ms,
        latency_budget_met: release_to_paste_ms <= 1_500,
        stt_quality: stt_quality.to_string(),
        target_window_class: snapshot.window_class.clone(),
        focused_control_class: snapshot.focused_class.clone(),
        target_process: snapshot.process_name.clone(),
        game: snapshot.is_game,
        text_field_plausible: snapshot.text_field_plausible,
        field_detection: snapshot.field_detection.clone(),
        clipboard_restore_scheduled,
    }
}

#[tauri::command(rename_all = "camelCase")]
async fn paste_into_foreground(
    app: tauri::AppHandle,
    release_id: u64,
    text: String,
    stt_quality: String,
    league_open_and_paste: bool,
) -> Result<DictationDeliveryReport, String> {
    let trimmed = text.trim_end().to_string();
    if trimmed.trim().is_empty() {
        return Err("Nothing to paste".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let snapshot = DICTATION_TARGETS
            .get_or_init(|| std::sync::Mutex::new(std::collections::BTreeMap::new()))
            .lock()
            .map_err(|_| "Dictation target state unavailable".to_string())?
            .remove(&release_id)
            .ok_or_else(|| format!("Unknown or expired dictation release {release_id}"))?;

        if snapshot.target_self {
            let report = report_for_snapshot(&snapshot, "self", false, &stt_quality);
            append_dictation_log(
                &app,
                serde_json::json!({ "event": "delivery", "report": &report }),
            );
            return Ok(report);
        }

        let sanitized = if snapshot.is_game {
            normalize_game_transcript(&trimmed)
        } else {
            trimmed
        };
        let open_and_paste = league_open_and_paste_eligible(
            &snapshot,
            league_open_and_paste,
            dictation_acceptance_fixture_is_armed(),
        );
        let deadline_ms = dictation_paste_deadline_ms(&snapshot, open_and_paste);

        let clipboard_owner_hwnd = app
            .get_webview_window("main")
            .and_then(|window| window.hwnd().ok())
            .map(|hwnd| hwnd.0 as isize)
            .unwrap_or_default();
        let (backup, clipboard_sequence) =
            match put_transcript_on_clipboard(&sanitized, clipboard_owner_hwnd) {
                Ok((backup, sequence)) => (Some(backup), sequence),
                Err(lossless_backup_error) => match replace_clipboard_with_transcript(&sanitized) {
                    Ok(sequence) => {
                        append_dictation_log(
                            &app,
                            serde_json::json!({
                                "event": "clipboard-fallback",
                                "releaseId": snapshot.release_id,
                                "result": "transcript-replaced-without-restore",
                                "losslessBackupError": lossless_backup_error,
                            }),
                        );
                        (None, sequence)
                    }
                    Err(replacement_error) => {
                        let report = report_for_snapshot(
                            &snapshot,
                            "clipboard-unavailable",
                            false,
                            &stt_quality,
                        );
                        append_dictation_log(
                            &app,
                            serde_json::json!({
                                "event": "delivery",
                                "report": &report,
                                "losslessBackupError": lossless_backup_error,
                                "replacementError": replacement_error,
                            }),
                        );
                        if snapshot.is_game {
                            play_game_dictation_cue(GameDictationCue::Error);
                        }
                        return Ok(report);
                    }
                },
            };
        let current_evidence = DICTATION_INPUT_EVIDENCE
            .get_or_init(|| std::sync::Mutex::new(DictationInputEvidence::default()))
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default();
        let current_target =
            inspect_dictation_target(&current_evidence, 0, snapshot.release_id, system_time_ms());
        let mut delivery_target = current_target.clone();
        let mut route = delivery_preflight_route(
            &snapshot,
            current_target.hwnd,
            current_target.process_id,
            current_target.process_created_ticks,
            current_target.focus_hwnd,
            current_target.text_field_plausible,
            current_target.input_evidence_sequence,
            current_target
                .window_class
                .as_deref()
                .is_some_and(window_class_is_shell),
            system_time_ms().saturating_sub(snapshot.released_at_ms),
            open_and_paste,
            deadline_ms,
        );

        if route == "pending" {
            let active_hotkey = DICTATION_HOTKEY
                .get_or_init(|| std::sync::Mutex::new(DictationHotkey::default()))
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default();
            let mut keys_clear = false;
            for _ in 0..20 {
                if dictation_keys_clear(&active_hotkey) {
                    keys_clear = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            if !keys_clear {
                route = "clipboard-ready-modifiers-held";
            }
        }

        if route == "pending" {
            std::thread::sleep(std::time::Duration::from_millis(35));
            let latest_evidence = DICTATION_INPUT_EVIDENCE
                .get_or_init(|| std::sync::Mutex::new(DictationInputEvidence::default()))
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default();
            let latest_target = inspect_dictation_target(
                &latest_evidence,
                0,
                snapshot.release_id,
                system_time_ms(),
            );
            delivery_target = latest_target.clone();
            route = delivery_preflight_route(
                &snapshot,
                latest_target.hwnd,
                latest_target.process_id,
                latest_target.process_created_ticks,
                latest_target.focus_hwnd,
                latest_target.text_field_plausible,
                latest_target.input_evidence_sequence,
                latest_target
                    .window_class
                    .as_deref()
                    .is_some_and(window_class_is_shell),
                system_time_ms().saturating_sub(snapshot.released_at_ms),
                open_and_paste,
                deadline_ms,
            );
            if open_and_paste && route == "pending" {
                let pre_enter_evidence_sequence = DICTATION_INPUT_EVIDENCE
                    .get_or_init(|| std::sync::Mutex::new(DictationInputEvidence::default()))
                    .lock()
                    .map(|value| value.sequence)
                    .unwrap_or_default();
                if !active_dictation_keys_clear() {
                    route = "clipboard-ready-modifiers-held";
                } else if pre_enter_evidence_sequence != latest_evidence.sequence {
                    route = "clipboard-ready-input-changed";
                } else if system_time_ms().saturating_sub(snapshot.released_at_ms) > deadline_ms {
                    route = "clipboard-ready-latency-exceeded";
                } else if !release_identity_still_active(&snapshot) {
                    route = "clipboard-ready-focus-changed";
                } else if !clipboard_still_contains_transcript(
                    clipboard_owner_hwnd,
                    clipboard_sequence,
                    &sanitized,
                ) {
                    route = "clipboard-ready-clipboard-changed";
                } else if let Some(boundary_route) = final_input_boundary_route(
                    &snapshot,
                    latest_evidence.sequence,
                    snapshot.released_at_ms,
                    deadline_ms,
                ) {
                    route = boundary_route;
                } else {
                    let enter_sent_at_ms = system_time_ms();
                    if send_enter_scancode().is_err() {
                        route = "clipboard-ready-chat-open-failed";
                    } else {
                        // League renders its own chat. Never treat our Enter alone as
                        // proof that an editable field opened: require a fresh native
                        // caret/control signal before the paste stage.
                        std::thread::sleep(std::time::Duration::from_millis(85));
                        let post_open_evidence = DICTATION_INPUT_EVIDENCE
                            .get_or_init(
                                || std::sync::Mutex::new(DictationInputEvidence::default()),
                            )
                            .lock()
                            .map(|value| value.clone())
                            .unwrap_or_default();
                        let post_open_target = inspect_dictation_target(
                            &post_open_evidence,
                            0,
                            snapshot.release_id,
                            system_time_ms(),
                        );
                        delivery_target = post_open_target.clone();
                        if !same_release_process(&snapshot, &post_open_target) {
                            route = "clipboard-ready-focus-changed";
                        } else if !owned_open_enter_was_uncontested(
                            &snapshot,
                            &post_open_evidence,
                            enter_sent_at_ms,
                        ) {
                            route = "clipboard-ready-input-changed";
                        } else if system_time_ms().saturating_sub(snapshot.released_at_ms)
                            > deadline_ms
                        {
                            route = "clipboard-ready-latency-exceeded";
                        } else if !concrete_post_open_field(&post_open_target) {
                            route = "clipboard-ready-chat-field-unproved";
                        } else {
                            let final_evidence_sequence = DICTATION_INPUT_EVIDENCE
                                .get_or_init(|| {
                                    std::sync::Mutex::new(DictationInputEvidence::default())
                                })
                                .lock()
                                .map(|value| value.sequence)
                                .unwrap_or_default();
                            if final_evidence_sequence != post_open_evidence.sequence {
                                route = "clipboard-ready-input-changed";
                            } else if system_time_ms().saturating_sub(snapshot.released_at_ms)
                                > deadline_ms
                            {
                                route = "clipboard-ready-latency-exceeded";
                            } else if !active_dictation_keys_clear() {
                                route = "clipboard-ready-modifiers-held";
                            } else if !release_identity_still_active(&post_open_target) {
                                route = "clipboard-ready-focus-changed";
                            } else if !clipboard_still_contains_transcript(
                                clipboard_owner_hwnd,
                                clipboard_sequence,
                                &sanitized,
                            ) {
                                route = "clipboard-ready-clipboard-changed";
                            } else if let Some(boundary_route) = final_input_boundary_route(
                                &post_open_target,
                                post_open_evidence.sequence,
                                snapshot.released_at_ms,
                                deadline_ms,
                            ) {
                                route = boundary_route;
                            } else if send_ctrl_v_scancode().is_ok() {
                                route = "open-and-paste-input-accepted";
                            } else {
                                route = "clipboard-ready-sendinput-failed";
                            }
                        }
                    }
                }
            } else if route == "pending" {
                let final_evidence_sequence = DICTATION_INPUT_EVIDENCE
                    .get_or_init(|| std::sync::Mutex::new(DictationInputEvidence::default()))
                    .lock()
                    .map(|value| value.sequence)
                    .unwrap_or_default();
                if final_evidence_sequence != snapshot.input_evidence_sequence {
                    route = "clipboard-ready-input-changed";
                } else if system_time_ms().saturating_sub(snapshot.released_at_ms) > deadline_ms {
                    route = "clipboard-ready-latency-exceeded";
                } else if !active_dictation_keys_clear() {
                    route = "clipboard-ready-modifiers-held";
                } else if !release_identity_still_active(&snapshot) {
                    route = "clipboard-ready-focus-changed";
                } else if !clipboard_still_contains_transcript(
                    clipboard_owner_hwnd,
                    clipboard_sequence,
                    &sanitized,
                ) {
                    route = "clipboard-ready-clipboard-changed";
                } else if let Some(boundary_route) = final_input_boundary_route(
                    &snapshot,
                    snapshot.input_evidence_sequence,
                    snapshot.released_at_ms,
                    deadline_ms,
                ) {
                    route = boundary_route;
                } else if send_ctrl_v_scancode().is_ok() {
                    route = "sendinput-accepted";
                } else {
                    route = "clipboard-ready-sendinput-failed";
                }
            }
        }

        // SendInput acceptance is not proof that a lagging game consumed Ctrl+V.
        // Restoring an old clipboard value too early could paste private prior data
        // into the game. Preserve the transcript for games until a future consumer
        // acknowledgment exists; non-game editors keep conditional restoration.
        let input_accepted = matches!(
            route,
            "sendinput-accepted" | "open-and-paste-input-accepted"
        );
        let restore = input_accepted
            && backup.is_some()
            && (!snapshot.is_game
                || snapshot.process_name.as_deref() == Some("vai_ptt_target.exe"));
        let report = if restore {
            let report = report_for_snapshot(&snapshot, route, true, &stt_quality);
            schedule_clipboard_restore(
                app.clone(),
                snapshot.release_id,
                sanitized,
                backup.expect("restore requires a lossless clipboard backup"),
                clipboard_sequence,
                clipboard_owner_hwnd,
            );
            report
        } else {
            report_for_snapshot(&snapshot, route, false, &stt_quality)
        };
        if snapshot.is_game {
            play_game_dictation_cue(game_dictation_cue_for_route(route));
        }
        append_dictation_log(
            &app,
            serde_json::json!({
                "event": "delivery",
                "report": &report,
                "deliveryInspection": &delivery_target,
                "leagueOpenAndPasteRequested": league_open_and_paste,
                "leagueOpenAndPasteEligible": open_and_paste,
            }),
        );
        return Ok(report);
    }

    #[cfg(not(target_os = "windows"))]
    Err("Global dictation delivery is currently Windows-only".to_string())
}

const BUBBLE_LABEL: &str = "dictation-bubble";
const BUBBLE_W: f64 = 460.0;
const BUBBLE_H: f64 = 180.0;

fn ensure_dictation_bubble(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(BUBBLE_LABEL) {
        let _ = existing.set_focusable(false);
        return Ok(existing);
    }
    tauri::WebviewWindowBuilder::new(
        app,
        BUBBLE_LABEL,
        tauri::WebviewUrl::App("index.html?view=dictation-bubble".into()),
    )
    .title("Vai Dictation")
    .inner_size(BUBBLE_W, BUBBLE_H)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    // Windows enables a DWM shadow on undecorated windows by default, which forces
    // opaque compositing and paints the "transparent" area solid black instead of
    // letting it show through (tauri-apps/tauri#8632, #8308). Must be off.
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .focusable(false)
    .build()
    .map_err(|e| e.to_string())
}

/// Bottom-center of the monitor containing the foreground target. This keeps the
/// indicator with a borderless game even when the cursor is on another display.
fn position_dictation_bubble(
    app: &tauri::AppHandle,
    bubble: &tauri::WebviewWindow,
    release_id: Option<u64>,
) {
    #[cfg(target_os = "windows")]
    let foreground_point = {
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect};
        let hwnd = unsafe { GetForegroundWindow() };
        let mut rect = unsafe { std::mem::zeroed::<RECT>() };
        if !hwnd.is_null() && unsafe { GetWindowRect(hwnd, &mut rect) } != 0 {
            Some(tauri::PhysicalPosition::new(
                (rect.left + rect.right) / 2,
                (rect.top + rect.bottom) / 2,
            ))
        } else {
            None
        }
    };
    #[cfg(not(target_os = "windows"))]
    let foreground_point: Option<tauri::PhysicalPosition<i32>> = None;

    #[cfg(target_os = "windows")]
    let release_point = if let Some(release_id) = release_id {
        DICTATION_BUBBLE_MONITOR
            .get_or_init(|| std::sync::Mutex::new(std::collections::BTreeMap::new()))
            .lock()
            .ok()
            .and_then(|value| value.get(&release_id).cloned())
            .map(|bounds| {
                tauri::PhysicalPosition::new(
                    (bounds.left + bounds.right) / 2,
                    (bounds.top + bounds.bottom) / 2,
                )
            })
    } else {
        None
    };
    #[cfg(not(target_os = "windows"))]
    let release_point: Option<tauri::PhysicalPosition<i32>> = None;

    let monitor = release_point
        .or(foreground_point)
        .and_then(|pos| {
            app.monitor_from_point(pos.x as f64, pos.y as f64)
                .ok()
                .flatten()
        })
        .or_else(|| {
            app.cursor_position()
                .ok()
                .and_then(|pos| app.monitor_from_point(pos.x, pos.y).ok().flatten())
        })
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let size = m.size();
        let mpos = m.position();
        let w = (BUBBLE_W * scale) as i32;
        let h = (BUBBLE_H * scale) as i32;
        let x = mpos.x + ((size.width as i32 - w) / 2).max(0);
        let y = mpos.y + size.height as i32 - h - (72.0 * scale) as i32;
        let _ = bubble.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

fn set_dictation_bubble_interactive(bubble: &tauri::WebviewWindow, interactive: bool) {
    // Active dictation stays click-through so it cannot disturb the target field.
    // Clipboard/error cards are deliberate fallback surfaces and need real controls.
    let _ = bubble.set_focusable(interactive);

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
            WS_EX_TRANSPARENT,
        };

        if let Ok(hwnd) = bubble.hwnd() {
            unsafe {
                let hwnd = hwnd.0;
                let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let passive_flags = WS_EX_NOACTIVATE as isize | WS_EX_TRANSPARENT as isize;
                let next_style = if interactive {
                    (ex_style & !passive_flags) | WS_EX_TOOLWINDOW as isize
                } else {
                    ex_style | passive_flags | WS_EX_TOOLWINDOW as isize
                };
                let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style);
            }
        }
    }
}

fn show_dictation_bubble_without_activation(bubble: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
        };

        if let Ok(hwnd) = bubble.hwnd() {
            let hwnd = hwnd.0;
            unsafe {
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
            return;
        }
    }

    let _ = bubble.show();
}

/// Monotonic counter over bubble updates. A native auto-hide thread captures the
/// value at spawn and hides unless a genuinely NEW dictation has begun since — so a
/// stale "Pasted" hide can't clobber a fresh dictation, but a trailing/out-of-order
/// non-dictation update can't STRAND the "Pasted" pill on screen either.
static BUBBLE_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Generation of the most recent update that put the bubble into an ACTIVE state
/// (listening/transcribing/polishing) — i.e. a new dictation started. The auto-hide
/// only stands down when THIS moves past it; ordinary trailing updates no longer
/// cancel a pending hide, which was the cause of the stuck "Pasted" pill.
static BUBBLE_ACTIVE_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn dictation_bubble_phase_is_interactive(kind: Option<&str>, via: Option<&str>) -> bool {
    matches!(kind, Some("modal" | "error")) || (kind == Some("pasted") && via == Some("clipboard"))
}

/// Show/refresh the bubble with a phase payload (JSON built by the frontend).
/// JSON is a syntactic subset of JS, so embedding it directly in eval is safe.
#[tauri::command(rename_all = "camelCase")]
async fn dictation_bubble_update(
    app: tauri::AppHandle,
    phase: String,
    release_id: Option<u64>,
) -> Result<(), String> {
    // Reject anything that isn't a plain JSON object — this string is eval'd.
    let parsed: serde_json::Value =
        serde_json::from_str(&phase).map_err(|_| "Invalid phase payload".to_string())?;
    let object = parsed
        .as_object()
        .ok_or_else(|| "Invalid phase payload".to_string())?;
    let kind = object.get("kind").and_then(serde_json::Value::as_str);
    let via = object.get("via").and_then(serde_json::Value::as_str);
    let clipboard_fallback = kind == Some("pasted") && via == Some("clipboard");
    let interactive = dictation_bubble_phase_is_interactive(kind, via);
    let active = matches!(kind, Some("listening" | "transcribing" | "polishing"));
    let pasted = kind == Some("pasted");
    // Re-serialize before eval so only canonical JSON reaches the WebView.
    let phase = serde_json::to_string(&parsed).map_err(|error| error.to_string())?;

    let bubble = ensure_dictation_bubble(&app)?;
    set_dictation_bubble_interactive(&bubble, interactive);
    let monitor_release_id = if kind == Some("listening") {
        None
    } else {
        release_id
    };
    position_dictation_bubble(&app, &bubble, monitor_release_id);
    bubble
        .eval(&format!(
            "window.dispatchEvent(new CustomEvent('vai:bubble-phase',{{detail:{phase}}}))"
        ))
        .map_err(|e| e.to_string())?;
    if !bubble.is_visible().unwrap_or(false) {
        show_dictation_bubble_without_activation(&bubble);
    }

    // Native auto-hide for terminal confirmations. The WebView throttles JS timers
    // when this window is backgrounded, which left the "Pasted" pill stuck on screen
    // for ages. A Rust timer isn't throttled. Only terminal 'pasted' phases auto-hide
    // (modal/error stay until dismissed). The pending hide only stands down when a NEW
    // dictation actually starts (an active phase) — not on any trailing update — so a
    // late/out-of-order sync can no longer strand the pill.
    let generation = BUBBLE_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    if active {
        BUBBLE_ACTIVE_GEN.store(generation, std::sync::atomic::Ordering::SeqCst);
    }
    if pasted && !clipboard_fallback {
        let hide_ms: u64 = 1600;
        let app_hide = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(hide_ms));
            // Hide unless a fresh dictation lit the bubble back up after us.
            if BUBBLE_ACTIVE_GEN.load(std::sync::atomic::Ordering::SeqCst) <= generation {
                if let Some(bubble) = app_hide.get_webview_window(BUBBLE_LABEL) {
                    let _ = bubble.hide();
                }
            }
        });
    }
    Ok(())
}

#[tauri::command]
async fn dictation_bubble_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(bubble) = app.get_webview_window(BUBBLE_LABEL) {
        let _ = bubble.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ =
            main.eval("window.dispatchEvent(new CustomEvent('vai:dictation-bubble-dismissed'))");
    }
    Ok(())
}

#[tauri::command]
fn copy_dictation_text(text: String) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Nothing to copy".to_string());
    }
    if text.len() > 1_000_000 {
        return Err("Dictation text is too large to copy".to_string());
    }
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_text(text).map_err(|error| error.to_string())
}

/// Bring the main Vai window forward (bubble cogwheel → voice settings).
#[tauri::command]
async fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
        let _ = main.eval("window.dispatchEvent(new CustomEvent('vai:open-voice-settings'))");
    }
    Ok(())
}

// ── Council-IDE: scoped, guarded filesystem access ─────────────────────────────
//
// The folder attached to a chat is the ONLY area agents may read or write. Every path
// is resolved inside the chosen root (canonicalized) so an agent-proposed path can
// never escape it via `..` or a symlink. Writes happen ONLY through `ide_write_file`,
// and the frontend only calls it after the user approved that diff.

const IDE_IGNORE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    "out",
    "coverage",
    ".venv",
    "__pycache__",
    ".idea",
    ".vscode",
];
const IDE_MAX_ENTRIES: usize = 5000;
const IDE_MAX_FILE_BYTES: u64 = 512 * 1024;

fn ide_binary_ext(path: &std::path::Path) -> bool {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
    {
        Some(ext) => matches!(
            ext.as_str(),
            "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "ico"
                | "pdf"
                | "zip"
                | "gz"
                | "tar"
                | "exe"
                | "dll"
                | "wasm"
                | "woff"
                | "woff2"
                | "ttf"
                | "otf"
                | "mp3"
                | "mp4"
                | "mov"
                | "wav"
                | "bin"
                | "node"
        ),
        None => false,
    }
}

/// Resolve `rel` inside `root`, rejecting anything that escapes the workspace.
fn ide_resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty()
        || rel.starts_with('/')
        || rel.starts_with('\\')
        || rel.contains("..")
        || rel.chars().nth(1) == Some(':')
    {
        return Err("unsafe path".to_string());
    }
    let root_canon =
        std::fs::canonicalize(root).map_err(|e| format!("workspace not found: {e}"))?;
    let joined = root_canon.join(rel.replace('\\', "/"));
    // If the target exists, confirm its REAL path is still inside root (blocks symlink escapes).
    if joined.exists() {
        let real = std::fs::canonicalize(&joined).map_err(|e| e.to_string())?;
        if !real.starts_with(&root_canon) {
            return Err("path escapes workspace".to_string());
        }
    }
    Ok(joined)
}

#[derive(serde::Serialize)]
struct IdeEntry {
    path: String,
    dir: bool,
}

/// List the workspace tree (relative paths), skipping vendored/build dirs and capping size.
#[tauri::command]
async fn ide_list_dir(root: String) -> Result<String, String> {
    let root_canon =
        std::fs::canonicalize(&root).map_err(|e| format!("workspace not found: {e}"))?;
    let mut out: Vec<IdeEntry> = Vec::new();
    let mut stack = vec![root_canon.clone()];
    while let Some(dir) = stack.pop() {
        if out.len() >= IDE_MAX_ENTRIES {
            break;
        }
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in rd.flatten() {
            let p = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir && (IDE_IGNORE_DIRS.contains(&name.as_str()) || name.starts_with('.')) {
                continue;
            }
            let rel = match p.strip_prefix(&root_canon) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            if is_dir {
                stack.push(p.clone());
            }
            out.push(IdeEntry {
                path: rel,
                dir: is_dir,
            });
            if out.len() >= IDE_MAX_ENTRIES {
                break;
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Read one text file from the workspace (rejects binary/oversized).
#[tauri::command]
async fn ide_read_file(root: String, rel: String) -> Result<String, String> {
    let path = ide_resolve(&root, &rel)?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > IDE_MAX_FILE_BYTES {
        return Err("file too large to open".to_string());
    }
    if ide_binary_ext(&path) {
        return Err("binary file".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.contains(&0u8) {
        return Err("binary file".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8".to_string())
}

const ATTACH_MAX_FILE_BYTES: u64 = 512 * 1024;

/// Native folder picker — attach a whole project (includes subfolders in the IDE tree).
#[tauri::command]
fn pick_project_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Select project folder")
        .pick_folder()
        .map(|p| p.display().to_string())
}

/// Native multi-file picker — attach individual files into the composer context.
#[tauri::command]
fn pick_attach_files() -> Vec<String> {
    rfd::FileDialog::new()
        .set_title("Select files to attach")
        .pick_files()
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.display().to_string())
        .collect()
}

/// Read a user-picked file (absolute path) for composer attachment.
#[tauri::command]
fn read_absolute_text_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > ATTACH_MAX_FILE_BYTES {
        return Err("file too large to attach (max 512 KB)".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.contains(&0u8) {
        return Err("binary file".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8".to_string())
}

/// Snapshot workspace before applying approved diffs (git stash or checkpoint marker).
#[tauri::command]
fn ide_create_checkpoint(root: String) -> Result<String, String> {
    let root_path = std::path::PathBuf::from(root.trim());
    if !root_path.is_dir() {
        return Err("workspace not found".to_string());
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let id = format!("vai-{ts}");

    if root_path.join(".git").exists() {
        let mut cmd = Command::new("git");
        cmd.args(["stash", "push", "-u", "-m", &format!("vai-pre-apply-{id}")])
            .current_dir(&root_path);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        match cmd.output() {
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                if out.status.success() || stderr.contains("No local changes") {
                    return Ok(format!("git-stash:{id}"));
                }
            }
            Err(_) => { /* fall through to file checkpoint */ }
        }
    }

    let checkpoint_dir = std::env::var("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("vai")
        .join("checkpoints")
        .join(&id);
    std::fs::create_dir_all(&checkpoint_dir).map_err(|e| e.to_string())?;
    let manifest = format!(
        r#"{{"root":"{}","createdAt":{}}}"#,
        root_path.display().to_string().replace('\\', "\\\\"),
        ts
    );
    std::fs::write(checkpoint_dir.join("manifest.json"), manifest).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Spawn a long-running dev server in the workspace (background child process).
#[tauri::command]
fn ide_spawn_dev_server(
    root: String,
    command: String,
    state: State<'_, DevServerState>,
) -> Result<String, String> {
    let root = root.trim().to_string();
    let command = command.trim().to_string();
    if root.is_empty() || command.is_empty() {
        return Err("root and command required".to_string());
    }
    if let Some(mut child) = state.0.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let log_path = std::env::temp_dir().join(format!("vai-dev-{ts}.log"));
    let log_display = log_path.display().to_string();
    // `2>&1` (duplicate stderr onto stdout) — the previous `2>>&1` is not valid cmd
    // redirection, so dev-server stderr never reached the log and the repair loop
    // diagnosed crashes blind.
    let inner = format!("{command} 1>> \"{log_display}\" 2>&1");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", &inner]);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-c", &inner]);
        c
    };
    cmd.current_dir(&root);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(child);
    Ok(log_display)
}

#[tauri::command]
fn ide_stop_dev_server(state: State<'_, DevServerState>) -> Result<(), String> {
    if let Some(mut child) = state.0.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
fn ide_probe_port(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;
    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap());
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

#[tauri::command]
fn ide_tail_dev_log(path: String, max_bytes: u64) -> Result<String, String> {
    // Only the app's own dev-server logs (vai-dev-*.log in the OS temp dir) may be
    // tailed. This command is renderer-reachable, so without this guard it would be
    // an arbitrary-file-read primitive for anything that compromises the webview.
    let requested = std::path::PathBuf::from(&path);
    let file_name = requested.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !file_name.starts_with("vai-dev-") || !file_name.ends_with(".log") {
        return Err("not a vai dev log".to_string());
    }
    let temp_canon = std::fs::canonicalize(std::env::temp_dir()).map_err(|e| e.to_string())?;
    let path = std::fs::canonicalize(&requested).map_err(|e| e.to_string())?;
    if !path.starts_with(&temp_canon) {
        return Err("log path outside the temp dir".to_string());
    }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let len = meta.len();
    if len == 0 {
        return Ok(String::new());
    }
    let start = len.saturating_sub(max_bytes);
    let to_read = (len - start) as usize;
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; to_read];
    file.read_exact(&mut buf).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Run a shell command in the workspace root (terminal panel).
#[tauri::command]
async fn ide_run_command(root: String, command: String) -> Result<String, String> {
    let root = root.trim().to_string();
    let command = command.trim().to_string();
    if root.is_empty() {
        return Err("empty workspace root".to_string());
    }
    if command.is_empty() {
        return Err("empty command".to_string());
    }
    let output = tauri::async_runtime::spawn_blocking(move || {
        // §9.1: never assume one platform. cmd on Windows, sh everywhere else.
        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = Command::new("cmd");
            c.args(["/C", &command]);
            c
        };
        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = Command::new("sh");
            c.args(["-c", &command]);
            c
        };
        cmd.current_dir(&root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut combined = stdout.into_owned();
    if !stderr.is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&stderr);
    }
    if combined.is_empty() && !output.status.success() {
        combined = format!("Command exited with code {:?}", output.status.code());
    }
    Ok(combined)
}

/// Write one file into the workspace — the ONLY write path, called after diff approval.
#[tauri::command]
async fn ide_write_file(root: String, rel: String, content: String) -> Result<(), String> {
    let path = ide_resolve(&root, &rel)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .manage(DevServerState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_engine,
            stop_engine,
            open_external,
            load_desktop_session_token,
            save_desktop_session_token,
            paste_into_foreground,
            configure_dictation_hotkey,
            dictation_acceptance_fixture_text,
            dictation_acceptance_adapter_ready,
            complete_dictation_release,
            dictation_bubble_update,
            dictation_bubble_hide,
            copy_dictation_text,
            focus_main_window,
            ide_list_dir,
            ide_read_file,
            ide_write_file,
            pick_project_folder,
            pick_attach_files,
            read_absolute_text_file,
            ide_create_checkpoint,
            ide_run_command,
            ide_spawn_dev_server,
            ide_stop_dev_server,
            ide_probe_port,
            ide_tail_dev_log
        ])
        .setup(|app| {
            // Build the hidden click-through bubble while Vai owns focus. Creating a
            // WebView2 window lazily during an external hold can transiently activate
            // it before WS_EX_NOACTIVATE is applied, stealing the game's release field.
            // Prewarming makes every game-time update operate on an existing window.
            if let Err(error) = ensure_dictation_bubble(app.handle()) {
                eprintln!("[VAI] Failed to prewarm dictation bubble: {error}");
            }
            // Auto-start the AI engine when the app opens
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state: State<'_, SidecarState> = app_handle.state();
                if let Err(e) = start_engine(app_handle.clone(), state).await {
                    eprintln!("[VAI] Failed to start engine: {}", e);
                }
            });
            // OS-registered global hold-to-dictate, anywhere on the machine.
            spawn_dictation_chord_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(all(test, target_os = "windows"))]
mod dictation_tests {
    use super::*;

    #[test]
    fn desktop_session_token_round_trips_through_windows_user_protection() {
        let token = b"vai-session-fixture-not-a-real-credential";
        let protected = protect_desktop_session_token(token).expect("protect token");
        assert_ne!(protected, token);
        let restored = unprotect_desktop_session_token(&protected).expect("restore token");
        assert_eq!(restored, token);
    }

    #[test]
    fn desktop_session_protection_rejects_empty_or_oversized_tokens() {
        assert!(protect_desktop_session_token(b"").is_err());
        assert!(
            protect_desktop_session_token(&vec![b'x'; MAX_DESKTOP_SESSION_TOKEN_BYTES + 1])
                .is_err()
        );
    }

    fn snapshot(text_field_plausible: bool) -> DictationTargetSnapshot {
        DictationTargetSnapshot {
            release_id: 7,
            released_at_ms: 1,
            hwnd: 101,
            focus_hwnd: 202,
            process_id: 303,
            process_created_ticks: Some(404),
            process_name: Some("league of legends.exe".to_string()),
            window_class: Some("RiotWindowClass".to_string()),
            focused_class: Some("RiotWindowClass".to_string()),
            monitor: Some(DictationMonitorBounds {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1080,
            }),
            window_mode: "borderless-or-exclusive".to_string(),
            is_game: true,
            target_self: false,
            text_field_plausible,
            field_detection: if text_field_plausible {
                "win32-caret".to_string()
            } else {
                "game-without-text-focus-evidence".to_string()
            },
            input_evidence_sequence: 11,
        }
    }

    fn test_preflight(
        snapshot: &DictationTargetSnapshot,
        current_hwnd: isize,
        current_process_id: u32,
        current_process_created_ticks: Option<u64>,
        current_focus_hwnd: isize,
        current_text_field_plausible: bool,
        shell: bool,
        elapsed_ms: u64,
    ) -> &'static str {
        delivery_preflight_route(
            snapshot,
            current_hwnd,
            current_process_id,
            current_process_created_ticks,
            current_focus_hwnd,
            current_text_field_plausible,
            snapshot.input_evidence_sequence,
            shell,
            elapsed_ms,
            false,
            DICTATION_GAME_PASTE_DEADLINE_MS,
        )
    }

    #[test]
    fn game_without_field_never_reaches_input_stage() {
        let route = test_preflight(&snapshot(false), 101, 303, Some(404), 202, true, false, 0);
        assert_eq!(route, "clipboard-ready-no-field");
    }

    #[test]
    fn focused_control_change_after_release_refuses_paste() {
        let route = test_preflight(&snapshot(true), 101, 303, Some(404), 999, true, false, 0);
        assert_eq!(route, "clipboard-ready-focus-changed");
    }

    #[test]
    fn process_mismatch_after_release_refuses_paste() {
        let route = test_preflight(&snapshot(true), 101, 404, Some(404), 202, true, false, 0);
        assert_eq!(route, "clipboard-ready-focus-changed");
    }

    #[test]
    fn reused_process_identity_after_release_refuses_paste() {
        let route = test_preflight(&snapshot(true), 101, 303, Some(999), 202, true, false, 0);
        assert_eq!(route, "clipboard-ready-focus-changed");
    }

    #[test]
    fn exact_release_target_with_field_is_eligible() {
        let route = test_preflight(&snapshot(true), 101, 303, Some(404), 202, true, false, 0);
        assert_eq!(route, "pending");
    }

    #[test]
    fn game_field_closed_after_release_never_reaches_input_stage() {
        let route = test_preflight(&snapshot(true), 101, 303, Some(404), 202, false, false, 200);
        assert_eq!(route, "clipboard-ready-field-closed");
    }

    #[test]
    fn game_input_after_release_never_reaches_input_stage() {
        let release = snapshot(true);
        let route = delivery_preflight_route(
            &release,
            101,
            303,
            Some(404),
            202,
            true,
            release.input_evidence_sequence + 1,
            false,
            200,
            false,
            DICTATION_GAME_PASTE_DEADLINE_MS,
        );
        assert_eq!(route, "clipboard-ready-input-changed");
    }

    #[test]
    fn zero_release_focus_is_an_identity_not_a_wildcard() {
        let mut release = snapshot(true);
        release.focus_hwnd = 0;
        let route = test_preflight(&release, 101, 303, Some(404), 202, true, false, 0);
        assert_eq!(route, "clipboard-ready-focus-changed");
    }

    #[test]
    fn late_transcript_is_clipboard_only_before_sendinput() {
        let at_deadline = test_preflight(
            &snapshot(true),
            101,
            303,
            Some(404),
            202,
            true,
            false,
            DICTATION_GAME_PASTE_DEADLINE_MS,
        );
        let late = test_preflight(
            &snapshot(true),
            101,
            303,
            Some(404),
            202,
            true,
            false,
            DICTATION_GAME_PASTE_DEADLINE_MS + 1,
        );
        assert_eq!(at_deadline, "pending");
        assert_eq!(late, "clipboard-ready-latency-exceeded");
    }

    #[test]
    fn normal_app_transcription_gets_a_realistic_delivery_window() {
        let mut browser = snapshot(true);
        browser.is_game = false;
        browser.process_name = Some("chrome.exe".to_string());
        browser.window_class = Some("Chrome_WidgetWin_1".to_string());
        browser.focused_class = Some("Chrome_RenderWidgetHostHWND".to_string());

        assert!(class_looks_like_text_host("Chrome_WidgetWin_1"));
        assert!(class_looks_like_text_host("Chrome_RenderWidgetHostHWND"));
        assert_eq!(
            dictation_paste_deadline_ms(&browser, false),
            DICTATION_NORMAL_PASTE_DEADLINE_MS,
        );
        assert_eq!(
            delivery_preflight_route(
                &browser,
                browser.hwnd,
                browser.process_id,
                browser.process_created_ticks,
                browser.focus_hwnd,
                true,
                browser.input_evidence_sequence,
                false,
                5_000,
                false,
                dictation_paste_deadline_ms(&browser, false),
            ),
            "pending",
        );
    }

    #[test]
    fn only_actionable_dictation_cards_capture_pointer_input() {
        assert!(dictation_bubble_phase_is_interactive(Some("modal"), None));
        assert!(dictation_bubble_phase_is_interactive(Some("error"), None));
        assert!(dictation_bubble_phase_is_interactive(
            Some("pasted"),
            Some("clipboard")
        ));
        assert!(!dictation_bubble_phase_is_interactive(
            Some("pasted"),
            Some("paste")
        ));
        assert!(!dictation_bubble_phase_is_interactive(
            Some("listening"),
            None
        ));
    }

    #[test]
    fn focus_churn_matrix_has_exactly_one_eligible_identity() {
        let mut eligible = 0;
        let mut exercised = 0;
        for hwnd in [101, 999] {
            for process_id in [303, 999] {
                for created in [Some(404), Some(999), None] {
                    for focus in [202, 999] {
                        for shell in [false, true] {
                            exercised += 1;
                            let route = test_preflight(
                                &snapshot(true),
                                hwnd,
                                process_id,
                                created,
                                focus,
                                true,
                                shell,
                                0,
                            );
                            let exact = hwnd == 101
                                && process_id == 303
                                && created == Some(404)
                                && focus == 202
                                && !shell;
                            assert_eq!(route == "pending", exact, "identity tuple unexpectedly routed: hwnd={hwnd} pid={process_id} created={created:?} focus={focus} shell={shell}");
                            if route == "pending" {
                                eligible += 1;
                            }
                        }
                    }
                }
            }
        }
        assert_eq!(exercised, 48);
        assert_eq!(eligible, 1);
    }

    #[test]
    fn focused_game_window_is_a_trusted_paste_target() {
        // User directive: paste into the focused input in any app, games
        // included. A game with no OS-visible caret is trusted (the user opened
        // chat before speaking); paste lands on release with no auto-Enter.
        let mut exercised = 0;
        for focused_class_text in [false, true] {
            for foreground_text_host in [false, true] {
                for recent_chat_click in [false, true] {
                    for recent_enter in [false, true] {
                        exercised += 1;
                        let (plausible, _reason) = determine_text_field(
                            true,
                            false,
                            focused_class_text,
                            false,
                            true,
                            false,
                            recent_chat_click,
                            recent_enter,
                            foreground_text_host,
                            false,
                        );
                        assert!(plausible);
                    }
                }
            }
        }
        assert_eq!(exercised, 16);
    }

    #[test]
    fn no_field_evidence_is_never_overridden_by_later_focus_state() {
        for current_hwnd in [0, 101, 999] {
            for current_focus in [0, 202, 999] {
                let route = test_preflight(
                    &snapshot(false),
                    current_hwnd,
                    303,
                    Some(404),
                    current_focus,
                    true,
                    false,
                    0,
                );
                assert_eq!(route, "clipboard-ready-no-field");
            }
        }
    }

    #[test]
    fn league_game_pastes_into_focused_window_without_enter_evidence() {
        // Even with no recent-Enter chat evidence, a focused in-match League
        // window is now a trusted paste target (user directive). Paste lands on
        // release; the user presses Enter to send.
        let enter_at = 1_000u64;
        let world_click_at = 1_500u64;
        let recent_enter = enter_at > world_click_at;
        let (plausible, reason) = determine_text_field(
            true,
            false,
            false,
            false,
            true,
            true,
            false,
            recent_enter,
            false,
            false,
        );
        assert!(plausible);
        assert_eq!(reason, "focused-window-user-trusted");
    }

    #[test]
    fn focused_game_pastes_regardless_of_click_geometry() {
        let (plausible, reason) = determine_text_field(
            true, false, false, false, true, true, true, false, false, false,
        );
        assert!(plausible);
        assert_eq!(reason, "focused-window-user-trusted");
    }

    #[test]
    fn league_enter_toggles_open_then_closed() {
        let mut evidence = DictationInputEvidence::default();
        record_enter_evidence(&mut evidence, 101, true, 1_000);
        assert!(evidence.league_chat_armed);
        assert_eq!(evidence.sequence, 1);
        record_enter_evidence(&mut evidence, 101, true, 1_200);
        assert!(!evidence.league_chat_armed);
        assert_eq!(evidence.last_disarm_at_ms, 1_200);
        assert_eq!(evidence.sequence, 2);
    }

    #[test]
    fn league_open_and_paste_is_explicit_and_only_for_closed_league_chat() {
        let closed = snapshot(false);
        assert!(league_open_and_paste_eligible(&closed, true, false));
        assert!(!league_open_and_paste_eligible(&closed, false, false));

        let open = snapshot(true);
        assert!(!league_open_and_paste_eligible(&open, true, false));

        let mut other_game = snapshot(false);
        other_game.process_name = Some("cs2.exe".to_string());
        assert!(!league_open_and_paste_eligible(&other_game, true, false));

        let mut missing_generation = snapshot(false);
        missing_generation.process_created_ticks = None;
        assert!(!league_open_and_paste_eligible(
            &missing_generation,
            true,
            false
        ));

        let mut auxiliary_window = snapshot(false);
        auxiliary_window.window_class = Some("Chrome_WidgetWin_1".to_string());
        assert!(!league_open_and_paste_eligible(
            &auxiliary_window,
            true,
            false
        ));

        let mut fixture = snapshot(false);
        fixture.process_name = Some("vai_ptt_target.exe".to_string());
        fixture.window_class = Some("VaiPttDeterministicGameTarget".to_string());
        assert!(league_open_and_paste_eligible(&fixture, true, true));
        assert!(!league_open_and_paste_eligible(&fixture, true, false));
    }

    #[test]
    fn open_and_paste_requires_concrete_post_enter_field_evidence() {
        let mut target = snapshot(true);
        for reason in [
            "recent-enter-chat-arm",
            "league-recent-chat-input-click",
            "fixture",
        ] {
            target.field_detection = reason.to_string();
            assert!(!concrete_post_open_field(&target), "{reason}");
        }
        target.field_detection = "win32-caret".to_string();
        assert!(concrete_post_open_field(&target));
        target.field_detection = "focused-text-control".to_string();
        assert!(concrete_post_open_field(&target));
    }

    #[test]
    fn owned_open_enter_allows_only_its_single_expected_evidence_edge() {
        let release = snapshot(false);
        let mut evidence = DictationInputEvidence {
            sequence: release.input_evidence_sequence,
            ..Default::default()
        };
        assert!(owned_open_enter_was_uncontested(&release, &evidence, 100));
        evidence.sequence += 1;
        evidence.league_chat_armed = true;
        evidence.league_chat_hwnd = release.hwnd;
        evidence.last_enter_hwnd = release.hwnd;
        evidence.last_enter_at_ms = 110;
        assert!(owned_open_enter_was_uncontested(&release, &evidence, 100));
        evidence.sequence += 1;
        assert!(!owned_open_enter_was_uncontested(&release, &evidence, 100));
    }

    #[test]
    fn non_league_games_also_paste_into_focused_window() {
        // The trusted-focused-window rule is not League-specific: any focused
        // game window accepts the paste on release (user directive).
        let (plausible, reason) = determine_text_field(
            true, false, false, false, true, false, true, true, false, false,
        );
        assert!(plausible);
        assert_eq!(reason, "focused-window-user-trusted");
    }

    #[test]
    fn trusted_chat_client_pastes_without_native_caret_proof() {
        // League client / Discord: no caret, no native edit, no text-host class,
        // yet paste must land (it's not a gameplay surface). This is the fix for
        // "the League client only copies to clipboard".
        let (plausible, reason) = determine_text_field(
            true, false, false, false, false, false, false, false, false, true,
        );
        assert!(plausible);
        assert_eq!(reason, "trusted-chat-app");
    }

    #[test]
    fn is_desktop_chat_client_recognizes_league_client_not_the_game() {
        assert!(is_desktop_chat_client(Some("LeagueClientUx.exe")));
        assert!(is_desktop_chat_client(Some("leagueclientux.exe")));
        assert!(is_desktop_chat_client(Some("Discord.exe")));
        assert!(!is_desktop_chat_client(Some("league of legends.exe")));
        assert!(!is_desktop_chat_client(Some("cs2.exe")));
        assert!(!is_desktop_chat_client(None));
    }

    #[test]
    fn common_engine_windows_are_treated_as_games_and_fail_closed() {
        for class in [
            "UnityWndClass",
            "UnrealWindow",
            "SDL_app",
            "GLFW30",
            "RiotWindowClass",
            "Valve001",
        ] {
            assert!(class_looks_like_game_host(class), "{class}");
        }
        assert!(!class_looks_like_game_host("Chrome_WidgetWin_1"));
    }

    #[test]
    fn exclusive_fullscreen_audio_routes_distinguish_paste_from_clipboard_ready() {
        assert_eq!(
            game_dictation_cue_for_route("sendinput-accepted"),
            GameDictationCue::Pasted,
        );
        assert_eq!(
            game_dictation_cue_for_route("open-and-paste-input-accepted"),
            GameDictationCue::Pasted,
        );
        assert_eq!(
            game_dictation_cue_for_route("clipboard-ready-field-closed"),
            GameDictationCue::ClipboardReady,
        );
        assert_eq!(
            game_dictation_cue_for_route("clipboard-ready-latency-exceeded"),
            GameDictationCue::ClipboardReady,
        );
    }

    #[test]
    fn clipboard_restores_only_if_vai_still_owns_temporary_value() {
        assert!(should_restore_clipboard(
            7,
            7,
            Some("temporary"),
            "temporary"
        ));
        assert!(!should_restore_clipboard(
            8,
            7,
            Some("temporary"),
            "temporary"
        ));
        assert!(!should_restore_clipboard(
            7,
            7,
            Some("user copied this"),
            "temporary"
        ));
        assert!(!should_restore_clipboard(7, 7, None, "temporary"));
    }

    #[test]
    fn destructive_clipboard_transactions_require_a_vai_window_owner() {
        let source = include_str!("main.rs");
        assert!(!source.contains(concat!("OpenClipboard(std::ptr::", "null_mut())")));
        assert!(source.contains("OpenClipboard(owner_hwnd as _)"));
        assert!(source.contains("IsWindow(owner_hwnd as _)"));
    }

    #[test]
    fn game_transcript_cannot_carry_newline_or_whitespace_submit_sequences() {
        assert_eq!(
            normalize_game_transcript(" hello\n world\r\n "),
            "hello world"
        );
        assert_eq!(normalize_game_transcript("one\t\ttwo"), "one two");
    }

    #[test]
    fn only_safe_global_hotkeys_are_accepted() {
        for value in [
            "Win+Alt",
            "Ctrl+Shift+Space",
            "Ctrl+Alt+Space",
            "Alt+Shift+Space",
            "Ctrl+Shift+F12",
        ] {
            assert!(parse_dictation_hotkey(value, 2).is_ok(), "{value}");
        }
        assert!(parse_dictation_hotkey("W", 2).is_err());
        assert!(parse_dictation_hotkey("Alt+F4", 2).is_err());
        let win_alt = parse_dictation_hotkey("Win+Alt", 2).expect("Win+Alt");
        assert!(hotkey_is_modifier_chord(&win_alt));
        assert!(hotkey_is_operational(false, true));
        assert!(!hotkey_is_operational(false, false));
        assert!(modifier_state_matches(&win_alt, false, false, true, true));
        assert!(!modifier_state_matches(&win_alt, true, false, true, true));
        assert!(!modifier_state_matches(&win_alt, false, true, true, true));
        assert!(!modifier_state_matches(&win_alt, false, false, false, true));
    }

    #[test]
    fn production_source_has_no_character_injection_path() {
        let source = include_str!("main.rs");
        assert!(!source.contains(concat!("KEYEVENTF_", "UNICODE")));
        assert!(!source.contains(concat!("type_text_", "unicode")));
        assert_eq!(source.matches(concat!("Send", "Input(")).count(), 1);
        assert_eq!(
            source
                .matches(concat!("send_enter_", "scancode().is_err()"))
                .count(),
            1
        );
    }

    #[test]
    fn every_production_input_site_has_a_post_clipboard_identity_boundary() {
        let source = include_str!("main.rs");
        // One definition plus one call immediately before Enter and each Ctrl+V.
        assert_eq!(
            source
                .matches(concat!("final_input_boundary_", "route("))
                .count(),
            4
        );
    }

    #[test]
    fn acceptance_driver_has_no_global_enter_click_or_focus_acquisition_path() {
        let source = include_str!("bin/vai_ptt_fixture_driver.rs");
        assert!(!source.contains(concat!("SetForeground", "Window")));
        assert!(!source.contains(concat!("SetCursor", "Pos")));
        assert!(!source.contains(concat!("MOUSEEVENTF_", "LEFTDOWN")));
        assert!(source.contains("dangerous-ptt-fixture"));
        assert!(source.contains("PostMessageW"));
    }
}
