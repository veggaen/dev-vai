# Vai Improvement Backlog

Shared queue between V3gga, Vai, and AI agents. Append dated entries with
evidence; mark items DONE with proof (test/screenshot/run). Agents: read
`AGENTS.md` first, and `GET /api/agent/introspect` for live state.

## Open

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
