#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("vai_ptt_target is a Windows-only acceptance fixture");
}

#[cfg(target_os = "windows")]
mod windows_target {
    use serde_json::{json, Value};
    use std::fs::{File, OpenOptions};
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicUsize, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::CreateSolidBrush;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SetFocus, VK_ESCAPE, VK_RETURN};
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    static LOG_FILE: OnceLock<Mutex<File>> = OnceLock::new();
    static RUN_ID: OnceLock<String> = OnceLock::new();
    static EDIT_A: AtomicIsize = AtomicIsize::new(0);
    static EDIT_B: AtomicIsize = AtomicIsize::new(0);
    static EDIT_A_PROC: AtomicIsize = AtomicIsize::new(0);
    static EDIT_B_PROC: AtomicIsize = AtomicIsize::new(0);
    // Toggled before each open so the canonical Enter→world→chat-region sequence uses A then B.
    static ACTIVE_EDIT: AtomicUsize = AtomicUsize::new(1);
    static CHAT_OPEN: AtomicBool = AtomicBool::new(false);
    static PASTE_COUNT: AtomicUsize = AtomicUsize::new(0);
    static GAMEPLAY_CHAR_COUNT: AtomicUsize = AtomicUsize::new(0);

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn now_ms() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    }

    fn log_event(event: &str, detail: Value) {
        let Some(file) = LOG_FILE.get() else { return };
        let record = json!({
            "runId": RUN_ID.get(),
            "atMs": now_ms(),
            "event": event,
            "detail": detail,
        });
        if let Ok(mut file) = file.lock() {
            let _ = writeln!(file, "{record}");
            let _ = file.flush();
        }
    }

    fn read_text(hwnd: HWND) -> String {
        let mut buffer = vec![0u16; 4096];
        let length = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        String::from_utf16_lossy(&buffer[..length.max(0) as usize])
    }

    fn edit_name(hwnd: HWND) -> &'static str {
        if hwnd as isize == EDIT_A.load(Ordering::SeqCst) {
            "A"
        } else {
            "B"
        }
    }

    unsafe extern "system" fn edit_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        let original = if hwnd as isize == EDIT_A.load(Ordering::SeqCst) {
            EDIT_A_PROC.load(Ordering::SeqCst)
        } else {
            EDIT_B_PROC.load(Ordering::SeqCst)
        };
        let previous: WNDPROC = std::mem::transmute(original);
        match message {
            WM_SETFOCUS => log_event("field-focus", json!({ "field": edit_name(hwnd) })),
            WM_KILLFOCUS => log_event("field-blur", json!({ "field": edit_name(hwnd) })),
            WM_CHAR => log_event(
                "field-char",
                json!({
                    "field": edit_name(hwnd),
                    "code": wparam,
                }),
            ),
            WM_PASTE => {
                PASTE_COUNT.fetch_add(1, Ordering::SeqCst);
                log_event("field-paste", json!({ "field": edit_name(hwnd) }));
            }
            _ => {}
        }
        let result = CallWindowProcW(previous, hwnd, message, wparam, lparam);
        if message == WM_PASTE {
            log_event(
                "field-value",
                json!({
                    "field": edit_name(hwnd),
                    "value": read_text(hwnd),
                }),
            );
        }
        result
    }

    fn show_chat(parent: HWND, via: &str) {
        let active = ACTIVE_EDIT.fetch_xor(1, Ordering::SeqCst) ^ 1;
        let target = if active == 0 {
            EDIT_A.load(Ordering::SeqCst) as HWND
        } else {
            EDIT_B.load(Ordering::SeqCst) as HWND
        };
        let other = if active == 0 {
            EDIT_B.load(Ordering::SeqCst) as HWND
        } else {
            EDIT_A.load(Ordering::SeqCst) as HWND
        };
        unsafe {
            ShowWindow(other, SW_HIDE);
            ShowWindow(target, SW_SHOW);
            SetFocus(target);
        }
        CHAT_OPEN.store(true, Ordering::SeqCst);
        log_event(
            "chat-open",
            json!({ "field": if active == 0 { "A" } else { "B" }, "via": via, "parent": parent as isize }),
        );
    }

    fn hide_chat(parent: HWND, via: &str) {
        unsafe {
            ShowWindow(EDIT_A.load(Ordering::SeqCst) as HWND, SW_HIDE);
            ShowWindow(EDIT_B.load(Ordering::SeqCst) as HWND, SW_HIDE);
            SetFocus(parent);
        }
        CHAT_OPEN.store(false, Ordering::SeqCst);
        log_event("chat-closed", json!({ "via": via }));
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_SIZE => {
                let mut rect = std::mem::zeroed::<RECT>();
                if GetClientRect(hwnd, &mut rect) != 0 {
                    let width = (rect.right - rect.left).max(320);
                    let height = (rect.bottom - rect.top).max(240);
                    let field_width = width * 42 / 100;
                    let field_height = 34;
                    let x = 16;
                    let y = height * 80 / 100;
                    for edit in [EDIT_A.load(Ordering::SeqCst), EDIT_B.load(Ordering::SeqCst)] {
                        if edit != 0 {
                            MoveWindow(edit as HWND, x, y, field_width, field_height, 1);
                        }
                    }
                }
                0
            }
            WM_KEYDOWN if wparam as u32 == VK_RETURN as u32 => {
                if CHAT_OPEN.load(Ordering::SeqCst) {
                    hide_chat(hwnd, "enter-toggle-close");
                } else {
                    show_chat(hwnd, "enter");
                }
                0
            }
            WM_KEYDOWN if wparam as u32 == VK_ESCAPE as u32 => {
                hide_chat(hwnd, "escape");
                0
            }
            WM_LBUTTONDOWN => {
                let x = (lparam as u32 & 0xffff) as i16 as i32;
                let y = ((lparam as u32 >> 16) & 0xffff) as i16 as i32;
                let mut rect = std::mem::zeroed::<RECT>();
                GetClientRect(hwnd, &mut rect);
                let width = (rect.right - rect.left).max(1);
                let height = (rect.bottom - rect.top).max(1);
                if x <= width * 44 / 100 && y >= height * 72 / 100 && y <= height * 97 / 100 {
                    show_chat(hwnd, "chat-region-click");
                } else {
                    hide_chat(hwnd, "world-click");
                    log_event("world-click", json!({ "x": x, "y": y }));
                }
                0
            }
            WM_CHAR if wparam == 13 || wparam == 27 => {
                log_event("control-char", json!({ "code": wparam }));
                0
            }
            WM_CHAR => {
                GAMEPLAY_CHAR_COUNT.fetch_add(1, Ordering::SeqCst);
                log_event("gameplay-char", json!({ "code": wparam }));
                0
            }
            WM_ACTIVATE => {
                log_event(
                    "activation",
                    json!({
                        "active": (wparam & 0xffff) != WA_INACTIVE as usize,
                        "foreground": GetForegroundWindow() as isize,
                    }),
                );
                DefWindowProcW(hwnd, message, wparam, lparam)
            }
            WM_SETFOCUS => {
                log_event("world-focus", json!({}));
                DefWindowProcW(hwnd, message, wparam, lparam)
            }
            WM_DESTROY => {
                log_event(
                    "summary",
                    json!({
                        "fieldA": read_text(EDIT_A.load(Ordering::SeqCst) as HWND),
                        "fieldB": read_text(EDIT_B.load(Ordering::SeqCst) as HWND),
                        "pasteCount": PASTE_COUNT.load(Ordering::SeqCst),
                        "gameplayCharCount": GAMEPLAY_CHAR_COUNT.load(Ordering::SeqCst),
                        "chatOpen": CHAT_OPEN.load(Ordering::SeqCst),
                    }),
                );
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    fn parse_args() -> Result<(bool, PathBuf, String), String> {
        let args: Vec<String> = std::env::args().collect();
        let borderless = args
            .windows(2)
            .any(|pair| pair[0] == "--mode" && pair[1] == "borderless");
        let log = args
            .windows(2)
            .find(|pair| pair[0] == "--log")
            .map(|pair| PathBuf::from(&pair[1]))
            .unwrap_or_else(|| std::env::temp_dir().join("vai-ptt-target.jsonl"));
        let run_id = args
            .windows(2)
            .find(|pair| pair[0] == "--run-id")
            .map(|pair| pair[1].trim().to_string())
            .filter(|value| value.len() >= 8 && value.len() <= 96)
            .ok_or("missing or invalid --run-id")?;
        Ok((borderless, log, run_id))
    }

    pub fn run() -> Result<(), String> {
        let (borderless, log_path, run_id) = parse_args()?;
        RUN_ID
            .set(run_id)
            .map_err(|_| "run id already initialized".to_string())?;
        if let Some(parent) = log_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&log_path)
            .map_err(|error| {
                format!(
                    "refusing to reuse target evidence {}: {error}",
                    log_path.display()
                )
            })?;
        LOG_FILE
            .set(Mutex::new(file))
            .map_err(|_| "log already initialized".to_string())?;

        let class_name = wide("VaiPttDeterministicGameTarget");
        let title = wide("Vai PTT deterministic game target — Enter opens chat; world click closes; chat-region click reopens");
        let edit_class = wide("EDIT");
        let empty = wide("");
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: instance,
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: CreateSolidBrush(0x00201810),
                lpszMenuName: std::ptr::null(),
                lpszClassName: class_name.as_ptr(),
            };
            if RegisterClassW(&class) == 0 {
                return Err("RegisterClassW failed".to_string());
            }
            let style = if borderless {
                WS_POPUP
            } else {
                WS_OVERLAPPEDWINDOW
            } | WS_VISIBLE;
            let (x, y, width, height) = if borderless {
                (
                    0,
                    0,
                    GetSystemMetrics(SM_CXSCREEN),
                    GetSystemMetrics(SM_CYSCREEN),
                )
            } else {
                (120, 90, 1280, 720)
            };
            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                title.as_ptr(),
                style,
                x,
                y,
                width,
                height,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return Err("CreateWindowExW failed".to_string());
            }

            let edit_style = WS_CHILD | WS_BORDER | ES_AUTOHSCROLL as u32;
            let edit_a = CreateWindowExW(
                0,
                edit_class.as_ptr(),
                empty.as_ptr(),
                edit_style,
                16,
                560,
                520,
                34,
                hwnd,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            let edit_b = CreateWindowExW(
                0,
                edit_class.as_ptr(),
                empty.as_ptr(),
                edit_style,
                16,
                560,
                520,
                34,
                hwnd,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if edit_a.is_null() || edit_b.is_null() {
                return Err("Could not create Edit controls".to_string());
            }
            EDIT_A.store(edit_a as isize, Ordering::SeqCst);
            EDIT_B.store(edit_b as isize, Ordering::SeqCst);
            EDIT_A_PROC.store(
                SetWindowLongPtrW(
                    edit_a,
                    GWLP_WNDPROC,
                    edit_proc as *const () as usize as isize,
                ),
                Ordering::SeqCst,
            );
            EDIT_B_PROC.store(
                SetWindowLongPtrW(
                    edit_b,
                    GWLP_WNDPROC,
                    edit_proc as *const () as usize as isize,
                ),
                Ordering::SeqCst,
            );
            ShowWindow(edit_a, SW_HIDE);
            ShowWindow(edit_b, SW_HIDE);
            ShowWindow(hwnd, SW_SHOW);

            log_event(
                "ready",
                json!({
                    "binaryPath": std::env::current_exe().ok().map(|path| {
                        path.canonicalize().unwrap_or(path).to_string_lossy().into_owned()
                    }),
                    "sourceFingerprint": env!("VAI_PTT_SOURCE_FINGERPRINT"),
                    "pid": GetCurrentProcessId(),
                    "hwnd": hwnd as isize,
                    "mode": if borderless { "borderless" } else { "windowed" },
                    "log": log_path,
                }),
            );

            let mut message = std::mem::zeroed::<MSG>();
            while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn main() {
    if let Err(error) = windows_target::run() {
        eprintln!("VAI_PTT_TARGET_ERROR {error}");
        std::process::exit(1);
    }
}
