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

// ── Global Win+Alt dictation (Wispr-Flow style) ─────────────────────────────────
//
// A background thread polls the PHYSICAL Win+Alt chord system-wide (GetAsyncKeyState —
// no keyboard hook, no focus requirement) and relays hold/release into the webview as
// `vai:global-dictation` DOM events via eval, which needs no plugin ACL. The frontend
// records speech during the hold and calls `paste_into_foreground` with the transcript;
// this side decides the delivery route:
//   "self"      → our window is focused; the frontend inserts into the composer.
//   "pasted"    → normal app focused; transcript goes to the clipboard and a real
//                 scan-code Ctrl+V is injected once the user's modifiers are released.
//   "typed"     → fullscreen/borderless game focused; the words are TYPED as unicode
//                 key events (game chat rarely supports paste). Clipboard still set.
//   "copied"    → injection failed (anti-cheat etc.); clipboard holds the text and
//                 the frontend shows a "press Ctrl+V" tip.
//   "no-target" → nothing sensible focused (desktop/shell); the frontend shows a
//                 copyable modal. The clipboard still holds the text as a fallback.

#[cfg(target_os = "windows")]
fn key_down(vk: u16) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    unsafe { (GetAsyncKeyState(vk as i32) as u16) & 0x8000 != 0 }
}

/// The window that was foreground when the user RELEASED the dictation chord —
/// the window they were speaking into. Transcription takes seconds; if the user
/// clicks somewhere else meanwhile, the transcript must NOT be injected into
/// that unrelated window (it stays on the clipboard instead).
#[cfg(target_os = "windows")]
static DICTATION_TARGET_HWND: std::sync::atomic::AtomicIsize =
    std::sync::atomic::AtomicIsize::new(0);

#[cfg(target_os = "windows")]
fn foreground_hwnd_value() -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe { GetForegroundWindow() as isize }
}

#[cfg(target_os = "windows")]
fn dictation_chord_down() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_SPACE,
    };
    let win_alt = (key_down(VK_LWIN) || key_down(VK_RWIN)) && key_down(VK_MENU);
    let ctrl_shift_space = key_down(VK_CONTROL) && key_down(VK_SHIFT) && key_down(VK_SPACE);
    win_alt || ctrl_shift_space
}

#[cfg(target_os = "windows")]
fn dictation_keys_clear() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_SPACE,
    };
    !key_down(VK_CONTROL)
        && !key_down(VK_SHIFT)
        && !key_down(VK_SPACE)
        && !key_down(VK_MENU)
        && !key_down(VK_LWIN)
        && !key_down(VK_RWIN)
}

#[cfg(target_os = "windows")]
fn foreground_is_shell() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return true;
    }
    let mut buf = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if len <= 0 {
        return false;
    }
    let class = String::from_utf16_lossy(&buf[..len as usize]);
    // Progman / WorkerW = the desktop wallpaper window: there is nowhere to type.
    class == "Progman" || class == "WorkerW"
}

/// Fullscreen/borderless game detection: the foreground window covers its whole
/// monitor and has no title bar. League of Legends in-game, most shooters, and
/// borderless-windowed games all match; the lobby/client (decorated window) does not.
#[cfg(target_os = "windows")]
fn foreground_is_fullscreen_app() -> bool {
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowLongW, GetWindowRect, GWL_STYLE, WS_CAPTION,
    };

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() || foreground_is_shell() {
        return false;
    }

    let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
    if style & WS_CAPTION == WS_CAPTION {
        return false; // decorated window — a normal app, not a fullscreen surface
    }

    let mut rect = unsafe { std::mem::zeroed::<windows_sys::Win32::Foundation::RECT>() };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return false;
    }
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    let mut info = unsafe { std::mem::zeroed::<MONITORINFO>() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return false;
    }
    let m = info.rcMonitor;
    rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
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
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() {
        return None;
    }

    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(foreground, &mut process_id) };
    let path = process_image_path(process_id)?;
    std::path::Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase())
}

#[cfg(target_os = "windows")]
fn focused_window_class_name() -> Option<String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO,
    };

    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() {
        return None;
    }
    let thread_id = unsafe { GetWindowThreadProcessId(foreground, std::ptr::null_mut()) };
    if thread_id == 0 {
        return None;
    }

    let mut info = unsafe { std::mem::zeroed::<GUITHREADINFO>() };
    info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
    if unsafe { GetGUIThreadInfo(thread_id, &mut info) } == 0 || info.hwndFocus.is_null() {
        return None;
    }

    window_class_name(info.hwndFocus)
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

/// Foreground is a terminal or CLI REPL (cmd, PowerShell, Windows Terminal, Grok CLI…).
#[cfg(target_os = "windows")]
fn foreground_is_console_or_cli_host() -> bool {
    if foreground_window_class_name()
        .as_deref()
        .is_some_and(|c| {
            let c = c.to_ascii_lowercase();
            c == "consolewindowclass"
                || c.contains("cascadia")
                || c.contains("mintty")
                || c.contains("virtualconsoleclass")
        })
    {
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
fn foreground_is_known_paste_text_host_app() -> bool {
    matches!(
        foreground_process_image_name().as_deref(),
        Some(
            "leagueclient.exe"
                | "leagueclientux.exe"
                | "leagueclientuxrender.exe"
                | "riotclientux.exe"
                | "riotclientservices.exe"
        )
    )
}

#[cfg(target_os = "windows")]
fn foreground_has_text_target() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO,
    };

    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() || foreground_is_shell() {
        return false;
    }
    let thread_id = unsafe { GetWindowThreadProcessId(foreground, std::ptr::null_mut()) };
    if thread_id == 0 {
        return false;
    }

    let mut info = unsafe { std::mem::zeroed::<GUITHREADINFO>() };
    info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
    if unsafe { GetGUIThreadInfo(thread_id, &mut info) } == 0 {
        return false;
    }

    if !info.hwndCaret.is_null() {
        return true;
    }

    let caret = info.rcCaret;
    if caret.left != 0 || caret.top != 0 || caret.right != 0 || caret.bottom != 0 {
        return true;
    }

    focused_window_class_name()
        .as_deref()
        .is_some_and(class_looks_like_text_host)
        || foreground_window_class_name()
            .as_deref()
            .is_some_and(class_looks_like_text_host)
        || foreground_is_known_paste_text_host_app()
        || foreground_is_console_or_cli_host()
}

/// Inject Ctrl+V as HARDWARE SCAN CODES (not virtual keys). Many games and some
/// Electron apps poll scan codes / DirectInput and never see VK-only synthetic
/// input — this is the difference between "paste works in the League lobby" and
/// "paste works in the game too".
#[cfg(target_os = "windows")]
fn send_ctrl_v_scancode() -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE,
    };

    const SC_LCTRL: u16 = 0x1D;
    const SC_V: u16 = 0x2F;

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

    let inputs = [
        key(SC_LCTRL, false),
        key(SC_V, false),
        key(SC_V, true),
        key(SC_LCTRL, true),
    ];
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent != inputs.len() as u32 {
        return Err(format!("SendInput injected {sent}/{} events", inputs.len()));
    }
    Ok(())
}

/// Type text directly as KEYEVENTF_UNICODE events — the delivery that works in
/// game chat boxes where clipboard paste is blocked or unsupported. Sent in
/// small batches with breaths in between so slow message pumps keep up.
#[cfg(target_os = "windows")]
fn type_text_unicode(text: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    };

    let mut events: Vec<INPUT> = Vec::new();
    let unit = |code: u16, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
            ki: KEYBDINPUT {
                wVk: 0,
                wScan: code,
                dwFlags: KEYEVENTF_UNICODE | if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    for code in text.encode_utf16() {
        events.push(unit(code, false));
        events.push(unit(code, true));
    }

    for chunk in events.chunks(64) {
        let sent = unsafe {
            SendInput(
                chunk.len() as u32,
                chunk.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        if sent != chunk.len() as u32 {
            return Err(format!("SendInput typed {sent}/{} events", chunk.len()));
        }
        std::thread::sleep(std::time::Duration::from_millis(8));
    }
    Ok(())
}

/// Watch the physical Win+Alt chord and mirror its state into the webview.
fn spawn_dictation_chord_watcher(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    std::thread::spawn(move || {
        let mut held = false;
        let mut last_down_emit = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_secs(1))
            .unwrap_or_else(std::time::Instant::now);
        loop {
            let down = dictation_chord_down();
            let should_heartbeat =
                down && held && last_down_emit.elapsed() >= std::time::Duration::from_millis(250);
            if down != held || should_heartbeat {
                // Three distinct phases so the frontend can tell a FRESH press from a
                // keep-alive: "down" = rising edge (a new press — always resets), "hold"
                // = heartbeat while the keys stay down (never resets, so renderer jank
                // can't be mistaken for a re-press), "up" = release. Emitting "down" for
                // heartbeats (the old behavior) made a dropped release edge unrecoverable
                // until a 2s watchdog — the "it won't reset" hang.
                let phase = if down && !held {
                    "down"
                } else if down {
                    "hold"
                } else {
                    "up"
                };
                if down {
                    last_down_emit = std::time::Instant::now();
                } else {
                    // Chord released — remember which window the user was dictating
                    // into so the (async) delivery can refuse to paste elsewhere.
                    DICTATION_TARGET_HWND.store(
                        foreground_hwnd_value(),
                        std::sync::atomic::Ordering::SeqCst,
                    );
                }
                held = down;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(&format!(
                        "window.dispatchEvent(new CustomEvent('vai:global-dictation',{{detail:'{phase}'}}))"
                    ));
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
    });
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

#[tauri::command]
async fn paste_into_foreground(
    window: tauri::WebviewWindow,
    text: String,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Nothing to paste".to_string());
    }

    // Our own window focused → the frontend inserts into the composer directly.
    if window.is_focused().unwrap_or(false) {
        return Ok("self".to_string());
    }

    // Always leave the transcript on the clipboard — even a missed paste is one
    // Ctrl+V away, and the no-target modal's Copy button is then redundant-safe.
    arboard::Clipboard::new()
        .and_then(|mut cb| cb.set_text(text.as_str()))
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        if foreground_is_shell() {
            return Ok("no-target".to_string());
        }

        // The user may still be physically holding Win+Alt (the chord that started
        // dictation). Injecting keys now would land as Ctrl+Alt+Win+… in the target,
        // so wait (bounded) for a clean keyboard first.
        let mut clean_keyboard = false;
        for _ in 0..40 {
            if dictation_keys_clear() {
                clean_keyboard = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        if !clean_keyboard {
            return Ok("copied".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(60));

        // Focus moved to a DIFFERENT window since the chord was released (the
        // user clicked elsewhere while we transcribed) — injecting now would
        // paste into something they never spoke into. The words are already on
        // the clipboard; show the Ctrl+V tip instead.
        let target = DICTATION_TARGET_HWND.swap(0, std::sync::atomic::Ordering::SeqCst);
        let current_hwnd = foreground_hwnd_value();
        if target != 0 && current_hwnd != target {
            // Console HWNDs change when tabs resize or conhost recreates — same process is OK.
            let same_process = || {
                use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
                let mut a = 0u32;
                let mut b = 0u32;
                unsafe {
                    GetWindowThreadProcessId(target as _, &mut a);
                    GetWindowThreadProcessId(current_hwnd as _, &mut b);
                }
                a != 0 && a == b
            };
            if !(foreground_is_console_or_cli_host() && same_process()) {
                return Ok("copied".to_string());
            }
        }

        // Terminals / CLI REPLs (cmd, Windows Terminal, Grok CLI…) — type directly.
        // They often have no GUI caret so the old path returned "copied" every time.
        if foreground_is_console_or_cli_host() {
            if type_text_unicode(&text).is_ok() {
                return Ok("typed".to_string());
            }
            if send_ctrl_v_scancode().is_ok() {
                return Ok("pasted".to_string());
            }
            return Ok("copied".to_string());
        }

        // Fullscreen/borderless target (in-game) → clipboard paste is unreliable or
        // outright unsupported in game chat; TYPE the words instead. The clipboard
        // already holds the text as the universal fallback either way.
        if foreground_is_fullscreen_app() {
            return match type_text_unicode(&text) {
                Ok(()) => Ok("typed".to_string()),
                // Typing blocked (anti-cheat swallows synthetic input) — the words
                // survive on the clipboard; tell the frontend to show the tip.
                Err(_) => Ok("copied".to_string()),
            };
        }

        // Normal app → scan-code Ctrl+V (works in strictly more targets than
        // virtual-key injection). If injection fails, the clipboard still has it.
        if !foreground_has_text_target() {
            return Ok("copied".to_string());
        }

        match send_ctrl_v_scancode() {
            Ok(()) => Ok("pasted".to_string()),
            Err(_) => Ok("copied".to_string()),
        }
    }

    #[cfg(not(target_os = "windows"))]
    Ok("no-target".to_string())
}

// ── Standalone dictation bubble ─────────────────────────────────────────────────────
//
// When the user dictates while ANOTHER app is focused, the in-app overlay is
// invisible (Vai may be minimized). This small always-on-top, taskbar-less
// window shows the listening/transcribing/result states on the monitor the
// user is actually working on. It never steals focus — the target app keeps
// receiving the Ctrl+V paste. Phase updates arrive via eval (same no-ACL
// pattern as the chord watcher).

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

/// Bottom-center of the monitor the cursor is on (fallback: primary monitor).
fn position_dictation_bubble(app: &tauri::AppHandle, bubble: &tauri::WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|pos| app.monitor_from_point(pos.x, pos.y).ok().flatten())
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

fn show_dictation_bubble_without_activation(bubble: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE,
            HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
            SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE,
        };

        if let Ok(hwnd) = bubble.hwnd() {
            let hwnd = hwnd.0;
            unsafe {
                let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_NOACTIVATE as isize);
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

/// Show/refresh the bubble with a phase payload (JSON built by the frontend).
/// JSON is a syntactic subset of JS, so embedding it directly in eval is safe.
#[tauri::command]
async fn dictation_bubble_update(app: tauri::AppHandle, phase: String) -> Result<(), String> {
    // Reject anything that isn't a plain JSON object — this string is eval'd.
    if !phase.starts_with('{') || phase.contains("</") {
        return Err("Invalid phase payload".to_string());
    }

    #[cfg(target_os = "windows")]
    if foreground_is_fullscreen_app() {
        if let Some(bubble) = app.get_webview_window(BUBBLE_LABEL) {
            let _ = bubble.hide();
        }
        return Ok(());
    }

    let bubble = ensure_dictation_bubble(&app)?;
    position_dictation_bubble(&app, &bubble);
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
    let is_active = phase.contains("\"kind\":\"listening\"")
        || phase.contains("\"kind\":\"transcribing\"")
        || phase.contains("\"kind\":\"polishing\"");
    if is_active {
        BUBBLE_ACTIVE_GEN.store(generation, std::sync::atomic::Ordering::SeqCst);
    }
    if phase.contains("\"kind\":\"pasted\"") {
        let hide_ms: u64 = if phase.contains("\"via\":\"clipboard\"") { 4200 } else { 1600 };
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
    Ok(())
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
    "node_modules", ".git", "target", "dist", "build", ".next", ".turbo", ".cache",
    "out", "coverage", ".venv", "__pycache__", ".idea", ".vscode",
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
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "ico" | "pdf" | "zip" | "gz" | "tar"
                | "exe" | "dll" | "wasm" | "woff" | "woff2" | "ttf" | "otf" | "mp3" | "mp4"
                | "mov" | "wav" | "bin" | "node"
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
    let root_canon = std::fs::canonicalize(root).map_err(|e| format!("workspace not found: {e}"))?;
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
    let root_canon = std::fs::canonicalize(&root).map_err(|e| format!("workspace not found: {e}"))?;
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
            out.push(IdeEntry { path: rel, dir: is_dir });
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
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap());
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

#[tauri::command]
fn ide_tail_dev_log(path: String, max_bytes: u64) -> Result<String, String> {
    // Only the app's own dev-server logs (vai-dev-*.log in the OS temp dir) may be
    // tailed. This command is renderer-reachable, so without this guard it would be
    // an arbitrary-file-read primitive for anything that compromises the webview.
    let requested = std::path::PathBuf::from(&path);
    let file_name = requested
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if !file_name.starts_with("vai-dev-") || !file_name.ends_with(".log") {
        return Err("not a vai dev log".to_string());
    }
    let temp_canon =
        std::fs::canonicalize(std::env::temp_dir()).map_err(|e| e.to_string())?;
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
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
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
            paste_into_foreground,
            dictation_bubble_update,
            dictation_bubble_hide,
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
            // Auto-start the AI engine when the app opens
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state: State<'_, SidecarState> = app_handle.state();
                if let Err(e) = start_engine(app_handle.clone(), state).await {
                    eprintln!("[VAI] Failed to start engine: {}", e);
                }
            });
            // Global Win+Alt hold-to-dictate, anywhere on the machine.
            spawn_dictation_chord_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
