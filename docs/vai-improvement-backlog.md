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
- **Clickable activity files** (V3gga, 2026-06-13) — file entries in the activity strip should be links: click opens that file in the preview Code editor tab.

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
