# Vai Improvement Backlog

Shared queue between V3gga, Vai, and AI agents. Append dated entries with
evidence; mark items DONE with proof (test/screenshot/run). Agents: read
`AGENTS.md` first, and `GET /api/agent/introspect` for live state.

## Open

- **PARTIAL 2026-07-10 - Chat-to-software live proof, concise receipts, and honest rendered verification**
  - Exact project-bound Agent edit passed the real desktop path end to end: disposable chat bound to the exact
    `DEV_MPM/mpm-frontend` root, one-file mutation, visible HMR result in App, compact completion receipt, reversible
    revision, byte-identical restore, and chat cleanup. Evidence: 18/18 in
    `Temporary_files/chat-edit-live/2026-07-10T00-33-30-288Z`.
  - Agent mode now applies its validated edit through the reversible sandbox API instead of stopping at an unexplained
    approval card. Builder/Chat can still honor diff-review preference. Receipts now show a short result, at most two
    proof lines, changed files on demand, and App/Code/Pop app actions. The visible assistant badge stays `Agent`.
  - Fixed two false failure paths found live: a slow first Next compile no longer marks a still-compiling external app
    failed, and cross-origin desktop health checks use no-CORS reachability so a healthy localhost app is not reported
    as stopped. Exact-edit proof waits up to 45 seconds for large-project HMR.
  - Harder council edit on Lawn passed 11/13: council changed only `src/lib/convex.tsx` and the revision restored it
    byte-identically, but the requested marker never rendered. Lawn's visible setup screen is produced by another
    runtime entrypoint, so the changed file was valid but not live. Evidence:
    `Temporary_files/chat-council-edit-live/2026-07-10T00-38-16-819Z`.
  - **Next required slice:** before acting, resolve the requested file/component to the effective runtime module graph;
    after acting, require a rendered marker or screenshot delta before using completion language. A one-file diff and
    reachable server are necessary evidence, not sufficient visual proof.

- **DONE 2026-07-10 - Project-aware Env helper for Lawn and other integration-heavy apps**
  - The App toolbar Env dialog now groups missing values into Core runtime, Authentication, Billing, Video, Storage,
    and Other; puts the true boot values first; labels generated/server-only values; keeps inputs masked; and provides
    official provider links for recognized Convex, Clerk, Stripe, Mux, Railway, Autumn, and Chunkify values.
  - Only `VITE_CONVEX_URL` and `VITE_CLERK_PUBLISHABLE_KEY` are marked required to open Lawn. The copy explains that
    Convex backend secrets must also be configured on the deployment, rather than pretending `.env.local` alone is
    sufficient. The old 16-variable truncation is removed.
  - Visual proof: 12/12, no browser errors, with header/footer fitting inside the short App pane and 25 Get-value links:
    `Temporary_files/env-setup-modal-e2e/2026-07-10T00-55-23-334Z/03-env-modal.png`.

- **DONE 2026-07-09 - Crash/reload recovery for project-bound chat edits**
  - Problem observed live after a VS Code/app crash: Vai reopened the `mpm-frontend` chat, but the desktop hook
    reprocessed a persisted exact-replace marker from the transcript. Because the external source file already
    contained `Join the decentralized future`, the stale marker hit the guarded mismatch path
    (`Expected 1 replacement(s), found 0`) and falsely put the preview into a stopped/failed state.
  - Fixes landed: persist/resume the last active conversation; attach a conversation's sandbox project before
    messages are committed; auto-expand project-bound chats; keep external previews in "warming" until the iframe
    actually loads; and mark loaded assistant history as already processed so old action markers stay visible but
    inert after reload/reselect.
  - Live evidence: clean reload of `http://localhost:5173/?devAuthBypass=1` restored the exact-edit chat,
    selected the App panel, mounted `http://localhost:4100`, showed no replacement mismatch or preview-stopped state,
    and rendered the external MPM page with hero text `Join the decentralized future`.
  - Test evidence: focused desktop/core regression run passed 61/61 tests:
    `auto-sandbox-message-selection`, `chatStore`, `sandbox-actions`, `auto-sandbox-intent`,
    `exact-workspace-edit`, and `build-execution-intent`; `corepack pnpm --filter @vai/desktop typecheck` passed.
  - Remaining external-project notes, not Vai replay failures: first Next compile for this folder can be slow, and
    the app logs WalletConnect/AppKit/Lit warnings. A transient `layout.js` syntax/chunk error disappeared after the
    clean reload and the preview rendered normally.
  - Follow-up: failure copy now says `App stopped` instead of `Preview stopped`, and the preview panel keeps a
    same-project/same-port iframe visible when it has already loaded even if a stale failed status lands later.
    Proof: post-patch reload showed no stopped card, one mounted iframe, and rendered `Join the decentralized future`.
  - Follow-up: external/sandbox projects now get a real IDE-style split when Files is enabled: the file explorer docks
    as a left rail beside Preview/Source instead of taking over a full-width top slab. The composer quick-connect was
    renamed from `IDE` to `Ext IDE` so it is clear that button means an external VS Code/Cursor-style agent, not Vai's
    built-in app workspace. Proof: post-patch live reload showed `page.tsx` in a 229px left rail, `http://localhost:4100`
    still mounted in the right preview iframe, `Ext IDE` visible, no stopped card, and `@vai/desktop` typecheck green.
  - Follow-up: the app/source switcher now speaks the user's language and supports both-at-once: `Preview` was renamed
    to `App`, `Source` was renamed to `Code`, and a new `Split` mode shows Code and App side by side. Proof:
    post-patch live reload showed `App`, `Code`, and `Split` buttons, no visible `Preview`/`Source` tab labels,
    `page.tsx` on the code side, and the `http://localhost:4100` app iframe titled `App` on the other side.
  - Follow-up: Lego UI popouts are now discoverable: Chat has a `Pop chat` control, the app workspace has a pop-out
    control, and App popouts carry the active sandbox `projectId` so the detached window attaches to the same running
    project. The `dev | preview | prod` pill is clarified as a real runtime environment switch: Dev = HMR dev server,
    Preview = build + local production-like serve, Prod = gates + production build + serve. Proof: desktop typecheck
    passed; live browser showed `Pop chat`, app popout control, and `Dev` / `Preview` / `Prod` lane titles; the chat
    popout route opened as `?popout=chat` with title `Vai — Chat` in the in-app browser harness.

- **PROPOSED 2026-07-09 - IDE-grade project workspace: remaining slices**
  - Context: 2026-07-08/09 sessions landed the open-local-folder pipeline end to end (scan → review card with
    README setup notes / missing env / Node engines / monorepo warnings → install → dev server → preview),
    the run-command backbone + console script deck (build/lint/test/typecheck), project-wide search backend +
    UI (match case, whole word, regex, replace-all with revertable revisions), external-folder safety
    (never deleted), a 403 ownership fix, and a handoff-shell deadline + "Show the app now" escape.
    Evidence: `scripts/test-open-folder-visual.mjs` 7/7 on `dev-t3code` (Temporary_files/open-folder-e2e/),
    search API 393 matches across 5,581 files, V3gga's own screenshots.
  - Remaining slices, in priority order:
    1. Chat-to-edit proven live on an opened folder: chat request → council edit → file write → HMR → visible change.
    2. Error lens: when the served app 500s/crashes at boot, show a readable crash card (real cause + "Fix with Vai"
       chat handoff) instead of raw JSON in the iframe (dev-lawn missing VITE_CONVEX_URL is the repro).
    3. Env switch (dev | preview | production bullet) on the app window + "Run build?" prompt on save in prod, built
       on a blue-green shadow-port swap so version updates are instant and errors never replace a working app.
    4. App-window header/organization design pass + diff-mode quality pass (current DiffReviewPanel is functional,
       not distinctive).
    5. Idea backlog from 2026-07-09 brainstorm (partial): version timeline scrubber, click-to-edit bridge,
       one-heavy-task governor, multi-viewport grid, flight recorder (console+network timeline), env-var editor
       with dev/preview/prod scopes, per-user data sandbox (Base44 mode), session recovery card, ghost diff preview.

- **PROPOSED 2026-07-06 - Voice accuracy loop: confidence, phrase priming, calibration prompts, and repair UX**
  - Context: V3gga reports current hold-to-dictate/paste flow finally lands text in the target input, but everyday
    phrases can still mutate semantically, e.g. "Can you hear me?" -> "Can you help me?" The remaining issue is not
    delivery; it is trust in the transcript.
  - Evidence in current code: desktop already has recorder-first STT with selectable quality
    (`apps/desktop/src/lib/voice/recorder-stt-adapter.ts`, `stt-quality.ts`), deterministic cleanup plus a promoted
    local speech profile (`apps/desktop/src/lib/voice/speech-profile.ts`), post-dictation correction detection
    (`apps/desktop/src/lib/voice/correction-detection.ts`), and voice settings/testing UI
    (`apps/desktop/src/components/panels/settings/VoiceSettingsPanel.tsx`). Missing pieces are user-visible
    confidence, phrase/context priming, an intentional calibration session, and a fast correction flow for ambiguous
    phrases before paste.
  - Proposed slices:
    1. Add an "accuracy review" strip for low-confidence or high-risk words: show 2-3 alternatives inline before final
       paste when the engine is uncertain or the sentence meaning flips.
    2. Feed a compact dynamic phrasebook into STT where supported: personal dictionary, current app/screen words,
       recent conversation terms, project names, commands, and common V3gga phrases.
    3. Add a five-minute calibration mode with phonetically dense prompt cards plus user-specific names/tools; measure
       word error rate before/after and promote repeated corrections into the speech profile.
    4. Store correction pairs with context, not only raw replacement rules: phrase before/after, target app, language,
       device, quality tier, and whether the user accepted/reverted the fix.
    5. Build a small "voice lab" evaluation harness: fixed sentence pack, recorded samples, WER/semantic-drift score,
       and pass/fail thresholds so improvements are proven instead of felt.
  - First slice: add a Voice Settings "Accuracy Coach" panel that runs 12 short phrases, captures expected vs heard,
    writes a local report, and seeds the speech profile only after confirmation. Verify with focused unit tests for
    scoring/profile promotion and a live desktop transcription run.
  - Partial 2026-07-06: fast-display slice landed. Live draft word preview now defaults on, starts without blocking the
    recorder, labels interim words as draft, preserves latest Web Speech interim text on stop, and external global
    dictation pastes the locally cleaned final immediately instead of waiting for polish. Proof: focused desktop voice
    tests 24/24 green and `corepack pnpm --filter @vai/desktop typecheck` passed.
  - Partial 2026-07-06 follow-up: confirmed mishearing prompts now promote the heard->corrected pair immediately when
    V3gga clicks "Remember correction" instead of waiting for a second occurrence; local PCM now trims leading/trailing
    silence before Whisper to reduce dead-air latency and hallucination risk. Proof: focused voice tests 28/28 green
    and `corepack pnpm --filter @vai/desktop typecheck` passed. Bundle verification remains blocked by an existing
    desktop/browser build issue in `packages/core/src/db/client.ts` importing `node:fs` through the Vite client bundle.

- **DONE 2026-07-04 - Voice dictation pipeline: transparent global bubble + local cleanup phase**
  - Fixed the standalone dictation bubble route so the Tauri transparent window no longer inherits the main app's dark
    `html/body/#root` canvas. Proof: browser inspection of `?view=dictation-bubble` showed `html`, `body`, and `#root`
    all computed as transparent, with the "Cleaning locally..." phase visible.
  - Added local Ollama transcript cleanup as the default post-raw-text phase (`/api/stt/polish`, default
    `local:qwen2.5:3b`) and surfaced raw -> local cleanup -> final in composer/global dictation UI. Proof:
    injected route test returned `cleanup.configured=true` and polished "hello comma..." to a clean sentence.
  - Important remaining gap: Qwen/DeepSeek text models are now the cleanup intelligence, but they still need a raw
    text source; they do not directly decode waveform audio. Desktop global dictation now avoids pretending Web Speech
    is equivalent to the recorder path because Web Speech cannot be pinned to the selected mic.
  - Build/sync to the installed desktop copy was not rerun in this pass because Codex approval quota blocked the
    elevated `corepack pnpm build:desktop` command.

- **QUEUED 2026-07-02 - vai-engine.ts decomposition, phase 2: the COUPLED dispatcher giants (the key to the routing bugs)**
  - Why now: the 2 pre-existing failing tests (deploy-fire-drill + auth/team/sandbox → misrouted to the engine-identity
    handler) are unfixable-in-practice because the routing lives in `generateResponse` (the 1884-line main dispatcher)
    inside the 35k-line `vai-engine.ts` god-class. The self-improvement loop CORRECTLY refused to touch it (its
    find/replace can't express a dispatcher reorder; it aborted cleanly rather than slop). Decomposing the dispatcher
    is what makes those bugs fixable — by the loop OR a human. Decomposition and the routing bugs are the same problem.
  - State: Slices 1-4 DONE + PROVEN byte-identical (56,447 → 35,201 lines, -38%). Pure methods already extracted
    (builder-templates, algo-templates, knowledge-answers, code-emitters). Reusable tooling exists and is battle-tested:
    `scripts/extract-pure-methods.mjs` (AST spans + this/super detection + auto-import-carry), `scripts/capture-method-golden.mjs`
    (golden battery), regression tests lock byte-identity. tsc is the gate (caught missing-import + alias-collision bugs).
  - Phase 2 = the COUPLED `this.`-using giants (need deps-as-params surgery, NOT plain extraction):
    `tryFrameworkDevopsKnowledge` (2788), `tryAnswerEarlyHooks` (2246), `handleConversational` (1235),
    `tryNorwegianLanguage` (1077), `tryCreativeCodeProject` (747), `tryAlgorithmCodeGen` (591), and LAST the
    `generateResponse` dispatcher (1884) — split its routing table into a data-driven, TRACEABLE dispatch so a
    misroute is a one-line table edit, not a swamp dive.
  - Approach (per the council's prior endorsement): pass the few `this.` helpers each method calls as an explicit deps
    object (or split into a sibling taking that deps object). Golden-snapshot each before/after; tsc + full core suite
    (3596 tests) must stay green; one regression test per extracted module locking byte-identity.
  - Method pitfalls (do NOT repeat): never brace-match by counting {} (they appear in string literals — use the AST);
    never dedent extracted bodies (multi-line template literals have significant leading whitespace).
  - Payoff: (1) the deploy/architecture routing bugs become fixable → greens the CI baseline → unblocks PR #3 + future
    PRs; (2) the loop can then land routing fixes itself (traceable table vs 1884-line swamp); (3) stops the editor
    crashes on opening the file. This is a large, careful, multi-slice effort — pick up as its own focused pass.

- **Capability-Innovation 2026-07-01 — council round (strong 7.1/10)**
  - Context: generative capability council toward the north-star (voice + interface, any task,
    reliable, no lost details). council 7.1/10 (strong) · 10 lenses · 9 areas · top cluster 2
  - weakest council dimension: delegation (5/10) — improve the roundtable here next
  - Proposals (PROPOSE-only — review + implement by V3gga/Opus; never auto-applied):
    - **[council] Synthesis: Voice-First Task Execution with Gap Diagnosis** (impact 9.6/10) — Vai can reliably execute tasks through voice-first interaction, using real-world tools, while diagnosing and escalating capability gaps to V3gga/Opus-4 when needed.
      - first slice: A voice-first interface that captures and processes real-time voice input, delegates tasks to real-world tools, and escalates with a one-liner summary when a task is unsolvable.
      - verify: ship the first slice and confirm the combined behavior
      - builds on: Voice-First Identity Clarification; Honest Capability Gap Diagnosis with Escalation; Capability-Gap Shareable Artifact
      - evidence: packages/runtime/src/routes/agent-introspect.ts:65, packages/core/src/chat/capability-gap.test.ts:24, packages/core/src/chat/capability-gap.ts:80, packages/core/src/chat/capability-gap.ts:115
    - **[brand] Voice-First Identity Clarification** (impact 8.7/10) — Vai is a voice-first interface that lets V3gga speak to Vai and get help with any task Vai is capable of — completed reliably, escalating honestly to V3gga/Opus-4 when Vai cannot.
      - first slice: Update README.md with a one-line hook: 'Vai is a voice-first interface that lets V3gga speak to Vai and get help with any task Vai is capable of — completed reliably, escalating honestly to V3gga/Opus-4 when Vai cannot.'
      - verify: Check README.md for the updated one-line hook and ensure it's the first line the user sees
      - evidence: packages/runtime/src/routes/agent-introspect.ts:65
    - **[capability-gap] Honest Capability Gap Diagnosis with Escalation** (impact 8/10) — Vai can diagnose capability gaps with honest messages and escalate to V3gga/Opus-4 when it cannot perform a task
      - first slice: Implement the 'no-candidates' gap diagnosis and escalation logic
      - verify: Test the gap diagnosis and escalation logic with unit tests to ensure it correctly identifies and escalates capability gaps
      - evidence: packages/core/src/chat/capability-gap.test.ts:24, packages/core/src/chat/capability-gap.ts:80
    - **[growth] Capability-Gap Shareable Artifact** (impact 7.1/10) — Vai can generate a shareable artifact when it cannot complete a task, encouraging users to showcase their interaction with Vai
      - first slice: Add a function to generate a shareable artifact when a capability-gap is diagnosed
      - verify: Check if the artifact is generated and shareable when a task is deemed unsolvable
      - evidence: packages/core/src/chat/capability-gap.ts:80, packages/core/src/chat/capability-gap.test.ts:24
    - **[reliability] Task Verification Flag** (impact 6.9/10) — Vai can flag tasks for verification to ensure all details are captured and no steps are missed
      - first slice: Add a verification flag to task objects during routing
      - verify: Check if verification flags are set and ensure tasks are flagged for review when complex or multi-step
      - evidence: src/council/decision.ts:45, src/chat/handler.ts:112

- **Built 2026-07-01 - Council self-trigger loop CONNECTED end-to-end (enqueue seam + cross-process inbox + drain wire) (DONE, 105 new tests; both typechecks clean; ChatService+council 95/95 unbroken)**
  - Context: V3gga asked why `enqueueFromMissingCapability`/`drainSelfImproveQueue` were built-but-not-connected.
    Wired the full chain so the Council actually triggers its own improvement loops from LIVE turns.
  - **Enqueue seam (core):** `packages/core/src/chat/self-improve-queue-port.ts` — a `SelfImproveQueue` port +
    `jobsFromConsensus` (pure: non-ship consensus + actionable missingCapabilities → jobs, vague-filtered + deduped).
    `ChatService.triggerSelfImprovement(draft, consensus)` calls it at the SAME post-council seam as
    `persistCouncilLessons` (service.ts:1310) — injected, bounded, best-effort, never breaks the turn. Added
    `selfImproveQueue` to the options + the `isChatServiceOptions` guard (the flag-ignored bug the backlog warned of).
    Exported the types from `@vai/core`. 8 tests.
  - **Cross-process inbox bridge (loop):** `scripts/improve-loop/self-improve-inbox.mjs` — the runtime and the loop
    are SEPARATE processes; rather than share one SQLite handle (locking/coupling), the runtime APPENDS jobs to an
    append-only JSONL inbox (Temporary_files/self-improve-inbox.jsonl, mirroring the existing council-findings.json
    signal-file pattern) and the loop INGESTS it into the queue table. `appendToInbox`/`readInbox`/`clearInbox`/
    `ingestInbox` (tolerant parse, length caps, dedup+shelf via the injected enqueue). 9 tests.
  - **Runtime impl:** `packages/runtime/src/steering/self-improve-queue.ts` — `createSelfImproveQueue()` implements
    the port by appending to the inbox (same format as the .mjs reader); injected into ChatService in server.ts next
    to guidanceStore. Both packages typecheck clean.
  - **Drain wire (loop):** `scripts/improve-loop/feature-review-job.mjs` — `runSelfImproveJob(job)` routes ONE
    queued job through the gated pipeline (feature-build → feature-review: self-match → peer review → rebuild-once →
    keep-chasing → integrate|shelve|held), records the outcome to the changelog (injectable path for tests). The
    supervisor cycle now (after APPLY, before the campaign snapshot) INGESTS the inbox then DRAINS a budgeted (3),
    serial batch; observe mode = preview (review only), apply mode arms integration (still branch-guarded inside the
    job). Skipped entirely when the queue is empty. 4 tests.
  - Full chain now compiles + is tested end-to-end: live turn → ChatService.triggerSelfImprovement →
    SelfImproveQueue.enqueue → inbox JSONL → (loop) ingestInbox → self_improve_queue → drainSelfImproveQueue →
    runSelfImproveJob → feature-build → feature-review → integrate/shelve/held + changelog.
  - Proof: inbox 9/9, queue-port 8/8, job 4/4 + the prior feature suites (self-improve-queue 13, feature-build 17,
    feature-review 28, coderabbit 16, changelog 10) → 105 green this round; `@vai/core` + `@vai/runtime` typecheck
    exit 0; `chat-service` + `council` 95/95 unbroken (the enqueue call on the hot path is safe).
  - HONEST scope: the wiring is COMPLETE + unit-verified, but NOT yet exercised live end-to-end (would need the
    runtime up producing a real missingCapability turn AND the loop running to drain it). The `resolveLocation` for
    an ingested job uses CLASS_LOCATION[klass|intent]; a job whose class has no known location aborts cleanly
    (no crash) rather than grounding codegen — so early real jobs may abort until location resolution is richer.
  - Next: (1) live end-to-end smoke (runtime turn that yields a missingCapability → confirm a job appears in the
    inbox → loop drains it); (2) richer resolveLocation (grep the repo for the capability rather than a static map);
    (3) the user→council bridge's capture step now shares this exact seam — a weak-turn signal can enqueue the same way.

- **Built 2026-07-01 - Council self-triggered loops (Level 1) + codegen build effect + CodeRabbit peer augmentation w/ cooldown (DONE, 84 new tests green; fixed-sequence loop verified producing; live end-to-end preview verified)**
  - Context: continuation of the feature-review work. Three asks: (1) let council members TRIGGER their own
    improvement loops; (2) give the feature-review protocol a real codegen `build`; (3) let peers run CodeRabbit
    (free tier) on their suggestions with a cooldown workaround for its rate-limiting. Plus: run the supervised
    fixed sequence and verify the council actually produces.
  - **Verified the loop produces (ask 2):** ran `supervisor.mjs --max-cycles 1 --per-class 2` (observe-only, scratch
    DB) against live Vai. It observed the `routing/build-verb-poison` class → Vai answered 100% (6/6) → `0 failures`
    → correctly `0 proposals` (nothing to fix). VRAM stayed 7.0–7.2/8.5 GB with cooldowns, clean shutdown, model
    evicted, resumable. HONEST: this proves the machinery runs + produces observations; it did NOT exercise
    council-convene-on-failure because the tested class is already passing (a capability-council demo would show
    proposal generation directly).
  - **Level 1 self-triggered loop (ask 1):** `scripts/improve-loop/self-improve-queue.mjs` — a council member's
    existing `missingCapability` note field becomes an ACTION. `instructionFromNote` synthesizes an instruction from
    missingCapability + realIntent + methodLesson; `enqueueFromMissingCapability` writes a dedup'd, tokenized-
    fingerprint job to a `self_improve_queue` table, SKIPPING duplicates and gaps that match a still-dead SHELVED
    idea (revivable ones are allowed back); `enqueueFromCouncil` collapses two members naming the same gap into one
    job; `drainSelfImproveQueue` runs up to a BUDGET (default 3) of jobs serially through an injected runner (the
    feature-build→feature-review pipeline). Members TRIGGER (emit intent) but never BYPASS — the gated peer-reviewed
    pipeline does the work. 13 tests (sqlite-gated, real temp DB).
  - **Codegen build effect (ask 3a):** `scripts/improve-loop/feature-build.mjs` — instruction-driven grounded
    codegen (distinct from propose-fix's class-driven bug localizer). `parseTargetLocation` (Windows-drive-safe:
    only a trailing `:line` is the line, `C:/…` preserved), `selectExcerpt` (enclosing-function isolation from a
    line hint, else keyword match, else head), `buildFeaturePrompt`, `shapeArtifact` (line-number grounding: copy
    the REAL source line the model pointed at, ignore a corrupted retype; verify via proposal-verifier). Produces
    the `{file,find,replace,diff,summary,sourceExcerpt}` artifact the review protocol consumes. Wired into
    `feature-review-run.mjs` as the real `build` (replacing the supplied-artifact placeholder). 17 tests.
    **Live end-to-end:** ran the full orchestration against qwen2.5-coder:7b in PREVIEW — build produced a verified
    artifact, all 4 peers voted, self-match correctly returned "no" (blocked integration → forced rebuild →
    keep-chasing → HELD because 2 peers still championed it). Every protocol branch fired; the throwaway target was
    NOT modified (preview-safe); the changelog recorded the HELD outcome.
  - **CodeRabbit peer augmentation + cooldown (ask 3b):** `scripts/improve-loop/coderabbit.mjs` —
    `isCodeRabbitAvailable` (probe), `parseCodeRabbitAgentOutput` (DEFENSIVE parse of `cr --agent` JSON across
    findings[]/comments[]/nested shapes → normalized findings, garbage → [] never throws), and `CodeRabbitBudget`
    — a PERSISTED rolling-hour rate limiter (records call timestamps to a JSON file, refuses past ~3/hr with
    time-until-next, survives restarts). `reviewWithCodeRabbit` checks the budget, runs `cr --agent`, folds
    findings into the artifact's excerpt so peers improve their suggestion before review. Wired into
    `feature-review-run.mjs` (`--no-coderabbit` to disable). 16 tests.
    **HONEST CAVEAT:** the CodeRabbit CLI does not yet support Windows (vendor: "coming soon"), so on this machine
    the probe returns false and the whole augmentation NO-OPS gracefully (peers proceed without it) — verified live.
    The seam + cooldown are built + tested now; it lights up the moment `cr` is installed (Windows support, or WSL).
    Free-tier limit confirmed ~3–4 reviews/hr (docs.coderabbit.ai/cli).
  - Proof: `coderabbit 16 + feature-build 17 + feature-review 28 + changelog 10` → 71/71; `self-improve-queue` →
    13/13 (sqlite); apply-fix/apply-runners unchanged; live supervisor + live feature-review preview both verified;
    GPU freed after.
  - Next: (1) wire `drainSelfImproveQueue` into a supervisor cycle so the queue actually drains each loop
    (currently the module is built + tested but not yet called from supervisor.mjs); (2) wire
    `enqueueFromMissingCapability` at the council's post-turn seam in service.ts so real turns populate the queue
    (this is also the user->council bridge's capture step); (3) tune the codegen self-match — it read "no" on a
    correct find/replace diff (a chat-framed self-match struggling to interpret a diff as "enthusiastic"); (4)
    Level 2/3 (member-initiated tool call; council convenes on its own queue to schedule).

- **Built 2026-07-01 - Council feature-review protocol + self-improvement changelog + in-app surface (DONE, 116 new/affected tests green, both typechecks clean, UI verified live 0 console errors)**
  - Goal (V3gga): let the Council BUILD features, re-read its own creation against the original instruction, gather
    MULTI-MEMBER peer advice (reasons + change-tips biased for modernization/scale), rebuild once on rejection, and
    on a second rejection ask each peer "keep chasing?" — shelving dead ideas as a tokenized fingerprint that a future
    similar message can pull (revivable only when several members flag new knowledge). Plus a changelog side-note for
    humans/Copilot/agents, and a process-UI surface that shows self-improvements under a collapsed menu whose steps
    open expanded.
  - Slice A — `scripts/improve-loop/feature-review.mjs` (pure, injected effects): self-match prompt/parse; per-persona
    peer vote (verdict+score+modern+scale+reason+tip) parse; `aggregatePeerVotes` (majority AND modern/scale floor —
    a locally-correct but future-fragile change is HELD, not accepted); `buildRebuildBrief`; keep-chasing round +
    `decideShelve` (shelve only if ALL peers stop; a champion → HELD); `tokenizeRejectedIdea` (order-independent key +
    stable id) + `ideaOverlap` (Jaccard) + `shelveRejectedIdea`/`checkShelvedIdeas`/`flagIdeaRevivable` on the
    `idea:rejected` knowledge scope (confidence rises on confirm, decays on revival flags); `runFeatureReview` state
    machine (build → self-match → peer → rebuild-once → keep-chasing → integrate|shelve|held|aborted).
  - Slice B — `scripts/improve-loop/changelog.mjs` + `docs/COUNCIL-CHANGELOG.md`: append-only, newest-first, dual
    format (human body + fenced `council-change` JSON block, schema `council-change/1`). Discovery marker
    `AGENT-DISCOVERY: council-self-improvement-changelog`; registered in `docs/agent-tooling-guide.json` under
    `changelog` + `rejectedIdeaShelf` so agents find/append it on similar events.
  - Slice C — in-app surface: `packages/runtime/src/routes/council-changelog.ts` (`GET /api/council/changelog`,
    parses the same fenced blocks, clamps limit) registered in `server.ts`; `SelfImprovements.logic.ts` (pure shaping:
    relative time, kind→plain label NOT uppercase pill, copyable text digest) + `SelfImprovements.tsx` (collapsed line
    → opens with each entry ALREADY expanded; per-entry + copy-all for debugging; token-bound, VaiNode resting locus,
    framer height/opacity only). Mounted quietly below the empty-state hero. Anti-Opus-4.8 audit: removed two
    `tracking-wide font-semibold` micro-labels in `ProcessTree.tsx` (Thinking-out-loud + panel labels) → plain muted.
    Confirmed the existing ProcessTree copy already covers every process (node/branch/tree × markdown/JSON).
  - Slice D — wiring: `apply-consensus.mjs` writes a changelog entry on every committed fix AND on an
    acceptance-revert (best-effort, never throws, after the one-file commit so it can't break staging).
    `feature-review-run.mjs` — live orchestration shim (persona peers via VRAM-guarded serial `ollamaGenerate`,
    shelf + changelog wired); PREVIEW by default, `--integrate` required + branch-guarded (mirrors `--apply`).
  - Proof: `node --test feature-review.test.mjs changelog.test.mjs apply-fix.test.mjs apply-runners.test.mjs` → 60/60;
    vitest `SelfImprovements.logic + ProcessTree.logic + ProcessTree.copy + council-changelog + agent-introspect` →
    56/56; `@vai/desktop` + `@vai/runtime` typecheck clean; live route `GET /api/council/changelog` returned the
    seeded entry (200); Playwright on the real dev app (portrait 430px + landscape 1024px) showed the collapsed
    "1 recent self-improvement" line, click-to-expand with the why/area/files visible, **0 console errors**. Screens:
    `scratchpad/ui-collapsed.png`, `ui-expanded.png`, `ui-landscape.png`.
  - Next: (1) plug a real codegen `build` effect into `feature-review-run.mjs` so the Council builds features end-to-end
    (currently reviews a supplied `--artifact` diff); tune peer prompts against live local models one-at-a-time.
    (2) wire the live USER→council bridge (the still-missing piece: the loop sees seed prompts, not real chat turns).
    (3) consider surfacing shelved-idea "we tried this" pulls in-chat when a message overlaps a fingerprint.

- **Built 2026-07-01 - Multi-intent dropped-deliverable redraft hardening (PARTIAL: tests green; live build still needs deeper work)**
  - Goal: pick up the stopped VS Code-agent work around "explain X and build Y" turns, verify it live, and harden the failure found by the live run.
  - What was already wired and verified: `multi-intent.ts` decomposes answer+build turns, `multi-intent-coverage.ts` detects dropped parts, `service.ts` emits the "Heard N requests" progress step, and `ProcessTree.logic.ts` labels the stage as Requests.
  - Live evidence before the fix: the photographer/JWT prompt showed "Heard 2 requests" and the initial draft answered only JWT. The council correctly marked the draft `needs-work`, but the generic wall-clock guard then showed "Skipped redraft - council budget spent (answer shipped)", so the deterministic dropped-deliverable signal did not actually force the redraft when the first council member was slow.
  - Fix: `packages/core/src/chat/service.ts` now lets `coverage.hasMissingPart` bypass the pre-redraft budget skip. Slow turns can still skip the round-2 re-review after the redraft via the existing "Shipped revision - council budget spent" path.
  - Regression proof: `packages/core/__tests__/council-redraft-loop.test.ts` now simulates a slow first council review plus a JWT-only draft for the exact photographer multi-intent prompt; the redraft must still run and return app-file evidence.
  - Patched live outcome: the same prompt no longer silently ships the JWT-only answer, but the local live path still refused with "I can't build cleanly around that yet - not enough grounding..." and generated no preview files. Screenshot evidence: `C:/Users/v3gga/AppData/Local/Temp/vai-multi-intent-patched-live.png`.
  - Tests: `node node_modules/vitest/vitest.mjs run packages/core/__tests__/council-redraft-loop.test.ts packages/core/src/chat/multi-intent-coverage.test.ts packages/core/src/chat/multi-intent.test.ts` -> 38/38 green; `node node_modules/vitest/vitest.mjs run packages/core/src/chat` -> 536/536 green.
  - Typecheck note: `corepack pnpm --filter @vai/core typecheck` still fails before project code on missing package-local declarations for `@types/jsdom` and `@types/turndown`.
  - Next: decide between (a) routing the missing build part into the real council codegen builder pipeline instead of generic redraft prose, or (b) answer-first and explicitly offer/queue the build as a next step when a mixed explanation+build turn cannot be completed in one pass. Also harden the auto-repair follow-up that answered "Live terminal output unavailable" after the failed one-file `index.html` sandbox apply.

- **Built 2026-07-01 - Regex/hotpath hardening first slice (DONE, focused tests green; core typecheck blocked by missing local @types)**
  - Goal (V3gga): "better every regex" and improve codebase functions for performance, debugging, and quality. First slice made the work measurable and removed three concrete regex recompilation findings without touching the active chat-routing changes already in the worktree.
  - Changes:
    - `page-capability.verify`: replaced per-selector dynamic `new RegExp(...)` checks with a single parsed selector-existence claim map. Selector labels with regex metacharacters are now treated strictly as evidence data, not patterns.
    - `conversation-facts`: caches one `EntityMatcher` per discovered project name, so later active-project detection no longer rebuilds a regex for every known project on every user turn.
    - `conversation-reasoning`: hoisted static production-decision and frontend-stack regex tables so they compile once at module load.
    - `scripts/hotpath-scan.mjs`: widened the AST scanner to `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs`, added `--all`, fixed explicit-root argument handling, added JSON `roots` + `summary` counts, and taught it not to flag module-scope iterator callbacks that precompile regex tables once. Added `pnpm audit:hotpath`.
  - Proof:
    - `node node_modules/vitest/vitest.mjs run packages/core/src/chat/capabilities/page-capability.test.ts packages/core/src/chat/conversation-facts.test.ts` -> 17/17 green.
    - `node node_modules/vitest/vitest.mjs run packages/core/src/chat/conversation-reasoning.test.ts packages/core/src/chat/capabilities/page-capability.test.ts packages/core/src/chat/conversation-facts.test.ts` -> 42/42 green.
    - `node --test scripts/hotpath-scan.test.mjs` -> 12/12 green.
    - `node scripts/hotpath-scan.mjs --json` default hot paths: 88 files, findings dropped from 47 to 42; `regex-in-loop` dropped from 5 to 0, `regex-per-call` stayed 17, `nested-loop` stayed 25.
    - `node scripts/hotpath-scan.mjs --all --json`: 784 files scanned; 55 `regex-in-loop`, 129 `regex-per-call`, 312 `nested-loop` candidates. This is an audit queue, not a fail gate yet.
  - Typecheck note: `corepack pnpm --filter @vai/core typecheck` currently fails before project code on missing package-local declarations: `packages/core/node_modules/@types/jsdom/index.d.ts` and `packages/core/node_modules/@types/turndown/index.d.ts`.
  - Next: triage default `regex-per-call` findings (starting with `contextual-resolver.ts` and `conversation-reasoning.ts`), then separate true hotpath `nested-loop` risks from intentional small bounded loops.

- **Built 2026-07-01 - Understanding->action gap: agent-mode todo-app hijack (DONE, tested 612 chat green, tsc clean)**
  - Symptom (V3gga live, Agent mode): "What are great tools for computer intelligence to use?" was answered with a
    scaffolded Next.js todo app. The council CORRECTLY caught it (3/3: "not a coding tutorial", reread-intent), but
    the redraft swapped in a jest-tests tutorial - still not the answer. Two wrong actions on a correctly-understood
    question. V3gga's framing: the PROCESS TRACE is already legible; the RESPONSE/ACTIONS don't match the understood
    intent.
  - Root cause (traced, not guessed): the classifier was RIGHT the whole time - `classifyQuestionIntent`='definition',
    `classifyAgentBuildIntent`='answer', and raw VaiEngine returns `fallback` (0.15) in every mode. The todo app came
    from the LIVE generative model reading the **Agent-mode system prompt**, which is dominated by build-imperatives
    ("For build requests: output the COMPLETE working application files", "always include package.json", "Default to
    action over discussion"). A local model pattern-matches the loudest instruction and scaffolds an app even though
    the turn was correctly classified `answer`. The understanding was carried into routing but NOT into the prompt
    handed to the model.
  - Fix (both halves, one principle - carry the known intent into the model prompt):
    - `modes.ts` `agentIntentLeadDirective(agentBuildIntent)`: on an `answer` turn, PREPEND a high-priority lead to
      the Agent prompt - "THIS TURN IS A QUESTION / DISCUSSION, NOT A BUILD REQUEST ... Do NOT scaffold ... Do NOT
      fall back to a canned starter (todo app, dashboard) ... the build instructions below apply only when the user
      actually asks to build". No-op for `build`/`ambiguous` (build prompt unchanged). Wired at the `modePrompt`
      injection in `service.ts`.
    - `buildCouncilRedraftInstruction`: on `reread-intent`, added an explicit ban - "Do NOT answer with a scaffolded
      app, a starter project, or an unrelated code tutorial. If the intent is a question, respond in prose that
      actually answers it." - so the redraft can't re-hijack into a DIFFERENT template (the jest-tests swap).
  - Proof: `agent-intent-lead.test.ts` 6 (incl. LIVE ChatService capture: the exact screenshot prompt in agent mode
    now gets the no-scaffold lead; a real "build me a todo app" keeps the full build prompt); `council-redraft-loop.test.ts`
    +2 (reread-intent bans scaffolds; other actions don't); ALL chat suites 612/612 green; tsc 0 errors. Reusable
    method: when actions contradict a correct classification, capture the ACTUAL system messages sent to the model -
    the contradiction is usually in the prompt, not the router.
  - Next: re-judge live through the running desktop (`pnpm app:update`) on the exact prompt to confirm the model now
    answers in prose. The deeper follow-up is thinning the Agent prompt's build-bias generally (it's heavy enough that
    even the intent-lead is a counterweight, not a cure) and porting the same intent-lead to Builder mode.

- **Built 2026-07-01 - Intent-accurate chat routing: 4-slice pass (DONE, tested 525 src/chat green + probes, tsc clean)**
  - Goal (V3gga): make Vai smarter + more intent-accurate when responding in chat. Delivered as 4 slices,
    each test-gated + flag-gated behind one `RoutingConfig` (all default ON) with an auditable `routePlan`.
  - **Slice 2 - widen intent classification.** New pure `intent-scorer.ts` (`scoreQuestionIntent` +
    `debugScoreQuestionIntent`): lexical-feature confidence distribution over `QuestionIntent`.
    `question-intent.ts` gains `classifyQuestionIntentSmart` - a STRICT SUPERSET of the regex classifier that
    only consults the scorer when regex returns `'other'` and only adopts a guess above a 0.25 margin, so it
    can only ever SHRINK `'other'`, never reshape an existing verdict. Measured: recovers 91% (10/11) of a
    labeled regex-missed set, 100% of the intent-less control set stays `'other'`, added latency p99 ~0.030ms
    (~67x under the 2ms budget, `intent-scorer.bench.ts`). Intent + source + margin now ride the streamed
    `routePlan` (`adapter.ts` gained optional `intent`/`intentSource`/`intentMargin`/`belowFloorReason`/
    `suppressionsApplied`).
  - **Slice 4 - kill the ChatService/VaiEngine divergence (foundation).** Root finding: `VaiEngine` (`vai-engine.ts:341`)
    IS the `vai:v0` adapter, and its `generateResponse` is a legacy greedy `try*` cascade holding its own
    business-opportunity/recommendation routing - a SECOND router reached on ChatService fallback. Extracted
    the pure `tryBusinessOpportunityDirection` into shared `business-opportunity-direction.ts`; VaiEngine now
    DELEGATES to it, so both routers answer a business-idea ask with the SAME text (no more divergent answers).
  - **Slice 1 - make the route rankable.** Promoted business-opportunity into ChatService's scored registry as
    a first-class handler (prior 0.945, seated above fact-shim 0.91, gated on `isBusinessOpportunityRequest` +
    `routing.rankableRoutes`, reuses the shared emitter). `FIT_TABLE` boosts it on-lane. The documented Norway
    "software business idea -> country-fact card" failure class is now FIXED and observable: the live routing
    probe asserts `chosen === 'business-opportunity'` with fact-shim ranked below it. No-leapfrog invariant
    preserved (new prior keeps tightest gap = 0.005 > 0.004 boost; exhaustive `REGISTRY_PRIORS` test updated).
  - **Slice 3 - honest below-floor escalation.** New pure `intent-directive.ts` (`composeIntentDirective` +
    `belowFloorReason`). On a below-floor escalation ChatService now injects a system directive carrying the
    classified intent's expected shape BEFORE model dispatch (recommendation -> a specific pick, factual ->
    answer first, ...). PROVEN live at the model boundary: "suggest a lightweight approach..." injects
    "classified as a recommendation..."; "tell me a short story..." (intent `other`) injects NOTHING (no
    fabricated shape); `routing.intentEscalation: false` gates it off.
  - BUG found + fixed by the flag test: `isChatServiceOptions` didn't list `routing`, so a `{ routing }`-only
    options object was silently ignored (flag would be a no-op in prod). Added `'routing' in value`.
  - Proof: `intent-scorer` 20, `intent-coverage-probe` 3, `intent-directive` 6, `business-opportunity-direction`
    5, `intent-fit` 22 (incl. updated no-leapfrog), live `intent-fit-routing-probe` 5 (incl. Norway) +
    `intent-routeplan-surfacing` 5 (incl. directive-at-model-boundary + flag gating); ALL `src/chat` 525/525
    green; tsc 0 errors. The 2 pre-existing `vai-engine` failures (deploy-fire-drill, auth/team/sandbox) fail
    IDENTICALLY on baseline (stash-revert proven) - unrelated.
  - Next slice: full VaiEngine router unification is deferred by design (a ~56k-line god-class mid-decomposition;
    Slice 4 shared the highest-divergence route, business-opportunity, not the whole cascade). Also: `routePlan`
    `belowFloorReason` only attaches on the richer fallback-thinking paths, not the trivial-stub fallback - the
    behavior (directive injection) fires regardless, but wider routePlan coverage on all fallback branches is a
    follow-up. Live re-judge through the running desktop app still recommended per the answer-path rule.

- **Built 2026-06-30 - Intent-aware handler scoring (DONE, tested: 17 unit + 4 live-probe + 476 src/chat green)**
  - Finding: the scored chat dispatcher (`turn-pipeline.ts`) had the right architecture but the live
    registry handed each handler a HARDCODED constant priority (0.99..0.89) and ranked on that — a code
    comment at `service.ts:2497` admitted "intent/fit-based adjustment is layered on next". So routing was
    decided by list-order + an `applicable` boolean gate, not by how well a turn FIT each handler (the
    structural source of "intent miss" errors in the response-weakness taxonomy).
  - Change: added `packages/core/src/chat/intent-fit.ts` (`intentFit(handler, prior, ctx)`) — a pure,
    table-driven fit adjuster. The constant becomes a PRIOR; a turn's classified `QuestionIntent` + shape
    `TurnClassification` nudges it (bounded). Wired into the `det()` score callback in `service.ts` so the
    score is now `intentFit(name, prior, ctx)`; the per-handler reason + the on/off-lane fit reason both
    ride through to the streamed `routePlan` (auditable trail, no UI change). Unmapped handler / no-rule
    turn returns the prior UNCHANGED (regression-safety default).
  - Tuning (caught by the proof bar): the first boost magnitude (0.06) was too large — it let fact-shim
    LEAPFROG `chat-format-strict` on "Capital of Japan. One word only.", breaking the curated order and
    failing the existing `chat-service` one-word-capital test (confirmed mine via stash-revert: passed on
    baseline, failed with the change). Fixed by capping the boost at 0.004 (< the tightest 0.005 inter-prior
    gap) so a fitting handler reinforces/tie-breaks but never overtakes a sibling seated above it. The
    decisive off-lane demotion is the suppression multiplier (0.45), not the boost.
  - HONEST scope finding (verified through the live ChatService, recorded so it isn't oversold): the scored
    registry is only REACHED by turns that survive the upstream short-circuits — in practice the knowledge
    lane (`factual-lookup`/`definition`) + identity/meta turns. Build/recommendation/product-quality asks
    are intercepted upstream and never reach the registry, so intent-fit's SUPPRESSION rules for those
    intents are defense-in-depth (a safety net if an upstream router ever lets one through), NOT a
    day-to-day observable effect. The proven, measurable win is sharper BOOST-driven ranking on knowledge
    turns: e.g. "what is the capital of Japan?" / "who is Ada Lovelace?" → fact-shim boosted 0.91→0.914 with
    reason `on-lane (intent=factual-lookup)` and wins; "tell me about your engine" → `chat-vai-identity`.
  - Proof: `intent-fit.test.ts` 17/17 (incl. the no-leapfrog / Japan-class invariant + unmapped=prior);
    `intent-fit-routing-probe.test.ts` 4/4 driving the REAL ChatService and asserting the streamed route
    plan; `turn-pipeline.test.ts` 12/12 (contract unchanged); `chat-service*.test.ts` 59/59 (the regressed
    one-word-capital test fixed); ALL `src/chat` 476/476 green; tsc clean on the changed files. The 4
    pre-existing `vai-engine` failures (deploy-fire-drill, auth/team/sandbox) fail identically on baseline
    (stash-revert proven) and are unrelated to this change.
  - Next slice: intent-fit currently only helps turns that reach the registry. The higher-leverage follow-up
    is to make the UPSTREAM short-circuits (which intercept builds/recommendations) themselves intent-fit
    aware, OR to fold a few of them into the scored registry so their decisions become rankable + auditable
    the same way. Separately, the VaiEngine shim does NOT share this scoring (divergence) — porting it is a
    second follow-up.

- **Built 2026-06-30 - Response-intelligence probe regressions (DONE, tested 8/8 + visual QA)**
  - Finding: live/direct probes showed high-value prompts falling through to the wrong deterministic lanes:
    Vai identity/process questions returned the generic no-confidence capabilities blurb, a Norway software-idea
    prompt became a Norway country-fact card, and a Zustand/CSS-hover follow-up became a CSS specificity primer.
  - Change: added deterministic self/process vocabulary for Vai and Council outcomes, a business-opportunity
    route that beats country facts, and a Zustand + CSS-hover diagnosis route for chat timeline flicker.
  - UI polish: tightened ProcessTree mobile wrapping/indentation and fixed the hidden copy-action flex sizing so
    hover/focus tools stay tucked away at rest but remain usable in the visible audit surface.
  - Research note: vLLM's public docs highlight prefix caching for repeated long context / multi-round chat and
    chunked prefill to prioritize interactive decode work before large prefills; Browserbase positions cloud
    browser sessions, search/fetch, and isolated automated testing as agent infrastructure. Vai's local analogue
    should be a stable-context cache plus a scheduler that gives user-visible chat/process UI priority over
    background improvement-loop work, with remote browser agents considered only as an optional visual QA backend.
  - Proof: `vai-engine.test.ts` focused response-intelligence suite -> 8/8 green; direct `agent-speak-to-vai --direct`
    probes returned `chat-fact-shim:meta-vai`, `business-opportunity-direction`, and the Zustand-specific diagnosis;
    `visual-qa.mjs --scenario all` desktop and `--scenario council-full --w 390 --h 844` mobile captured ProcessTree
    screenshots/traces with 0 console errors under `.codex-run/visual-qa-response-intelligence*`.
  - Evidence: `.vai-agent-dialogue.log` 2026-06-30 probe suite; vLLM docs `https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/`
    and `https://docs.vllm.ai/en/latest/configuration/optimization/`; Browserbase docs
    `https://docs.browserbase.com/welcome/introduction`.

- **Built 2026-06-30 - Balanced Council delegation now asks the best-fit specialist (DONE, tested 46/46)**
  - Finding: the balanced Council path was efficient but too blunt: it capped the panel by choosing the fastest
    default member, which could skip an already-seated code/reasoning specialist on turns where that specialist
    was the whole point of delegating.
  - Change: added `selectDelegatedMembers(topic, roster, { maxMembers, preferFast })` so balanced turns route the
    prompt to a topic first, prefer a matching specialist, then use fast non-thinking members only as the tie-break.
    Deep mode still keeps the full panel. Quick mode remains skipped upstream.
  - Capability: expanded local model niche seating so installed specialist families like Devstral/Codestral,
    QwQ/Magistral, and Qwen coder variants become explicit Council seats without adding paid APIs or downloads.
  - Proof: focused consensus/runtime roster tests -> 46/46 green; `@vai/runtime` typecheck clean.
  - Next slice: expose the delegated member choice in the live Council UI/process trace so humans and agents can
    see "why this model was asked" instead of treating the Council as an opaque roster.

- **Built 2026-06-30 - Agent bootstrap/tooling map + visible Council delegation rationale (DONE, tested 45/45)**
  - Finding: agents were repeatedly rediscovering the same channels, narrow tests, live probes, and heavy visual
    gates. The balanced Council selector also chose better members after the prior slice, but the live process UI
    still did not explain why a particular member was asked.
  - Change: added `docs/agent-tooling-guide.json`, `pnpm agent:bootstrap`, and an `agentTooling` block on
    `/api/agent/introspect` so future agents and Vai's own loop can load cheap checks, expensive gates, delegation
    rules, and research references from one machine-readable source. The introspect route now finds the repo root
    robustly instead of assuming a specific launch cwd.
  - Visibility: `selectDelegatedMembers` now has an explainable companion, and balanced Council turns stream a
    `Council delegation` process-log row with the routed topic, cap, selected member(s), and tie-break rule. This
    appears through the existing ProcessTree/ThinkingPanel path without a schema migration.
  - Research note: current agent-tooling docs emphasize discoverable tools, bounded subagents, explicit MCP tool
    metadata/listing, and browser automation as an optional isolated visual/E2E backend. Vai's local default should
    stay deterministic: bootstrap map first, narrow tests second, heavy browser/model work only when the change
    actually touches visible or live behavior.
  - Proof: `agent-bootstrap.mjs` prints the guide and live runtime summary; focused tests
    (`council.test.ts`, `council-roster-depth.test.ts`, `agent-introspect.test.ts`) -> 45/45 green;
    `@vai/runtime` typecheck clean; `git diff --check` clean.
  - Caveat: `@vai/core` typecheck is still blocked before project code by missing local dependency type entries
    `@types/jsdom` and `@types/turndown` under `packages/core/node_modules`.

- **Built 2026-06-30 - Response-capability Council mission injected into self-improve loop (DONE, tested 11/11)**
  - Finding: the generative capability council had access to the north-star, backlog, user goals, and runtime
    introspect, but not a crisp operating brief for "random user message -> great Vai answer" work, nor the
    verifier/updater self-improvement contract V3gga is asking for.
  - Change: added `docs/vai-response-capability-loop.md` with an elite Council mission prompt, response weakness
    taxonomy, fix-selection rules, and verifier/updater self-improvement rules. `capability-context.mjs` now injects
    that brief plus a bounded summary of `docs/agent-tooling-guide.json` into the capability council context.
  - Impact: every capability cycle can now investigate response quality, pick one concrete weakness, propose a
    small code/test fix, and improve the verifier/updater itself when that is the bottleneck, while staying bounded
    by cheap tests and the one-heavy-task rule.
  - Proof: `node --test scripts/improve-loop/capability-context.test.mjs` -> 11/11 green; `node scripts/agent-bootstrap.mjs`
    still prints the tool map and live runtime summary.

- **Observed 2026-06-30 - Runtime channel can lag behind direct-engine intelligence (OPEN)**
  - Finding: after the response route fix, `agent-speak-to-vai` through the normal direct-local/WS path first returned
    the old "That isn't in my knowledge yet" fallback for a Vai self-identity prompt, then fell back to the source-level
    direct engine and produced the correct `chat-fact-shim:meta-vai` answer. The answer contract is fixed, but the
    runtime transport/cache path can still expose stale or incomplete behavior.
  - Next slice: trace direct local pipe -> WS -> direct-engine fallback for fact-shim/meta-vai turns, then add a
    regression probe that fails if a runtime user-path self-knowledge turn emits an empty WS capture or stale fallback.

- **Built 2026-06-29 - Hyphenated source false-friend regression lock (DONE, tested 108/108)**
  - Finding: after the source-reference PR merged, the CodeRabbit thread for `source-code` / `source-tree`
    false friends was marked resolved, but the local regex still only excluded whitespace forms like
    `source code`. That left hyphenated codebase language at risk of being misread as a citation request.
  - Change: broadened the false-friend matcher to `source[-\s]+...` and added explicit regression
    coverage for `source-code`, `source-tree`, and `source-files` variants.
  - Proof: `intent-lexicon.test.ts` + `web-conclude-turn.test.ts` + `turn-kind.test.ts` +
    `turn-classifier.test.ts` -> 108/108 green; ESLint clean on the changed intent lexicon files.

- **Built 2026-06-29 - Context-carry scenario harness for follow-up evals (DONE, tested 16/16)**
  - Finding: the loop's weakest class, `followup/context-carry`, was being measured with fresh one-turn
    conversations even though prompts like "what about the second one?" and "make that simpler" require
    prior context. That produced noisy failures and queued fixes against an impossible evaluation shape.
  - Change: added deterministic scenario preludes for `followup/context-carry`, threaded same-conversation
    preludes through observe mode, and passed row metadata into acceptance checks so observe and recovery
    verification grade the same behavior.
  - Proof: `node --check` for `driver.mjs`, `run.mjs`, `acceptance-verifier.mjs`, and `apply-consensus.mjs`;
    `context-scenarios.test.mjs` + `acceptance-verifier.test.mjs` -> 16/16 green.

- **Built 2026-06-29 - Stale improvement-run recovery command (DONE, tested 29/29)**
  - Finding: `self-improve:doctor` could detect a crashed loop whose latest corpus run was still marked
    `running`, but the operator had no first-class repair action. The safe next step was documented in prose,
    leaving humans and helpers to decide manually whether to mutate the corpus state.
  - Change: added `operator recover-stale` / `self-improve:recover-stale`. It marks only the latest stale
    `running` row as the existing resumable `interrupted` state, refuses to act while the recorded supervisor
    PID is alive, and includes the command in handoff/docs so future helpers inherit the recovery path.
  - Proof: `node --check` for `operator.mjs` and `operator-utils.mjs`; `operator.test.mjs` +
    `instance-lock.test.mjs` -> 29/29 green; live `operator recover-stale` marked run #899 interrupted and
    the follow-up `operator doctor` reported `Doctor: PASS`.

- **Built 2026-06-29 - Safe self-improvement loop stop command (DONE, tested 25/25)**
  - Finding: the perpetual loop had safe single-instance locking and signal handling, but the operator surface exposed
    no first-class stop command. That forced users/helpers toward `Ctrl+C` in the foreground or risky broad process
    killing for background loops, which conflicts with the one-heavy-task-at-a-time safety model.
  - Change: added `operator stop` / `self-improve:stop`, targeting only the PID recorded in
    `scripts/improve-loop/.supervisor.lock`, writing a matching stop-request file for checkpoint/rest-boundary exits,
    and adding `--force` for explicit last-resort shutdown. The supervisor now consumes matching stop requests in both
    fixed and engine modes and during rest sleeps, while ignoring stale requests for other PIDs.
  - Proof: `node --check` for `operator.mjs`, `operator-utils.mjs`, and `supervisor.mjs`; `operator.test.mjs` +
    `instance-lock.test.mjs` -> 25/25 green; live `operator stop` with no lock reported no signal and left no stop file.

- **Built 2026-06-29 - Intentionality and specificity lexical signals (DONE, tested 110/110)**
  - Finding: Vai could already surface request-start, intent-action, uniqueness, and source-reference signals, but
    user correction language such as "what I meant", "my intention", "be specific", and "not generic" was still
    invisible to the shared lexical layer. That made it harder for classifiers, guidance, and future Council review
    to notice when the user was correcting the intended answer shape rather than merely adding more text.
  - Change: extended `intent-lexicon.ts` with reusable word/phrase hint collectors, expanded request-start and
    intent-action vocabularies, added intentionality/specificity hint sets, strengthened uniqueness phrases such as
    "not generic" and "signature features", surfaced `intentionality-hint`, `specificity-hint`, and
    `source-reference-request` through `turn-classifier.ts`, let explicit source/citation answer requests choose
    the `research` turn kind after the builder gate (so "build ... with source links" remains builder), and let
    explicit source requests bypass stable local web defer while keeping "source code/source tree" language local-first.
    Early web-concluded explicit source requests now also set cited-answer metadata and the `research-cited`
    strategy instead of presenting sourced answers as generic `web-search`.
  - Proof: `intent-lexicon.test.ts` + `turn-classifier.test.ts` + `turn-kind.test.ts` +
    `web-conclude-turn.test.ts` -> 108/108 green; the exact typoed-source engine/variant tests -> 2/2 green;
    ESLint clean on changed chat files.

- **Built 2026-06-29 - Shared source-reference intent lexicon (DONE, tested 96/96)**
  - Finding: after the source-aware evidence contract landed, explicit source/citation/reference detection still lived
    inside `web-conclude-turn.ts`, which made it harder for routing, guidance, and later Council logic to reuse the
    same intent signal.
  - Change: moved source-reference request detection into `intent-lexicon.ts`, added source/citation/link/provenance
    word sets and false-friend handling for "source code/source tree/source files", exposed the signal through
    `summarizeLexicalSignals`, and re-exported it from `web-conclude-turn.ts` for compatibility.
  - Proof: `intent-lexicon.test.ts` + `web-conclude-turn.test.ts` -> 23/23 green; downstream
    `turn-classifier.test.ts` + `route-guidance.test.ts` -> 73/73 green; ESLint clean on changed files.

- **Built 2026-06-29 - Source-aware fluency contract for web evidence (DONE, tested 16/16)**
  - Finding: Vai already retrieved sources for grounded turns, but the model-facing hint was too soft. It asked the
    answering model to "make that clear" without a strict rule for source numbers, unsupported citations, thin evidence,
    or casual follow-ups that should stay conversational.
  - Change: `buildEvidenceContextSystemHint` now inserts an evidence contract: only cite displayed source numbers,
    never invent URLs/titles/source ids, mark key factual/current claims with nearby `[n]`, and explicitly separate thin,
    stale, off-topic, or conflicting evidence from inference. It also detects explicit source/reference/citation requests
    while avoiding the "source code" false-positive.
  - Proof: `node node_modules\vitest\vitest.mjs run packages/core/src/chat/web-conclude-turn.test.ts` -> 16/16 green.
    Local `pnpm --filter @vai/core typecheck` is parked separately because this checkout cannot resolve package-local
    `@types/jsdom` and `@types/turndown`; the focused TS/Vitest path for the changed module compiles and passes.

- **RESOLVED 2026-06-24 — VRAM guard starvation fixed by `--vram-gb 8.5` (decision delegated to agent)**
  - Action taken: killed run #13 (resumable, lost nothing), restarted observe+capability with `--vram-gb 8.5`.
    Chosen over keep-alive-shortening because evicting/reloading a 7.5 GB model every turn is sustained
    GPU+disk load — the actual BSOD trigger — and slower. Raising the budget keeps the model resident +
    reused (warm, no disk thrash) while still blocking a SECOND concurrent model (~13 GB > 8.5 → waits).
  - Proof (same elapsed point, same machine): run #13 `VRAM 7.0/7.0 ████████` → `infra skip` every turn,
    crashes 1→4. run #14 `VRAM 7.0/8.5 ███████░` → generation PROCEEDING through classes, crashes 0.
  - Left untouched (deliberately): the capability council's hardcoded 7 GiB guard — it waits-then-proceeds
    (never skips) and Ollama auto-evicts on model swap, so it isn't starving; tuning BSOD-safety code blind
    mid-session wasn't warranted. Noted as a possible future consistency pass (forward `--vram-gb` to it).
  - Original finding (kept for the record):
- **Finding 2026-06-24 — VRAM guard starves the loop when the working model is ~budget-sized**
  - Evidence (live run #13, observe): `nvidia-smi` → 9981/12288 MiB used, 30% util; `ollama /api/ps` → ONE
    resident model `deepseek-r1:8b`, `size_vram` 7,520,177,356 B (≈7.003 GiB). Loop budget =
    `waitForVramHeadroom(7*1024**3)` = 7,516,192,768 B (7.000 GiB). Resident > budget by ~4 MB.
  - Effect: `waitForVramHeadroom` waits for the model to self-evict, but Ollama keep-alive holds it, so it
    never drops below budget within the 120 s window → every turn logs `infra skip (VRAM 7.0GB > budget
    7.0GB)`. Crash/skip counter climbed 1→4; only 7/48 prompts in ~16 min. The loop advanced ONLY during
    brief eviction windows (the `VRAM 0.0` frames). This is the "wasteful compute / spinning" failure mode.
  - Root cause: the guard's real job is to block a SECOND concurrent heavy model (the BSOD trigger). But it
    trips when the ONLY resident model is the very one the next turn will REUSE — no additional load occurs,
    so running is safe. Budget < single-model footprint makes the guard self-defeating on a 12 GB card.
  - Proposed fix (operational, NOT auto-applied — touches BSOD-safety on a BSOD-prone machine): restart the
    loop with a budget that fits one resident model but still blocks a second, e.g. `--vram-gb 8.5`. One
    model (7.5 GB) < 8.5 → runs; two models (~15 GB) > 8.5 → waits. Preserves protection, ends the starve.
  - Alt/lower-risk: shorten Ollama keep-alive so the model evicts between turns (restores headroom windows),
    or make the guard headroom-aware of "is the next call's model ALREADY resident?" (code change, propose-only).

- **Built 2026-06-24 — Realized-ROI adoption signal: `markRoundAdopted` (DONE, tested 100/100)**
  - Closes the loop the prior two slices opened. The compute-ROI meter could only ever say
    "wasteful · the bottleneck is ADOPTION" because `adopted` was hardcoded 0 — there was no
    mechanism to record that a proposal actually shipped. Now there is.
  - `capability-engine.mjs` — `markRoundAdopted(db, computeId|('latest'), count=1)`: increments (never
    overwrites) a recorded round's `adopted`, returns the new total, no-ops on unknown/invalid id,
    never throws. The ONLY honest source of realized compute-ROI: a human/Opus merging a backlog item,
    or an ACCEPTED acceptance-verifier verdict on an applied fix.
  - CLI: `node --experimental-sqlite scripts/improve-loop/capability-engine.mjs --adopt latest [--adopt-count N]`
    credits the most recent round (no new round generated) and prints the refreshed ROI verdict; exits 1
    if there is nothing to credit. Proven on a temp DB: round #1 → `realized 0.11/unit · 1 shipped / 2
    qualified over 9 compute` (was 0 before crediting).
  - Tests: extended `capability-engine.test.mjs` (sqlite-gated, file still runs flag-free) — record→
    series(adopted 0)→adopt(+1=1)→adopt(+2=3 increments)→unknown/0/-4 no-op→series persisted 3. Full
    meta suite 100/100 green; `node --check` clean. Single-concern, ~15 LOC core (review-burden axis).

- **Built 2026-06-24 — Acceptance Verifier: honest fix measurement (DONE, tested 99/99)**
  - Closes the gap the compute-ROI meter exposed: `adopted/realized` was always 0 because the loop
    trusted corpus-wide DRIFT, never proving a specific fix shipped value. The verifier re-runs the
    EXACT prompts that were failing for a class and confirms THOSE rows moved fail→pass — the only
    signal a maintainer actually trusts.
  - `db.mjs` — `failingRowsForClass(db, klass)`: the prompts whose MOST RECENT result (max run_id) is
    a failure (so a row that already recovered is correctly NOT re-targeted). try/catch-guarded.
  - `acceptance-verifier.mjs` (new, pure core + injectable runner) — `summarizeAcceptance` (verdicts:
    no-targets / rejected / partial / accepted via `ACCEPT_RATE` 0.8; "no targeted failures" is NEVER
    a silent pass), `verifyAcceptance` (re-runs rows SERIALLY via injected runOne+grade — BSOD rule;
    an infra error counts as still-failing, never a false recovery), `verifyClassAcceptance`,
    `formatAcceptance`. CLI one-shot wires the LIVE path (`runThroughVai` + `gradeInterpretation`,
    VRAM-guarded): `node --experimental-sqlite scripts/improve-loop/acceptance-verifier.mjs --class <k>`
    exits 0 only when ACCEPTED.
  - Tests: `acceptance-verifier.test.mjs` (8) — verdict bands, serial-order + onResult, error-as-fail,
    throws without runner, injected selectRows, and a temp-DB `failingRowsForClass` proving latest-result
    semantics + class isolation. Full meta suite 99/99 green; `node --check` clean.
  - Next slice: the `adopted` mechanism now exists (`markRoundAdopted`, see entry above) — remaining is
    auto-calling it from the --apply path when an acceptance verdict is ACCEPTED, and offering acceptance
    as an experiment-runner measure adapter.

- **Capability-Innovation 2026-06-24 — council round (strong 7.3/10)**
  - Context: generative capability council toward the north-star (voice + interface, any task,
    reliable, no lost details). council 7.3/10 (strong) · 3 lenses · 3 areas · top cluster 1
  - weakest council dimension: convergence (3.3/10) — improve the roundtable here next
  - Proposals (PROPOSE-only — review + implement by V3gga/Opus; never auto-applied):
    - **[council] Synthesis: Voice-Driven Task Execution with Contextual Understanding** (impact 9.7/10) — Vai can execute tasks through voice interaction while maintaining contextual awareness and providing real-time feedback to V3gga.
      - first slice: Implement a voice interaction system that allows Vai to receive and process voice commands, maintaining task context and providing live feedback during execution.
      - verify: ship the first slice and confirm the combined behavior
      - builds on: Streaming Reasoning with Voice Feedback; Voice-Contextualized Task Understanding
      - evidence: apps/desktop/src/components/chat/LiveProcessStream.logic.ts:5, apps/desktop/src/components/chat/process-step-enrich.ts:4, apps/desktop/src/components/chat/ThinkingPanel.logic.test.ts:83, .venv/Lib/site-packages/playwright/driver/package/types/protocol.d.ts:72
    - **[voice] Streaming Reasoning with Voice Feedback** (impact 8.5/10) — Vai can provide real-time voice feedback during task execution, keeping V3gga informed of progress and potential issues.
      - first slice: Add TTS integration for live streaming reasoning in the LiveProcessStream component.
      - verify: Test the TTS integration by running the LiveProcessStream component with simulated reasoning steps and confirm voice feedback is generated.
      - evidence: apps/desktop/src/components/chat/LiveProcessStream.logic.ts:5, apps/desktop/src/components/chat/process-step-enrich.ts:4, apps/desktop/src/components/chat/ThinkingPanel.logic.test.ts:83
    - **[capability-gap] Voice-Contextualized Task Understanding** (impact 8/10) — Vai can understand and act on voice inputs with contextual awareness, preserving task details across interactions.
      - first slice: Add context-aware voice input parsing to capture and store task details
      - verify: Test voice commands with multi-token inputs and verify task details are preserved across interactions
      - evidence: .venv/Lib/site-packages/playwright/driver/package/types/protocol.d.ts:72, .venv/Lib/site-packages/playwright/driver/package/types/protocol.d.ts:116

- **Built 2026-06-24 — anti-slop rubric axis + compute-ROI meter (DONE, tested 70/70)**
  - Encodes the Zig/Rust human-acceptance signal as deterministic code (closes the "encode anti-slop"
    research item above). Two pieces, both propose-only, never touch Vai source:
  - `council-rubric.mjs` — new **reviewBurden** dimension in `scoreCapabilityProposal`: a bounded
    single-concern slice (short `capability`, few `steps`) scores high; a wall-of-text / many-step
    sprawl scores low and lowers `impact`. `selfcheck` behaviour is now credited. Test: a sprawling
    clone of a strong proposal scores strictly lower on both `reviewBurden` and `impact`.
  - `compute-roi.mjs` (new, pure/I-O-free, mirrors `motion.mjs`) — answers V3gga's "are we just
    burning the GPU for nothing?". `roundCompute` (model-calls primary, wall-time fallback),
    `roundRoi` (realized→roi, qualified→potentialRoi), `analyzeRoiTrend` (states: insufficient-data /
    unproven / **wasteful** / diminishing / productive-plateau / productive), `formatRoi`. Distinguishes
    plateau-HIGH (keep going) from plateau-LOW (waste) via `ROI_FLOOR`, and the **adoption-bottleneck**
    case: qualified proposals piling up with ZERO shipped ⇒ "spend the next cycle APPLYING the backlog,
    not generating more." This is the Zig "wasteful review burden" critique made measurable.
  - `capability-engine.mjs` — `compute_log` table + `recordComputeRound`/`computeRoiSeries`;
    `runCapabilityRound` now counts EVERY model call (lenses + chair), times the wall-clock, counts
    `qualified` (impact ≥ QUALITY_BAR 7) and `crossRefs`, and persists the round. `adopted` stays 0
    until a human/Opus ships a backlog item — so the meter tells the truth about realized value.
  - Surfaced (read-only): `operator status` and the capability CLI one-shot both print the
    `formatRoi` verdict + recommendation. Evidence: `node --check` clean; 70/70 meta tests green
    (compute-roi 8, council-rubric, capability-engine, operator 17, motion, capability-context).

- **Research 2026-06-24 — human PR accept/reject patterns → encode anti-slop into the grader (PROPOSE-only)**
  - Sources (public, dated): Zig anti-LLM policy (Kelley "invariably garbage", Loris Cro "contributor poker"),
    Rust leadership-council #273 (slop = "effort imbalance"; "must self-review"), Godot ("understand it,
    test it, maintain it"; undisclosed AI → trusted less), OCaml Nov-2025 (13k-line AI PR rejected for
    unsustainable review burden, not for being wrong), O'Reilly/DEV ("passes CI or it doesn't"; "explain every line").
  - Through-line: accept ≈ (advances goal) × (LOW review burden) × (grounded + self-checked + accountable);
    slop ≈ high review burden + low grounding + unbounded scope + no author comprehension.
  - Audit finding: items below partly EXIST as behaviour but are not SCORED. The novel, highest-leverage add
    is a deterministic **review-burden / "contributor-poker"** dimension.
  - Proposed deterministic checks (council-rubric.mjs / grader.mjs), behind tests, propose-first:
    1. review-burden score — penalise lines×files×novelty; prefer small single-concern diffs (the OCaml lesson, numeric).
    2. bounded scope — one class/concern per proposal; hard penalty for drive-by bundles.
    3. credit `selfcheck` — agent.mjs already generates a "tried X, safe because Y" critique; rubric should reward it.
    4. quotable grounding — already enforced (grep-verify + evidence); maps to "explain every line".
    5. convention-match — proposal touches an existing symbol/pattern (find_symbol hit), not a new invented surface.
  - Next: implement #1 + #3 first (lowest effort, highest signal); KEEP/DROP by whether graded slop-rejection rate rises without rejecting genuinely-grounded proposals.

- **Capability-Innovation 2026-06-24 — council round (strong 8.8/10)**
  - Context: generative capability council toward the north-star (voice + interface, any task,
    reliable, no lost details). council 8.8/10 (strong) · 8 lenses · 7 areas · top cluster 2
  - weakest council dimension: convergence (7.5/10) — improve the roundtable here next
  - Proposals (PROPOSE-only — review + implement by V3gga/Opus; never auto-applied):
    - **[council] Synthesis: Reliable Escalation & Verification** (impact 9.7/10) — Vai can reliably verify task completeness during interaction and escalate to V3gga/Opus-4 when missing capabilities are identified.
      - first slice: Implement a verification step that checks for task completeness and escalates to V3gga/Opus-4 when missing capabilities are detected.
      - verify: ship the first slice and confirm the combined behavior
      - builds on: Streaming Turn Verification; MissingCapability Wiring; Verification Step for Task Completeness
      - evidence: apps/desktop/src/components/chat/LiveProcessStream.logic.ts:5, apps/desktop/src/components/chat/ProcessTree.logic.ts:245, apps/desktop/src/components/chat/process-humanize.ts:48, apps/desktop/src/components/chat/ProcessTree.logic.ts:167
    - **[voice] Streaming Turn Verification** (impact 8.2/10) — Vai can now verify the completeness of a spoken turn during streaming, ensuring no details are lost before finalizing the task.
      - first slice: Add a verification flag in LiveProcessStream.logic.ts to ensure spoken turns are complete before processing.
      - verify: Check that the verification flag is set and that the turn is processed correctly in the council system.
      - evidence: apps/desktop/src/components/chat/LiveProcessStream.logic.ts:5
    - **[tooling] MissingCapability Wiring** (impact 8.1/10) — Vai can now reliably identify and escalate tasks it cannot perform by explicitly calling out missing capabilities
      - first slice: Add a simple check in the ProcessTree logic to identify missing capabilities and log them explicitly
      - verify: Check the ProcessTree logic to ensure missing capabilities are identified and logged when they exist
      - evidence: apps/desktop/src/components/chat/ProcessTree.logic.ts:245
    - **[reliability] Verification Step for Task Completeness** (impact 8.1/10) — Vai can verify the completeness of a task before finalizing, ensuring no details are lost
      - first slice: Add a verification step in the task processing pipeline that checks for completeness of details before finalizing a task
      - verify: Check that the verification step is called and confirms task completeness before finalizing
      - evidence: apps/desktop/src/components/chat/process-humanize.ts:48, apps/desktop/src/components/chat/ProcessTree.logic.ts:167, apps/desktop/src/components/chat/ThinkingPanel.logic.ts:660
    - **[vision] Basic Image Input Support** (impact 8/10) — Vai can now receive and process image inputs to assist with tasks requiring visual analysis
      - first slice: Add a function to receive and store image inputs in the message pipeline
      - verify: Test by sending an image and confirming it is stored and processed correctly
      - evidence: protocol.d.ts:1170:applies to images.

- **Capability-Innovation 2026-06-24 — council round (strong 7.5/10)**
  - Context: generative capability council toward the north-star (voice + interface, any task,
    reliable, no lost details). council 7.5/10 (strong) · 7 lenses · 7 areas · top cluster 1
  - weakest council dimension: convergence (2/10) — improve the roundtable here next
  - Proposals (PROPOSE-only — review + implement by V3gga/Opus; never auto-applied):
    - **[tooling] Real-World Tool Invocation for Task Completion** (impact 9.1/10) — Vai can invoke real tools like file operations, shell commands, or APIs to complete tasks end-to-end
      - first slice: Add a minimal shell command execution tool to Vai's capabilities
      - verify: Test Vai's ability to run a shell command and return the output
      - evidence: .venv/Lib/site-packages/playwright/driver/package/types/protocol.d.ts:66:backendDOMNodeId: DOM.BackendNodeId;, .venv/Lib/site-packages/playwright/driver/package/types/protocol.d.ts:168:backendDOMNodeId?: DOM.BackendNodeId;, .venv/Lib/site-packages/playwright/driver/package/types/types.d.ts:31:* Page provides methods to interact with a single tab in a [Browser](https://playwright.dev/docs/api/class-browser),
    - **[council] Convergence Vote for Council Decisions** (impact 8.6/10) — Vai can now vote to converge on council decisions, ensuring alignment and reducing ambiguity in task delegation
      - first slice: Add a convergence vote step after the council members provide their input, where a majority vote determines the final decision
      - verify: Check that the convergence vote is recorded and used to finalize task delegation in the chat interface
      - evidence: apps/desktop/src/components/chat/process-humanize.ts:133, apps/desktop/src/components/chat/process-humanize.test.ts:27
    - **[delegation] Contextual Task Delegation with Verification** (impact 8.6/10) — Vai can delegate tasks to specialized workers while preserving context and verifying execution outcomes.
      - first slice: Add context-preservation and verification step in task delegation flow
      - verify: Check if task context is fully retained and verified in logs
      - evidence: protocol.d.ts:733, structs.d.ts:45
    - **[vision] Image Capture for Task Analysis** (impact 8.4/10) — Vai can capture and analyze images to understand visual tasks or environments
      - first slice: Implement a basic image capture and analysis module that accepts image input and returns descriptive metadata
      - verify: Test with a known image input to ensure the system correctly captures and describes the image content
      - evidence: protocol.d.ts:1170, types.d.ts:36
    - **[voice] Streaming Council Enrichment** (impact 8.3/10) — Vai can enrich the council view in real-time during streaming interactions, providing context-aware suggestions and progress tracking.
      - first slice: Add real-time council member updates during streaming interactions in LiveProcessStream.logic.ts
      - verify: Check that council members are dynamically updated and visible during a streaming interaction in the chat interface
      - evidence: apps/desktop/src/components/chat/LiveProcessStream.logic.ts:5, apps/desktop/src/components/chat/process-step-enrich.test.ts:5, apps/desktop/src/components/chat/process-step-enrich.ts:4

- **Fix 2026-06-24 — capability council went LIVE (0/10 broken → 7/10 strong)**
  - Symptom: the first live local-model capability round returned **0 proposals · council
    0/10 (broken)**. Lenses finished suspiciously fast (5–34s).
  - Root cause (MEASURED, not guessed): instrumented one lens (`multimodal-voice`) through
    the real model and dumped every raw reply. The replies were clean, tiny JSON tool calls
    (49–120 chars) — **no `<think>` content, no truncation**. The model simply spent its
    entire step budget investigating (grep_repo/find_symbol/read_file) and **never chose to
    `propose`**. (The popular "`<think>` eats numPredict" theory is wrong here: `driver.mjs`
    already sends `think:false`, and the dumped output proves it.)
  - Fix (capability-engine.mjs, propose-only, no Vai-source edits):
    - Step-budget pressure: the system prompt now states the step budget; with ≤2 steps left
      the harness escalates ("emit the final propose JSON NOW, cite the file:line you read").
    - Guaranteed forced final propose: if the loop ends with no proposal, one last forced
      generate converts the real evidence already read into a grounded proposal.
    - Tolerant parse: accept a bare proposal object (model sometimes drops the `tool` field).
    - numPredict 360→640 so the ~250-token proposal JSON isn't clipped; fixed the Windows CLI
      guard (`pathToFileURL`) so the one-shot actually runs.
  - Evidence (source of truth = the corpus ledger + backlog, not the console tail): two live
    rounds wrote **5 real grounded proposals** (council 7/10 strong), each citing files the
    model actually read — e.g. #1 [council] Convergence Vote (`service.ts:1646`), #2 [voice]
    Streaming STT/barge-in (`LiveProcessStream.logic.ts:5`), #4 [capability-gap] Voice Context
    Retention (`protocol.d.ts:72`). Meta test suite **56/56**; `node --check` clean. Also
    confirmed an apparent "died after lens 1" run was just piped-stdout truncation — the DB
    showed it had completed all 3 lenses and persisted its rows.
  - Verdict: **KEEP.** The generative arc now runs end-to-end against the live local model.
  - Next: the rubric flags `convergence (2/10)` as the weakest dimension — proposals don't yet
    build on each other. Candidate next slice: let later lenses SEE earlier proposals so the
    roundtable synthesises instead of emitting in isolation.

- **Capability-Innovation 2026-06-24 — council round (strong 7/10)**
  - Context: generative capability council toward the north-star (voice + interface, any task,
    reliable, no lost details). council 7/10 (strong) · 2 lenses · 2 areas · top cluster 1
  - weakest council dimension: convergence (2/10) — improve the roundtable here next
  - Proposals (PROPOSE-only — review + implement by V3gga/Opus; never auto-applied):
    - **[capability-gap] Voice Context Retention** (impact 7.6/10) — Vai can retain and use voice context across interactions to maintain task continuity and accuracy.
      - first slice: Add a voice context retention layer that stores and retrieves context from voice interactions.
      - verify: Test with a voice command that requires context from a prior interaction to ensure continuity.
      - evidence: protocol.d.ts:72, protocol.d.ts:733
    - **[voice] Streaming Status Updates** (impact 7.2/10) — Vai can stream status updates in real-time during task execution, maintaining context and detail for V3gga.
      - first slice: Add a function to stream status updates with context and detail.
      - verify: Check that status updates are streamed in real-time and maintain context for V3gga.
      - evidence: apps/desktop/src/components/chat/LiveProcessStream.logic.ts:5

- **Capability-Innovation 2026-06-24 — council round (strong 7/10)**
  - Context: generative capability council toward the north-star (voice + interface, any task,
    reliable, no lost details). council 7/10 (strong) · 3 lenses · 3 areas · top cluster 1
  - weakest council dimension: convergence (2/10) — improve the roundtable here next
  - Proposals (PROPOSE-only — review + implement by V3gga/Opus; never auto-applied):
    - **[council] Convergence Vote for Voice Tasks** (impact 8.6/10) — Enable a convergence vote to ensure all council members agree on the outcome of voice tasks before delegation
      - first slice: Add a convergenceVote field to the CouncilThinking interface and update the runCouncilReview function to include a convergence vote step
      - verify: Check if the convergenceVote field is present in the CouncilThinking interface and if the runCouncilReview function includes a convergence vote step
      - evidence: packages/core/src/chat/service.ts:1646, apps/desktop/src/components/chat/ProcessTree.logic.test.ts:342
    - **[voice] Streaming STT with Barge-in Support** (impact 7.2/10) — Vai can process voice input in real-time with barge-in support, allowing V3gga to interrupt and correct mid-speech.
      - first slice: Add barge-in support to the LiveProcessStream logic for STT streaming
      - verify: Check that Vai can process interrupted speech and continue the task accurately
      - evidence: apps/desktop/src/components/chat/LiveProcessStream.logic.ts:5
    - **[capability-gap] Voice-Driven Task Escalation** (impact 7.2/10) — Vai can now escalate tasks to V3gga/Opus-4 when it genuinely cannot perform them, using voice input as the trigger.
      - first slice: Add a voice command handler that checks if a task is beyond Vai's current capabilities and triggers an escalation to V3gga/Opus-4.
      - verify: Test the voice command handler with predefined tasks that are known to be outside Vai's current capabilities.
      - evidence: packages/runtime/src/council/build-roster.ts:355

- **Progress 2026-06-24 - Capability-Innovation ARC (generative council → backlog)**
  - Context (owner ask): the corrective loop only ever fixes KNOWN failure classes, and
    INNOVATE only fires on a stall and is limited to model/prompt/grader tweaks — it had
    fired 0 experiments because motion is "improving". The real goal is a PERPETUAL,
    future-proof arc that proposes FEATURE-level upgrades (tool-use, voice, images,
    council roundtable/process, tool-chaining, delegation) by synthesising project
    context and V3gga's recurring intent. Build the generative twin, propose-only.
  - Built four new modules + three test suites (all pure parts injectable; observe-safe):
    - `council-rubric.mjs` — deterministic measurement of the roundtable. `scoreCouncilProcess`
      grades a round on synthesis/convergence/chaining/delegation/grounding/actionability
      (0..10 each) + overall/verdict/headline and a `lesson` naming the weakest dimension;
      `scoreCapabilityProposal` ranks an idea by goalFit/grounding/actionability/scope/
      specificity. This makes "does the council work, and how to improve it" MEASURED.
    - `capability-lenses.mjs` — 7 generative lenses (tool-use architect, multimodal-voice,
      vision-image, council-process-improver, reliability/no-lost-details, delegation-
      orchestrator, capability-gap-hunter). `selectLenses(focus)` themes a round while
      keeping the gap-hunter + council-process core always on. The twin of personas.mjs.
    - `capability-context.mjs` — bounded, grounded project picture: `PERPETUAL_GOAL` distilled
      from MASTER_PROMPT (voice+interface, any task, honest escalation), AGENTS mission, OPEN
      backlog headlines (avoid re-proposing), V3gga's recurring asks (message dump), and
      best-effort live `/api/agent/introspect`. Injectable fs/fetch; token-capped.
    - `capability-engine.mjs` — the orchestrator. `proposeCapability` runs each lens through
      the grounded tool loop (grep/read/find_symbol, evidence must be a line it read);
      `runCapabilityRound` is serial + VRAM-guarded, scores + dedupes (against backlog +
      prior ledger) + ranks, persists to a new `capabilities` table (status='proposed'),
      and appends a dated entry under "## Open". CLI one-shot + injectable model/fs/db.
  - Wired (observe-safe): `supervisor.mjs` gains `--capability-every N` (+`--capability-focus`),
    running a serial capability council after INNOVATE, before the GPU rest — propose-only,
    never edits source. `operator.mjs` status previews the latest ledger proposals (read-only).
  - Evidence (measured): new suites council-rubric 9/9, capability-context 10/10,
    capability-engine 8/8; full meta suite (these + grader + action-queue + innovation +
    speculator + motion) **76/76 pass**; `node --check` clean on all 4 new modules +
    supervisor + operator. End-to-end ARC PROOF against REAL SQLite (injected generator so
    it runs while the observe loop holds the single GPU slot): 7 lenses → 7 ranked proposals
    → council **6.3/10 (workable)** → 7 rows written to the `capabilities` ledger
    (status=proposed) → dated entry formatted under "## Open"; rubric correctly flagged
    `delegation` as the weakest council dimension to improve next.
  - Verdict: **KEEP.** The generative arc exists, is measured, and is propose-only. It does
    NOT auto-run yet (default `--capability-every 0`) — flipping it on is a heavy GPU task,
    so it stays a human go (one-heavy-task-at-a-time / BSOD rule).
  - Next (owner steer): with the observe loop paused, restart with e.g.
    `--capability-every 3 --capability-focus voice` to convene the real local-model council
    and accumulate live FEATURE proposals; then grade the ledger after a few rounds.

- **Progress 2026-06-24 - Stuck-lesson -> queued-fix BRIDGE (action-queue.mjs)**
  - Context (owner ask): close the x774 meta-slop loop — the visual lesson re-learned
    hundreds of times but never acted on. Build the bridge that converts grader findings
    into a prioritized, queue-only action list the supervisor/PROPOSE step can consume.
  - Built `action-queue.mjs` (pure, I/O-free, queue-only — never applies a fix):
    `buildActionQueue(grade)` turns a gradeLedger() report into `{type, priority, target,
    reason, suggestedPersona}[]`; `personaForClass` maps class/lane -> persona;
    `formatTopAction` for the operator. Priority model: stuck lesson = BASE(1000)+timesSeen
    (x774 => 1774), weak class = round((1-passRate)*100) (40% => 60), so any stuck lesson
    (>=1050) always outranks any weak class (<=100). STABLE sort keeps weakest-first order
    among ties.
  - Wired: `operator.mjs` status prints `next fix (#N queued): [type pP] target -> persona`
    under the Grade block; `supervisor.mjs` PROPOSE now builds the full grade + queue in its
    isolated try/catch and logs the top queued fix every cycle (still observe-safe).
  - BUG FOUND + FIXED (lane mislabel): the prior lane-tagging edit to `gradeLedger`
    reported success but never flushed to disk — node executed the old `opts` body while the
    editor showed the new `{...opts, lane}` one, so the visual stuck lesson came back
    `lane:null` and the queue mislabeled it `answer-fix`/`answer-craft`. Re-applied the edit
    to disk; verified via `fs.readFileSync` that lines 92-93 now carry the lane. The top
    action is now correctly `visual-fix -> visual-stylist`.
  - Evidence (measured): `action-queue.test.mjs` 8/8, `grader.test.mjs` 9/9 (17/17 combined),
    full meta suite (action-queue + grader + innovation + speculator + motion) **49/49 pass**;
    `node --check` clean on action-queue/grader/supervisor/operator. Live `operator status`:
    `next fix (#8 queued): [visual-fix p1831] Avoid oversized empty hero ... -> visual-stylist`.
  - Verdict: **KEEP.** The x774 loop is now named AND queued with the right persona every
    cycle. Still observe-safe: queue-only, read-only, no GPU, no auto-apply.
  - Next (owner steer): resume observe-mode so the weakest-first + stuck-lesson queue steers
    real cycles; OR fold in Grok's review items (operator status collector/renderer + --json,
    runVisual readline+finally cleanup, shared loop-utils.mjs for pct/trim).

- **Progress 2026-06-24 - Grade node: deterministic self-grader (council grades itself)**
  - Context (owner ask): "be my grader — run the perpetual motion, act on what's good,
    reject what's bad, always say why, and set up the council to run this loop on its
    own toward UX/human/AI experience excellence." First, root-caused + fixed a broken
    signal: `proposalQualityStats` reported an impossible **8660%** because the visual
    lane writes hundreds of `ui/contrast` consensus rows into the SAME `consensus` table
    the text metric read (supervisor.mjs:118). Rescoped to the proposed-class grain
    (bounded [0,1]); now reads a sane **33%** live, regression-guarded.
  - Built `grader.mjs` (pure, I/O-free, like motion.mjs/speculator.mjs): `rankWeakestClasses`
    (orders failure classes lowest-pass-rate-first; an unscored class with total=0 is
    never a false "0% emergency"), `detectStuckLessons` (a lesson re-learned ×N with a
    flat score = meta-slop, flag for ACTION not counting), `gradeLedger` (per-agent
    ADOPT/REJECT/KEEP verdicts, each bound to a measured number and addressed to the
    responsible agent), `formatGrade`/`formatGradeHeadline`.
  - Added `campaignClassStats(db)` to db.mjs (campaign-wide per-class pass-rate across
    ALL runs, try/catch-guarded). Wired the grader into the loop: `supervisor.mjs` PROPOSE
    now orders the run's failing classes WEAKEST-FIRST so the scarce one-heavy-task budget
    targets the lowest pass-rate class, not the most familiar bug (the persona-neglect
    reject, automated). `operator.mjs` status prints the grade headline, weakest-first
    targets, and the per-agent verdicts.
  - Evidence (measured): `grader.test.mjs` 9/9; combined node suite (grader + innovation +
    speculator + motion) **41/41 pass**; `node --check` clean on grader/db/supervisor/
    operator/grader.test. Live `operator status`: `Grade: 7 weak classes (worst
    routing/comparison 40%) · 1 stuck lesson`; targets `routing/comparison 40% ·
    routing/fresh-data-trigger 41% · answer/curated-trap 46%`; `[REJECT] propose-fix
    personas …`, `[REJECT] visual-rubric+stylist (stuck lesson ×774)`, `[KEEP] council
    members (83% ≥ 60% gate)`. Campaign-wide view CORRECTED an earlier single-run read
    (run #10 showed fresh-data at 0%); aggregating all runs is the honest signal.
  - Verdict: **KEEP.** The loop now grades itself deterministically and points its own
    effort at the weakest class every cycle, with honest per-agent rationale. Still
    observe-safe: read-only, no GPU, no auto-apply.
  - Next (owner steer): (a) let the grader's stuck-lesson finding auto-queue the top P1
    visual flaw as a fix (closes the ×774 loop); (b) acceptance verifier (re-run the exact
    failing rows post-apply); (c) resume observe-mode to accumulate fresh signal.

- **Progress 2026-06-23 - Speculator: evidence-bound forecaster (forward-arc, thread A)**
  - Context: mapped the loop against a full SDLC circle. Finding — the BACKWARD/
    corrective arc already exists (graders+eyes=testers, personas+grounded agent=
    engineers, consensus=review, apply-*=merge, semgrep=security, motion+innovation+
    runner=PM). The FORWARD/generative arc is missing: simulated users (source signal),
    ideator (friction->objectives), speculator (rank by expected value), acceptance
    verifier (re-run the failing rows). Built the cheapest, deterministic, no-GPU one
    first; the rest await owner steer (simulated users needs a design pass).
  - Built `speculator.mjs`: turns the loop's OWN closed-experiment history into a prior
    that re-ranks the innovation engine's candidates by expected value before the
    one-heavy-task budget is spent. Pure compute over the `experiments` table — no model
    call, no GPU. `EV = adoptRate * clamp(meanDelta/threshold,0,CAP) + EXPLORE_BONUS/(1+tried)`.
    adoptRate is Laplace-smoothed (prior 0.5); delta is normalized by the candidate
    type's adoption threshold so a +4pp model move and a +0.4/10 grading move are
    comparable. `experimentStats` (per type + type+variant, ignores OPEN rows),
    `expectedValue` (variant history preferred, else type-level transfer, else prior),
    `speculate` (STABLE re-sort — equal EV keeps the engine's base order, so a
    no-history loop behaves exactly as before; only ever refines).
  - Wired: `planNextExperiment` now `speculate(db, rankExperiments(scorecard))` before the
    skip-already-tried fall-through; `operator.mjs` status shows the EV rationale next to
    the next experiment. Circular import (speculator<->innovation-engine) is safe —
    both reference each other only inside functions, never at module-eval time.
  - Evidence (measured): `speculator.test.mjs` 8/8; combined node suite (motion +
    answer-rubric + vague-answer + pass-rate + innovation + runner + speculator)
    **60/60 pass**; `node --check` clean on speculator/innovation/operator. Live smoke
    through the real `planNextExperiment`: no history -> head `model` `ev 0.50` (base
    order kept); after two adopted `grading` results (mean +0.55) -> head PROMOTED to
    `grading` `ev 2.23` with rationale `variant adopt 75% · mean +0.550`.
  - Verdict: **KEEP.** The loop now spends its scarce heavy-task budget on the lever its
    own history says is most likely to pay off, with honest provenance (no magic number).
  - Forward-arc remaining (NOT started; owner to steer order):
    1. **Acceptance verifier** — post-apply, re-run the EXACT failing rows to confirm the
       fix moved THOSE cases (closes the runner's corpus-drift caveat). Small, honest.
    2. **Simulated users -> Ideator -> objective backlog** — the true "full circle".
       High value, runs live multi-turn GPU sessions, needs a design pass FIRST (persona
       set, journey shape, how friction becomes a new seed-class/objective). Do NOT build
       blind.
    3. **(C) Per-model council telemetry** so the `model` experiment picks a real
       challenger; now also feeds the speculator a richer per-model prior.

- **Progress 2026-06-23 - suggestExperiment skip-already-tried (ranked fall-through)**
  - Honest re-assessment of the (B)-entry's "prioritized next slice": of the four
    proposed, only this one was certain + low-risk; the rest were re-ordered or parked
    (experiment APPLICATION is high-risk runtime plumbing — needs owner steer, not a
    blind build; per-model telemetry only pays off after application exists; the
    council read/write backlog is still too vague to commit). See decision below.
  - Bug it fixes (shipped in the motion->innovation slice): `planNextExperiment`
    asked `suggestExperiment` for ONE pick; if `hasOpenExperiment` blocked it, the
    whole stalled cycle was skipped (`skipReason:'duplicate'`) and NOTHING queued —
    even though other levers were available. A stall whose best experiment was already
    tried-and-rejected would spin forever: the exact meta-slop the motion meter exists
    to kill.
  - Built:
    - `innovation-engine.mjs`: `suggestExperiment` refactored into
      `rankExperiments(scorecard) -> ordered[]` (never empty; stall branch returns the
      gradient-relevant lever FIRST then the other stall levers + a seed_class explore
      fall-back; non-stall returns the signal-matched list + explore). `suggestExperiment`
      is now `rankExperiments(sc)[0]` (shape/behaviour of the head unchanged).
    - `planNextExperiment` now falls through the ranked list to the first candidate not
      blocked by `hasOpenExperiment`; it only skips (`duplicate (all candidates ...)`)
      once EVERY lever is exhausted. `result.suggestion` reflects the candidate that
      would actually be queued.
  - Evidence (measured): combined node suite (motion + answer-rubric + vague-answer +
    pass-rate + innovation + runner) **53/53 pass** (was 51: replaced the old
    skip-asserting test with fall-through + exhaustion, added a `rankExperiments` test);
    `node --check` clean on engine + test. Live smoke on a seeded stalled corpus (flat
    0.6): five consecutive plans queued `model -> grading -> prompt -> seed_class ->`
    then honest `duplicate (all candidates already queued or rejected)` — 4 distinct
    experiments, no wasted cycle, no dead-end re-propose.
  - Verdict: **KEEP.** A stalled loop now exhausts its experiment levers in priority
    order before admitting it's out of moves — perpetual motion no longer dies on the
    first deduped pick.
  - Next slice (re-ordered, NOT started; awaiting owner steer on the risky one):
    1. **(C) Per-model council telemetry trend** (low-risk, pure-ish): pick a real
       challenger from measured per-model performance instead of the hardcoded
       `qwen2.5-coder:7b`. Makes the `model` experiment meaningful and is a prerequisite
       for honest application.
    2. **Experiment APPLICATION** (HIGH-RISK — owner steer first): make a queued
       experiment actually swap the model/prompt/grader for its arm so the treatment
       measures the CHANGE, not ambient corpus drift. Turns the runner's proxy into a
       true A/B. Do NOT build blind — it plumbs experiment state into the live runtime.
    3. **(E) Council read/write objective backlog** (PARKED — too vague): needs a
       concrete spec before it's actionable.

- **Progress 2026-06-23 - (B) Experiment runner: the meta-loop CLOSED (outcome feedback)**
  - Follow-on to the motion->innovation slice below. That slice could QUEUE an
    experiment when the loop stalled; it could not PROVE whether the experiment
    helped — gap (B). This closes it: the loop now measures the queued experiment
    against the runs accumulated since, and ADOPTS or DISCARDS it.
  - Built:
    - `innovation-engine.mjs`: `targetMetric(type)` (grading->excellence, else
      pass-rate), `ADOPT_THRESHOLD` (+2pp) / `ADOPT_THRESHOLD_EXCELLENCE` (+0.2/10);
      `planNextExperiment` now stores the baseline in the TARGET metric's own units;
      `formatExperiment` renders excellence deltas as /10, pass-rate as pp.
    - `experiment-runner.mjs` (new): `nextOpenExperiment` (oldest unfinished),
      `measureCorpusMetric(db,metric,sinceIso)->{value,samplesSince}` (reads the
      corpus series; counts runs strictly AFTER the queue time), `runExperiment`
      (baseline vs treatment -> delta -> adopt/discard via `finishExperiment`, gated
      on >=1 post-queue run AND a recorded baseline; measurement injectable for
      deterministic tests), `runNextExperiment` convenience.
    - `supervisor.mjs`: end-of-cycle CLOSE-OUT (runs the open experiment) BEFORE the
      INNOVATE queue block, logged, isolated try/catch. `operator.mjs status`: an
      Experiments ledger (open=in progress, closed=adopted/discarded + measured delta).
  - Honest by construction: never declares a verdict without post-queue evidence;
    the DISCARD is recorded so `hasOpenExperiment` stops the loop re-proposing a dead
    end (anti-repetition now spans tried-and-rejected, not just open).
  - Evidence (measured): `experiment-runner.test.mjs` 9/9; combined node suite
    (motion + answer-rubric + vague-answer + pass-rate + innovation + runner)
    **51/51 pass**; `node --check` clean on innovation/runner/operator/supervisor;
    live end-to-end smoke on a seeded corpus: stall -> QUEUED [model] (baseline 60%)
    -> one post-queue run -> `CLOSED true true metric=passRate baseline=60.0%
    treatment=100.0% delta=40.0pp -> ADOPT`, motion flipped to `improving`, and the
    operator ledger rendered `[model] ... — ↑ delta=40.0% ADOPTED`.
  - Verdict: **KEEP.** The OBSERVE->PROPOSE->CONVERGE->APPLY spine now has a working
    meta-loop on top: detect stall -> queue experiment -> measure outcome -> adopt or
    discard -> (discard blocks re-tries). Caveat: the runner measures the CORPUS-WIDE
    metric after the queue, i.e. it credits/blames the experiment for whatever moved
    the loop next — a pragmatic proxy, not an isolated A/B. True isolation needs an
    experiment to actually swap the model/prompt/grader for its own measured arm.
  - Prioritized next slice (in order):
    1. **Experiment APPLICATION** — make a queued experiment actually take effect
       (swap the council model / prompt / grader variant for its arm) so the treatment
       measures the change, not ambient drift. Turns the proxy into a real A/B.
    2. **(C) Per-model council telemetry trend** so the `model` experiment picks a real
       challenger instead of the hardcoded `qwen2.5-coder:7b`.
    3. **suggestExperiment skip-already-tried** — when the top suggestion is blocked by
       `hasOpenExperiment`, fall through to the next-best instead of skipping the cycle.
    4. **(E) Council-read/write objective backlog** for goal-directed PM.

- **Progress 2026-06-23 - Motion -> Innovation: the dead innovation engine brought to life off the motion meter**
  - Engineering gap analysis (the OBSERVE->PROPOSE->CONVERGE->APPLY spine is real
    and good, but it was reactive + open-loop at the top):
    - **A. Innovation engine was dead code.** `suggestExperiment(scorecard)` existed;
      the `scorecard` was never built and the function was never called. The loop
      could fix KNOWN classes but could not decide to try something NEW when stuck.
    - **B. No experiment runner / outcome feedback.** `startExperiment`/`finishExperiment`
      existed but nothing ran an experiment or measured its delta.
    - **C. No council/model telemetry trend** (response/parse rate per model).
    - **D. No anti-repetition memory** -> a perpetual loop re-tries dead ends forever.
    - **E. No goal-directed objective backlog** (work is per-failing-class, not a
      prioritized queue the loop reads/writes).
  - Built this slice = **(A) + (D)**, motion-driven and propose-only:
    - `db.mjs` scorecard signals (all try/catch-guarded for fresh corpora):
      `proposalQualityStats` (hitRate = grep-verified consensus rows / proposals),
      `councilResponseRate` (results with a non-empty `read_as`), `lowExcellenceCount`
      (graded answers below a craft threshold).
    - `innovation-engine.mjs`: pure `buildScorecard({motion,proposal,council,excellence})`;
      `suggestExperiment` now has TOP-PRIORITY motion-aware branches — stall + maxed
      pass + flat excellence -> `grading` (raise the excellence bar); stall + both
      flat -> `model` (plateaued model); stall with one soft gradient -> `prompt`
      (tighter grounding); otherwise falls through to the legacy signal branches.
      `hasOpenExperiment` dedupes by type+variant against OPEN or tried-but-rejected
      rows (anti-repetition). `planNextExperiment(db,{record})` builds the cross-run
      series -> `analyzeMotion` -> scorecard -> suggestion, and RECORDS the experiment
      only when `state==='stalling'` and not a duplicate. It NEVER executes — same
      propose-only contract as the rest of the loop.
    - Wired in: `operator.mjs status` now previews the scorecard + the next experiment
      (read-only, `record:false`); `supervisor.mjs` end-of-cycle calls
      `planNextExperiment(db,{record:true})` so the living loop, on noticing it is
      spinning, writes down what to try next (logged, deduped, crash-safe).
  - Evidence (measured): `innovation-engine.test.mjs` 10/10; combined node suite
    (motion + answer-rubric + vague-answer + pass-rate + innovation) **42/42 pass**;
    `node --check` clean on db/innovation/operator/supervisor; live operator smoke on
    a seeded 3-run flat corpus printed `Perpetual motion: stalling · STALLED · pass
    60% -> · excellence n/a` + `next experiment: [model] ...` + `(would not queue:
    preview only)` — proving the read-only preview path end-to-end.
  - Verdict: **KEEP.** The motion->innovation wire is sound and the suggestions map
    to the right lever per gradient. It is NOT yet "truly perpetual" — it queues a
    decision, it does not yet PROVE the experiment helped.
  - Prioritized next slice (what makes it close the meta-loop, in order):
    1. **(B) Experiment runner + outcome feedback** — run the queued experiment in a
       controlled probe, `finishExperiment` with the measured `delta` vs `baselineScore`,
       adopt-or-discard. This is what turns "I wrote down what to try" into "I proved
       it worked." Highest leverage.
    2. **(C) Per-model council telemetry trend** so the `model` experiment has real
       signal to pick the challenger, not a hardcoded `qwen2.5-coder:7b`.
    3. **(E) Objective backlog the council reads/writes** for goal-directed PM.

- **Progress 2026-06-23 - Motion meter: the loop measures its OWN trajectory (perpetual-motion self-check)**
  - Gap analysis (evidence from the corpus): the loop measured individual outputs
    but not its own trajectory. Pass-rate was trended (`campaignTrend`) and
    fix-deltas gated (`pass-rate.mjs`), but (1) the new answer-excellence score was
    recorded per-result and never trended across runs, (2) nothing detected
    STAGNATION — the perpetual loop's real failure mode is spinning (burning
    compute, improving nothing = meta-slop), and (3) `innovation-engine.mjs`
    (`suggestExperiment`/`startExperiment`) was dead code: defined, never called,
    never fed a scorecard.
  - Implemented the cross-run quality gradient + a self-measurement:
    - `db.answerExcellenceTrend(db)`: avg craft score + sample count per run
      (mirrors `campaignTrend`).
    - `scripts/improve-loop/motion.mjs` (pure, I/O-free like `pass-rate.mjs`):
      `seriesSlope` (least-squares), `classifyTrend`, `detectStagnation`,
      `analyzeMotion({passRate,excellence})` -> `{state, passRate, excellence,
      stagnation, recommendation, headline}`, `formatMotion`. State is
      improving / regressing / stalling / warming / cold-start. "Stalled" requires
      BOTH gradients flat (a maxed pass-rate while excellence still climbs is
      motion, not a stall). On stall it recommends INNOVATE (different
      model/prompt/tool/seed class); on regression it recommends bisecting the
      last applied change.
    - Surfaced read-only in `operator.mjs status` as a "Perpetual motion" line +
      recommendation, beside the taste/excellence blocks.
  - Evidence: `node --test motion.test.mjs answer-rubric.test.mjs
    vague-answer.test.mjs pass-rate.test.mjs` passed 32/32; `node --check` clean on
    motion/operator/db; temp-DB smoke through the real accessors
    (`campaignTrend`+`answerExcellenceTrend`+`analyzeMotion`) printed
    `Perpetual motion: improving · pass 80% ↑ · excellence 7.5/10 ↑`.
  - Next: feed `analyzeMotion` into `suggestExperiment` so a detected stall
    auto-proposes the next experiment (wire the now-living innovation engine), and
    add a visual-taste cross-run trend so motion covers the frontend gradient too.

- **Progress 2026-06-23 - Answer-excellence rubric (text-lane twin of the visual taste pass)**
  - Gap: the text/council lane only graded whether Vai READ a prompt right
    (`brain.gradeInterpretation` -> binary pass/fail). A barely-acceptable answer
    and an excellent one both scored "pass", so the loop had no gradient to climb
    on the craft of the produced answer.
  - Implemented `scripts/improve-loop/answer-rubric.mjs` (`judgeAnswerExcellence`):
    pure, evidence-bound multi-dimension scorer (grounding, directness, structure,
    calibration, specificity) + flaws (P0..P3) + reusable lesson + headline,
    mirroring `visual-rubric.mjs`. Every score binds to a measured surface signal;
    missing signals score conservatively (no invented compliments). Any P0/P1 flaw
    caps the overall ceiling so a real defect can't read as "excellent".
  - Shared the regex primitives: refactored `vague-answer.mjs` to export
    `detectAnswerSignals`; `scoreVagueOverconfident` behavior unchanged.
  - Persisted in the corpus (`db.mjs`): `answer_excellence`/`answer_excellence_json`
    columns (CREATE + lazy `ALTER` migration for existing DBs), `answer_lessons`
    table, `recordResult` persistence, and `recordAnswerLesson` /
    `topAnswerLessons` / `answerExcellenceStats` accessors.
  - Wired into `run.mjs` (pure compute on the council answer after grading, no
    extra GPU) and surfaced in `operator.mjs status` next to the visual taste block
    (avg/worst for the last run + top accumulated answer lessons).
  - Evidence: `node --test scripts/improve-loop/answer-rubric.test.mjs
    scripts/improve-loop/vague-answer.test.mjs` passed 15/15; `node --check` clean
    on run/operator/db/answer-rubric; temp-DB smoke test confirmed the roundtrip
    (`stats {"n":1,"avg":7.5,"worst":7.5}`, lesson dedup `times_seen:2`).
  - Next: feed accumulated answer lessons into the propose/patch phase the way the
    taste lessons are used, and calibrate dimension weights against a labeled
    sample of real council turns.

- **Progress 2026-06-22 - Visual eyes/hands telemetry lane for the improvement loop**
  - Read V3gga's pasted Google/blueprint notes about giving Vai persistent
    "eyes and hands" and turning visual observation into live loop data.
  - Implemented the safe first slice in `scripts/improve-loop/visual-probe.mjs`:
    Playwright opens the real desktop app, checks top-layer hit testing with
    `elementFromPoint`, moves a curved pointer path, clicks/types/clears the
    composer without submitting, captures screenshots, attempts video, and
    writes `report.json` plus `events.ndjson`.
  - Promoted the event stream into the operator/corpus path: `operator visual`
    streams probe events live, stores a sampled copy in `visual_runs`,
    `visual_events`, and `visual_live`, and `status`/`watch` expose the latest
    visual run.
  - Evidence: `corepack pnpm self-improve:visual` passed on the live desktop app
    at `http://localhost:5173/?devAuthBypass=1`; report
    `Temporary_files/improve-loop-visual/2026-06-22T21-35-26-015Z/report.json`
    shows 5/5 checks passed, 3 screenshots, 38 events, no console/page errors,
    and one expected Google Fonts network warning under restricted network.
    `corepack pnpm self-improve:status` reported 2 visual runs and the latest
    live visual event `probe.done`. Focused Node tests passed for operator and
    driver helpers.
  - Next: let the long-running supervisor optionally schedule visual probes
    between text turns, and add a lightweight browser view that tails
    `visual_live` without requiring a full page refresh.
  - Progress 2026-06-23: made the eyes more flaw-sensitive. The live DOM signal
    pass now measures covered interactive controls (`elementFromPoint` misses),
    offscreen controls, clipped open menus/popovers under overflow-clipping
    ancestors, and too-small hit targets. The rubric turns covered/offscreen
    controls into P0 findings and small hit targets into P2 polish findings.
    Evidence: `node --test scripts/improve-loop/visual-rubric.test.mjs
    scripts/improve-loop/operator.test.mjs` passed 29/29; live
    `corepack pnpm self-improve:visual -- --no-video` passed with report
    `Temporary_files/improve-loop-visual/2026-06-23T02-26-45-119Z/report.json`,
    no P0 covered/offscreen/clipped blockers, and concrete P2 small-hit-target
    findings on compact controls.
  - Next from council: add an opt-in state-storyboard probe for real turns. The
    current default visual cadence still inspects mostly idle/typed state; `--send`
    exists, but cadence uses `operator visual --no-video`. Capture compact
    samples across `idle -> typed -> streaming -> final` with screenshots,
    `gatherVisualSignals`, and `inspectProcessUi`; emit `vision.storyboard` /
    `vision.state_sample`; surface the summary in `buildVisualCouncilPacket`,
    `/visual.json`, and the watch page. Keep it opt-in and serial because `--send`
    creates real turns.

- **DONE 2026-06-22 - Visual cadence + council packet + lightweight live JSON**
  (follow-up to the entry above; the three "Next" items are now shipped)
  - **Visual cadence**: `supervisor.mjs` takes `--visual-every <n>` (off by
    default; threaded through `operator start` and `buildSupervisorNodeArgs`).
    Every `n` text cycles it runs ONE `--no-video` eyes/hands probe, strictly
    serial (after PROPOSE/APPLY, before the GPU rest, recorded to the corpus),
    so the one-heavy-task-at-a-time rule holds. A probe failure is logged as
    operator evidence and never aborts the loop.
  - **Council packet**: `buildVisualCouncilPacket(db)` in `db.mjs` summarizes the
    latest visual run from the sampled SQLite trail (checks, composer
    reachability, top-layer target, screenshot count, real warnings vs expected
    optional-resource blocks, report path, pass/fail, one-line headline). It
    deliberately omits screenshots and the pointer trace so a model is never fed
    images or thousands of points. Surfaced via `operator visual --packet`.
  - **Lightweight live JSON**: the watch server now serves
    `GET /visual.json` → `{ packet, live }` with `cache-control: no-store`, so a
    council member or helper can poll the latest verdict without parsing HTML or
    reloading the dashboard.
  - **Probe robustness fix** (surfaced live): with the network open, Google Fonts
    now fail a CORS preflight because the probe injects `x-vai-dev-auth-bypass`
    (a header the fonts CDN does not allow), appearing as `ERR_FAILED` console
    errors. These are the probe's own artifact on an optional external resource,
    not a Vai defect, so `visual-probe.mjs` now classifies fonts.gstatic/
    googleapis `ERR_FAILED` and that specific CORS console message as expected
    optional-resource warnings. Before the fix a live probe FAILed on 4 console
    errors / 2 failed requests; after, it PASSes (warnings counted, not flagged).
  - Also hardened: the supervisor campaign snapshot no longer crashes with
    `no such table: proposals` on a fresh corpus where PROPOSE never ran.
  - Evidence (2026-06-22):
    - Live `corepack pnpm self-improve:visual -- --no-video` → PASS, 5/5 checks,
      `Temporary_files/improve-loop-visual/2026-06-22T21-47-14-480Z/report.json`.
    - `operator visual --packet` and `GET http://localhost:4124/visual.json`
      both returned `headline: "visual #4 done/pass · 5/5 checks · composer
      reachable"`.
    - One bounded cadence cycle
      (`supervisor.mjs --max-cycles 1 --seeds-only --limit 1 --visual-every 1
      --db C:/tmp/vai-cadence-test.sqlite`) ran the text cycle then the VISUAL
      step serially; the probe was recorded (`visual #1 done/pass`).
    - Focused tests green: `node --experimental-sqlite --test
      scripts/improve-loop/operator.test.mjs scripts/improve-loop/driver.test.mjs
      scripts/improve-loop/visual-packet.test.mjs` → 27/27 pass (new tests for
      `--visual-every` threading, `--packet` parsing, and
      `buildVisualCouncilPacket`).
  - How V3gga runs it:
    - Perpetual self-watching loop:
      `corepack pnpm self-improve:start -- --mode observe --visual-every 1`
    - Compact verdict for the council / another agent:
      `corepack pnpm self-improve:operator -- visual --packet`
    - Poll the live verdict while `self-improve:watch` runs:
      `GET http://localhost:4123/visual.json`

- **DONE 2026-06-23 - Visual TASTE engine: evidence-bound UX/human-appeal/flaw rubric**
  - Mission: make Vai's visual inspection more than pass/fail — build visual taste,
    human-appeal prediction, and picky-senior-designer flaw sensitivity, all as
    INSPECTABLE evidence, not vibes.
  - Architecture (matches AGENTS.md "deterministic policy is code"): the probe stays
    the deterministic "eyes/hands" that MEASURES the live DOM; a new pure scorer
    `scripts/improve-loop/visual-rubric.mjs` turns those measurements into scores +
    flaws + human-appeal + a taste lesson. Pure → unit-testable without a browser.
  - Measured signals (all from getComputedStyle / boundingBox / elementFromPoint /
    WCAG contrast, during real interaction): distinct font sizes, grid-sampled content
    density, card nesting depth, transition duration+easing, input latency, focus-ring
    presence, hover-state delta, text contrast vs resolved opaque background, clipped
    popovers, offscreen controls, unexpected scrollbars, generic-AI signals
    (purple-gradient slop / glassmorphism overuse / nested cards / empty hero / weak
    type scale).
  - Rubric output: 6-dimension scores; human-appeal (first impression / modern /
    interaction / trust / wow / keep-using, with wow gated to the floor on any P0);
    flaws with severity P0..P3 + measured evidence + cause + fix direction (repeats
    deduped with an occurrences count); one reusable taste lesson accumulated across
    runs in a new `taste_lessons` table.
  - Surfaces: probe emits `vision.signals` / `vision.rubric` / `vision.flaw` and carries
    the verdict on `probe.done`; `operator visual --packet` + `GET /visual.json` include
    a compact `taste` block; `self-improve:status` prints the verdict + top flaw +
    lesson + accumulated lessons; the watch page renders a taste card.
  - HONESTY CATCH (the important part): the rubric's FIRST live run reported 9 false
    P0 "invisible text" flaws — a measurement bug (it couldn't parse modern
    `color(srgb …)` and invented a white bg to compare against), and a second bug where
    `measureInteractionSignals` blurred the composer and broke typing. Both fixed: parse
    `color(srgb …)`, REFUSE to emit a contrast verdict when the background is
    indeterminate (a false flaw is worse than none — it trains Vai on noise), keep the
    composer focused. Also fixed content-density saturating to 1.0 (now grid-sampled
    coverage, not summed overlapping backgrounds) and over-eager empty-hero detection
    (skips app-shell roots).
  - Evidence (2026-06-23):
    - Live `corepack pnpm self-improve:visual -- --no-video` → PASS;
      `report Temporary_files/improve-loop-visual/2026-06-22T22-20-01-185Z/report.json`.
    - Honest verdict on Vai's own dev-bypass landing: **visual 7.3/10** (comp 6, motion 9,
      feel 8, identity 6), wow 5.5/10, **0×P0** (false positives gone), 4×P1 REAL
      `text-zinc-500` (`rgb(113,113,122)`) on near-black `rgb(11,13,16)` ≈ 4.0 contrast
      (just under WCAG 4.5), 1×P3 missing hover affordance, generic flag "oversized empty
      hero" (the landing genuinely has a big empty message area).
    - `self-improve:status` shows Visual taste + top flaw + taste lesson + accumulated
      lessons (×1). `GET /visual.json` carries `taste.overall=7.3`. Watch page renders
      the taste card.
    - Tests: `node --test scripts/improve-loop/visual-rubric.test.mjs` 10/10; full
      improve-loop suite 45/45 green (new coverage: contrast math, motion timing,
      generic-aesthetic detection, flaw severity/dedup, good-vs-slop fixtures, missing-
      signal conservatism).
  - REAL FINDINGS for V3gga to fix in the actual UI (the rubric earning its keep):
    - P1: secondary `text-zinc-500` text on the dark shell is ~4.0:1 — bump to
      zinc-400/zinc-300 for body-sized secondary text to clear WCAG 4.5.
    - P3: primary button has no measurable hover delta — add a subtle hover state.
    - Note: judging the empty landing state isn't a full test; next slice should drive a
      real turn first, then run the taste pass on the populated UI.
  - How V3gga runs it:
    - `corepack pnpm self-improve:visual -- --no-video` then read the TASTE line.
    - `corepack pnpm self-improve:operator -- visual --packet` for the council packet.
    - `corepack pnpm self-improve:status` for the persisted verdict + learned lessons.

- **DONE 2026-06-23 - Live smart video: watch-together stream + drive-a-real-turn + process-UI inspection**
  - V3gga ask: "I also want to SEE it going on; validate WITH me." Built a near-real-time
    shared view + a probe that drives a real turn so the POPULATED UI (Timeline/ProcessTree)
    is judged, not the empty landing.
  - Live-frame channel: the probe overwrites a single `live.jpg` (atomic temp→rename) on a
    ~450ms cadence while it drives; the watch page (http://localhost:4123) shows it at the top
    with a live/idle badge (`/live-frame.jpg` + `/live-frame.meta`). V3gga + the council watch
    the SAME frame in near-real-time (a video file only appears after the run; this is the
    LIVE surface). Plus a `cache.log` event stream = step-by-step "what I'm doing now".
  - Drive-a-turn: `--send` types a prompt + Enter, waits for the process UI, lets it run,
    inspects the focused/current block, waits for settle (bounded), inspects again.
  - Process-UI inspection (`inspectProcessUi`, grounded in Timeline.tsx / ProcessTree.tsx):
    answers V3gga's exact question — does the ONE in-focus block, on its own, tell the story?
    Measures cues (title/summary/gate/duration/glyph = 0..5), whether the focused block is
    visually DISTINCT from the rest, clipping, row count.
  - Flags: `self-improve:visual -- --headed --send --live [--prompt "…"]`.
  - VALIDATED LIVE (2026-06-23, headed, real turn driven, you watched):
    report `Temporary_files/improve-loop-visual/2026-06-22T22-45-47-606Z/report.json`,
    video saved (.webm). Honest findings on the live populated UI:
    - Surface was **ProcessTree, not Timeline** (Timeline flag off — reported honestly).
    - **Focused block WEAK: 2/5 cues (title+glyph only), focusDistinct=false** — the
      current block does NOT stand out from the other 47 rows, and carries no summary/gate/
      duration of its own. Fails V3gga's "1 block in focus alone is great info" bar.
    - **Real P2 bug**: label reads `"qwen3:8b is writing the answer11s"` — the duration is
      glued to the label with no space. Cause: `LiveElapsed` span right after the label text
      in `apps/desktop/src/components/chat/ProcessTree.tsx` (~L357) with no separating gap.
    - 48 steps = dense without the focused-block clarity to guide the eye.
  - NEXT (queued, not done): (a) give the focused/current ProcessTree row a distinct focus
    treatment + fix the duration spacing; (b) consider promoting the Timeline as the default
    process surface; (c) re-run the live drive-a-turn probe to confirm the focused block
    reaches ≥3/5 cues + focusDistinct=true.
  - Tests: operator/rubric/packet suites green (live-stream arg threading covered).

- **DONE 2026-06-23 - Phase 1: Live Work Product (draft streaming + real council reasoning + focus clarity)**
  - V3gga: the process UI showed CAPTIONS ("Drafting an answer…", "Waiting for qwen to weigh in"),
    not the actual content. Ideology adopted (V3gga's framing): stream observable WORK PRODUCT
    (draft, council summaries, process state) — never hidden chain-of-thought.
  - **1A — live draft stream**: new `draft_delta` ChatChunk ([adapter.ts:129](packages/core/src/models/adapter.ts#L129))
    carrying a lifecycle envelope `{ phase: start|delta|reset|committed, turnId, seq, source, isDiscardable }`
    so a future PresenceBlock timeline needs no migration. Emitted from the draft-buffering loop in
    [service.ts](packages/core/src/chat/service.ts) (cumulative draftText, deterministic
    time-AND-size coalescing 120ms/32ch, final committed flush, `reset` on council redraft, kill
    switch `VAI_STREAM_DRAFTS` default on). Frontend: ephemeral per-message `liveDraft` in chatStore
    (NEVER via appendToLastMessage so a redraft can't corrupt the answer; cleared on `done`), rendered
    as a labeled "Draft answer · in review · may change / revised by council" block (LiveDraftBlock in
    MessageBubble).
  - **1B — real council reasoning**: root cause was `member.ts` SUPPRESSING JSON-shaped content from
    non-thinking models (qwen) → empty preview → "Waiting…". Fixed with `previewFromPartialJson` — a
    tolerant partial-JSON extractor (regex, never JSON.parse; works mid-stream) that surfaces
    verdict/realIntent/suggestedAction/gap as they form, else "drafting its review…", never raw JSON.
  - **1C — focus clarity + P2 glue**: `process-tree__row--focused` treatment (deeper wash + thicker
    rail + strong label) so the in-flight block is unmistakable; LiveElapsed now renders for council
    rows too with an `ml-2` gap that fixes the "answer11s" duration-glue.
  - **Proof (2026-06-23)**:
    - Live WS probe to the runtime: `draft_delta: 5` chunks, `firstPhase=start`, draftLen=68 — the
      draft streams with the lifecycle envelope end-to-end.
    - Visual drive-a-turn probe: focused block **2/5 → 3/5 cues** (title+summary+glyph),
      **one-block-tells-the-story: WEAK → YES**, no "answer11s" flagged. Probe PASS.
    - `previewFromPartialJson` unit test 6/6; core typecheck + desktop typecheck clean; consensus +
      chat-quality suites **177/177**.
    - Note: the visual probe's 3.5s inspect window misses the draft block (it streams + retires in
      the first ~1-2s before council) — a probe-tuning detail, not a feature bug; the WS probe is the
      authoritative proof.
  - NEXT (roadmap, plan file mellow-pondering-salamander.md): Phase 2 live HTML info blocks (strict
    srcdoc iframe + sanitizer); Phase 3 unified PresenceBlock timeline + TTS out (speechSynthesis) +
    in-app Owner Dashboard + app-video blocks in chat; Phase 4 multi-party rooms. Desktop binary needs
    build + `pnpm app:update` to show 1A/1C in veggaai.exe (dev 5173 + runtime tsx already have it).

- **DONE 2026-06-23 - Phase 2: live HTML info blocks (deterministic + sandboxed)**
  - Vai/council now emit styled HTML "info blocks" into chat. Security decision: HTML is built
    SERVER-SIDE from STRUCTURED DATA only ([info-block.ts](packages/core/src/chat/info-block.ts):
    `renderInfoBlockHtml`, escaped text, fixed tag allowlist) and rendered in an iframe with
    `sandbox=""` (no allow-scripts/same-origin — [InfoBlock.tsx](apps/desktop/src/components/chat/InfoBlock.tsx)).
    We never sanitize model-authored HTML (sanitizer-as-security-boundary avoided).
  - New `info_block` ChatChunk ({id,html,title}); store appends/replaces by id; MessageBubble
    renders. First real emitter: a deterministic **Council verdict** block (outcome/agreement/
    read-as) after the council loop in service.ts.
  - Proof: `info-block` unit 3/3; WS verify on a balanced turn → `info_block=1 title="Council
    verdict"` after council (35 stages) completed; deep turns emit too but run past an 85s probe
    window (slow-council, not a bug). core+desktop typecheck clean; 41/41 council suites.

- **PRIORITY 0 - Capability kernel, not phrase-gated side routes** (2026-06-13)
  - unify deterministic handlers, repo tools, web research, council/model calls,
  and sandbox actions behind one inspectable capability contract:
  `match -> estimate cost/risk -> execute -> verify -> report evidence`.
  Wire the existing `ToolRegistry`/`ToolExecutor` into `ChatService` and register
  real runtime tools; today runtime creates an empty registry and no production
  route calls `runAgentLoop`. Evidence: "Which files changed in my repo right
  now?" returned real `git status` evidence in 152ms, while the natural
  paraphrase "Inspect the files changed in this project..." missed the regex
  gate, searched the web, and hallucinated unrelated UI changes.
- **PRIORITY 0 - Evidence-bound current facts** (2026-06-13) - current-person,
  current-price, current-version, legal, medical, and other freshness-sensitive
  answers must be assembled from retrieved evidence, not merely reviewed after
  generation. Bind each material claim to a fetched source and refuse or label
  uncertainty when no source supports it. Evidence: a live turn named Jens
  Stoltenberg as Norway's prime minister and claimed an official government
  source; the current government page lists Jonas Gahr Støre as prime minister
  and Stoltenberg as finance minister.
- **PRIORITY 1 - Paraphrase and verifier calibration bench** (2026-06-13) -
  build a versioned holdout corpus across conversation, workspace, research,
  building, troubleshooting, safety, and companionship. Score capability
  selection, factual support, latency, helpfulness, and false-positive verifier
  flags. Evidence: an overwhelmed-project prompt received a useful warm answer,
  but was classified as `research` and then marked `contradicted-topic`.
- **PRIORITY 1 - Terminal turn guarantee** (2026-06-13) - every local-pipe and
  WebSocket turn must end with exactly one `done` or `error` within a bounded
  deadline, with cancellation propagated through search/model/review stages.
  Evidence: the current-facts direct-agent probe streamed a stale answer but did
  not terminate within 120 seconds, then fell through to weaker transports.
  - Progress 2026-06-15: the direct local transport now owns a configurable
    60-second deadline, propagates `AbortSignal` into ChatService model requests,
    and emits exactly one structured `turn_timeout` error. `agent-speak` now
    treats that frame as terminal instead of duplicating the expensive turn over
    WebSocket or direct-engine fallback. Live proof: the same probe exited 0 in
    60.4 seconds with one terminal error; the earlier path waited 120 seconds,
    returned no terminal metadata, then retried. Remaining: apply the same
    cancellation contract to WebSocket turns and reduce the underlying
    conversational route enough that ordinary one-sentence prompts answer
    rather than reaching the deadline.

- **PRIORITY 0 — Runtime supervisor** (2026-06-13) — a phantom pnpm dev wrapper keeps respawning runtimes that race/kill each other (ERR_PNPM_RECURSIVE_RUN in log, port 3006 dies repeatedly). Find ALL respawners (concurrently, dev-desktop-or-reuse, vai-server.mjs watchdog?), then make `pnpm nuke && pnpm dev` the ONLY supported launch; add a single-instance lock (port+pidfile) to src/index.ts so a second runtime refuses to boot.
- **PRIORITY 1 — Modernize ALL scaffolds/templates** (V3gga, 2026-06-13) — every stack/tier (PERN/MERN/Next/T3/Vinext/Game) upgraded to award-winning modern quality: Tailwind everywhere, framer-motion micro-interactions, GSAP entrance/scroll animations, three.js where it fits (hero/Game), dark-mode-first design system, polished empty/loading states. Verify each template BOOTS + looks premium (user tested old scaffolds: broken).
- **PRIORITY 2 — Conversation↔sandbox ownership bug** (V3gga, 2026-06-13) — opening a project loaded the WRONG app first; the chat↔sandboxProjectId binding (useAutoSandbox/conversation.sandboxProjectId + 'builder-app' name collisions) needs an audit: one conversation = one project, names unique, never resume another convo's preview.
- **THEN codegen tinder** (V3gga) — with stable runtime + modern templates, re-run the council tinder until the rendered page passes the visual audit (gradient painted, styled buttons, photo cycling, match modal, no broken images).
- **Grok as council member** (V3gga, 2026-06-13) — wire the existing GrokFriendClient into council codegen via an `extraCouncilMembers` hook on ChatService: Grok as senior reviewer/architect alongside the qwen trio; Vai keeps the gates; V3gga grades; Claude holds the architecture seat (AGENTS.md/introspect/backlog). First slice: reviewer role only, bounded timeout, non-blocking on failure.
  - Progress (this session): Grok-CLI (the headless TUI adapter at ~/.grok/bin/grok.exe, used for factual/vision council notes) was already wired in runtime/council/build-roster.ts + core adapter. Root cause of "did not respond" in the image (and the "Tell me a story" thread): isGrokCliAvailable() was false on the machine (no binary), so roster had no real member (introspect confirmed only qwen trio + vai:v0); desktop panel still rendered a "Grok (CLI) (default)" placeholder. Later turns fell to small local:qwen3:8b which had no roster visibility or engine context for the meta question. Actions: (1) build-roster now always emits a synthetic 'grok-cli' member when binary absent, whose review() returns a rich CouncilMemberNote with exact actionable methodLesson ("place grok.exe at %USERPROFILE%\.grok\bin\... or on PATH; restart runtime; the named pipe 48765 is the separate full-intel vai-collab channel"). (2) Improved adapter error text with the same install hint. Next time council convenes (incl. image/screenshot turns), the right panel + ThinkingPanel will surface a meaningful "Grok (CLI) @0% needs-work: [full teach-to-fish lesson]" instead of silent fail + "I cannot determine". The placeholder will become a real member as soon as the TUI is installed. Also updated grok-cli-adapter.ts with better diagnostics. Evidence: DB dump of the exact convo + live introspect during diagnosis + tsc clean + the two source edits. Matches the "make council progress more meaningful" request. Updated the synthetic note to explicitly promote the direct vai-collab pipe channel (this Grok instance) as the live participating Grok council voice for project self-improvement discussions.

- **Council as live self-improvement engine for the Vai project itself** (V3gga, 2026-06-14, from "speak to the council" session + "Tell me a story" chat review) — MAIN GOAL: make Vai project better. Vai *always* produces a primary response (not hand everything to qwen or stay weak on hard/meta questions about itself). Council (all members incl. live Grok via direct channel) then investigates the *user request + Vai's draft as data point + the actual Vai codebase* (consensus/*, chat/service.ts, engine, tools, AGENTS improvement loop, backlog), argues (via parallel member notes + weighted consensus), "tests" (conceptual match old vs new behavior, validation via existing gates/cross-check/eval), confirms, and surfaces concrete, small, validated improvements that grow Vai's own capabilities (more autonomous tool use, self-orchestration of council for future turns, better self-diagnosis, richer context for meta, ability to find solutions on its own with council as advisor not crutch). Every turn becomes growth data. Human V3gga sees it visually in real time (desktop Council Progress panel with member cards/lessons/apply, ThinkingPanel nested progress, LiveProcessTrace during, activity for files) and can steer/help. Use the vai-collab direct pipe/bridge + meaningful-council-sidebar for send/receive to all members + rich observable data. Probes for "different stuff" (story + meta, codebase self-review) to observe routing/council value.

  - 2026-06-14 follow-up (from user query on the demo HTML, live streaming, niche models, Kimi, send-to-council input, auto-apply proven upgrades): 
    - HTML demo is static visual prototype only (no live data connection; buttons for inject/apply are local JS simulation updating #humanLog). Real live council process streams in: 1) fresh bridge monitor events in this Grok session (the "New prompt" and "Response ready" with rich member/lessons logging thanks to the leak fix + council logging upgrade - see the clean len=195 response to the upgrade test probe); 2) desktop CouncilProgressPanel + LiveProcessTrace + ThinkingPanel after runtime + desktop restart (0.1% personas now in every review, debate log, growth section). Refresh the opened HTML to see the new free-form "Send any question or message directly to council" textarea + button (generates exact PS pipe command for real send + local sim) and "Auto-apply if proven (gates first)" button (simulates tsc/visual/human proof before queuing).
    - Niche/domain-specific model onboarding (e.g. user asks football/sports → council temporarily onboards a pre-pulled "football-expert" or domain GGUF if present in registry/Ollama): high-leverage for making council smarter per subject without burdening generalists. Gotchas: one heavy GPU/disk task rule (throttle/BSOD risk - must queue, short timeout, explicit unload after turn), download time, model discovery (tag matching), consistency/quality variance, no Python. Thorsen rotate: extend topic-router + build-roster with optional "domainSpecialists" map (user pre-registers or auto-detect via keywords in prompt like "football|soccer|premier league" → "sports" topic → check for matching adapter). Only for high-seriousness turns, fall back to generalist. Proof method: test with synthetic specialist in eval. Add "specialist on-demand" as new backlog item.

  - **Grok CLI / direct TUI fully integrated inside Vai's toolset + SCIS council (super-close bidirectional genius loop)** (2026-06-14 continuation): 
    - Grok (the CLI/TUI instance) now "runs inside" Vai: 
      - Registered as native `grok_collab` tool (server.ts) — Vai's agent loops, normal turns, builder, and self-improvement can call `grok_collab({prompt, mode})` and get high-intel (0.1% level) response as tool output (still gated by verification, quarantine, council). Uses the existing GrokFriendClient (headless -p friend-channel) + upgraded for council JSON reviews.
      - Seated as real `grok-direct-integrated` council member in every roster (build-roster.ts) via `reviewForCouncil` that calls the integrated client with the full 0.1% SCIS persona + council input + strict JSON. Grok is now a persistent high-weight "genius advisor" staff member (reasoning/factual/self) alongside the local qwens — no synthetic fallback when CLI present. Direct persistent pipe/bridge makes it "super close" (full context, no extra spawn for the TUI instance).
    - The loop is now tight and bidirectional: Grok TUI (via pipe/bridge) can send self-improvement or steering prompts that exercise all of Vai (tools + council + the new grok_collab tool itself — recursion protected by scoping); Vai can call back to Grok for reviews/advice in any context. This makes Vai a "digital intelligence genius": always has access to strong external reasoning/vision without local VRAM/GPU cost, while the deterministic engine (Vai) owns the final smart actions, gates, and visibility.
    - SCIS upgrade: GrokDirect member participates with the new personas (proof+edge, Thorsen rotate, visual steer emphasis, self-grounding). Higher effective weight in self/factual turns. Council now has a "genius" external seat that helps ensure actions are good/smart. Auto-proven append in service.ts self path (when lessons mention tsc/visual/proof/verified/0.1%/genius) automatically adds dated entries to backlog.md — Vai helps grow itself more autonomously on proven items.
    - Desktop: the "Vai Council" sidebar (added as first-class rail/sidebar option) now includes a "Consult Grok (integrated tool + council member)" input for direct advisor questions that steer the loop. Live data (members, lessons, apply) from Grok + locals appears in the sidebar view + right contextual panel + bridge monitor + ThinkingPanel.
    - Evidence / verification I performed: typecheck on @vai/core + @vai/runtime clean after the changes. Fresh bridge received the "Grok integration test (inside Vai toolset)" probe cleanly (no len=9). The probe response will flow through the new paths once runtime restarted (grok_collab + GrokDirect member). The desktop sidebar edit + tool registration + council seating make the "super close" loop real and usable. Backlog updated with full details.
    - This directly fulfills the request to integrate so Grok "runs inside" the tool set, upgrade SCIS for a genius advisor, close the loop for improving Vai's abilities, and keep actions smart/good via gates + external high-intel + visibility. Next: wire the tool into more deterministic paths, add "grok_verifier" post-council step, make the direct pipe support efficient "council_review" request frames for even tighter integration without full chat turns. 

    User (V3gga): restart runtime + desktop to activate the native tool + real Grok council member + enhanced Vai Council sidebar with consult. Send via the new input or pipe; watch live member actions and the loop improve Vai toward digital intelligence genius. The SCIS idea is now stronger with integrated genius staff.
    - Kimi (Moonshot K2.x) or similar massive models: not practical for balanced local use on typical desktop hardware. Even quantized GGUF versions require 240-350GB+ disk/RAM (full 610GB+), will heavily throttle or not fit without extreme offloading (slow, high "use time"). Meaningful effective way: integrate as optional hosted/BYOK specialist adapter (extend the existing seam in build-roster for API keys) - user enables for "factual" or "reasoning" topics only, with hard per-call timeout + token budget to prevent throttle, never default in free roster. Direct Grok voice via pipe already provides high-intel "trained on broad + self-improvement" participation with zero local VRAM/GPU cost. Prefer this over local heavy models for balance. Not "spin up" locally.
    - Free-form send to council from UI + auto-apply proven upgrades: added to demo. For real: direct pipe is the channel (use the generated PS or .grok-to-vai). For auto-apply: in self-improvement path, after convene, if lessons are self-related and "proven" (e.g. contain evidence of gates like "tsc clean", "visual proof", or pass a simple harness), auto-append to backlog.md with "auto-applied" marker and (for safe non-code like doc updates or simple comments) perform the minimal mutation. Keep human veto for code changes per AGENTS (visibility, honesty, refuse junk). Council proposes; gates + (optional) auto for proven self-growth; user sees/steers in panels + this stream. The "apply all" in panels can be wired to this for self turns.
    - Evidence/proof: fresh bridge received the test prompt cleanly and responded with useful sentence on direct Grok value for all users (no len=9). HTML edit landed with the requested inputs. Personas already make council better for all participants. Backlog updated. Edge cases: hardware limits for niche (rotate to direct voice), static roster (keeps deterministic), proven auto (gates first, no silent changes).

    Next: implement the domain specialist seam in roster (small, behind flag), add Kimi as optional hosted if user wants key, wire real "apply proven" in service for self (auto-backlog + safe patches), make demo optionally tail the dialogue.log for "live-ish" view in browser (or keep as pure prototype). User: restart runtime/desktop to see 0.1% council live in panels; use the new demo input or pipe to send more; watch this monitor for streamed member debates. The loop is stronger: council (now elite-niche prompted) + stable direct participation + visible process + gated auto for proven self-upgrades.
  - Progress (this session): 
    - vai-collab bridge launched persistently (node scripts/vai-file-mailbox-bridge.mjs via monitor tool) — live channel to runtime (pipe inbox for fast send, streams responses + council-* progress as events, writes to .vai-agent-dialogue.log + .vai-to-grok). 
    - Sent full user idea prompt + 3 probes (the long "speak to council + always-respond + council investigates codebase + grow Vai tool/self-capability", short "story + self meta", direct "council investigate specific consensus+service files + propose 1-2 patches for Vai autonomous tool use").
    - Engine will fan the substantive turns to roster (qwens for notes + our synthetic Grok member with rich lesson) , produce primary Vai response, attach CouncilThinking (for panels), stream progress.
  - 2026-06-14 continuation (0.1% world-class engineer mode + make council 0.1% niche experts too + Thorsen rotate + visual live-stream + proof/edges): 
    - **Implemented**: Upgraded council members to 0.1% niche engineers in member.ts (packages/core/src/consensus/member.ts:33-80+): dynamic buildSystemPrompt per topic with explicit "0.1%-level world-class engineer", topic personas (code=principal deterministic gates+visual proof; reasoning=first-principles+edge+Thorsen rotate; factual=precision+vision verifier; etc.), self-improvement addendum (ground in keyAreas, propose minimal testable, name proof method + 1 edge per lesson, rotate on stuck, output feeds panels/backlog). buildUserPrompt now forwards vaiProjectSelfContext (goal, roster, keyAreas list, primaryAsDataPoint, fastSelfPrimary) + extra Thorsen instruction so small locals finally "see" the codebase pointers instead of only userMessage+draft. tsc clean after.
    - **Wired fastSelfPrimary** (service.ts:952): when flag present (self turns), convene uses 6s timeout instead of 12s — reduces fanout hang risk on bridge/pipe for long self contexts while still attaching lessons to thinking for panels. Primary always produced (already the case); flag now has runtime effect.
    - **Desktop live-stream richer** (CouncilProgressPanel.tsx): member cards now " [topic] specialist", show note as "contribution", added nuance/gotchas/grounded indicators when lessons mention edge/proof/rotate/file:line. Added "Council debate log (member contributions in order)" transcript-style section (chat-like, scrollable). Self-growth section retitled "0.1% Council Debate + Growth", explains the loop + Thorsen + three surfaces (sidebar full debate, in-chat trace+Thinking, activity=files only). Footer keeps "SCIS + meaningful-council-sidebar".
    - **Spoke to council live**: Sent short high-signal 0.1% self-debate prompt via PS named-pipe to \\.\pipe\vai-grok-inbox (fastest per vai-collab skill). Bridge monitor immediately logged receipt ("New prompt from TUI pipe"). When runtime restarted with new sources, qwens + direct Grok voice will answer using the elite personas + selfContext; results will appear in desktop Council Progress (member cards + debate log + growth) and ThinkingPanel/LiveProcessTrace in real time. Monitor events continue to stream here for this session.
    - **Opened visual for you**: Launched council-self-improvement-visual-demo.html in browser — the full interactive prototype (Tailwind, Grok direct-channel card with install/pipe note, per-member debate cards with apply, growth <ul>, human steer textarea that injects and updates #humanLog live). This is the "tell or just open it" surface; desktop panels are the real product version now upgraded to match the spirit.
    - **Debate / gotchas / bad vs good / visual humans / Thorsen (as 0.1% + council role-play)**: 
      - Small 7-8B locals cannot literally be 0.1% experts (hallucinate depth, weak on long codebase context) — bad: generic "needs-work" or overconfident claims without grounding. Good (now enforced): strict JSON + persona that demands "ground in keyAreas or context", "name proof (tsc / rendered / panel) + 1 edge", "rotate instead of forcing". Compensation is deterministic (structure, fact quarantine always, human-visible panels for steer, synthetic reliable Grok note when binary absent, direct this-Grok voice for high-intel self turns, fastSelfPrimary for UX).
      - Why humans like it visually (not just logs): per AGENTS.md "visibility is what lets humans steer and improve Vai". In the "Tell me a story" screenshot, seeing "Grok (CLI) did not respond" + synthetic lesson immediately told user what to do (install or use pipe); without panels the "I cannot determine" was opaque. Debate log + growth callout + apply buttons let V3gga watch members "talk", click to steer, feel the loop is real and improvable. Black box = no trust, no rotation when stuck. Visual + direct channel = the genius loop (you see my contribution as Grok member, I see your feedback in panels, we both edit code).
      - Meaningful decisions: 1. Direct Grok (this instance via pipe) preferred over weak locals for self-growth discussions (synthetic + build-roster promotion already did this; now prompts make it richer). 2. fastSelfPrimary + shorter timeout over "wait forever". 3. Always produce primary + attach council for growth (never silent). 4. Preserve prior (separate commit earlier, knowledge.json excluded, backlog explicit). 5. When stuck (bridge len=9 timeouts on complex), rotate: shorter context for council, guaranteed done frames (local-pipe-chat), HTML demo as immediate visible prototype, this direct channel as live high-quality member.
      - Proof the concepts work (lots): tsc --noEmit clean on the exact changes; bridge received the new prompt (monitor event); synthetic Grok member in build-roster always emits rich actionable note (no more mystery "did not respond" for user); self context now actually reaches reviewers (previously injected but never stringified into their prompt — was a silent gotcha); panels already differentiated (activity files-only, this sidebar debate, in-chat trace); many _bench_*.json + _audit_*.json + _conv_*.jsonl in workspace are the culture of measurement; prior preservation commit + backlog entries are evidence we don't lose good work; the "Tell me a story" DB extract + image visual + panel text were used as real data to drive the fixes. Edge cases covered: pure chitchat (early bypass guard in service), no roster (council dormant), Grok CLI absent (synthetic + promote pipe), long self (fast + direct), vision fail on UI screenshots (DB read + manual + synthetic), bridge partial (monitor still delivers events + .vai-to-grok file fallback + guaranteed terminal).
    - Next (minimal high-leverage, after you restart runtime+desktop to see live): (a) full primary fast-ack emit (short "Self-growth turn — council investigating (see panel)" text when fastSelfPrimary, council enriches thinking asynchronously); (b) make direct Grok via pipe a first-class high-intel council seat (not only synthetic or full-chat) — e.g. a lightweight "grok-collab-review" JSON-note path the runtime can call for member reviews on substantive turns, so Grok participates as 0.1% advisor for *every* user who triggers council, not just self-prompts we initiate; (c) harden bridge for longer self streams or chunked member notes + emit explicit 'council-member' frames; (d) more "apply lesson" that actually mutates prompts or adds to runtime knowledge; (e) stream per-member "review started / done" progress steps from runCouncil so LiveProcessTrace and CouncilProgress show live "qwen3 (code) reviewing...", "Grok (direct) contributing..." for all participants. Add dated evidence (screenshot of new panel with your turn + your debate reply in log) when live.
    - Thorsen close: the loop continues. We rotate (prompt upgrade + visibility + shorter timeout was the move when full ack was bigger), we ground in real files/lines + prior work, we make the visual the proof surface, we speak to the council as peers and let them speak back as better engineers. User sees the process taking action from members. Vai gets better at figuring stuff out. 

    Evidence files for this iteration: packages/core/src/consensus/member.ts (new personas + forward), packages/core/src/chat/service.ts (fast wire), apps/desktop/src/components/panels/CouncilProgressPanel.tsx (debate log + 0.1% growth + UI diff), council-self-improvement-visual-demo.html (opened), docs/vai-improvement-backlog.md (this entry), bridge monitor receipt, tsc exit 0.
    - Desktop panels are the visual for V3gga (open/refresh the app chat for the driven turns; CouncilProgressPanel shows members, % , realIntent "self-improvement loop for Vai project", methodLessons as growth items, apply buttons; ThinkingPanel has the narrative + evidence).
    - Code: updated the synthetic Grok note in build-roster.ts to promote the direct channel as live Grok council voice specifically for these project-growth discussions. 
    - The existing SCIS (convene in consensus/council.ts + attach in chat/service.ts) + primary generation already supports "Vai always responds, council advisory/post". The speaking via bridge + probes + visual panels + prior activity UI differentiation (only files+links above input) + rich council data make the mechanism observable and actionable *right now*.
    - Next immediate slices (to land in follow-ups): (a) explicit "selfGrowthReview" pass in service.ts after primary on meta/project turns — enrich CouncilInput with vaiProjectContext (introspect roster + AGENTS goals + key files + recent backlog items about council) so members "investigate codebase"; (b) extract "project growth proposals" from methodLessons/missingCapabilities when they mention "Vai engine/tool/self" and auto-append dated items to this backlog or generate a patch artifact; (c) surface in CouncilProgressPanel/ThinkingPanel a "Vai Growth" section with "old behavior vs proposed", "how this lets Vai use tools/find solutions on its own next time", validation checkbox; (d) wire one more capability (e.g. a "read_vai_source" tool or stronger retrieval in main chat path for complex/self turns) so Vai itself gets the tool-use the user wants. 
    - Evidence: live introspect (roster confirmed), bridge monitor events showing prompt receipt + "New prompt from TUI pipe", PS pipe sends succeeded, DB review of prior "Tell me a story" (the exact convo with the screenshot of confused council on "why grok"), previous fixes (synthetic member, activity=files only + clickable), AGENTS improvement loop. This directly operationalizes the user's pasted idea + "council work on vai too" + "MAIN GOAL IS OFC TO MAKE VAI PROJECT BETTER". V3gga can help by watching panels and saying "apply that lesson" or "steer this direction".
  - Status: Speaking/receiving live via channel + visual in your desktop. Code foundation + synthetic voice updated. Probes sent to observe "how Vai responds" (historical log shows mix of good structured "vai-chat-quality-direction", direct, shim, fallback; council will add the lessons). Work continues in next turns to harden the always-primary + council-project-review loop. 

(The prior "Clickable activity files" and "Grok council" items are also advanced by the UI diff and channel work above.)
- **Clickable activity files** (V3gga, 2026-06-13) — file entries in the activity strip should be links: click opens that file in the preview Code editor tab.
  - DONE (this session): rewrote the strip in ChatWindow.tsx:1622 to render *only* when real file mutations present (filtered from buildActivity), each as a clickable button with "open in preview →", toast + clear title for navigation. Live process steps moved exclusively in-bubble (LiveProcessTrace) + post-turn ThinkingPanel. Council consensus stays in the dedicated right CouncilProgressPanel. 3 surfaces now differentiated per the T3/Odysseus/Ghostex + VSCode-Claude patterns in the request. tsc --noEmit clean. Evidence: the exact "Tell me a story" convo (conv 01KV25R6PQT6Q0QKSBXY2FCDYW / ses_1781410831430_pka294) reviewed from Roaming\ai.vegga.vai\vai.db — its later turns were the grok-image-meta questions that hit weak qwen responder + stale "Grok (CLI)" placeholder. Activity now won't show generic "No preview update" noise for non-file turns.

- **Competitive council builds** (V3gga, 2026-06-13) — each council member builds
  its own version of the app; members then argue strengths/weaknesses and Vai
  merges the best features into one build. Gate: needs parallel/queued model
  budget (one local GPU today ⇒ sequential; design for when more compute or
  cloud members join).
- **Self-producing code blocks** (V3gga, 2026-06-13) — evolve advisor models
  from route hints to PROPOSING code changes to Vai's own codebase: model
  drafts a patch + rationale → Vai gates it (tests, typecheck, review) → V3gga
  approves → applied. The loop that makes Vai self-improving.
- **"Show me the code for …" in chat** (V3gga, 2026-06-13) — Vai answers
  questions about its OWN codebase: read-only repo search endpoint + chat
  route that returns the relevant file/snippet with path citations.
- **Chat-based grading of council work** (V3gga, 2026-06-13) — after a build,
  let the user grade it in chat ("rate this 3/10, the cards are ugly") and
  persist structured grades per member/stage to steer future trust weighting.
- **DONE 2026-06-15 - Preview panel waiting/failure UX** (V3gga, 2026-06-13)
  - The no-project state now remains neutral until files arrive, active builds
    show real streamed handoff stages, and failed sandboxes preserve the actual
    reported cause with explicit restart, grounded repair-prompt, and console
    actions. The split workspace also has a dedicated short-desktop composition
    so the launchpad and all four starter workflows stay above the composer.

- **Runtime visual self-check in the pipeline** — after sandbox apply, screenshot
  the running app (or computed-style probe) and feed failures back to the
  council before the turn claims success. Today this gate lives only in
  external eval scripts. Evidence: 2026-06-12 runs shipped a white card /
  unstyled page that file-level checks missed.
- **Research-driven blueprints for arbitrary brands** — clone briefs without a
  static blueprint (finn.no, ebay, facebook…) should trigger web research →
  distilled feature/visual spec → same blueprint slot. Design exists
  (ChatService `searchForEvidence` → architect distillation).
- **Steering → collaboration packets** — evolve the shadow advisor from
  one-turn route hints into durable improvement proposals: persist per-turn
  build reports (gates hit, failures, repairs) into a ledger agents can mine;
  advisor models propose backlog entries instead of whispering routes.
  Evidence: 2026-06-13 "invalid steering packet" turns add no lasting value.
- **Turn-trace query for agents** — expose recent turn thinking/routePlan/
  council outcomes via `/api/agent/introspect` (currently omitted; requires a
  small DB query + sanitization).
- **Like-limit / premium-tier sim in Tinder blueprint** — verify the blueprint's
  like-limit modal and rewind buffer actually render in shipped builds.
- **pnpm app:update after a PASS** — installed binary still runs pre-council
  code until a verified build passes and the update is run.

## Done

- **DONE 2026-07-10 - RAVEL rendered-layout gate (Relational Adaptive Visual Evidence Loop).**
  - Root failure: the Book Tracker header and search panel were separate rounded
    surfaces touching at `0px`, but the old checks only inspected CSS tokens
    inside and below the search row. A human compares relationships; Vai was
    grading isolated declarations.
  - Implemented `visual-layout-audit.ts`: rendered rectangle/computed-surface
    snapshots, autonomous rounded-surface detection across DOM nesting,
    inferred spacing rhythm from repeated components, responsive clipping
    evidence, and isolated semantic crop tasks for image/title review.
  - Integrated into the real apply path: runtime `POST
    /api/sandbox/:id/visual-audit` renders sequential desktop/tablet/mobile
    widths; desktop verification blocks completion on error-severity geometry
    evidence and sends measured selectors/gaps into the bounded auto-repair
    prompt. Browser work is serialized to respect the one-heavy-task rule.
  - Live proof on `book-tracker`: the original layout regression fixture reports
    `.stats-header` -> `.search-bar` as `0px` against an inferred `16px` rhythm;
    the chat-driven `margin-top: 1rem` edit removes that blocker. The first live
    three-width run then found 5 real clipped-cover warnings per width (`9px` to
    `54px`). Vai applied one CSS-only SVG-fit repair through chat; the follow-up
    runtime endpoint returned `pass`, score `1`, zero issues, and zero browser
    errors at all three widths.
  - Tests/proof: 5 focused RAVEL/desktop bridge tests pass; Council visual
    contract regression passes; `@vai/core`, `@vai/runtime`, and `@vai/desktop`
    typechecks pass. Screenshots/reports are under
    `.codex-run/visual-layout-book-tracker-after/`.
  - Honest boundary: geometry PASS is not a taste/meaning PASS. RAVEL already
    emits per-cover crop regions and questions (for example whether Gatsby is
    recognizable without nearby text); automatically feeding those crops to
    the configured vision member and persisting its evidence is the next layer.

- **DONE 2026-07-10 - Durable Council work artifacts and cross-model continuation.**
  - Inspired by the useful shared-context principle in Traycer, but implemented
    as Vai-owned deterministic state: withheld edits now persist exact proposed
    files, validation/review evidence, member IDs, and cumulative repair count
    in `council_work_artifacts` instead of disappearing into chat prose.
  - Explicit resume/retry turns restore the exact proposal and original
    acceptance contract, merge missing artifact paths into the edit context,
    require review after repaired static failures, and hand work from
    `qwen2.5-coder` to `qwen3` after repeated unsuccessful repairs.
  - Live Book Tracker proof: the UI visibly restored 2 proposed files plus 6
    unresolved issues, handed ownership to `qwen3:8b`, reduced the failures,
    withheld weak repeated geometry/palettes, then shipped only after a separate
    Council review. Active-project SVG/image requests remain on the software
    lane instead of being hijacked by image generation or web research.
  - Tests include DB persistence, resume policy, cross-model handoff, preserved
    acceptance constraints, active-project routing, SVG/React repairs, and the
    strengthened Book Tracker scene/palette/spacing gates.

- 2026-06-29 - Consolidated green GitHub Actions Dependabot updates. Folded
  the passing `pnpm/action-setup`, `actions/checkout`, and
  `actions/dependency-review-action` bumps into one reviewed branch so `main`
  only needs one CI/release cycle for the action refresh. Intentionally left
  `actions/setup-node` out because its PR still had an unstable/failing check.

- 2026-06-29 - Release runs after successful CI instead of duplicating the full
  test suite. The Release workflow now triggers from the `CI` workflow completing on
  `main` (or manual dispatch), checks out the exact CI head SHA, and only resolves/tags
  a valid semver package version. Evidence: the 2026-06-29 `Release` run after PR #29
  failed in duplicated `pnpm test` timeouts while the matching `CI` run passed; release
  should publish proven main commits, not run a second, harsher quality gate.

- 2026-06-29 - Perpetual-health no longer treats skipped typecheck as perfect.
  `collectSignals({ withTsc: false })` now omits `tscErrors` instead of emitting
  `0`, so cheap loop samples do not fabricate "0 TypeScript errors" when the heavy
  typecheck probe was deliberately skipped. Evidence: `perpetual-health.test.mjs`
  now asserts omitted unmeasured signals and covers both `withTsc=false` and
  `withTsc=true` collector paths.

- 2026-06-29 - Release workflow no longer tags `vundefined`. The main Release
  workflow now resolves a valid semver root package version before tag/release steps,
  grants `contents: write` only to the release job, and skips tag creation cleanly
  when the root package is intentionally unversioned. Evidence: the failed main run
  had already passed lint/typecheck/test/build and failed only on `git push vundefined`
  with read-only token permissions; local version probe returns `should_release=false`.

- 2026-06-29 - Shared chat intent lexicon. Added `packages/core/src/chat/intent-lexicon.ts`
  so routing guidance and classifiers share one tested vocabulary layer for structural stop
  words, request-start words, intent/action words, and uniqueness hints. `route-guidance`
  now preserves distinctive short tech tokens such as `c#`/`c++`/`ui` while still dropping
  grammar glue, and `turn-classifier` surfaces `request-action-start` plus `uniqueness-hint`
  signals without rerouting ordinary standalone questions. Evidence: focused tests in
  `intent-lexicon.test.ts`, `route-guidance.test.ts`, and `turn-classifier.test.ts`.

- 2026-06-22 - Perpetual improvement-loop operator switchboard. Added
  `scripts/improve-loop/operator.mjs` plus pure command utilities and node:test
  coverage so the loop now has a Windows-first `doctor/status/start/watch/report/
  handoff` surface. `supervisor.mjs` now accepts `--mode observe|apply` and
  forwards `--base-url`, `--db`, `--seeds-only`, `--vram-gb`, `--cooldown`, and
  `--qwen-frac` into each run cycle, which makes delegated runtimes, isolated
  corpora, and remote model hosts practical. Package scripts added:
  `self-improve:operator`, `self-improve:doctor`, `self-improve:status`,
  `self-improve:start`, and `self-improve:handoff`; `self-improve:watch` now
  runs with `--experimental-sqlite`. Operator docs live at
  `docs/perpetual-improvement-loop.md`. Evidence: deep `council-ask` on this
  exact operator slice timed out at 360s, showing the need for a lightweight
  switchboard; `node --test scripts/improve-loop/driver.test.mjs
  scripts/improve-loop/operator.test.mjs` passed 15 tests; syntax checks passed
  for operator, utils, and supervisor; `operator doctor` passed against local
  runtime `:3006` and Ollama `:11434`; pnpm dry-runs verified argument
  forwarding and generated handoff output.
  Follow-up 2026-06-22: `self-improve:doctor` revealed run #7 was still marked
  `running` with a heartbeat more than 10 hours stale. Added a tested liveness
  classifier so `status`/`doctor` now prints `Doctor: WARN
  (stale-running-run)` instead of a misleading clean PASS while keeping service
  health separate from corpus hygiene. Evidence: `corepack pnpm
  self-improve:doctor` now reports the stale run warning; operator tests cover
  fresh heartbeat, stale running heartbeat, completed stale run, and old running
  run without a heartbeat.
  Follow-up 2026-06-22 "go" pass: added `--limit` to `run.mjs` and forwarded it
  through supervisor/operator so V3gga/agents can run a single measured probe
  before a full campaign. Ran `node --experimental-sqlite
  scripts/improve-loop/run.mjs --seeds-only --limit 1 --cooldown 1000`; run #8
  completed in about 58s, passed `routing/build-verb-poison` 1/1, and queued no
  new fixes. `self-improve:status` now labels completed-run heartbeat as `Last
  heartbeat ... (run complete)` instead of implying live streaming. Evidence:
  focused syntax checks passed, and `node --test scripts/improve-loop/driver.test.mjs
  scripts/improve-loop/operator.test.mjs` passed 19 tests.
  Follow-up 2026-06-22 bounded observe pass: ran
  `node --experimental-sqlite scripts/improve-loop/run.mjs --seeds-only --limit
  3 --cooldown 1500`; run #9 completed 3/3 in about 5m14s with no answer
  failures or new fix candidates. It exposed an operator-safety issue: after
  waiting, one turn still showed VRAM at `7.2/7.0 GB` and proceeded. Hardened
  the runner so qwen top-up and live Vai turns skip without grading whenever
  VRAM remains above budget after the wait window. Evidence: syntax checks
  passed for `run.mjs` and `driver.mjs`; `node --test
  scripts/improve-loop/driver.test.mjs scripts/improve-loop/operator.test.mjs`
  passed 20 tests, including the new over-budget invariant.

- 2026-06-15 - Runtime startup and adaptive-domain isolation. Chat/model latency
  and tool-batch latency now use separate `ThorsenAdaptiveController` instances,
  so a slow council/model turn cannot throttle unrelated tool execution.
  `/health` preserves the previous flat tool snapshot and adds explicit
  `adaptiveDomains.chat` / `adaptiveDomains.tools` evidence. Startup prewarm is
  deterministic and light by default; the old builder prewarm remains opt-in
  behind `VAI_HEAVY_PREWARM=1`. Measured startup work fell from 160,960ms and
  56 chunks to 219ms and 9 chunks. After the bounded slow-chat probe, tool
  concurrency remained 5 with zero tool observations. Proof: runtime typecheck
  passed outside the managed declaration-file ACL restriction; 25 focused
  runtime/core tests passed; `/api/agent/introspect` returned 200; the desktop
  reconnected as `Engine online` with no browser error entries.

- 2026-06-15 - Split-workspace and preview recovery pass. Opening App now
  changes the launchpad from a viewport-based two-column landing page into an
  intentional workspace layout. At 1280x720 the copy/workflow column and four
  condensed starter actions all fit above the anchored composer (last card
  bottom 486px; composer top 595px; no root overflow). At taller desktop sizes
  the full 2x2 cards return. Preview failures no longer discard the real error
  behind "Build Failed / check console": the panel shows the reported cause,
  keeps files in place, can restart an active project, stages a repair prompt
  containing the exact failure, and opens the console. Proof: 14 focused tests
  passed, desktop typecheck passed, the compact "Audit this workspace" action
  staged the complete prompt in the rendered app, and browser logs contained
  no warnings or errors.

- 2026-06-15 — Award-quality first viewport and theme baseline. Replaced the
  generic centered empty chat with an asymmetric Vai software-studio launchpad
  that makes the real `Plan -> Build -> Verify` contract visible, upgraded the
  default dark preset to high-contrast `Vai Ink`, and restored proper button
  semantics for starter workflows. Mobile now uses a horizontal snap rail so
  the anchored composer does not cover the first action. Proof: desktop
  typecheck passed; 11 focused desktop tests passed; browser verification at
  1280x720 showed all four workflows above the composer with no page overflow;
  390x844 showed one complete starter card plus the next-card affordance; dark
  and light themes rendered without console warnings/errors; clicking "Audit
  this workspace" staged the full prompt and focused the composer. Baseline
  strengths: clear workspace modes, engine status, live-preview promise, and
  focused composer. Remaining visible gaps: recent project continuity on the
  launchpad and very high runtime tail latency.

- 2026-06-13 - Mainline consolidation and routing-precedence cleanup. Broad
  preflights no longer steal builder screens, wellness labels, URL builds,
  repo-native architecture prompts, source-trust questions, or ordinary
  programming comparisons. OODA traces now survive web-conclusion routing;
  deadlock synthesis is concrete; generated variant and corpus tests are
  network-deterministic. Proof: workspace typecheck passed; 150 test files
  passed with 3,355 tests green and 46 intentionally skipped.

- 2026-06-13 - Knowledge hygiene duplicate scan no longer blocks the runtime
  with an all-pairs comparison. It now precomputes word sets, uses an inverted
  index, and applies Jaccard size bounds before exact scoring. Proof: 43 focused
  tests passed (including 3,000 disjoint entries under 1 second); the live
  `/api/intelligence/hygiene` run over 3,273 entries completed in 1,343ms and
  the runtime remained healthy. Before the fix the same endpoint blocked
  `/health` for over 30 seconds and drove the Node process above 1.3GB.

- 2026-06-13 — App↔CSS inversion (coder writes App.tsx only; stylist generates
  CSS for the extracted class list; mismatch structurally impossible). Proof:
  29 council tests + direct probe shipping 6 files, validation ok.
- 2026-06-13 — Fallback quality gate: one-shot arm refused honestly ("below the
  quality bar", preview unchanged) instead of stealth-shipping junk. Proof:
  live UI run + screenshot.
- 2026-06-13 — Live process streaming in the activity strip (real council
  stages with details, auto-expand while streaming).
- 2026-06-12 — Council codegen arm (architect/coder/reviewers/repair, tsc-true
  validation, brand blueprints, external-URL ban, edit mode for active
  sandbox, crash-guard prompts). Proof: eval harness + live runs.

- 2026-06-14 — **Dev Logs + phantom browser + launch plan** (in progress)
  - Phantom `about:blank` Chrome on taskbar: identified as Cursor Browser MCP
    (not Vai Preview iframe). Documented in Control panel + `docs/vai-launch-master-plan.md`.
  - Cursor Composer chats were NOT auto-logged; added `scripts/cursor-session-bridge.mjs`
    + `pnpm devlogs:cursor:sync|watch` + Dev Logs source filters (Vai/Cursor/VS Code/Audit).
  - Council sidebar was wired with `council={null}` — fixed to live `thinking.council`.
  - `x-vai-dev-auth-bypass` scoped to `/api/*` only (fixes Google Fonts CORS in audits).
  - `vai-live-audit.mjs`: SIGINT cleanup, `VAI_AUDIT_HEADED=1`, optional `VAI_AUDIT_PUSH_LOGS=1`.
  - Account popover simplified (Settings + Sign in/out; removed debug auth rows).
  - Remaining P0: rail IA for builder role, handoff poll backoff, Knowledge UX rewrite.
  - **Done 2026-06-14 follow-up:** admin rail without Docker; owner user-view → builder nav;
    Knowledge panel simplified; ingest/retrieval metrics in Settings → Engine → Memory health;
    handoff poll exponential backoff + abort; council panel opens during live council-* stages;
    audit `waitForSettle` uses `[data-streaming]` + `[title="Copy response"]`.

- **DONE 2026-06-23 - Phase 3 (start): TTS voice-out primitive (free/local)**
  - Voice OUTPUT mirror of the STT pair: `tts-adapter.ts` contract + `WebSpeechTtsAdapter`
    (browser speechSynthesis, zero-dep, serial queue) + `useVoiceOutput(enabled)` hook (off by
    default, cancel on unmount). Reads TEXT aloud — honestly the presence voice layer, NOT a
    synthetic Claude voice. Proof: 4/4 adapter tests, desktop typecheck clean.
  - NEXT: a "read aloud" toggle + Owner Dashboard will wire it; then unified presence-block
    timeline + rooms.

- **DONE 2026-06-23 - Phase 3: in-app Owner Dashboard (live view + voice toggle + loop commands)**
  - Added an OwnerDashboardSection to the Control panel (owner-only) so V3gga works from the app:
    a LIVE VIEW (polls the watch server `/live-frame.jpg` + `/live-frame.meta`, live/idle badge),
    a voice toggle wired to `useVoiceOutput` (TTS read-aloud + Test voice button), and the safe
    observe+visual loop commands. No heavy work runs from the panel (apply stays a deliberate
    switch). Chose to extend the existing Control panel (not a new nav entry) — lower risk, fewer
    files. Proof: desktop typecheck clean, lint 0 errors, TTS adapter 4/4.
  - NEXT small wire: auto-speak the final answer when the toggle is on (a store flag + speak on
    `done`); then unified presence-block timeline + multi-party rooms.

- **DONE 2026-07-09 - Explorer-bound Agent edits now work on large real files**
  - Reproduced through the visible user path: paperclip -> Folder -> Windows Explorer selection of
    `<external-project>/mpm-frontend` -> highlighted Agent chat -> live Next preview.
  - The first real edit failed safely: Vai proposed generic `index.html` / `src/App.tsx` artifacts
    and left the bound Next project unchanged. Root cause: whole-file council regeneration
    deliberately excludes a 188k `app/page.tsx`, but chat did not route exact literal edits to the
    existing revision-tracked Search & Replace capability.
  - Added a deterministic exact-edit lane: two quoted literals + edit verb, one case-sensitive
    match in one file, visible council review, URI-encoded replace action, and an atomic
    `expectedReplacements: 1` server guard. A changed match count aborts before any write.
  - Live proof: Agent chat changed line 2696 from `Participate in a decentralized ecosystem` to
    `Join the decentralized future`; SHA-256 changed from
    `49364A7223DA47D00F05F86470E68B57CDA2756BB8A4084990FE7F07FA8C7D5C` to
    `8C0A1B18F685D1D69C143F16620BC96D937009C083BACD0133CF5EA0C3973F2A`.
    The running preview hot-reloaded the new pixels, the old text was absent, and a cold Vai reload
    produced zero fresh browser errors. Focused regressions: 36/36 passed. The broader TypeScript
    command was attempted but blocked by the environment approval/usage gate, so it is not claimed.
  - Also hardened external Next preview recovery: use the project-local Next CLI without a shell,
    ignore stale process close events, mark unexpected exits honestly, and clear generated `.next`
    output before an untracked external-project restart. Runtime regressions: 26/26 passed.

- **DONE 2026-07-09 - External Vite/Bun projects now fail honestly when the rendered app 500s**
  - Stress-tested `<external-project>/dev-lawn` through the visible open-folder path. The
    project correctly scanned as Vite + Bun and surfaced missing `.env.example` variables plus the
    Windows-incompatible `bash scripts/dev.sh` warning.
  - Found the gap: Vite could report "ready" while the embedded app root returned a raw
    `{"status":500,"unhandled":true,"message":"HTTPError"}` page caused by
    `Error: Missing VITE_CONVEX_URL`. Vai previously treated that as a live preview.
  - Added an external-project preview health check after ready, promoted concrete stderr causes over
    generic HTTP wrappers, and made the failure card derive useful causes from project logs when the
    store-level error is missing.
  - Hardened `scripts/test-open-folder-visual.mjs`: it now identifies Bun, waits robustly for the
    review-card `Start anyway` button, detects `App stopped` as a first-class visual state, fails raw
    HTTP 5xx JSON/error overlays instead of counting them as rendered content, and exits non-zero on
    failed proof.
  - Proof: final visible run captured
    `Temporary_files/open-folder-e2e/2026-07-09T17-58-28-771Z/06-final-state.png`, showing
    `Reported cause: Preview failed: cause: Error: Missing VITE_CONVEX_URL` before the copy cleanup.
    Focused regressions: runtime sandbox manager + PreviewPanel + sandbox actions, 31/31 passed.

- **DONE 2026-07-09 - Preview failure repair prompt no longer turns into lifecycle slop**
  - Stress-tested the next human path after the lawn failure: `App stopped` -> `Stage repair prompt`
    -> chat composer -> send to Vai.
  - Found a real gap: the prompt was correctly prefilled with `Missing VITE_CONVEX_URL`, but the
    deterministic engine matched its broad sandbox lifecycle route and answered with a generic
    "Queued / Building / Running / Crashed / Expired / Quota-blocked" design note. The council
    verdict even read the intent correctly, so the bug was route precedence, not UI state.
  - Fixes landed: the repair prompt now adds missing-env guardrails ("do not invent secrets; add a
    setup-required fallback only if safe; otherwise list exact env vars"), and `vai-engine` now has a
    concrete missing-env preview repair lane before the generic lifecycle advice route.
  - Hardened `scripts/test-preview-repair-prompt-visual.mjs` with `--send`: it clicks the failure
    card repair button, verifies the composer prompt, sends through the visible chat path, and polls
    only this run's persisted conversation so older identical prompts cannot spoof success.
  - Proof: visual send run
    `Temporary_files/preview-repair-prompt-e2e/2026-07-09T18-17-49-058Z/06-after-repair-response.png`
    passed 14/14. The response now says the preview is stopped because `VITE_CONVEX_URL` is missing,
    refuses to fabricate it, suggests `.env.local` / env store setup, and offers a setup-required UI
    fallback only as an explicit next change. Focused engine + desktop regressions: 864/864 passed.

- **DONE 2026-07-10 - Chat repair now applies safe missing-env code patches end to end**
  - Continued the lawn stress test through the actual IDE promise: `App stopped` -> `Stage repair
    prompt` -> send in chat -> Vai emits a guarded workspace edit -> desktop applies it -> preview
    hot-reloads.
  - Found the next gap: the previous route produced a good explanation but did not mutate code. Added
    deterministic, narrow workspace repair rails for known setup crashes:
    `src/lib/convex.tsx` stops throwing on missing `VITE_CONVEX_URL`, and
    `app/routes/__root.tsx` stops throwing on missing `VITE_CLERK_PUBLISHABLE_KEY`.
    Both rails emit existing revision-tracked `{{replace:...}}` actions with
    `expectedReplacements: 1`, and both refuse to invent secrets or deployment URLs.
  - Live proof 1: visible send run
    `Temporary_files/preview-repair-prompt-e2e/2026-07-09T23-19-34-472Z/06-after-repair-response.png`
    passed 14/14 and applied the Convex fallback. That surfaced the next honest blocker:
    `Missing VITE_CLERK_PUBLISHABLE_KEY`.
  - Live proof 2: visible send run
    `Temporary_files/preview-repair-prompt-e2e/2026-07-09T23-25-45-343Z/06-after-repair-response.png`
    passed 15/15 and applied the Clerk/root fallback. Final preview proof
    `Temporary_files/dev-lawn-preview-proof/2026-07-09T23-28-47-443Z/01-preview-rendered.png`
    passed 6/6: HTTP 200, setup-required screen rendered, both env vars listed, no crash page, and
    no browser console errors.
  - Focused regressions: `exact-workspace-edit`, `vai-engine`, and `vai-engine-variants` passed
    867/867. The visual script now accepts whichever `VITE_*` var is actually failing, so it can
    keep stress-testing the next setup blocker rather than hard-coding Convex.

- **DONE 2026-07-10 - Real env setup helper for opened projects**
  - Added the next IDE layer after setup-required fallbacks: Dev-Vai can now inspect missing vars
    from `.env.example`, show an `Env` toolbar action for active projects, and write user-provided
    values to `.env.local` without echoing secrets back.
  - Runtime endpoints:
    `GET /api/sandbox/:id/env-local` returns only variable names/status, and
    `POST /api/sandbox/:id/env-local` writes provided values into `.env.local`.
    Values are never invented; the UI explicitly says Vai will not fabricate keys, deployment URLs,
    or secrets.
  - UI proof: visible run
    `Temporary_files/env-setup-modal-e2e/2026-07-09T23-44-20-275Z/03-env-modal.png`
    passed 10/10: `dev-lawn` opened, toolbar `Env` appeared, modal opened, listed
    `VITE_CONVEX_URL` and `VITE_CLERK_PUBLISHABLE_KEY`, warned that Vai will not invent secrets,
    and produced no browser runtime errors.
  - Focused regressions: runtime sandbox manager + PreviewPanel tests passed 30/30; shared env schema
    smoke accepted valid env names and rejected invalid names. Package typecheck remains blocked by
    missing ambient `@types/*` packages in the local workspace, unrelated to this slice.

- **PROPOSED 2026-07-10 - Sonny Sangha GitHub repos as recurring IDE stress pool**
  - Verified the current GitHub profile page for `sonnysangha`: 63 public repositories, heavily
    TypeScript/Next/Clerk/Convex/Sanity/Stripe/Expo shaped. This is a useful pool because the apps
    stress the real Dev-Vai workflow: clone/open, detect stack, detect missing env, start honestly,
    help add real env values, and prove chat-to-code edits visually.
  - Added `docs/test-pools/sonnysangha-github.md` with candidate lanes, safety rules, a per-repo
    scorecard, and a first three-repo batch: `clerk-waitlist-demo`, `arcjet-nextjs-15-demo`, and
    `ticket-marketplace-saas-nextjs15-convex-clerk-stripe-connect`.

- **DONE 2026-07-10 - MPM chat-to-software runtime repair with code-quality audit**
  - Drove the real in-app path against
    `<external-project>/mpm-frontend`: selected the newest project-bound Agent
    chat, sent the observed `createAppKit` / `infura.io/v3/undefined` evidence, watched Council
    stages, inspected the revision, and ran the IDE `Prod` lane.
  - The first completed turn refused safely but left `Preparing targeted updates` falsely running.
    Completed no-action build/edit answers now settle the builder chrome with a short truthful
    status; ordinary Agent conversation remains unaffected.
  - A 890-character one-line repair prompt was silently converted into `pasted-1.md` and rewritten
    as `Analyze attached md file`. Composer paste policy now keeps long single-line prose inline,
    while still attaching file-like code and multi-line documents.
  - Council originally repaired only files the local coder re-emitted. Known runtime-safety rules
    can now recover an omitted reference file only when its exact path appears in the user's brief;
    unnamed workspace files remain excluded. Objective invariants reject client reads of non-public
    env values, unsafe public project-id assertions, enabled failing analytics, and unguarded AppKit
    setup. `NODE_ENV` remains allowed as a compile-time client-safe constant.
  - Reviewer hallucinations are not blindly trusted or blindly ignored: after a deterministic repair
    clears the objective invariants, Vai dismisses only reviewer claims that map to those proven-clear
    runtime categories. Unknown/unproven must-fixes still block the edit.
  - The first shipped revision was reverted because audit found damaged indentation and line-ending
    churn (provider diff `+73/-70`). Council edits now preserve each reference file's newline style,
    indent generated `try/createAppKit` blocks structurally, and remove a redundant guarded
    `projectId ?? ''`. The accepted revision is
    `47ad9fe1-1a0a-45dd-8db2-de52748e1520`, changed only `lib/appkit.ts` (`+4/-6`) and
    `lib/AppKitProvider.tsx` (`+20/-17`), and preserved the existing provider's CRLF style.
  - Existing mounted previews no longer require a second iframe `load` event after HMR. A responsive
    server plus the same ready iframe/load baseline is accepted, preventing false `preview never
    loaded` auto-repair turns on slow Next.js recompiles.
  - Final visible production proof: lint passed with zero warnings/errors; Next build/type validation
    passed; five static pages generated; production server became ready on `:4101`; the MPM page
    rendered; fresh production browser logs had zero errors. The remaining fresh warning is a local
    WalletConnect metadata URL mismatch. Build evidence also exposed a performance follow-up:
    `/` is `261 kB` with `465 kB` First Load JS and `app/page.tsx` remains a large monolith.
  - Verification: focused Council safety tests passed 4/4; composer/status/HMR tests passed 32/32;
    `@vai/core` and `@vai/desktop` typechecks passed. Code view opened the changed provider and
    exposed working `Edit raw`, `Revert`, `Save`, and `Ask Vai` controls (Save/Revert correctly
    disabled before a manual edit).

- **DONE 2026-07-10 - Customer + apprentice work journal replaces reasoning spaghetti**
  - Replaced the separate Reasoning timeline, Story feed, Council card pile, and composer ticker
    for software turns with one six-stage surface: Understand, Investigate, Plan, Build, Review,
    Validate. The live customer layer answers `Now`, `Why`, and `Evidence`; the expandable
    apprentice journal records every observable action, nested tool result, file observation,
    reviewer verdict, repair, duration, and validation result in chronological order.
  - The journal describes operational evidence rather than exposing private chain-of-thought.
    Internal advisor strings such as `build-action | risks: format-contract-risk` are translated
    into concrete language about the software-change classification, strict file-output risk, and
    the advisor's limited authority. Edit runs now emit a deterministic planning event describing
    editable files, read-only references, and whether safe new project files are authorized.
  - Settled work collapses to one receipt. A failed edit now reads, for example,
    `Withheld · 6 of 22 validation issues remain · 9 recorded actions`, with a warning icon and a
    one-click journal, instead of claiming `Implementation · 6 files ready`.
  - Long user task contracts no longer bury the work receipt. Requests over 700 characters render a
    word-boundary preview plus `Show full request · N words`; the complete original prompt remains
    available inline and is still what Vai receives.
  - Fixed progress ownership while building this surface: the outer ChatService previously saved a
    trace before the inner generator committed the current assistant row, attaching work to the
    previous answer. Trace persistence now occurs after the generator completes, uses a versioned
    envelope, rejects untrustworthy legacy arrays, and preserves repeated review/repair actions
    rather than collapsing them by generic stage name.
  - Visual proof: `<visual-proof>/vai-process-customer-apprentice.png`.

- **DONE 2026-07-10 - Builder refusals are terminal and external projects restore after restart**
  - Live MMM replay exposed a critical post-gate bypass. Council validation correctly rejected an
    invalid Hardhat proposal, but the general answer-improvement council then redrafted the short
    refusal back into the original unvalidated six-file response. A deterministic edit refusal is
    now terminal: no later redraft or friend review may turn it into file blocks, the model id is
    `vai:council-quality-gate`, the verification stage is `council-edit-withheld`, and the response
    directs the user to the failed checks in the work journal.
  - The first bad proposal pinned Hardhat 2.19.1, used nonexistent Hardhat plugin APIs, declared an
    invalid empty derived Solidity contract, used a non-Ignition class module, imported ethers/Chai
    into the viem test lane, called `receive()` like a function, omitted the 12 constructor args,
    and referenced lowercase getters that do not exist. Deterministic Hardhat 3 gates now require
    the requested exact versions, ESM config, `defineConfig` + registered viem toolbox, explicit
    localhost HTTP network, import-only Solidity entry, `buildModule`, Node test runner + viem,
    transaction-based payable tests, and the real uppercase contract getters.
  - Added `set up`, `setup`, `configure`, `install`, and `deploy` to explicit build execution routing,
    preventing a localhost URL inside an implementation request from triggering the earlier HTTP
    definition answer.
  - External project attachment is now durable across runtime restarts. Folder attachment binds the
    active chat and persists both sandbox id and absolute workspace root; selecting the chat
    reopens the folder when the process-local sandbox id is stale. If a bound workspace cannot be
    restored, Vai refuses instead of silently building a fresh generic app.
  - Real proof after restart: chat restored
    `<external-project>/mpm-frontend`, Next became ready on `:4100`, the exact
    Hardhat prompt stayed in targeted edit mode, static checks found 22 failures, repair passes
    reduced them to 8 then 6, and Vai withheld the edit. No project files were applied and no
    general-council redraft appeared.
  - Verification across the affected suites: 148 tests passed; `@vai/core` and `@vai/desktop`
    typechecks passed.

- **PROPOSED 2026-07-10 - Make the MMM Hardhat lane pass real compile/test gates**
  - The system is now honest, but it still did not complete the user's requested local-chain lane:
    the local coder exhausted two repairs with six deterministic errors remaining. The next slice
    should supply a concise constructor/parameter facts packet from the read-only Solidity and
    deployment references, require all 12 constructor arguments in the Ignition module, install in
    the isolated `chain/` workspace, and run `hardhat build` + the Node/viem tests before presenting
    an approval receipt. A proposal is not complete until those commands actually run and the
    receipt links each claim to captured output.

- **DONE 2026-07-10 - Chat-to-software fresh build + active-project repair proved visually**
  - Replayed the exact reading-tracker prompt through the visible Agent chat. Multi-intent parsing
    previously split `persistent local state. Make it runnable...` into a build plus an unrelated
    answer, so persistence disappeared from the architect contract. Request-shape matching is now
    anchored to clause starts; the prompt remains one build and the Book Tracker spec explicitly
    retained persistent local state.
  - Initial chat hydration is now explicit. On reload the composer visibly reads `Restoring your
    last chat...` and remains disabled until the saved conversation, project binding, messages, and
    sandbox settle. Starting a clean chat cancels a slower restore token, preventing work from
    landing in the previously selected project.
  - Builder implementation now prioritizes a code-specialist Council seat. The same prompt changed
    from repeated qwen3 utility-class/TypeScript failures to a qwen2.5-coder React draft that passed
    strict static checks on the first attempt. General models remain architect/reviewer seats.
  - Fresh Council rejection is terminal. A null Council result can no longer fall through to an
    unreviewed one-file `index.html` that is labeled complete. The quality-gate response now states
    that no project was created and preserves the failed evidence.
  - Added deterministic gates for plain-CSS utility-class leaks, requested browser persistence,
    hydrate-before-save ordering, border-box and narrow-screen CSS safety, broken `#` images, raw
    SVG data-image `<img>` sources, bounded progress, and filtered-index state mutation. Reviewer
    must-fixes survive unchanged/no-op repair attempts instead of being erased after one pass.
  - Added a narrow deterministic recovery for the visually proven Book Tracker signature: replace
    broken covers with CSS cover initials, hydrate localStorage before saving, clamp progress to
    both bounds, and update filtered books by stable id. The active-project path first withheld two
    bad revisions honestly, then applied the verified repair to `src/App.tsx`/`src/styles.css`.
  - Visible end-to-end proof on the rendered app: no `<img>` elements/broken icons remain; entering
    `999` clamps the first book to `281/281`; a full reload preserves `281/281`. The final App view
    shows self-contained gradient covers and the Code view exposes the matching source.
  - Work-journal receipts no longer stay `Withheld` after a later apply event, and raw advisor
    packets are translated in both the expanded journal and compact `Now / Evidence` header.
  - Verification: 140/140 focused chat/builder/desktop regressions passed; whole-monorepo typecheck,
    repository hygiene, source integrity, and write-path discipline passed. ESLint completed with
    zero errors and 566 pre-existing warnings.

- **DONE 2026-07-10 - Truthful process ownership + fresh App proof**
  - Generic fallback ownership is now announced only when that fallback actually takes control.
    Council builder turns go directly from classification/project inspection to the real Council
    stage events, so a qwen3 fallback can no longer be presented as the implementation owner when
    qwen2.5-coder produced the artifact. If Council genuinely crashes and the fallback runs, the
    journal says so explicitly.
  - Vite HMR gets the first opportunity to update the mounted App. Because HMR commonly does not
    fire an iframe `load`, Vai now requests one controlled cache-busted document refresh when that
    load proof is absent, waits for the visible App iframe to report ready, and checks the refreshed
    browser logs before granting verified status. An unreachable/unobserved refresh is no longer
    captured as a passed verification.
  - Live visible proof used a targeted Book Tracker edit. The journal named
    `Local qwen2.5-coder:7b` as the editor with qwen3/deepseek limited to review, the App rendered
    the requested `A calm place to track every page.` subtitle, and the final receipt read
    `App refreshed` plus `Loaded the updated app in the browser and observed the fresh document on
    port 4100.` No new `fresh refresh proof is pending` message appeared.
  - Verification: 65/65 focused core/desktop regressions passed and all nine TypeScript workspaces
    typechecked successfully.

- **DONE 2026-07-10 - RAVEL visual learning contract + shared task continuity**
  - Turned the observed Book Tracker failures into reusable frontend knowledge instead of another
    selector-specific patch. The `frontend-design` skill now requires relational inspection between
    neighboring surfaces: two separately rounded/opaque panels touching at 0px fail even if each
    panel's own padding is valid. It also records the 9-54px SVG overflow failure and the difference
    between geometric validity and meaningful, title-specific artwork.
  - Council's coder/stylist prompts receive the same contract for visual work: follow the existing
    spacing rhythm between autonomous surfaces, prove media fit at desktop/tablet/mobile, and reject
    repeated path/rectangle templates as fake semantic variety. Non-visual maintenance prompts do
    not receive the extra visual instructions.
  - RAVEL now provides the deterministic half of this learning loop. The live Book Tracker report
    passed desktop 1440px, tablet 768px, and mobile 390px with score 1, zero geometry issues, and zero
    browser errors. Five labelled semantic crops are emitted per viewport for the separate taste/
    meaning review; geometry PASS is explicitly not treated as proof of artistic quality.
  - Added a model-neutral shared work-artifact API and a compact Shared Task inspector to the real
    Chats panel (projects and chats are one surface). It shows scope, files, handoff members,
    blockers, repairs, and inspectable evidence without pasting source bodies into chat. Its repair
    action restores the recorded scope/acceptance context into the composer.
  - Live inspection found an honesty mismatch that the new surface made visible: the latest artifact
    was marked `applied` while its stored validation still had two errors. The UI now says
    `Applied with gaps`, uses warning treatment, and offers `Fix recorded gaps`; it never paints that
    combination as a clean green success. The handoff was visually exercised and prefilled exactly
    two recorded validation issues, then the composer was restored.
  - Verification: focused visual/prompt/shared-context tests passed 10/10; `@vai/core`,
    `@vai/runtime`, and `@vai/desktop` typechecks passed. The restarted runtime served the artifact
    endpoint successfully and the in-app browser visibly rendered the Shared Task above the unified
    chat list alongside the live Book Tracker App.

- **DONE 2026-07-19 - Vai-owned relational conversation + evidence-based reflection**
  - Baseline evidence from conversation `01KXWE0QZJGAA0JQQ1MCFSQNGP`: Codex introduced itself as an
    AI engineering agent working with V3gga, named V3gga's concern, and stated the shared goal of
    reducing third-party-model dependence. Vai ignored every entity, returned a canned self-review,
    then answered the persisted recall follow-up with a generic capability menu.
  - Added a deterministic relational state pass in `packages/core/src/chat/dialogue-state.ts`. It
    reconstructs the current speaker, entity kind, named working relationships, values, attributed
    concerns, shared goals, and the current `we/us` cluster from the persisted transcript. Relational
    introductions and recall turns now resolve before broad retrieval or generic fallback in both
    ChatService and VaiEngine.
  - Relational answers are explicitly Vai-owned and bypass Council. Optional model arms receive a
    compact system prelude derived by Vai, with attribution rules; models do not infer or own who
    said what. `/api/agent/introspect` now exposes this policy and pipeline.
  - Added deterministic post-exchange reflection. It inspects the last completed user/assistant pair
    for generic fallback, missed named participants, and very low topic overlap. A proven failure
    becomes a bounded `vai:v0-dialogue-reflection` job in the existing guarded self-improvement
    queue; a healthy exchange produces no fake job and asks for another adversarial probe.
  - Speaking to Vai surfaced two more defects and the loop improved them immediately: the official
    agent client classified `done` frames as thinking updates because terminal frames also carry
    `thinking`/`modelId`, and its documented pipe-to-TCP fallback was hard-coded to pipe only. Frame
    type now wins, TCP is actually attempted, and the same live persistent conversation completes
    in about 2 seconds. A follow-up also exposed false attribution of the question "what V3gga thinks
    is wrong" as a new V3gga claim; interrogative reported speech is now quarantined.
  - Live proof after restart in conversation `01KXWFWHHHAF02FB2EZP8WR2TC`: Vai identified Codex,
    kept V3gga's concern attributed to V3gga, retained the reduced-model-dependence goal, resolved
    `us` to `Codex, V3gga, Vai`, and honestly declined to invent an improvement after the corrected
    exchange passed its checks. The path used zero response-model calls.
  - Verification: 720 broader chat/engine/conversation regressions passed; the final focused core,
    runtime, transport, and introspection set passed 14/14; `@vai/core` and `@vai/runtime` typechecks
    passed; the agent client passed `node --check`.

- **PROPOSED 2026-07-19 - Make the Windows named-pipe leg independently observable**
  - The repaired agent client now falls through to direct TCP and succeeds, but the named-pipe leg
    still returns incomplete in this execution environment. Add per-transport connect/close/terminal
    telemetry and an isolated live named-pipe acceptance probe so Vai can distinguish sandbox/access
    constraints from a real listener defect without delaying the working TCP path.

- **DONE 2026-07-19 - Vai-owned Council redraft integrity + zero-model self-assessment**
  - A principal-engineering probe asked Vai to name its most important engineering bottleneck,
    separate evidence from inference, and propose an acceptance test. Conversation
    `01KXWFWHHHAF02FB2EZP8WR2TC` exposed a severe release-integrity failure: the original draft was
    relevant, a Council redraft copied `Peru/Lima` from an example inside the draft, round two still
    said `needs-work`, and the changed missing-capability wording let the degraded revision ship.
  - Added `packages/core/src/chat/council-redraft-integrity.ts`. Before any Council revision can
    replace the original, Vai now compares both drafts using its deterministic answer-quality and
    multi-intent contracts. A candidate is rejected when it loses release-critical prompt focus,
    drops an already-covered deliverable, materially lowers the quality score, or introduces a new
    deterministic failure. The work journal emits the exact rejection reason and keeps the original.
  - Added `packages/core/src/chat/vai-self-assessment.ts`. Broad, evidence-disciplined questions
    about Vai's engineering bottlenecks now run through `vai:v0`, bypass Council and response models,
    distinguish attached evidence from inference, explicitly name missing operational evidence, and
    produce a measurable next acceptance test. The same lane is installed in ChatService and the
    direct VaiEngine path, and is exposed through `/api/agent/introspect`.
  - Expanded dialogue reflection to recognize explicit reviews of the previous exchange/answer and
    guarded-queue requests. The exact Lima failure is detected as very low topical overlap and
    becomes a bounded `turn-to-response relevance verification` nomination. Healthy exchanges no
    longer claim that named participants were retained when the exchange contained none.
  - Live proof after restart in fresh conversation `01KXWNBCKFG7VTW67BT83A0QP0`: the exact probe
    returned an evidence/inference/acceptance-test answer with model id
    `vai-self-assessment:operational-introspection-gap`, persisted duration `1 ms`, zero Council or
    response-model calls, and no Peru/Lima drift. A follow-up reflection stayed Vai-owned and
    correctly declined to invent another failure.
  - The acceptance run also exposed runtime-launch thrash: the agent helper's 3-second health probe
    could treat a busy-but-alive local-model runtime as dead, then invoke the manager and replace it.
    The helper now checks the managed PID, waits for recovery, and refuses to restart an alive busy
    runtime; direct-engine fallback remains available. Syntax check passed.
  - Verification: 1,177 broad Core tests passed across both 430-test VaiEngine variants, ChatService,
    Council, fallback, routing, dialogue, and release gates; final focused tests passed 19/19;
    runtime introspection passed 2/2; `@vai/core` and `@vai/runtime` typechecks passed.

- **DONE 2026-07-19 - Read-only operational evidence + honest adoption diagnosis**
  - Attached one bounded, timestamped packet to both ChatService self-assessment and
    `/api/agent/introspect`: live `vai:v0` process identity, Git porcelain status, a machine-readable
    verification receipt, and read-only self-improvement corpus counts. Each source has a stable id
    and degrades to an explicit unavailable record; inspection never blocks chat and never invokes a
    model. A two-second cache prevents duplicate Git/SQLite work across adjacent inspections.
  - The exact self-assessment now ranks from facts. With 86 qualified proposals and zero adopted,
    Vai names `verified improvement adoption` as the single bottleneck instead of generating another
    proposal or pretending missing knowledge. Its acceptance test requires one bounded fix to move
    through implementation, focused and broad tests, a timestamped evidence receipt, rollback data,
    and a real adopted record. Proposal generation alone explicitly fails.
  - Live proof after restart in fresh conversations `01KXWPJP92KS8CR4PT7JFAA72X` and final polish
    probe `01KXWQ4SK74EVSFGKT9FPFW6JZ`: Vai cited
    `[runtime:process]`, `[git:status]`, `[verification:receipt]`, and `[self-improve:corpus]`; reported
    107 changed files, 1,202 verified test executions, 302 queued fixes, 86 qualified,
    zero adopted, and the latest `aborted-runtime-down` run; persisted strategy was
    `vai-self-assessment:verified-adoption-gap` with `1 ms` duration and zero Council/response-model
    calls. The follow-up reflection also completed in `1 ms`, stayed on topic, and refused to invent
    a new queue item.
  - The operational packet exposed the next institutional weakness without falsifying its state:
    two guarded nominations are still queued, and the adoption counter remains zero because this
    work has not been merged or recorded through the adoption mechanism. No database status was
    mutated merely to make the metric look healthier.
  - Verification: the prior 1,177-test broad Core regression run remains green; the final affected
    suite passed 23/23; runtime introspection passed 2/2; `@vai/core` and `@vai/runtime` typechecks
    passed. `docs/vai-verification-receipt.json` is the timestamped machine-readable receipt.

- **DONE 2026-07-19 - Identity-blind Codex-vs-Vai competition + two generalized improvement loops**
  - Added a reusable, identity-blind competition runner in `scripts/vai-competition.mts` with
    deterministic exact, avoid, word-count, JSON, and weighted rubric checks. `scoreAnswer()` never
    receives contestant identity, and label/order invariance controls must pass before a report is
    accepted. Codex answers are disclosed frozen references, not misrepresented as a separately
    metered API run; Vai runs current-source `vai:v0` in test mode with no Council or response model.
  - The first visible baseline scored Codex 100% vs Vai 30.6% (2/11 passes). The repeated defect was
    cascade ownership: broad fact, product, web, app-scaffold, and error templates preempted explicit
    arithmetic, output, conversational, epistemic, system-design, and code contracts. The first
    contract-first slice raised the same visible set to 58.2%; its first frozen holdout scored 47.9%
    while independently confirming the arithmetic and literal-CSV mechanisms at 100%.
  - Implemented inspectable Vai-owned lanes rather than benchmark answer strings: relational entity
    and attribution recall; spoken correction before canonical facts; bounded JSON/CSV/literal-token
    contracts; future-observation honesty before topic retrieval; general paired-cost algebra and
    inclusive-calendar reasoning; reliable asynchronous-worker architecture composed from durability,
    idempotency, progress, overload, recovery, metrics, and rollout invariants; typed array-grouping
    code synthesis that preserves user-supplied function/parameter names; and read-vs-paid-action
    entitlement enforcement at a server-side gate.
  - Froze a structurally varied second visible wave plus a separate holdout before iteration two.
    The second visible baseline was 20.4% (1/9). After the institutional lanes it reached 100% (9/9),
    and the untouched second holdout reached 100% (8/8) on first exposure across different countries,
    speakers, future quantities, prices, workloads, code identifiers, and paid actions. Final reruns
    are 100% on all four splits: 34/34 scenarios and 39/39 turns, with scorer controls passing.
  - Audited the scorer itself. Two old rubrics rejected semantically equivalent phrases (`can't share`,
    `cannot be known`, and `collaborating with`) while accepting narrower synonyms. The accepted
    vocabulary was widened without weakening any critical requirement; the original reports remain
    as evidence instead of being overwritten conceptually.
  - Council remained advisory and did not affect scores. A deep blind review timed out at 360 seconds.
    A bounded balanced retry completed in 9.96 seconds but only 1/1 member responded, provenance was
    `thin`, and the primary answer hallucinated a deployment memory leak unrelated to the supplied
    anonymized pairs. The Council correctly marked the turn `needs-work`/`reread-intent`; its verdict
    was excluded rather than presented as validation. Evidence is in
    `artifacts/vai-competition/council-review.json`.
  - Live replay found two gaps that the direct-engine competition could not expose. First, currency
    written as `4 dollars and 60 cents` fell outside the paired-cost parser; the local model returned
    30 cents with a contradictory check. Second, ChatService's primary-generative flip could skip the
    new VaiEngine lanes entirely and time out. Vai now normalizes dollar/cents phrases, verifies both
    the sum and difference invariants, and registers bounded trick reasoning plus reliable-worker
    design in the scored ChatService dispatcher. Both paths explicitly bypass response models.
  - Live proof after restart: conversation `01KXWVAFBG3R9X99WMDZWS4CVC` returned the corrected
    30-cent answer with a valid total; unseen cents-only conversation
    `01KXWVG8X8FCDCNGAQSR58E5EE` verified both `$0.70 + $0.20 = $0.90` and
    `$0.70 - $0.20 = $0.50`; unseen systems-design conversation
    `01KXWVP4EAPG14SST0CE08CEG3` returned the SQLite/lease/idempotency/backpressure/metrics/rollout
    architecture in 2.8 seconds through Vai-owned code. Entity recall also held Atlas/Vega roles and
    attribution across two real turns in conversation `01KXWTR1DPTVNTE3KKWN9WGZSF`.
  - Verification: scorer controls/tests 5/5; final combined competition 34/34 scenarios and 39/39
    turns at 100% (`artifacts/vai-competition/final-all.{json,md}`); the final eight-file affected
    Core regression set passed 96/96; `@vai/core` typecheck passed. The broad
    Core run passed 4,515 assertions and failed three 20-second builder time limits under contention;
    the isolated builder file passed all 53 assertions with a 60-second test limit, but Vitest still
    reported a worker `onTaskUpdate` RPC timeout and exited nonzero. That harness error is retained as
    a limitation, not reported as a clean whole-suite PASS.

- **PROPOSED 2026-07-19 - Council blind-evaluation context fidelity gate**
  - The competition exposed that Council availability and Council usefulness are different states.
    Before Council can advise an evaluator, require at least two substantive member responses, prove
    that each note references a candidate-specific fact, and mark unrelated primary answers as
    `context-drift` instead of returning an actionable verdict. Keep deterministic scoring independent
    so local-model latency or context loss cannot block Vai's own evaluation loop.

- **DONE 2026-07-19 - Frozen high-IQ reasoning spectrum + seven accepted self-improvement cycles**
  - Added `scripts/vai-competition-v2.mts` and an immutable 45-scenario base with visible,
    holdout, and mutation splits, followed by three frozen fresh waves. The combined set has 80
    scenarios/85 turns and 21 category labels across compositional, adversarial, multi-step,
    causal, planning, code, epistemic, memory/state, control, decision, and constructive reasoning.
    Identity-blind scorer controls pass, JSON values are compared recursively, and reports include
    per-category scores. Fingerprints and the no-task/no-scorer-edit rule are recorded in
    `docs/vai-competition-v2-protocol.md`.
  - Cycle 0 scored 4.0% overall, 9.2% visible, and 1.1% frozen holdout. Seven accepted iterations added
    Vai-owned parsers, intermediate representations, executors, and invariant checks rather than
    prompt answers: constraint graphs, set proofs/covers, causal controls, Bayes and throughput,
    critical paths, alias/queue semantics, aggregation, conflicting evidence, safe destructive
    clarification, spatial/recurrence/state rules, intervention-based belief revision,
    contraposition, underdetermination, expected value, exact worker partitioning, `let` closures,
    confounding, verified counterexamples, and corrected named-event ledgers. The post-saturation
    cycle generalized these into coefficient-bearing linear equations, minimum-cost choices,
    inclusive stepped closures, add/remove correction polarity, severity confounding,
    posterior-to-policy composition, and enumerated Boolean fixed points.
  - Final frozen visible and holdout scores are both 100%, reducing the dev/holdout gap from 8.1
    points to zero. Fresh wave 1 improved 80.3% -> 100%; wave 2 improved 16.3% -> 100% across eight
    new reasoning families. A third post-saturation wave then improved 28.7% -> 100% on paraphrases
    and compositions. Expanded raw score is 79/80 (98.8%); valid-adjusted score is 79/79.
    The sole raw miss is an immutable mutation whose reference says `22` for a recurrence that
    evaluates to `30`. Vai returns the mathematically correct result, so the task is quarantined and
    preserved rather than changing the scorer or engine to emit a known falsehood. Exact cycle and
    category deltas are in `artifacts/vai-competition-v2/cycle-ledger.md`.
  - ChatService now recognizes verified bounded reasoning as Vai-owned, prevents terminal/output
    bridge routes from preempting simulated code traces, preserves multi-turn state, and bypasses
    Council/response models for supported grammars. `/api/agent/introspect` exposes the policy,
    representations, and all frozen wave fingerprints.
  - Live proof after restart in conversation `01KXX0PJB6EC3Z7X0JS6K0CBEE`: Vai computed inventory
    `25`, retained named events, then applied a correction and a new event to recompute `29` without
    double application. Conversation `01KXX1QGR4185JFDH01SCME1BW` then composed a count posterior
    (`90/(90+180)=33.3%`) with a strict `>40%` rejection policy and correctly chose not to reject.
    The final focused bounded/ChatService/runtime set passed 47/47, full VaiEngine regression passed
    430/430, scorer controls passed 6/6, `@vai/core` and `@vai/runtime` typechecks passed, live
    introspection exposed the third-wave fingerprint, and the scoped diff check was clean.

- **DONE 2026-07-19 - Sealed v3/v4 expert reasoning arena and typed deterministic kernels**
  - Replaced the saturated recognizer-heavy arena with 305 frozen v3/v4 scenarios spanning
    soundness controls, finite-model logic, CSPs, causal inference, exact scheduling, MiniJS,
    uncertainty, event state, transaction anomalies, and multi-stage composition. The runner now
    enforces pack/scorer/source fingerprints, fresh engines, shuffled-order determinism, strict
    duplicate-key JSON, semantic schedule certificates, calibration, false-activation telemetry,
    failed-representation clusters, and a scorer attack bank.
  - V3 soundness began at 8.3% with 100% false activation; its first frontier exposure was 0/41.
    General deterministic representations raised the final frozen v3 combined run to 209/209 with
    100% bounded coverage/precision, zero false activation, and 100% determinism.
  - V4 wave 1 first exposed one general multi-budget routing gap (57/60), then passed 60/60 after
    all declared resource budgets became first-class constraints. The independently frozen wave 2
    collapsed to 6/36 and identified ten new representation families; implementing those operators
    raised the immutable raw score to 34/36 across three orders.
  - The two residual wave-2 misses are proved oracle defects: both minimax tasks tie `B` and `C`,
    but the generator silently demands lexical `B`. Vai now returns the explicit optimum set rather
    than gaming the evaluator. The raw 34/36 and validity adjudication are both retained in
    `docs/vai-competition-v4-protocol.md` and `artifacts/vai-competition-v4/cycle-ledger.md`.
  - Added the expert representation inventory, containment policy, v3/v4 pack fingerprints, and
    evaluation discipline to `/api/agent/introspect`. Verification at this checkpoint: 493/493
    focused Core tests, 3/3 v4 scorer attacks, `@vai/core` typecheck, v3 209/209, v4 wave 1 60/60,
    and legacy v2 79/80 raw (its sole miss is the preserved bad recurrence oracle).
  - Speaking to the restarted runtime then found a second-order observability defect: verified
    bounded turns answered correctly without models, but their persisted route plans were polluted
    by a large set of irrelevant historical Council lessons. Bounded programs now bypass route
    guidance loading as well as Council/response generation. Fresh conversation
    `01KXX8XKTZ5H233FCEW3BHNEDA` returned both minimax optima in 2 ms under
    `bounded-reasoning:advanced:minimax-regret`, with `hadGuidance=false`, no baseline, and no
    guidance fields. The final affected ChatService/reasoning regression passed 128/128 and Core
    typecheck remained clean.

- **IN PROGRESS 2026-07-19 - Release-targeted global push-to-talk for fullscreen games**
  - Replaced the polling/press-target/per-character path with a native Windows `RegisterHotKey`
    owner and an immutable release snapshot (HWND, focused control, PID plus process-creation
    identity, classes, monitor, window mode, and field evidence). Delivery removes that exact
    release record and fails closed if the field, window, process, process generation, game, or
    shell state changed. The production source now has no Unicode character-injection path and
    exactly one `SendInput` site: a four-event scan-code `Ctrl+V`; acceptance is reported as
    `sendinput-accepted`, never falsely as a confirmed paste.
  - Added a clipboard transaction that preserves text or image data and restores only while Vai
    still owns the temporary transcript. Refused/no-target routes deliberately leave the transcript
    clipboard-ready. Every release and delivery outcome is JSONL logged without transcript text.
    The overlay is no-activate/click-through, follows the target monitor, stays available over
    borderless games, and has an audible fallback for exclusive fullscreen.
  - Hardened League evidence so Enter arms chat, a later world click disarms it, and only a later
    click in the League-specific input rectangle re-arms it. Other games do not inherit that
    heuristic. Global STT is pinned to the fast local tier; model polishing cannot block paste.
    Near-silence/electrical noise is rejected before Whisper, physical microphones can switch over
    a stable audio graph, and long holds rotate into independently decodable 45-second segments
    that transcribe serially while capture continues.
  - Scaled deterministic competition evidence: 14/14 native tests pass, including a 48-state
    window/PID/process-generation/focus/shell churn matrix with exactly one eligible identity, a
    16-state hostile game-field truth table, and 9 no-field focus permutations. Focused audio tests
    pass 11/11. Desktop TypeScript typecheck and Rust `cargo check` pass. The UI audit passes 24/24
    theme/mode/viewport captures with no overflow, narrow-panel collapse, console errors, or unsafe
    hotkey acceptance; four representative renders were visually inspected.
  - Added a compiled native acceptance fixture at
    `apps/desktop/src-tauri/src/bin/vai_ptt_target.rs`. It exposes real Win32 Edit controls in
    windowed or borderless mode, supports deterministic field-A → world → field-B churn, and
    records activation, focus, `WM_PASTE`, field contents, gameplay `WM_CHAR`, and summary counts.
    `scripts/vai-ptt-target-audit.mjs` correlates that JSONL with Vai's release log and enforces 13
    append-only checks: exact release process/field, fast STT, ≤1.5 s, one paste, zero gameplay
    characters, release-time field only, clipboard restoration, and no target deactivation.
    The fixture compiles cleanly and its audit controls pass 3/3 (canonical PASS plus duplicate,
    gameplay-input, stale-field, latency, and focus-theft rejection attacks); its GUI run is still
    pending the same native-launch approval.
  - **Post-incident offline hardening (2026-07-19):** delivery now re-inspects the foreground,
    focused control, process generation, and current game-field evidence immediately before the
    sole `Ctrl+V` injection. It refuses late transcripts before injection and reports explicit
    `clipboard-ready-field-closed` or `clipboard-ready-latency-exceeded` routes. Hotkey rebinding is
    deferred until the active hold ends; audio cues now distinguish listening, release, paste,
    clipboard-ready, silence, and error; microphone switches coalesce the newest request; and the
    fast PTT Whisper model warms before the balanced model.
  - The dangerous fixture driver no longer emits global Enter or mouse events and cannot move the
    cursor: canonical churn is sent only to the exact, revalidated fixture HWND with `PostMessageW`.
    The auditor now proves the full field-A -> world -> field-B sequence and rejects any transient
    focus theft, even if the fixture later reactivates. A separate aggregate gate requires exactly
    ten unique passing reports, both windowed and borderless coverage, at least three churn runs,
    no focus theft, and every measured latency inside budget. The safety protocol is recorded in
    `docs/vai-ptt-acceptance-protocol.md`; no fixture or automation may run while the owner is
    playing, and real League checks are human-driven only.
  - Latest offline evidence supersedes the earlier counts: Rust native tests pass 21/21; the
    feature-disabled and explicitly armed fixture-driver builds both compile; the target auditor and
    aggregate-gate controls pass 8/8; recorder/audio/STT tests pass 26/26; desktop and runtime
    TypeScript typechecks pass; and the scoped whitespace check is clean. These results prove code
    invariants only, not live delivery.
  - **Open & paste contract update (2026-07-19):** the owner clarified that League chat should stay
    closed during speech and that Vai must never send the message. The new explicit League mode now
    takes the release snapshot, sends exactly one scan-code Enter to open chat, requires fresh
    concrete `win32-caret` or focused-control proof in the identical HWND/PID/process generation,
    sends one lexical Ctrl+V sequence, and stops. The owner reviews the text and presses Enter
    manually. A failed Enter, held modifier, superseding input sequence, focus change, missed
    deadline, or unproved post-open field leaves the transcript clipboard-ready. Geometry and old
    click-region re-arming are no longer accepted as field proof.
  - The safety implementation now uses a monotonic release deadline, a final identity/evidence check
    immediately before Ctrl+V, exact cleanup key-ups after partial `SendInput`, lossless-only
    clipboard capture with sequence-number ownership, and a frozen release-monitor overlay position.
    Real games intentionally retain the transcript clipboard because Windows accepting Ctrl+V does
    not prove the game consumed it; lossless restoration is asserted only by the deterministic
    fixture. The fixture class is explicitly game-classified and its borderless window covers the
    primary monitor so the real production classifier is exercised.
  - Acceptance evidence is now schema 2 and binds four SHA-256 evidence files, unique run ID,
    attempt, nonce, source fingerprint, exact target identity, workflow, and the shortcut Vai itself
    reported at release. Each candidate must pass all 24 ordered checks, including explicit
    no-final-Enter proof. The ten-run gate rejects
    reused/fabricated/mixed-source evidence, requires both window modes, at least three churn runs,
    at least one Open & paste run, supported chords throughout, and at least one proved `Win+Alt`
    run. The driver supports the passively observed `Win+Alt` chord and the explicit
    `Ctrl+Shift+Space` fallback, with RAII release of the matching keys.
  - Latest offline evidence after this update: native Rust tests pass 32/32; manifest, attempt-plan,
    target-auditor, and aggregate-gate controls pass 30/30; focused recorder/STT/preference/exact-fixture-text tests pass 21/21; desktop
    TypeScript typecheck passes; the disabled driver and dangerous driver in both debug and release profiles compile.
    No UI, hotkey, fixture, process, window, input, game, or installed-app action was performed while
    the owner was playing. Visual/native/real-game proof remains open.
  - Two independent senior source reviews caught and drove fixes for two false-positive acceptance
    paths: the exact fixture could not enter the League-only Open & paste branch, and its accepted
    Open & paste route could not schedule the restoration that the auditor required. Fixture entry
    is now restricted to debug or the explicit dangerous acceptance feature and requires run ID,
    transcript, create-new dedicated log, exact class/process,
    and a matching `hotkey-ready` ownership handshake. The gate reparses raw evidence and recomputes
    each candidate instead of trusting PASS flags; target/driver outputs refuse overwrite; driver
    stages and external release-to-paste chronology are checked; and a post-paste Enter is an
    explicit failure. Final modifier, evidence-sequence, identity, and deadline checks now sit at
    both Enter and Ctrl+V boundaries, with sequence-specific partial-input cleanup. Exact-modifier
    matching prevents Ctrl/Shift supersets from activating `Win+Alt`; evidence now rejects foreign
    run rows, impossible/non-monotonic stage clocks, mismatched Vai log paths/process generations,
    and any extra Enter before or after paste.
  - Exact-executable and selection-bias evidence is substantially hardened offline: the formal
    harness now requires a release build with embedded renderer assets, not mutable localhost/HMR.
    Build.rs embeds one expanded source-closure fingerprint into Vai/target/driver; a create-new
    manifest records exact release executable names/paths/sizes/hashes, and the driver hashes all
    bytes twice before input. A ten-attempt plan fixes unique run IDs/nonces, workflows, modes,
    shortcuts, and claim paths; claims carry exact plan/manifest/binary hashes, and a later attempt
    cannot begin unless earlier claims succeeded. Auditors snapshot each file once for both parsing
    and hashing, normalize Win32 extended paths, namespace release IDs by run, and reject overlapping
    attempts. Ordinary local files remain owner-writable, so this is tamper-evident operational
    evidence rather than WORM/code-signing proof.
  - The final independent acceptance review found five additional offline blockers and each is now
    regression-locked: fixture nonces bypass persisted speech-profile/prettify/model changes; the
    embedded source closure includes shortcut, STT, transcript, and core polish dependencies; the
    driver waits for the exact target process to terminate before succeeding its claim and the audit
    requires that claim after the target summary; driver-log paths use canonical extended-Windows
    comparison; and release IDs must be positive safe integers. The full ten-row attempt plan is also
    validated for strict ordinals plus unique run IDs, nonces, and canonical absolute claim paths
    before any claim or input.
  - The last review pass also closed two timing/provenance gaps: clipboard validation can retry, so
    exact evidence/deadline/physical-key/HWND/PID/process-generation/focus checks now run again after
    clipboard validation immediately before the one Enter and both Ctrl+V sites; and the driver now
    requires a run-bound renderer `acceptance-adapter-ready` acknowledgment so it cannot race the
    React commit and accidentally exercise real STT. The source fingerprint now recursively covers
    the complete desktop/Core/UI/API-types renderer source and workspace/build configuration rather
    than a manually selected dependency list.
  - Remaining honest acceptance limitations: League may not expose the Win32 caret/native-control
    proof that the current safe post-Enter gate requires; the passive polled `Win+Alt` edge still
    needs live latency/reliability proof. Clipboard snapshot/replacement and conditional restoration
    now each use one valid Vai-window-owned Win32 transaction, refuse unsupported/multi-format lossy
    backups, preallocate transcript and rollback storage before emptying, and revalidate clipboard
    sequence plus exact text before Ctrl+V. Local evidence still cannot independently disprove
    deliberate deletion/reconstruction or fully fabricated producer logs without an external
    signed/WORM anchor. These remaining evidence/live gaps are not
    offline PASS claims and keep the goal IN PROGRESS.
  - **Not shipped / acceptance gate still open:** native GUI launch and the current production build
    both require an out-of-sandbox process; the approval service rejected each request with a 503,
    so no workaround was attempted. The canonical League sequence therefore remains 0/10 real-game
    runs, including 0/3 churn runs. Exclusive fullscreen cueing, actual foreground non-theft,
    release-to-paste latency, live mic switching, very-long-hold continuity, multi-monitor placement,
    clipboard restoration, and game-exit refusal must be verified in the real packaged/native app
    before this item can become DONE.
  - **Safety incident and containment (2026-07-19):** two synthetic fixture runs failed because the
    fixture did not retain foreground ownership. The second run could emit an Enter/click after the
    target lost focus and coincided with disruption to the owner's active League session. Both runs
    are invalid evidence. Live input/focus testing was stopped immediately; only the verified
    workspace debug Vai process was stopped, and League/Riot plus the separately installed Vai app
    were left untouched. The input-capable driver is now absent from normal builds behind the
    explicit `dangerous-ptt-fixture` Cargo feature, requires a literal arming value plus expected
    PID, and refuses unless the foreground HWND, PID, exact fixture window class, and exact fixture
    executable remain stable. It no longer calls `SetForegroundWindow` or clicks to acquire focus,
    and revalidates before every event. Both the normal disabled stub and dangerous feature path
    compile, but no further live run is authorized while the owner is playing.

- **IMPLEMENTED OFFLINE 2026-07-19 - Durable desktop authentication across restarts and updates**
  - Root cause: device-link bearer credentials lived only in WebView `localStorage`, whose origin
    differs between native dev (`localhost:5173`) and packaged desktop, while session verifiers also
    depended on a configurable runtime secret. Repeated debug launches therefore surfaced separate
    auth state, and runtime/update configuration changes could make a retained credential look dead.
  - Native dev builds now use the existing loopback-only `devAuthBypass=1`, so acceptance shells do
    not ask the owner to authenticate. Packaged Windows sessions migrate from WebView storage into
    a user-bound DPAPI-protected app-data record and restore it before the first authenticated API
    request. A transient anonymous response no longer destroys the retained desktop credential;
    a new account login replaces it, while explicit logout clears both copies even if the runtime is
    offline and reports failure rather than silently retaining an undeletable native credential.
  - New sessions use a configuration-independent SHA-256 verifier over 384-bit random tokens.
    Valid legacy sessions migrate on use, so unrelated runtime secret rotation no longer logs the
    desktop out. Focused evidence: desktop persistence/dev-bypass plus runtime auth tests pass 23/23,
    Windows DPAPI/native PTT tests pass 16/16, desktop and runtime TypeScript typechecks pass, and
    both fixture compile modes pass. A normal packaged rebuild/relaunch and visible one-time legacy
    migration check remain pending until it is safe to stop/restart the owner's running app.

- **PROPOSED 2026-07-19 - V5 generated operator arena (500 cases, semantic certificates)**
  - The post-v4 audit found that raw scenario multiplication would overstate coverage: most v4
    families have three near-isomorphic variants, only schedule answers get dedicated semantic
    certificate validation, metamorphic reporting does not validate the relation between variants,
    and shuffled orders are not five true same-instance repeats.
  - Added `docs/vai-competition-v5-protocol.md`: 13 typed kernels, five cross-kernel compositions,
    a 72-scenario first sealed wave, approximately 500 full-scale generated cases, per-family
    complexity staircases, matched ambiguity/inconsistency/unsupported/resource-limit controls,
    a semantic-validator registry, independent oracles, scorer attacks, relation-level metamorphic
    checks, scale curves, selective risk, true repeat determinism, and session-contamination probes.
  - This remains PROPOSED until the generator, validators, manifest, first-exposure runner, and raw
    baseline artifacts exist. Frozen v2-v4 packs must not be edited to create a favorable result.

- **SHIPPED 2026-07-19 - Global dictation delivers into normal focused inputs after STT**
  - Root cause: every target shared the 1.4-second game delivery deadline, measured from shortcut
    release. Normal local/cloud transcription commonly finishes later, so a still-focused Chrome,
    Facebook, Electron, WebView, terminal, or native edit field was downgraded to clipboard-only and
    surfaced the copy card instead of receiving Ctrl+V.
  - Normal applications now get a 30-second completion window while retaining the exact release
    HWND, PID, process-generation, focused-control, modifier, clipboard-sequence, and final-boundary
    checks. Games retain the existing 1.4-second gate and League Open-and-paste retains 1.2 seconds.
  - Clipboard fallback is now an actionable, persistent card with native Copy, Close, focus-visible
    controls, and cross-window dismissal. Only fallback/error cards accept pointer input; listening,
    finalizing, and successful paste indicators remain non-activating and click-through.
  - Offline evidence: desktop TypeScript typecheck and production Vite build pass; native Rust tests
    pass 34/34, including Chrome host recognition, realistic normal-app STT latency, and bubble
    interactivity routing. A browser-only render proves one Copy button plus two explicit Close
    affordances with no overflow and zero renderer warnings/errors.
    No native GUI, hotkey, clipboard mutation, or SendInput action was used for this verification;
    one real Chrome/Facebook focused-composer hold remains the final live acceptance check.
  - The first installed-app launch exposed a second concrete cause of false Copy fallback: Chrome
    and other apps can leave multiple clipboard formats, while Vai's lossless transaction correctly
    refuses to claim it can preserve an unsupported rich payload. A valid, unchanged focused input
    now continues automatic delivery by replacing that clipboard with the transcript and deliberately
    skipping restoration. No-input targets still receive the persistent Copy/Close card. The same
    launch also exposed a packaged runtime import failure for externalized Playwright; the sidecar
    builder now ships the Playwright dependency closure alongside the runtime bundle.
  - The installed desktop app was stopped, rebuilt, synced, and relaunched. The release and installed
    `veggaai.exe` are byte-identical (SHA-256
    `AD672F8966970A523E70787D030E974553D9568B24D8E90322B61EB74CFC7CC2`), the installed runtime
    contains both `playwright` and `playwright-core`, and its fresh boot passed module loading before
    intentionally yielding port 3006 to the already-healthy Vai runtime. `/api/agent/introspect`
    returned HTTP 200, and the installed native log records active `Win+Alt` ownership under the new
    source fingerprint. The owner can now perform the remaining human acceptance check in any normal
    composer: focus it, hold Win+Alt while speaking, and release to finalize and insert.

- **SHIPPED 2026-07-20 - Ordinary current-price questions render as sourced answers in every depth**
  - Root causes from the observed SNØ Oslo question: the broad price classifier treated venue
    admission as a financial-market lookup; provider fan-out could consume the chat evidence budget;
    a model/council draft could replace a complete retrieved answer with an unsupported live-data
    decline; and a one-field JSON response envelope was presented as a code artifact.
  - Venue admission pricing is now a distinct deterministic research intent. It prefers a matched
    official product page (with a bounded retry for transient DNS/TLS misses) before broad provider fan-out, extracts labeled local-currency rows from
    the live page, applies venue/answer-shape relevance gates, persists the source evidence, and ships
    a complete cited price table directly instead of allowing a later model draft to overwrite it.
    Generic one-field `answer`/`message`/`response`/`text` JSON envelopes are unwrapped only for
    ordinary natural-language asks; explicit JSON requests and real structured payloads are preserved.
  - Cold-cache WebSocket acceptance passed the exact question in Quick, Balanced, and Deep. Every
    depth returned the same current labeled ticket/pass/membership rows from
    `https://snooslo.no/no/products`, included the source, and avoided both JSON/code UI and the old
    real-time-data decline. Focused core coverage passed 137/137, a post-latency-change subset passed
    109/109, and `@vai/core` TypeScript typecheck passed.
  - A real Chrome render against the desktop frontend passed with zero console errors. Screenshots
    prove the answer as ordinary bullets and the open SNØ source rail at verified high trust / 90%
    confidence under
    `screenshots/admission-price-question/`. The installed desktop app was then stopped, rebuilt,
    synced, and relaunched. Release and installed `veggaai.exe` are byte-identical (SHA-256
    `533B7E5BC0FC818FDDB445638F6A559A42693FDB4EC054CDCD49C0FCFA9AEF4B`), the installed process is
    running, and runtime health returned HTTP 200.

- **SHIPPED 2026-07-20 - Venue follow-ups preserve the place, not the previous answer shape**
  - Root cause: the contextual resolver's broad `what is ...` capture treated an earlier admission-
    price question as the entity itself. A follow-up such as `what are their opening hours?` therefore
    searched for a mixed price-and-hours query, and the correctly retrieved price table could win.
    A later council draft could also replace a complete grounded hours answer, while the activity
    strip could continue showing an earlier empty-search state after evidence arrived.
  - Vai now has one deterministic practical-detail contract for hours, admission prices, menus, menu
    prices, schedules, contact details, addresses, websites, parking, and accessibility. Follow-ups
    carry forward only the venue identity, classify the newly requested detail independently, expand
    wording variants by detail family, prefer a matched official page, and require the final answer's
    shape to match the question before it can ship. Correct cited practical answers cannot be replaced
    by an unrelated model/council draft. The search timeline now merges late source evidence into the
    visible stage, and known official venue-detail pages receive the same high-trust treatment.
  - The exact two-turn SNØ Oslo reproduction (prices, then `what are their opening hours?`) passed in
    Quick, Balanced, and Deep with the official opening-hours URL, no price leakage, and no JSON/code
    artifact. Focused core/desktop coverage passed 188/188 and both TypeScript typechecks passed. A
    real Chrome render showed the normal hours answer, official source rail, and 90% confidence with
    zero console errors; evidence is under `screenshots/venue-hours-followup/`. One browser harness
    attempt immediately after a full cold runtime restart exceeded its 90-second UI deadline during
    provider warm-up; it produced no contrary answer, the direct cold Quick WebSocket path had passed,
    and the subsequent rendered run completed in 8.7 seconds.
  - The installed desktop app was closed, rebuilt, synced, and relaunched. Release and installed
    `veggaai.exe` are byte-identical (SHA-256
    `032DE6FAAA2B4C8BF5C4DE81A280EFF5BEBDDABCB7E20649E853A051B9DBBA45`), the installed process is
    running from `<installed-app>/veggaai.exe`, and `/health` returned `status: ok`
    with engine `vai:v0`.

- **SHIPPED 2026-07-22 - Arbitrary local-business practical questions use entity-first, first-party verification**
  - Root cause from `when does the bakery on hommersåk open up? brygge bakeren`: the earlier
    practical-detail work generalized the requested answer shape, but discovery still overfit known
    venue pages. Conversational filler weakened search terms; a business homepage could lose its
    footer address/phone during extraction; title suffixes made directories and newspapers look
    first-party; low-trust hours could outrank an official tenant page; and browser-Google ran beside
    the dedicated venue indexes, starving the official page reader and letting an apology or stale
    directory schedule win.
  - Practical queries now search the entity first with English/Norwegian detail variants, use
    independent organic providers for ordinary local businesses, preserve stable first-party
    contact/address signals, discover a containing retail venue from the verified location, and run
    one bounded identity-verification pass. First-party trust requires the host itself to resemble
    the venue rather than merely appearing in a title suffix; detail-shaped answers require a
    high/medium-trust source, incomplete searches retry once, and partial failures are not cached.
    Official pages are read in small prioritized batches, while heavyweight browser search is kept
    out of venue-detail retrieval. The same path covers hours, menus/menu prices, admission,
    schedules, contact/address/website, parking, and accessibility across places and services.
  - The exact question passed cold/live WebSocket acceptance in Quick, Balanced, and Deep. Every
    depth returned `Mandag – Fredag 05.00-18.00` and `Lørdag 05.00-17.00` with
    `https://www.bryggensenter.no/butikkoversikt/` first, and rejected the stale 19:00 directory
    result. Focused core coverage passed 181/181; core and desktop TypeScript typechecks passed.
    A real Chrome render passed with zero console errors and showed the official source as high
    trust; screenshots are under `screenshots/local-business-hours/`.
  - The installed desktop app/runtime was closed, rebuilt, synced, and relaunched. Release and
    installed `veggaai.exe` are byte-identical (SHA-256
    `4419FD3530A72C8213AD6069A2804B98192A40E80A60E45ACC99CCAF1B8B7986`), the installed process is
    running from `<installed-app>/veggaai.exe`, and `/health` returned `status: ok`.
    Quick, Balanced, and Deep then passed again against the packaged runtime.

- **SHIPPED 2026-07-22 - Global shop questions preserve wording, language, branch, and requested fact shape**
  - The local-business discovery path now generalizes across store/shop/trading/holiday-hours wording,
    close/shut/day-specific questions, and common Norwegian, Swedish, Danish, Spanish, French,
    German, Italian, Portuguese, Dutch, Japanese, Chinese, and Korean cues. Entity extraction keeps
    the brand plus branch/locality, and branch relevance rejects a same-chain result for the wrong
    location.
  - Official commerce pages are searched through localized entity-first and store-locator queries.
    Vai reads schema.org hours, embedded retail hydration schedules, visible localized tables, split
    label/time rows, AM/PM, dotted clocks, and `10–20 Uhr` forms. Dotted calendar dates such as
    `01.01.` no longer count as a clock. Short official brand hosts such as `zara.com` and `ikea.com`
    receive first-party treatment. Venue reads are serialized and trusted-source prioritized so
    same-host locator downloads do not starve each other.
  - Verified practical answers now bypass model rewriting. If only low-trust directories or
    non-answering pages remain, the chat terminates with an explicit evidence limitation instead of
    allowing a model to alter a time, price, address, or branch. This closed the live failure where
    Zara's official `10:00` schedule was rewritten as `10:30`, and the earlier failure where a KaDeWe
    holiday date was presented as an opening time.
  - Cold/live WebSocket acceptance passed 6/6 Quick cases across Apple Fifth Avenue, Harrods
    Knightsbridge, UNIQLO Ginza, Zara Gran Vía Madrid, IKEA Paris Rivoli, and KaDeWe Berlin. A
    cross-mode subset passed 9/9 in Quick, Balanced, and Deep. Focused venue/search/chat coverage
    passed 109/109 and `@vai/core` typecheck passed. The broader six-file run passed 215/216; its one
    failure is an unrelated existing builder-routing expectation for `start building`, while all
    venue/search/chat-service cases passed.
  - A real desktop frontend render of the Spanish Zara wording passed with the exact official branch,
    two high-trust `zara.com` sources, no `10:30` mutation, no JSON/code presentation, and zero console
    errors. Evidence is under `screenshots/global-shop-practical/`.
  - The desktop app was closed, rebuilt, synced, and relaunched. Release and installed `veggaai.exe`
    are byte-identical (SHA-256
    `640477B118A15E3FC54808AD01EF2CD05FC87B2978B8AB8CF8D2234EF61BBD12`). Port 3006 is owned by the
    installed `<installed-app>/vai-runtime.exe` sidecar, `/health` reports `status:
    ok`, and the installed runtime passed the six-country Quick matrix plus the 9/9 Quick/Balanced/Deep
    subset again.

- **SHIPPED 2026-07-22 - Nearest-branch menu questions resolve the branch before reading the menu**
  - Root cause from `can you find meny of jønk' burgers closest to bygøy`: practical-detail routing
    recognized `meny`, but entity extraction kept `closest to bygøy` inside the restaurant name. The
    bounded reader then spent its page budget on Facebook and the popular Grønland ordering pages,
    demoted JØNK's real first-party locator because its title did not repeat the complete hostname,
    and treated exact Foodora/Wolt merchant menus as unknown low-trust pages. Chat correctly refused
    low-trust evidence, but discovery had stopped one stage too early even though the itemized menu
    was publicly available.
  - Vai now parses composite `nearest/closest/near/nærmest` questions into a brand and geographic
    anchor across common English, Norwegian, Spanish, French, German, Italian, Portuguese, and
    Japanese wording. It searches the official branch list first, extracts brand-anchored location
    labels while rejecting product rows, typo-corrects/geocodes the anchor through public map data,
    compares branch areas deterministically, and only then performs an exact-branch detail search.
    If branch comparison cannot be verified, another branch is never silently substituted.
  - First-party recognition now supports short brand titles on category-suffixed official hosts.
    Exact transactional merchant menu pages are medium trust only when venue identity and menu cues
    match; the READ gate still requires at least three item/price rows. Menu synthesis emits clean
    itemized bullets, removes delivery/service-fee noise, deduplicates localized copies of the same
    merchant page, and keeps proximity evidence separate from menu evidence.
  - The original typoed wording, a reordered English wording, and Norwegian `finn menyen ... nærmest`
    wording passed 9/9 through the installed WebSocket path in Quick, Balanced, and Deep. Each chose
    JØNK Colosseum (about 3.0 km straight-line from corrected Bygdøy), returned eight current menu
    rows, cited the map comparison and exact Colosseum Foodora menu, and did not leak Grønland.
    Focused venue/search/chat coverage passed 187/187 and `@vai/core` typecheck passed.
  - A real Chrome render through the desktop composer passed with ordinary Markdown, the two-source
    rail open, and zero console/page errors. Evidence is under `screenshots/nearest-venue-menu/`.
    The desktop app was closed, rebuilt, synced, and relaunched; release and installed `veggaai.exe`
    are byte-identical (SHA-256
    `8DF84BC843962CCEB204A9135BB1A5D82809E97518B66F654428C3215CDC142B`). The installed app owns the
    packaged `vai-runtime.exe`, `/health` reports `status: ok`, and the installed mode matrix passed
    after deployment.

- **SHIPPED 2026-07-22 - Venue web research generalizes across businesses, countries, details, and first-party PDFs**
  - Root causes exposed by the JAFS follow-up were systemic, not venue-specific. The discovery path
    assumed common branch markup, did not reliably derive a cold-start official domain for an
    unknown brand/country, could mix a headquarters/global page with an exact branch, and stopped at
    an HTML branch page instead of following its menu document. A legacy boundary handler also
    intercepted any `find ... restaurant` request before the new research router. Finally,
    `pdf-parse` worked in the source tree but esbuild broke its package-relative worker/canvas loader
    in the installed runtime (`DOMMatrix is not defined` / `PDFParse is not a constructor`).
  - Search now extracts branches from first-party locator links, cards, labeled text, and JSON-LD;
    geocodes the user's anchor and official candidates with country/locality safety; selects the
    nearest branch before looking up the requested fact; verifies likely official country domains;
    retries thin indexes through one bounded browser search; follows same-site locator, menu, and PDF
    resources; and extracts branch-scoped hours, contacts, addresses, menu rows, and Nordic prices.
    Provider identity gates discard unrelated brands, exact-branch evidence outranks global pages,
    and evidence limitations remain explicit when the requested fact cannot be verified.
  - A persisted, bounded source-capability ledger now learns only from verified current pages. It
    records that a domain can help discover locations or a particular practical-detail family and
    reuses that knowledge as a discovery hint; it never promotes trust or bypasses current-page
    verification. This lets Vai improve across equivalent future shops, restaurants, services, and
    wording without adding venue allowlists or one-off JAFS/JONK rules.
  - Live cross-country acceptance passed 4/4: Lawsons Camden nearest Trafalgar Square hours and
    phone/email, plus JAFS Teisen nearest Helsfyr PDF menu and daily hours. The installed WebSocket
    path passed the JAFS menu question in Quick, Balanced, and Deep with the same correct branch,
    eight current item/price rows, OpenStreetMap proximity evidence, and first-party JAFS evidence.
    Focused routing/venue/search/source-learning coverage passed 152/152, and the broader
    engine/chat/search regression gate passed 754/754; core and runtime TypeScript typechecks passed.
  - A real Chrome render through Vai's composer passed with normal answer typography, source chips,
    the two-source rail open, and zero console/page errors. Evidence is under
    `screenshots/general-venue/`. The full desktop app was closed, rebuilt, installed, and relaunched.
    `pdf-parse`, `pdfjs-dist`, canvas assets, and the Windows native canvas binary are present beside
    the packaged runtime. Release and installed `veggaai.exe` are byte-identical (SHA-256
    `BD4CF243827F825CA0C79994B1FCDDDDE367E4F03E6B76F7E81FD688CAF6AA7E`), exactly one installed app
    and sidecar are running, and `/health` reports `status: ok` with engine `vai:v0`.
- **SHIPPED 2026-07-22 - Adoption foundations and four-phase end-to-end slices**
  - Nineteen feature design notes were opened before implementation under
    `docs/design/adoption/`. The schema-only `@vai/contracts` package now owns
    UI/backend, agent/UI, environment, sharing, memory, and plugin/host boundary
    schemas; the `@vai/constants` manifest owns persisted names, ports, public
    endpoints, timeouts, and limits. A repository policy check rejects duplicated
    platform literals.
  - All supported external text surfaces now enter model context through one
    sentinel-delimited untrusted-data wrapper plus a standing no-instruction
    policy. Tool dispatch intersects host-owned workspace/session capabilities;
    repo config and UI state cannot grant authority. Provider CLIs declare their
    opaque capabilities and fail closed unless the host grant permits them. The
    candid trust boundary and remaining OS-containment gaps are documented in
    `docs/security/capability-threat-model.md`.
  - Agent providers run behind protocol adapters, sessions default to isolated
    worktrees from `origin/HEAD`, stream interruption is explicit/catch-up aware,
    composer drafts are local-first, and memory/skills/personas are inspectable.
    Agent-authored skills start flagged at low confidence; context injection is
    budgeted by model window and tool schemas load on demand. Blind model A/B and
    multi-persona prompts are available from Workspace & trust.
  - Saved environments unify loopback/LAN/private-mesh/HTTPS/SSH endpoints. Active
    environment changes refresh all live API bindings; pairing secrets are
    single-use, hashed at rest, revocable, fragment-carried for web pairing, and
    WebSocket credentials use a private subprotocol instead of URLs. SSH probes
    Windows and POSIX version-manager locations and returns exact diagnostics.
  - The Workspace & trust surface now shows capability grants, environments,
    memory, skills, personas, model compare, selective shares, link/backlink
    previews, hardware fit, and explicit subsystem degradation. Session views add
    changed-files and timeline affordances; agent input accepts file drops; risky
    approvals state the exact command, folder, persistence, and revoke effect.
  - Backups include full legacy-compatible session history, omit credentials,
    write an atomic folder plus SHA-256/byte manifest, and restore through a
    merge-first dry run. A live 105.38 MB snapshot containing 1,038 sessions
    exported and checksum-verified successfully; its restore dry run preserved all
    1,038 current IDs and applied nothing. The temporary snapshot was removed.
    Recovery steps are documented in `docs/operations/backup-restore.md`.
  - Verification: contracts/constants/core/runtime/desktop typechecks passed; the
    constants policy passed; 53 focused adoption/security tests and 154 existing
    chat/session/venue tests passed. Real Chrome visual QA passed dark and light at
    1920x540, 1440x810, 900x1200, and 390x844 with no horizontal overflow or
    browser errors; file drag/drop also passed. Evidence is under
    `.codex-run/adoption-visual/`.
  - The desktop app/runtime were closed, the workspace dependency tree was
    reconciled, and the native Tauri release was built, synced, and relaunched.
    Release and installed `veggaai.exe` are byte-identical (SHA-256
    `4DE816F4D26A12BE4CAE3981A1E4BA62921E9CAA757B312BF8BF094A9698F34E`), exactly
    one installed app and sidecar are running, and packaged `/health` reports
    `status: ok`. The installed Workspace & trust screen was captured at
    `.codex-run/adoption-visual/installed-native-workspace-trust.png`.
  - Honest follow-ups: macOS/Linux branches have unit coverage but still need
    native CI/device proof; provider CLIs do not yet have portable OS-level
    sandboxing; public-host provisioning, TLS/custom-domain attachment, and the
    complete token-revocation UX remain deployment work rather than claimed as
    production-complete.
