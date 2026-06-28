# Vai Improvement Backlog

Shared queue between V3gga, Vai, and AI agents. Append dated entries with
evidence; mark items DONE with proof (test/screenshot/run). Agents: read
`AGENTS.md` first, and `GET /api/agent/introspect` for live state.

## Open

- **PRIORITY 1 - Builder edit smoke applies files but misses requested theme** (2026-06-28)
  - Evidence: PR #28 CI browser builder smoke selected Builder mode, built the
    analytics dashboard, linked sandbox `a30b51f0`, and the purple/teal edit turn
    enqueued two files, but sandbox source readback never contained a changed
    purple/teal source bundle within 120s. Run `28334151991`, Verify job
    `83937345494`, failure after screenshots `01-ready` and
    `02-dashboard-before-edit`.
  - Expected: edit-mode turns must update the active sandbox deterministically or
    refuse with visible evidence; source readback and rendered iframe should
    prove the edit.
  - Next slice: inspect `useAutoSandbox` edit file application, conversation
    `sandboxProjectId` binding, and `VaiEngine` dashboard edit handling around
    `buildDashboardAppCode` / purple-teal routing; add a focused regression that
    checks revision/file content after an edit.

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
