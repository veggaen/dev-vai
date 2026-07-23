#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(not(all(target_os = "windows", feature = "dangerous-ptt-fixture")))]
fn main() {
    eprintln!(
        "vai_ptt_fixture_driver is disabled; build explicitly with --features dangerous-ptt-fixture only in an isolated test session"
    );
    std::process::exit(2);
}

#[cfg(all(target_os = "windows", feature = "dangerous-ptt-fixture"))]
mod windows_driver {
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::fs::{File, OpenOptions};
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Foundation::{CloseHandle, HWND, RECT, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, VK_CONTROL, VK_LWIN, VK_MENU,
        VK_RWIN, VK_SHIFT, VK_SPACE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsWindow,
        PostMessageW, WM_CLOSE, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP,
    };

    const TARGET_CLASS: &str = "VaiPttDeterministicGameTarget";
    const TARGET_EXE: &str = "vai_ptt_target.exe";
    const SOURCE_FINGERPRINT: &str = env!("VAI_PTT_SOURCE_FINGERPRINT");
    const ARM_VALUE: &str = "target-only-input-is-safe";
    const MK_LBUTTON_WPARAM: usize = 0x0001;
    const SC_LCTRL: u16 = 0x1D;
    const SC_LSHIFT: u16 = 0x2A;
    const SC_LALT: u16 = 0x38;
    const SC_SPACE: u16 = 0x39;
    const SC_LWIN: u16 = 0x5B;
    const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum HotkeyChord {
        WinAlt,
        CtrlShiftSpace,
    }

    impl HotkeyChord {
        fn label(self) -> &'static str {
            match self {
                Self::WinAlt => "Win+Alt",
                Self::CtrlShiftSpace => "Ctrl+Shift+Space",
            }
        }

        fn inputs(self) -> (Vec<INPUT>, Vec<INPUT>) {
            match self {
                Self::WinAlt => (
                    vec![key(SC_LWIN, false, true), key(SC_LALT, false, false)],
                    vec![key(SC_LALT, true, false), key(SC_LWIN, true, true)],
                ),
                Self::CtrlShiftSpace => (
                    vec![
                        key(SC_LCTRL, false, false),
                        key(SC_LSHIFT, false, false),
                        key(SC_SPACE, false, false),
                    ],
                    vec![
                        key(SC_SPACE, true, false),
                        key(SC_LSHIFT, true, false),
                        key(SC_LCTRL, true, false),
                    ],
                ),
            }
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum Workflow {
        CanonicalChurn,
        OpenAndPaste,
    }

    impl Workflow {
        fn label(self) -> &'static str {
            match self {
                Self::CanonicalChurn => "canonical-churn",
                Self::OpenAndPaste => "open-and-paste",
            }
        }
    }

    struct Args {
        hwnd: HWND,
        target_pid: u32,
        out: PathBuf,
        vai_log: PathBuf,
        binary_manifest: PathBuf,
        attempt_plan: PathBuf,
        attempt_number: u8,
        expected: String,
        workflow: Workflow,
        shortcut: HotkeyChord,
        run_id: String,
    }

    fn parse_args() -> Result<Args, String> {
        let values: Vec<String> = std::env::args().collect();
        let value = |flag: &str| {
            values
                .windows(2)
                .find(|pair| pair[0] == flag)
                .map(|pair| pair[1].clone())
        };
        if value("--armed").as_deref() != Some(ARM_VALUE) {
            return Err(format!(
                "refusing synthetic input without --armed {ARM_VALUE}; never run this while another app may own focus"
            ));
        }
        let hwnd = value("--hwnd")
            .ok_or("missing --hwnd")?
            .parse::<isize>()
            .map_err(|error| format!("invalid --hwnd: {error}"))? as HWND;
        if hwnd.is_null() {
            return Err("--hwnd cannot be zero".to_string());
        }
        let target_pid = value("--target-pid")
            .ok_or("missing --target-pid")?
            .parse::<u32>()
            .map_err(|error| format!("invalid --target-pid: {error}"))?;
        if target_pid == 0 {
            return Err("--target-pid cannot be zero".to_string());
        }
        let out = PathBuf::from(value("--out").ok_or("missing --out")?);
        let vai_log = PathBuf::from(value("--vai-log").ok_or("missing --vai-log")?);
        let binary_manifest =
            PathBuf::from(value("--binary-manifest").ok_or("missing --binary-manifest")?);
        let attempt_plan = PathBuf::from(value("--attempt-plan").ok_or("missing --attempt-plan")?);
        let attempt_number = value("--attempt")
            .ok_or("missing --attempt")?
            .parse::<u8>()
            .map_err(|error| format!("invalid --attempt: {error}"))?;
        if !(1..=10).contains(&attempt_number) {
            return Err("--attempt must be from 1 to 10".to_string());
        }
        let expected = value("--expected").ok_or("missing --expected")?;
        let workflow = match value("--workflow").as_deref() {
            None | Some("canonical-churn") => Workflow::CanonicalChurn,
            Some("open-and-paste") => Workflow::OpenAndPaste,
            Some(other) => return Err(format!("unsupported --workflow {other:?}")),
        };
        let shortcut = match value("--shortcut").as_deref() {
            None | Some("Win+Alt") | Some("win+alt") => HotkeyChord::WinAlt,
            Some("Ctrl+Shift+Space") | Some("ctrl+shift+space") => HotkeyChord::CtrlShiftSpace,
            Some(other) => return Err(format!("unsupported --shortcut {other:?}")),
        };
        let run_id = value("--run-id")
            .map(|value| value.trim().to_string())
            .filter(|value| value.len() >= 8 && value.len() <= 96)
            .ok_or("missing or invalid --run-id")?;
        Ok(Args {
            hwnd,
            target_pid,
            out,
            vai_log,
            binary_manifest,
            attempt_plan,
            attempt_number,
            expected,
            workflow,
            shortcut,
            run_id,
        })
    }

    fn now_ms() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    }

    fn window_class(hwnd: HWND) -> Result<String, String> {
        let mut buffer = [0u16; 256];
        let length = unsafe { GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        if length <= 0 {
            return Err("GetClassNameW failed".to_string());
        }
        Ok(String::from_utf16_lossy(&buffer[..length as usize]))
    }

    fn process_path(pid: u32) -> Result<PathBuf, String> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return Err(format!("cannot inspect target PID {pid}"));
        }
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut length) };
        unsafe { CloseHandle(handle) };
        if ok == 0 {
            return Err(format!("cannot resolve target PID {pid} image"));
        }
        Ok(PathBuf::from(String::from_utf16_lossy(
            &buffer[..length as usize],
        )))
    }

    fn process_exe(pid: u32) -> Result<String, String> {
        Ok(process_path(pid)?
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase())
    }

    fn normalized_path(value: &Path) -> String {
        let normalized = value
            .canonicalize()
            .unwrap_or_else(|_| value.to_path_buf())
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase();
        if let Some(unc) = normalized.strip_prefix(r"\\?\unc\") {
            format!(r"\\{unc}")
        } else {
            normalized
                .strip_prefix(r"\\?\")
                .unwrap_or(&normalized)
                .to_string()
        }
    }

    fn paths_match(left: &Path, right: &Path) -> bool {
        normalized_path(left) == normalized_path(right)
    }

    #[derive(Clone)]
    struct VerifiedBinary {
        path: PathBuf,
        sha256: String,
    }

    #[derive(Clone)]
    struct BinaryProvenance {
        manifest: PathBuf,
        manifest_sha256: String,
        source_fingerprint: String,
        vai: VerifiedBinary,
        target: VerifiedBinary,
        driver: VerifiedBinary,
    }

    struct AttemptPlanBinding {
        path: PathBuf,
        sha256: String,
        binary_manifest_sha256: String,
        claim_path: PathBuf,
    }

    fn sha256_file(path: &Path) -> Result<String, String> {
        let mut file = File::open(path)
            .map_err(|error| format!("cannot open {} for hashing: {error}", path.display()))?;
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("cannot hash {}: {error}", path.display()))?;
            if read == 0 {
                break;
            }
            hash.update(&buffer[..read]);
        }
        Ok(format!("{:x}", hash.finalize()))
    }

    fn read_and_hash(path: &Path) -> Result<(Vec<u8>, String), String> {
        let bytes = std::fs::read(path)
            .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        Ok((bytes, sha256))
    }

    fn manifest_binary(manifest: &Value, name: &str) -> Result<VerifiedBinary, String> {
        let entry = manifest
            .get("binaries")
            .and_then(|value| value.get(name))
            .ok_or_else(|| format!("binary manifest is missing binaries.{name}"))?;
        let path = PathBuf::from(
            entry
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("binary manifest has no path for {name}"))?,
        );
        let size = entry
            .get("size")
            .and_then(Value::as_u64)
            .ok_or_else(|| format!("binary manifest has no size for {name}"))?;
        let sha256 = entry
            .get("sha256")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !path.is_absolute()
            || sha256.len() != 64
            || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(format!("binary manifest has an invalid {name} entry"));
        }
        let metadata = std::fs::metadata(&path)
            .map_err(|error| format!("cannot inspect manifested {name} binary: {error}"))?;
        if !metadata.is_file() || metadata.len() != size {
            return Err(format!("manifested {name} binary size changed"));
        }
        let actual_sha256 = sha256_file(&path)?;
        if !actual_sha256.eq_ignore_ascii_case(sha256) {
            return Err(format!("manifested {name} binary hash changed"));
        }
        Ok(VerifiedBinary {
            path,
            sha256: actual_sha256,
        })
    }

    fn verify_binary_manifest(
        args: &Args,
        vai_binary_path: &Path,
    ) -> Result<BinaryProvenance, String> {
        let manifest_path = args.binary_manifest.canonicalize().map_err(|error| {
            format!(
                "cannot resolve binary manifest {}: {error}",
                args.binary_manifest.display()
            )
        })?;
        let (manifest_bytes, manifest_sha256) = read_and_hash(&manifest_path)?;
        let manifest: Value = serde_json::from_slice(&manifest_bytes)
            .map_err(|error| format!("invalid binary manifest JSON: {error}"))?;
        if manifest.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
            return Err("unsupported binary manifest schema".to_string());
        }
        let source_fingerprint = manifest
            .get("sourceFingerprint")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if source_fingerprint.len() != 64
            || !source_fingerprint
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("invalid binary manifest source fingerprint".to_string());
        }
        if source_fingerprint != SOURCE_FINGERPRINT {
            return Err(
                "running fixture driver was built from a different source closure".to_string(),
            );
        }
        let provenance = BinaryProvenance {
            manifest_sha256,
            manifest: manifest_path,
            source_fingerprint: source_fingerprint.to_string(),
            vai: manifest_binary(&manifest, "vai")?,
            target: manifest_binary(&manifest, "target")?,
            driver: manifest_binary(&manifest, "driver")?,
        };
        let current_driver = std::env::current_exe()
            .map_err(|error| format!("cannot resolve fixture driver binary: {error}"))?;
        let current_target = process_path(args.target_pid)?;
        if !paths_match(&provenance.driver.path, &current_driver) {
            return Err("running fixture driver does not match binary manifest".to_string());
        }
        if !paths_match(&provenance.target.path, &current_target) {
            return Err("running target does not match binary manifest".to_string());
        }
        if !paths_match(&provenance.vai.path, vai_binary_path) {
            return Err("running Vai does not match binary manifest".to_string());
        }
        Ok(provenance)
    }

    fn verify_attempt_plan(
        args: &Args,
        provenance: &BinaryProvenance,
    ) -> Result<AttemptPlanBinding, String> {
        let plan_path = args.attempt_plan.canonicalize().map_err(|error| {
            format!(
                "cannot resolve attempt plan {}: {error}",
                args.attempt_plan.display()
            )
        })?;
        let (plan_bytes, plan_sha256) = read_and_hash(&plan_path)?;
        let plan: Value = serde_json::from_slice(&plan_bytes)
            .map_err(|error| format!("invalid attempt plan JSON: {error}"))?;
        if plan.get("schemaVersion").and_then(Value::as_u64) != Some(1)
            || plan.get("sourceFingerprint").and_then(Value::as_str)
                != Some(provenance.source_fingerprint.as_str())
            || plan
                .get("createdAtMs")
                .and_then(Value::as_u64)
                .unwrap_or(u64::MAX) as u128
                > now_ms()
        {
            return Err("attempt plan metadata does not match the armed build".to_string());
        }
        let planned_manifest = PathBuf::from(
            plan.get("binaryManifestPath")
                .and_then(Value::as_str)
                .ok_or("attempt plan has no binary manifest path")?,
        );
        if !paths_match(&planned_manifest, &provenance.manifest) {
            return Err("attempt plan targets a different binary manifest".to_string());
        }
        let planned_manifest_sha256 = plan
            .get("binaryManifestSha256")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if planned_manifest_sha256 != provenance.manifest_sha256 {
            return Err("attempt plan targets a different binary-manifest hash".to_string());
        }
        let attempts = plan
            .get("attempts")
            .and_then(Value::as_array)
            .filter(|attempts| attempts.len() == 10)
            .ok_or("attempt plan must contain exactly ten attempts")?;
        let mut run_ids = std::collections::BTreeSet::new();
        let mut nonces = std::collections::BTreeSet::new();
        let mut claim_paths = std::collections::BTreeSet::new();
        for (index, planned) in attempts.iter().enumerate() {
            let run_id = planned
                .get("runId")
                .and_then(Value::as_str)
                .filter(|value| (8..=96).contains(&value.len()))
                .ok_or("attempt plan contains an invalid run ID")?;
            let nonce = planned
                .get("nonce")
                .and_then(Value::as_str)
                .filter(|value| value.len() >= 8)
                .ok_or("attempt plan contains an invalid nonce")?;
            let claim = PathBuf::from(
                planned
                    .get("claimPath")
                    .and_then(Value::as_str)
                    .ok_or("attempt plan contains no claim path")?,
            );
            let valid_contract = planned.get("attemptNumber").and_then(Value::as_u64)
                == Some((index + 1) as u64)
                && matches!(
                    planned.get("workflow").and_then(Value::as_str),
                    Some("canonical-churn" | "open-and-paste")
                )
                && matches!(
                    planned.get("mode").and_then(Value::as_str),
                    Some("windowed" | "borderless")
                )
                && matches!(
                    planned.get("shortcut").and_then(Value::as_str),
                    Some("Win+Alt" | "Ctrl+Shift+Space")
                )
                && claim.is_absolute();
            if !valid_contract
                || !run_ids.insert(run_id.to_string())
                || !nonces.insert(nonce.to_string())
                || !claim_paths.insert(normalized_path(&claim))
            {
                return Err(
                    "attempt plan numbering, contracts, or identities are invalid".to_string(),
                );
            }
        }
        for prior in &attempts[..args.attempt_number as usize - 1] {
            let prior_number = prior
                .get("attemptNumber")
                .and_then(Value::as_u64)
                .ok_or("prior attempt has no number")?;
            let prior_run_id = prior
                .get("runId")
                .and_then(Value::as_str)
                .ok_or("prior attempt has no run ID")?;
            let prior_claim_path = PathBuf::from(
                prior
                    .get("claimPath")
                    .and_then(Value::as_str)
                    .ok_or("prior attempt has no claim path")?,
            );
            let rows = std::fs::read_to_string(&prior_claim_path)
                .map_err(|_| format!("prior attempt {prior_number} has no terminal claim"))?
                .lines()
                .map(|line| serde_json::from_str::<Value>(line).map_err(|error| error.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            let row_matches = |row: &Value, terminal: &str| {
                row.get("schemaVersion").and_then(Value::as_u64) == Some(1)
                    && row.get("runId").and_then(Value::as_str) == Some(prior_run_id)
                    && row.get("attemptNumber").and_then(Value::as_u64) == Some(prior_number)
                    && row.get("sourceFingerprint").and_then(Value::as_str)
                        == Some(provenance.source_fingerprint.as_str())
                    && row.get("attemptPlanSha256").and_then(Value::as_str)
                        == Some(plan_sha256.as_str())
                    && row.get("binaryManifestSha256").and_then(Value::as_str)
                        == Some(provenance.manifest_sha256.as_str())
                    && row.pointer("/binarySha256/vai").and_then(Value::as_str)
                        == Some(provenance.vai.sha256.as_str())
                    && row.pointer("/binarySha256/target").and_then(Value::as_str)
                        == Some(provenance.target.sha256.as_str())
                    && row.pointer("/binarySha256/driver").and_then(Value::as_str)
                        == Some(provenance.driver.sha256.as_str())
                    && row.get("terminal").and_then(Value::as_str) == Some(terminal)
            };
            if rows.len() != 2
                || !row_matches(&rows[0], "started")
                || !row_matches(&rows[1], "succeeded")
            {
                return Err(format!(
                    "prior attempt {prior_number} did not terminate successfully; batch cannot continue"
                ));
            }
        }
        let attempt = attempts
            .get(args.attempt_number as usize - 1)
            .ok_or("attempt is missing from plan")?;
        let matches = attempt.get("attemptNumber").and_then(Value::as_u64)
            == Some(args.attempt_number as u64)
            && attempt.get("runId").and_then(Value::as_str) == Some(args.run_id.as_str())
            && attempt.get("nonce").and_then(Value::as_str) == Some(args.expected.as_str())
            && attempt.get("workflow").and_then(Value::as_str) == Some(args.workflow.label())
            && attempt.get("shortcut").and_then(Value::as_str) == Some(args.shortcut.label());
        if !matches {
            return Err("fixture arguments do not match the predeclared attempt".to_string());
        }
        let claim_path = PathBuf::from(
            attempt
                .get("claimPath")
                .and_then(Value::as_str)
                .ok_or("predeclared attempt has no claim path")?,
        );
        if !claim_path.is_absolute() {
            return Err("predeclared claim path must be absolute".to_string());
        }
        Ok(AttemptPlanBinding {
            sha256: plan_sha256,
            binary_manifest_sha256: planned_manifest_sha256.to_string(),
            path: plan_path,
            claim_path,
        })
    }

    struct AttemptClaim {
        file: File,
        run_id: String,
        attempt_number: u8,
        source_fingerprint: String,
        plan_sha256: String,
        binary_manifest_sha256: String,
        vai_sha256: String,
        target_sha256: String,
        driver_sha256: String,
        finished: bool,
    }

    impl AttemptClaim {
        fn create(
            args: &Args,
            binding: &AttemptPlanBinding,
            provenance: &BinaryProvenance,
        ) -> Result<Self, String> {
            if let Some(parent) = binding.claim_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| format!("cannot create attempt claim directory: {error}"))?;
            }
            let file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&binding.claim_path)
                .map_err(|error| {
                    format!(
                        "attempt {} is already claimed or cannot be claimed at {}: {error}",
                        args.attempt_number,
                        binding.claim_path.display()
                    )
                })?;
            let mut claim = Self {
                file,
                run_id: args.run_id.clone(),
                attempt_number: args.attempt_number,
                source_fingerprint: provenance.source_fingerprint.clone(),
                plan_sha256: binding.sha256.clone(),
                binary_manifest_sha256: binding.binary_manifest_sha256.clone(),
                vai_sha256: provenance.vai.sha256.clone(),
                target_sha256: provenance.target.sha256.clone(),
                driver_sha256: provenance.driver.sha256.clone(),
                finished: false,
            };
            claim.write("started")?;
            Ok(claim)
        }

        fn write(&mut self, terminal: &str) -> Result<(), String> {
            writeln!(
                self.file,
                "{}",
                json!({
                    "schemaVersion": 1,
                    "atMs": now_ms(),
                    "runId": self.run_id,
                    "attemptNumber": self.attempt_number,
                    "sourceFingerprint": self.source_fingerprint,
                    "attemptPlanSha256": self.plan_sha256,
                    "binaryManifestSha256": self.binary_manifest_sha256,
                    "binarySha256": {
                        "vai": self.vai_sha256,
                        "target": self.target_sha256,
                        "driver": self.driver_sha256,
                    },
                    "terminal": terminal,
                })
            )
            .and_then(|_| self.file.flush())
            .map_err(|error| format!("cannot write attempt claim: {error}"))
        }

        fn succeed(mut self) -> Result<(), String> {
            self.write("succeeded")?;
            self.finished = true;
            Ok(())
        }
    }

    impl Drop for AttemptClaim {
        fn drop(&mut self) {
            if !self.finished {
                let _ = self.write("failed-or-aborted");
            }
        }
    }

    fn verify_exact_target(args: &Args, stage: &str) -> Result<(), String> {
        if unsafe { IsWindow(args.hwnd) } == 0 {
            return Err(format!("{stage}: target HWND no longer exists"));
        }
        let foreground = unsafe { GetForegroundWindow() };
        if foreground != args.hwnd {
            return Err(format!(
                "{stage}: foreground changed; expected HWND {}, got {} — no input emitted",
                args.hwnd as isize, foreground as isize
            ));
        }
        let mut actual_pid = 0u32;
        unsafe { GetWindowThreadProcessId(args.hwnd, &mut actual_pid) };
        if actual_pid != args.target_pid {
            return Err(format!(
                "{stage}: target PID changed; expected {}, got {} — no input emitted",
                args.target_pid, actual_pid
            ));
        }
        let class = window_class(args.hwnd)?;
        if class != TARGET_CLASS {
            return Err(format!(
                "{stage}: untrusted target class {class:?} — no input emitted"
            ));
        }
        let exe = process_exe(actual_pid)?;
        if exe != TARGET_EXE {
            return Err(format!(
                "{stage}: untrusted target process {exe:?} — no input emitted"
            ));
        }
        Ok(())
    }

    fn require_stable_manual_focus(args: &Args) -> Result<(), String> {
        // The driver never steals foreground or clicks to acquire it. A human must
        // deliberately focus the fixture first; five checks then prove ownership.
        for index in 0..5 {
            if !fixture_chord_keys_clear() {
                return Err(format!(
                    "arming-check-{}: a shortcut key is physically held; no input emitted",
                    index + 1
                ));
            }
            verify_exact_target(args, &format!("arming-check-{}", index + 1))?;
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    }

    fn fixture_chord_keys_clear() -> bool {
        [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN, VK_SPACE]
            .into_iter()
            .all(|key| unsafe { GetAsyncKeyState(key as i32) } >= 0)
    }

    fn verify_vai_hotkey_ownership(args: &Args) -> Result<PathBuf, String> {
        let content = std::fs::read_to_string(&args.vai_log).map_err(|error| {
            format!(
                "cannot read Vai hotkey evidence {}: {error}",
                args.vai_log.display()
            )
        })?;
        let acknowledgment = content.lines().rev().find_map(|line| {
            let row = serde_json::from_str::<Value>(line).ok()?;
            (row.get("runId").and_then(Value::as_str) == Some(args.run_id.as_str())
                && row.get("event").and_then(Value::as_str) == Some("hotkey-ready"))
            .then_some(row)
        });
        let Some(acknowledgment) = acknowledgment else {
            return Err(
                "Vai did not publish a matching run-bound hotkey-ready acknowledgment".to_string(),
            );
        };
        let active = acknowledgment.get("active").and_then(Value::as_bool) == Some(true);
        let active_shortcut = acknowledgment
            .get("activeShortcut")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !active || active_shortcut != args.shortcut.label() {
            return Err(format!(
                "Vai owns {active_shortcut:?}, not requested fixture chord {:?}",
                args.shortcut.label()
            ));
        }
        if acknowledgment
            .get("sourceFingerprint")
            .and_then(Value::as_str)
            != Some(SOURCE_FINGERPRINT)
        {
            return Err("running Vai was built from a different source closure".to_string());
        }
        let adapter_ready = content.lines().rev().find_map(|line| {
            let row = serde_json::from_str::<Value>(line).ok()?;
            (row.get("runId").and_then(Value::as_str) == Some(args.run_id.as_str())
                && row.get("event").and_then(Value::as_str) == Some("acceptance-adapter-ready"))
            .then_some(row)
        });
        let Some(adapter_ready) = adapter_ready else {
            return Err(
                "Vai did not publish a matching run-bound acceptance-adapter-ready acknowledgment"
                    .to_string(),
            );
        };
        if adapter_ready.get("textLength").and_then(Value::as_u64)
            != Some(args.expected.len() as u64)
            || adapter_ready
                .get("sourceFingerprint")
                .and_then(Value::as_str)
                != Some(SOURCE_FINGERPRINT)
        {
            return Err(
                "Vai acceptance adapter acknowledgment does not match this run".to_string(),
            );
        }
        let binary_path = acknowledgment
            .get("binaryPath")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or("Vai hotkey acknowledgment has no binary path")?;
        Ok(PathBuf::from(binary_path))
    }

    fn key(scan: u16, up: bool, extended: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: 0,
                    wScan: scan,
                    dwFlags: KEYEVENTF_SCANCODE
                        | if up { KEYEVENTF_KEYUP } else { 0 }
                        | if extended { KEYEVENTF_EXTENDEDKEY } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send_raw(inputs: &[INPUT]) -> Result<(), String> {
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        if sent != inputs.len() as u32 {
            return Err(format!(
                "SendInput accepted {sent}/{} fixture events",
                inputs.len()
            ));
        }
        Ok(())
    }

    struct ChordReleaseGuard {
        armed: bool,
        release_inputs: Vec<INPUT>,
    }

    impl Drop for ChordReleaseGuard {
        fn drop(&mut self) {
            if self.armed {
                let _ = send_raw(&self.release_inputs);
            }
        }
    }

    fn send_to_verified_target(args: &Args, stage: &str, inputs: &[INPUT]) -> Result<(), String> {
        verify_exact_target(args, stage)?;
        send_raw(inputs)?;
        verify_exact_target(args, &format!("{stage}-after"))
    }

    fn post_fixture_message(
        args: &Args,
        stage: &str,
        message: u32,
        wparam: usize,
        lparam: isize,
    ) -> Result<(), String> {
        verify_exact_target(args, stage)?;
        if unsafe { PostMessageW(args.hwnd, message, wparam, lparam) } == 0 {
            return Err(format!("{stage}: PostMessageW failed"));
        }
        verify_exact_target(args, &format!("{stage}-after"))
    }

    fn post_fixture_click(args: &Args, stage: &str, x: i32, y: i32) -> Result<(), String> {
        let lparam = (((y as u32 & 0xffff) << 16) | (x as u32 & 0xffff)) as isize;
        post_fixture_message(args, stage, WM_LBUTTONDOWN, MK_LBUTTON_WPARAM, lparam)?;
        post_fixture_message(args, &format!("{stage}-up"), WM_LBUTTONUP, 0, lparam)
    }

    pub fn run() -> Result<(), String> {
        let args = parse_args()?;
        let vai_binary_path = verify_vai_hotkey_ownership(&args)?;
        let provenance = verify_binary_manifest(&args, &vai_binary_path)?;
        let attempt_plan = verify_attempt_plan(&args, &provenance)?;
        let clipboard_before = arboard::Clipboard::new()
            .map_err(|error| error.to_string())?
            .get_text()
            .map_err(|_| {
                "fixture requires an existing text clipboard so it can prove lossless restoration"
                    .to_string()
            })?;
        let mut rect = unsafe { std::mem::zeroed::<RECT>() };
        if unsafe { GetWindowRect(args.hwnd, &mut rect) } == 0 {
            return Err("GetWindowRect failed".to_string());
        }
        require_stable_manual_focus(&args)?;
        if let Some(parent) = args.out.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut report_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&args.out)
            .map_err(|error| {
                format!(
                    "refusing to overwrite driver evidence {}: {error}",
                    args.out.display()
                )
            })?;
        let path_keys = [
            &args.out,
            &args.vai_log,
            &args.binary_manifest,
            &args.attempt_plan,
            &attempt_plan.claim_path,
        ]
        .map(|value| normalized_path(value));
        if path_keys
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != path_keys.len()
        {
            return Err(
                "driver evidence, logs, manifest, plan, and claim paths must be distinct"
                    .to_string(),
            );
        }
        let attempt_claim = AttemptClaim::create(&args, &attempt_plan, &provenance)?;
        let mut stages = Vec::new();
        let mut record_stage = |name: &str| {
            stages.push(json!({
                "name": name,
                "atMs": now_ms(),
                "foreground": unsafe { GetForegroundWindow() } as isize,
            }));
        };
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);
        record_stage("target-manually-verified");

        // Fixture-only state changes are target-addressed messages, never global
        // Enter/click input. The sole synthetic global input below is the actual
        // active PTT chord being exercised.
        if args.workflow == Workflow::CanonicalChurn {
            post_fixture_message(&args, "open-field-a", WM_KEYDOWN, 0x0D, 0)?;
            post_fixture_message(&args, "open-field-a-up", WM_KEYUP, 0x0D, 0)?;
            std::thread::sleep(Duration::from_millis(180));
            record_stage("field-a-opened");
        } else {
            record_stage("chat-closed-before-hold");
        }

        // Once the chord is down, always release its modifiers even if a later
        // safety check aborts. Key-up events cannot type or click in another app.
        let vai_binary_path = verify_vai_hotkey_ownership(&args)?;
        let verified_again = verify_binary_manifest(&args, &vai_binary_path)?;
        let attempt_plan_again = verify_attempt_plan(&args, &verified_again)?;
        if !paths_match(&provenance.manifest, &verified_again.manifest)
            || provenance.manifest_sha256 != verified_again.manifest_sha256
            || !paths_match(&provenance.vai.path, &verified_again.vai.path)
            || provenance.vai.sha256 != verified_again.vai.sha256
            || !paths_match(&provenance.target.path, &verified_again.target.path)
            || provenance.target.sha256 != verified_again.target.sha256
            || !paths_match(&provenance.driver.path, &verified_again.driver.path)
            || provenance.driver.sha256 != verified_again.driver.sha256
            || !paths_match(&attempt_plan.path, &attempt_plan_again.path)
            || attempt_plan.sha256 != attempt_plan_again.sha256
            || attempt_plan.binary_manifest_sha256 != attempt_plan_again.binary_manifest_sha256
            || !paths_match(&attempt_plan.claim_path, &attempt_plan_again.claim_path)
        {
            return Err("binary provenance changed during fixture arming".to_string());
        }
        verify_exact_target(&args, "hold-start")?;
        if !fixture_chord_keys_clear() {
            return Err(
                "hold-start: a shortcut key became physically held; no input emitted".to_string(),
            );
        }
        let (press_inputs, release_inputs) = args.shortcut.inputs();
        let mut chord_guard = ChordReleaseGuard {
            armed: true,
            release_inputs,
        };
        send_raw(&press_inputs)?;
        let workflow_result = (|| -> Result<u128, String> {
            verify_exact_target(&args, "hold-start-after")?;
            std::thread::sleep(Duration::from_millis(320));
            record_stage("hold-active");

            if args.workflow == Workflow::CanonicalChurn {
                post_fixture_click(&args, "world-click", width * 70 / 100, height * 45 / 100)?;
                std::thread::sleep(Duration::from_millis(180));
                record_stage("world-clicked");
                post_fixture_click(&args, "field-b-click", width * 20 / 100, height * 82 / 100)?;
                std::thread::sleep(Duration::from_millis(250));
                record_stage("field-b-opened");
            }

            let released_at_ms = now_ms();
            send_to_verified_target(&args, "release-chord", &chord_guard.release_inputs)?;
            Ok(released_at_ms)
        })();

        let released_at_ms = workflow_result?;
        chord_guard.armed = false;
        std::thread::sleep(Duration::from_millis(100));
        record_stage("released");
        std::thread::sleep(Duration::from_millis(2_200));
        record_stage("delivery-settled");

        let foreground_after = unsafe { GetForegroundWindow() } as isize;
        let clipboard_after = arboard::Clipboard::new()
            .ok()
            .and_then(|mut value| value.get_text().ok());
        let output = json!({
            "schemaVersion": 2,
            "sourceFingerprint": SOURCE_FINGERPRINT,
            "runId": args.run_id,
            "workflow": args.workflow.label(),
            "shortcut": args.shortcut.label(),
            "vaiHotkeyReady": true,
            "vaiLog": args.vai_log,
            "binaryManifest": provenance.manifest,
            "binaryManifestSha256": provenance.manifest_sha256,
            "attemptPlan": attempt_plan.path,
            "attemptPlanSha256": attempt_plan.sha256,
            "attemptClaim": attempt_plan.claim_path,
            "attemptNumber": args.attempt_number,
            "vaiBinaryPath": provenance.vai.path,
            "targetBinaryPath": provenance.target.path,
            "driverBinaryPath": provenance.driver.path,
            "binarySha256": {
                "vai": provenance.vai.sha256,
                "target": provenance.target.sha256,
                "driver": provenance.driver.sha256,
            },
            "expected": args.expected,
            "targetHwnd": args.hwnd as isize,
            "targetPid": args.target_pid,
            "releasedAtMs": released_at_ms,
            "foregroundAfter": foreground_after,
            "clipboardBefore": clipboard_before,
            "clipboardAfter": clipboard_after,
            "clipboardRestored": clipboard_after.as_deref() == Some(clipboard_before.as_str()),
            "stages": stages,
        });
        report_file
            .write_all(format!("{output:#}\n").as_bytes())
            .map_err(|error| error.to_string())?;
        verify_exact_target(&args, "fixture-close")?;
        let target_process = unsafe {
            OpenProcess(
                SYNCHRONIZE_ACCESS | PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                args.target_pid,
            )
        };
        if target_process.is_null() {
            return Err("cannot acquire exact target process for terminal wait".to_string());
        }
        let close_posted = unsafe { PostMessageW(args.hwnd, WM_CLOSE, 0, 0) };
        if close_posted == 0 {
            unsafe { CloseHandle(target_process) };
            return Err("failed to request exact target closure".to_string());
        }
        let wait_result = unsafe { WaitForSingleObject(target_process, 5_000) };
        unsafe { CloseHandle(target_process) };
        if wait_result != WAIT_OBJECT_0 || unsafe { IsWindow(args.hwnd) } != 0 {
            return Err("exact target did not terminate before the attempt claim".to_string());
        }
        attempt_claim.succeed()?;
        Ok(())
    }
}

#[cfg(all(target_os = "windows", feature = "dangerous-ptt-fixture"))]
fn main() {
    if let Err(error) = windows_driver::run() {
        eprintln!("VAI_PTT_FIXTURE_DRIVER_ERROR {error}");
        std::process::exit(1);
    }
}
