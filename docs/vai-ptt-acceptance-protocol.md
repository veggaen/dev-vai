# Vai PTT acceptance protocol

Status: offline gates are passing. Native fixture and real-game execution remain paused until the owner explicitly says the machine is safe for focus/input testing.

## Product contract

The owner-facing League mode is **Open & paste**:

1. League chat stays closed while the owner speaks.
2. The owner holds the configured PTT shortcut, normally `Win+Alt`.
3. On release, Vai records the exact foreground window/process identity and transcribes the completed audio.
4. If the release target is exactly `League of Legends.exe`, modifiers are up, the deadline has not elapsed, and the same input sequence is still current, Vai may send exactly one Enter key-down/up pair to open chat.
5. Vai must then prove a concrete focused text field in the same HWND/PID/process generation before sending one lexical Ctrl+V sequence.
6. Vai stops after the paste. It never sends the final Enter. The owner always reviews and presses Enter manually to send.

Paste-only mode remains available when a chat field was already concretely focused at release. Neither mode injects transcript characters or Unicode key events; transcript delivery is clipboard plus Ctrl+V only.

## Non-negotiable safety boundary

1. Never start a fixture, Vai debug shell, or input-capable driver while the owner is playing a game.
2. Never terminate, minimize, focus, click, or send keys to League/Riot or another user application during automated acceptance.
3. Never use `SetForegroundWindow`, `SetCursorPos`, or global synthetic Enter/mouse input in an acceptance harness. The feature's production-owned Enter is tested only against the exact deterministic target and later by a human in League.
4. The owner manually focuses the deterministic fixture. If the exact foreground HWND, PID, process image, or class is not the expected fixture for five consecutive checks, abort before input.
5. A focus mismatch aborts the run without retry. If the driver already placed the PTT chord down, its RAII guard emits only that exact chord's key-up sequence.
6. Real-game trials are human-driven. The harness only observes append-only logs after the trial.
7. Every fixture run gets a unique 8–96 character run ID. The same value must be passed to the target and driver and set as `VAI_PTT_ACCEPTANCE_RUN_ID` for Vai before startup. Evidence with another run ID is ignored.

## Evidence levels

### A. Offline gates (safe while another application is active)

- Rust policy/unit tests prove exact release identity, process generation, current-field evidence, deadline enforcement, no character injection, one-Enter Open & paste semantics, modifier cleanup, and clipboard ownership invariants.
- TypeScript tests prove silence rejection, long-hold ordering, fast-tier routing, persisted Open & paste preference, and UI state behavior.
- Target-audit and aggregate-gate tests try duplicate, abbreviated, stale, cross-run, mixed-source, and reused-evidence attacks.
- The input-capable driver is inert in normal builds. Its implementation compiles only when `dangerous-ptt-fixture` is explicitly enabled; compilation does not execute it.

Offline gates can disprove readiness but cannot prove Windows focus behavior or League's real chat-field signal.

### B. Deterministic Win32 fixture (only after explicit safe-to-test approval)

Run windowed and borderless target modes separately. Before every attempt:

- Confirm no game is being played and no unrelated foreground interaction is expected.
- Start only `vai_ptt_target.exe` with a unique `--run-id`; its `ready` JSONL row supplies the exact PID and HWND.
- The owner manually selects the fixture window.
- Build formal Vai fixture evidence in Cargo `release` with `dangerous-ptt-fixture`; this uses embedded release renderer assets rather than the mutable localhost/HMR renderer. Start Vai with the matching `VAI_PTT_ACCEPTANCE_RUN_ID`, deterministic acceptance transcript in
  `VAI_PTT_ACCEPTANCE_TEXT`, and a new absolute `.jsonl` path in
  `VAI_PTT_ACCEPTANCE_LOG_PATH`. The feature-enabled process creates that evidence file with create-new
  semantics; an existing or invalid path leaves fixture-only Enter injection disarmed. The acceptance
  adapter preserves this predeclared transcript byte-for-byte after non-speech annotation removal and
  bypasses learned speech-profile, casing, punctuation, and model-polish changes. After React commits
  that exact adapter, it emits a run-bound `acceptance-adapter-ready` acknowledgment; the driver refuses
  to emit its chord until both this acknowledgment and `hotkey-ready` match the planned run/build/text.
- Build the target and driver in the same release profile, with the driver explicitly gated by `--features dangerous-ptt-fixture`. Before any run, create one binary manifest with `vai-ptt-binary-manifest.mjs`, then one hash-bound ten-attempt plan with `vai-ptt-attempt-plan.mjs`. Pass the literal arming value `target-only-input-is-safe`, exact PID/HWND, binary manifest, attempt plan and number, the plan's run ID/nonce/workflow, the dedicated Vai log via `--vai-log`, and the shortcut Vai reports as active.
- The driver supports `--shortcut Win+Alt` and `--shortcut Ctrl+Shift+Space`. Before global chord input it twice verifies a matching run-bound `hotkey-ready` acknowledgment, the exact plan/manifest/executable hashes, and that all chord keys are physically up. A run is invalid unless that acknowledgment and Vai's release row report the same active shortcut.
- `Win+Alt` is a pure-modifier chord and is observed with passive key-state polling rather than an OS-reserved `RegisterHotKey` registration. The keyed fallback still uses `RegisterHotKey`; neither path installs a keyboard hook or swallows game input.
- The fixture uses target-addressed `PostMessageW` only for its internal chat/click churn. The sole global driver input is the active PTT chord under test.

Two fixture workflows are required:

- `canonical-churn`: field A opens, a world click closes it, field B opens, release pastes exactly once into B.
- `open-and-paste`: chat is closed at release; production Vai sends one Enter, proves field A, pastes exactly once into A, and sends no final Enter.

Each candidate is audited with four create-new evidence files: target JSONL, Vai dictation JSONL, driver JSON, and the predeclared attempt-claim JSONL. `vai-ptt-target-audit.mjs` binds the run ID, attempt number, nonce, PID/HWND, workflow, active shortcut, source fingerprint, binary manifest, attempt plan, and SHA-256 hashes. The aggregate gate reparses those files, independently rehashes all three executables, and recomputes every candidate; self-declared PASS fields are not trusted.

A candidate PASS requires all 24 ordered checks, including:

- exact target and delivery identity;
- correct game/window-mode classification;
- the workflow's release-field contract and delivery route;
- concrete post-Enter text-field proof for Open & paste;
- fast STT and finite release-to-paste latency from 0 through 1,500 ms;
- exactly one paste, no gameplay characters, and no value in the non-target field;
- exactly one chat-opening Enter, no Enter/control event after paste, and chat still open when the fixture closes;
- no target deactivation before paste and stable driver foreground;
- fixture-only clipboard restoration when Vai still owns the temporary value.
- exact running Vai/target/driver paths matching the one binary manifest;
- an attempt plan created before target readiness and a two-row `started` → `succeeded` terminal claim bound to its exact hashes.

Clipboard snapshot and replacement use one valid Vai-window-owned Win32 `OpenClipboard` transaction. Vai accepts
only an empty clipboard or one losslessly copyable Unicode-text/DIB format; multiple or unsupported
formats fail closed. Transcript and rollback storage are allocated before `EmptyClipboard`; replacement failure triggers an in-transaction rollback. Immediately before Ctrl+V, Vai reopens the clipboard and requires both the captured sequence number and exact sanitized transcript, otherwise it refuses the paste. The
delayed fixture/non-game restoration reopens the clipboard once, verifies both sequence ownership
and exact temporary text, then restores under that same lock.

After ten candidate reports exist, `vai-ptt-acceptance-gate.mjs` independently rehashes every evidence file, the attempt plan, binary manifest, and all three executables, then rejects the batch unless all candidates pass. It also requires the exact predeclared attempts 1–10 in non-overlapping chronological order, unique run IDs/nonces/release identities/evidence, one source/binary build, both window modes, at least three churn runs, at least one Open & paste run, supported shortcuts on every run, at least one proved `Win+Alt` run, no focus theft, and passing latency everywhere. Release IDs are namespaced by run because Vai restarts for each run-bound log and its local sequence restarts too.

Every failed candidate must be preserved for diagnosis. The producers refuse to overwrite their evidence paths. Once manual focus is stable, the driver pre-creates its report and claims the numbered attempt before emitting the chord; success is permitted only after the exact target process terminates and its summary timestamp precedes the terminal `succeeded` row. Every ordinary error/drop writes `failed-or-aborted`. Claims carry the exact plan, manifest, binary, and compiled-source hashes. The driver validates the entire ten-row plan's ordinal numbering and unique absolute claim paths/run IDs/nonces before input, and attempt N cannot start unless all earlier claims succeeded. These are strong operational/tamper-evident controls, but ordinary owner-writable files are not WORM storage: deliberate deletion/reconstruction remains outside what this local gate can independently disprove.

The binary manifest accepts only the exact Cargo `target/release` executable names and records their paths, sizes, SHA-256 hashes, Cargo/Tauri contract, and source-closure fingerprint. Rather than maintaining a fragile hand-picked import list, the closure recursively hashes the complete desktop, Core, UI, and API-types source trees plus workspace/native/build configuration and the formal PTT scripts. Build.rs embeds that fingerprint into Vai, target, and driver; runtime evidence must expose all three matches, and the driver hashes the executing files twice before input. Every audit snapshots each input once and derives parsing plus SHA-256 from the same bytes. This tightly binds the observed local run, but does not claim code-signing, an external transparency log, or reproducible proof of the compiler/toolchain.

### C. Real League trials (human-driven only)

Open & paste trial:

1. Owner leaves League chat closed.
2. Owner holds the active PTT chord and speaks a unique nonce.
3. Owner releases PTT without changing focus.
4. Vai may send one Enter to open chat and one Ctrl+V only after the concrete post-open field check.
5. Owner verifies the text, then personally presses Enter to send.

Canonical churn control:

1. Owner opens League chat, holds PTT, and speaks a unique nonce.
2. While holding, owner clicks the world, then deliberately reopens/refocuses chat.
3. Owner releases PTT.
4. Vai may send one Ctrl+V only if release-time and delivery-time field evidence both remain valid. Owner sends manually.

Record the matching `released` and `delivery` rows plus the expected `clipboardRestoreScheduled: false`/transcript-retained state. A real-game PASS requires the nonce exactly once in the intended chat field, zero transcript characters delivered to gameplay, no focus theft, no automatic final Enter, and latency at most 1.5 seconds. Run 10 consecutive PASS trials, with Open & paste represented and at least three full churn controls. Windowed/borderless and exclusive fullscreen must be represented; exclusive mode may rely on distinct audio cues when the overlay cannot render.

For real games, Vai deliberately leaves the transcript on the clipboard after accepted Ctrl+V. Windows accepting Ctrl+V does not prove the game consumed the clipboard before restoration. Lossless restoration remains proved in the deterministic fixture only; real-game restoration needs a future consumption acknowledgement.

## Fail-closed routes

- `clipboard-ready-no-field`: no editable field was proved at release.
- `clipboard-ready-field-closed`: game field evidence became invalid before delivery.
- `clipboard-ready-focus-changed`: HWND, PID, process generation, or focused control changed.
- `clipboard-ready-input-changed`: another dictation/input sequence superseded this release.
- `clipboard-ready-clipboard-changed`: the clipboard sequence or exact transcript changed before paste, so Vai refused to paste unrelated clipboard data.
- `clipboard-ready-modifiers-held`: a modifier was still physically down before production input.
- `clipboard-ready-chat-open-failed`: Windows did not accept the single League chat-open Enter.
- `clipboard-ready-chat-field-unproved`: Enter was accepted, but Vai could not concretely prove the resulting text field.
- `clipboard-ready-latency-exceeded`: the safe input deadline elapsed; late text remains clipboard-only.
- `clipboard-ready-sendinput-failed`: Windows did not accept the paste input.
- `no-target`: no usable foreground target or the desktop shell was foreground.

These leave the transcript clipboard-ready and are safe outcomes, not acceptance passes.
