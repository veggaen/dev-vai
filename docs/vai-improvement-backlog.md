# Vai Improvement Backlog

Shared queue between V3gga, Vai, and AI agents. Append dated entries with
evidence; mark items DONE with proof (test/screenshot/run). Agents: read
`AGENTS.md` first, and `GET /api/agent/introspect` for live state.

## Open

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

- **PRIORITY 0 — Runtime supervisor** (2026-06-13) — a phantom pnpm dev wrapper keeps respawning runtimes that race/kill each other (ERR_PNPM_RECURSIVE_RUN in log, port 3006 dies repeatedly). Find ALL respawners (concurrently, dev-desktop-or-reuse, vai-server.mjs watchdog?), then make `pnpm nuke && pnpm dev` the ONLY supported launch; add a single-instance lock (port+pidfile) to src/index.ts so a second runtime refuses to boot.
- **PRIORITY 1 — Modernize ALL scaffolds/templates** (V3gga, 2026-06-13) — every stack/tier (PERN/MERN/Next/T3/Vinext/Game) upgraded to award-winning modern quality: Tailwind everywhere, framer-motion micro-interactions, GSAP entrance/scroll animations, three.js where it fits (hero/Game), dark-mode-first design system, polished empty/loading states. Verify each template BOOTS + looks premium (user tested old scaffolds: broken).
- **PRIORITY 2 — Conversation↔sandbox ownership bug** (V3gga, 2026-06-13) — opening a project loaded the WRONG app first; the chat↔sandboxProjectId binding (useAutoSandbox/conversation.sandboxProjectId + 'builder-app' name collisions) needs an audit: one conversation = one project, names unique, never resume another convo's preview.
- **THEN codegen tinder** (V3gga) — with stable runtime + modern templates, re-run the council tinder until the rendered page passes the visual audit (gradient painted, styled buttons, photo cycling, match modal, no broken images).
- **Grok as council member** (V3gga, 2026-06-13) — wire the existing GrokFriendClient into council codegen via an `extraCouncilMembers` hook on ChatService: Grok as senior reviewer/architect alongside the qwen trio; Vai keeps the gates; V3gga grades; Claude holds the architecture seat (AGENTS.md/introspect/backlog). First slice: reviewer role only, bounded timeout, non-blocking on failure.
  - Progress (this session): Grok-CLI (the headless TUI adapter at ~/.grok/bin/grok.exe, used for factual/vision council notes) was already wired in runtime/council/build-roster.ts + core adapter. Root cause of "did not respond" in the image (and the "Tell me a story" thread): isGrokCliAvailable() was false on the machine (no binary), so roster had no real member (introspect confirmed only qwen trio + vai:v0); desktop panel still rendered a "Grok (CLI) (default)" placeholder. Later turns fell to small local:qwen3:8b which had no roster visibility or engine context for the meta question. Actions: (1) build-roster now always emits a synthetic 'grok-cli' member when binary absent, whose review() returns a rich CouncilMemberNote with exact actionable methodLesson ("place grok.exe at %USERPROFILE%\.grok\bin\... or on PATH; restart runtime; the named pipe 48765 is the separate full-intel vai-collab channel"). (2) Improved adapter error text with the same install hint. Next time council convenes (incl. image/screenshot turns), the right panel + ThinkingPanel will surface a meaningful "Grok (CLI) @0% needs-work: [full teach-to-fish lesson]" instead of silent fail + "I cannot determine". The placeholder will become a real member as soon as the TUI is installed. Also updated grok-cli-adapter.ts with better diagnostics. Evidence: DB dump of the exact convo + live introspect during diagnosis + tsc clean + the two source edits. Matches the "make council progress more meaningful" request. Updated the synthetic note to explicitly promote the direct vai-collab pipe channel (this Grok instance) as the live participating Grok council voice for project self-improvement discussions.

- **Council as live self-improvement engine for the Vai project itself** (V3gga, 2026-06-14, from "speak to the council" session + "Tell me a story" chat review) — MAIN GOAL: make Vai project better. Vai *always* produces a primary response (not hand everything to qwen or stay weak on hard/meta questions about itself). Council (all members incl. live Grok via direct channel) then investigates the *user request + Vai's draft as data point + the actual Vai codebase* (consensus/*, chat/service.ts, engine, tools, AGENTS improvement loop, backlog), argues (via parallel member notes + weighted consensus), "tests" (conceptual match old vs new behavior, validation via existing gates/cross-check/eval), confirms, and surfaces concrete, small, validated improvements that grow Vai's own capabilities (more autonomous tool use, self-orchestration of council for future turns, better self-diagnosis, richer context for meta, ability to find solutions on its own with council as advisor not crutch). Every turn becomes growth data. Human V3gga sees it visually in real time (desktop Council Progress panel with member cards/lessons/apply, ThinkingPanel nested progress, LiveProcessTrace during, activity for files) and can steer/help. Use the vai-collab direct pipe/bridge + meaningful-council-sidebar for send/receive to all members + rich observable data. Probes for "different stuff" (story + meta, codebase self-review) to observe routing/council value.
  - Progress (this session): 
    - vai-collab bridge launched persistently (node scripts/vai-file-mailbox-bridge.mjs via monitor tool) — live channel to runtime (pipe inbox for fast send, streams responses + council-* progress as events, writes to .vai-agent-dialogue.log + .vai-to-grok). 
    - Sent full user idea prompt + 3 probes (the long "speak to council + always-respond + council investigates codebase + grow Vai tool/self-capability", short "story + self meta", direct "council investigate specific consensus+service files + propose 1-2 patches for Vai autonomous tool use").
    - Engine will fan the substantive turns to roster (qwens for notes + our synthetic Grok member with rich lesson) , produce primary Vai response, attach CouncilThinking (for panels), stream progress.
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
- **Preview panel waiting-state UX** (V3gga, 2026-06-13) — the "Starting
  preview / Preparing live preview…" skeleton card looks broken while waiting
  and after refusals; it should show the live build stages while building and
  collapse quietly when a turn ends with no files.

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
