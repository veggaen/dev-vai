# Vai engineering company portfolio — 20 missions

Status: active and audited 2026-07-23; M01 shipped with evidence in
`truthful-turn-receipts.md`.

## Operating model

This portfolio treats Vai as a product and an institution, not as a collection
of unrelated features. Missions were selected from four independent evidence
tracks: principal architecture/security, senior product/AI quality, SRE/release,
and the live Vai operator/introspection reports.

Execution rules:

- One mutating P0 mission at a time. Read-only audits and disjoint verification
  may run in parallel.
- Every mission opens its own design note before code, names a rollback, and
  defines observable acceptance before implementation.
- Security, data integrity, and process truth precede breadth.
- Model output is never the acceptance oracle. Contracts, deterministic tests,
  rendered proof, and human-visible receipts remain Vai-owned gates.
- Windows proof is required for every desktop change on the owner machine.
  macOS/Linux parity is claimed only after native CI/device evidence.
- No heavy build, browser, GPU, or disk task runs beside another heavy task.
- A mission is not shipped until its evidence is in
  `docs/vai-improvement-backlog.md` and its branch/commit state is explicit.

## Portfolio

### M01 — Truthful turn and process receipts

- Priority/owner: P0 · Conversation Infrastructure.
- Evidence: `progress-trace.ts` promotes persisted `running` steps and tools to
  `done`; the test suite explicitly preserves that behavior. The desktop also
  infers failure from label text.
- Outcome: versioned terminal outcomes (`succeeded`, `failed`, `interrupted`,
  `withheld`, `not-run`) and stable evidence IDs across live and reloaded views.
- Dependencies: none.
- Acceptance: error, disconnect, cancellation, and crash fixtures never reload
  as success; terminal updates cannot be overwritten by stale running frames;
  legacy traces remain readable without rewriting their history.
- Primary risk: migration compatibility and noisy false interruptions.

### M02 — Self-improvement adoption control plane

- Priority/owner: P0 · Vai Improvement Office.
- Evidence: 302 queued fixes, 86 qualified proposals, zero shipped over 919
  compute units, six weak quality classes, and a stale 2026-07-02 heartbeat.
- Outcome: pause duplicate generation, deduplicate/rank the queue, and expose an
  owner board with evidence, risk, assignee, expiry, decision, rollback, and
  realized quality/compute ROI.
- Dependencies: M01.
- Acceptance: three qualified proposals ship through review and gates; repeated
  lessons collapse; every rejection has a reason; realized ROI is non-zero
  before proposal generation resumes.
- Primary risk: automating code changes faster than review capacity.

### M03 — Mandatory local authority and credential bootstrap

- Priority/owner: P0 · Product Security.
- Evidence: core API auth defaults off without configured keys and loopback can
  bypass route auth, conflicting with the multi-user-machine threat model.
- Outcome: per-install credential in the OS credential store, authenticated
  non-public routes on loopback, integration-scoped revocable sessions, and a
  dev bypass that cannot ship.
- Dependencies: contracts/constants foundation.
- Acceptance: an unrelated local process receives 401/403 while the desktop
  bootstraps successfully; secrets never enter URLs/logs; recovery is tested.
- Primary risk: locking the owner out of a local installation.

### M04 — Universal model-context gateway

- Priority/owner: P0 · AI Security.
- Evidence: dozens of production model invocation sites exist, while the
  untrusted-content wrapper appears at only a fraction of those boundaries.
- Outcome: one gateway is the only component allowed to invoke model adapters;
  untrusted text becomes a branded type and raw bypasses fail CI.
- Dependencies: M03 and boundary registry work in M20.
- Acceptance: web, repo, tool, docs/comments, memory, skill, agent, and provider
  injection fixtures cannot issue instructions or escalate authority.
- Primary risk: prompt/token changes alter answer quality during migration.

### M05 — Transactional persistence and migration ledger

- Priority/owner: P0 · Data Platform.
- Evidence: database migrations are distributed and broad SQL errors can be
  treated as “already exists”; JSON stores silently return fallback data on
  malformed reads and lack schema validation/fsync/recovery.
- Outcome: numbered/checksummed transactional migrations, automatic
  pre-migration backup, schema-validated atomic stores, last-good recovery, and
  visible corruption states.
- Dependencies: contracts/constants.
- Acceptance: injected disk-full, malformed JSON, interrupted rename,
  concurrent writer, corrupt migration, and Windows replace fixtures never
  silently discard user data.
- Primary risk: migration mistakes strand real profiles.

### M06 — Capability kernel v2

- Priority/owner: P0 · Runtime Security.
- Evidence: six coarse capability classes cannot express path/domain/resource
  policy; legacy filesystem/browser/process/Git helpers remain outside the
  central dispatcher.
- Outcome: action + resource + workspace/session policy, typed denial receipts,
  granular Git authority, and explicit degraded containment per OS.
- Dependencies: M03, M05, M09.
- Acceptance: malicious repo/config/provider fixtures cannot write outside
  scope, access network in no-network, or spawn in no-shell on all desktop OSes.
- Primary risk: portable OS containment differs materially by platform.

### M07 — Provider and plugin isolation supervisor

- Priority/owner: P1 · Extensibility Platform.
- Evidence: provider CLIs run as the current user; event payloads/lines are not
  fully bounded; cancellation may not kill Windows process trees; plugin-host
  contracts exist without a complete isolated host.
- Outcome: versioned framed IPC, capability manifests, publisher trust,
  backpressure/size limits, redacted diagnostics, crash budgets, timeouts, and
  process-tree termination.
- Dependencies: M05 and M06.
- Acceptance: malformed/oversized payload, fork-bomb, crash-loop, secret-read,
  and out-of-scope-write fixtures remain contained.
- Primary risk: provider protocol drift and OS process semantics.

### M08 — Durable agent journal and reconnect semantics

- Priority/owner: P1 · Agent Sessions.
- Evidence: live agent sessions/events are held in process memory, a resumable
  cursor is declared but unused, and runtime restart loses the active journal.
- Outcome: transactional `(session, sequence)` journal, ACK/cursor catch-up,
  explicit provider non-resumability, retention/export, and exactly-once replay.
- Dependencies: M01, M05, M07.
- Acceptance: reconnect and runtime-restart chaos tests preserve ordered events
  without duplication; partial streams terminate visibly.
- Primary risk: write amplification and sensitive output retention.

### M09 — Canonical workspace identity and native boundary split

- Priority/owner: P1 · Desktop Platform.
- Evidence: several path owners lowercase paths on every OS, conflating distinct
  Linux paths; Tauri `main.rs` contains a wide Windows-heavy command/unsafe
  surface.
- Outcome: OS-aware path identity, symlink/junction containment, Unicode rules,
  and platform-neutral native command facades with Windows/macOS/Linux modules.
- Dependencies: boundary contracts.
- Acceptance: case, inode, junction, symlink, Unicode, PTY, and shell fixtures
  pass natively on three OSes; unsupported features report degraded explicitly.
- Primary risk: TOCTOU and network filesystem behavior.

### M10 — Incremental ignore-aware workspace index

- Priority/owner: P1 · Developer Intelligence.
- Evidence: context helpers can synchronously rewalk up to 20,000 files with a
  fixed ignored-directory list rather than nested ignore rules.
- Outcome: watcher-backed per-workspace index with `.gitignore`/global/nested
  ignores, hashes, binary/size/symlink policy, freshness watermark, and bounded
  reconciliation.
- Dependencies: M09 and M20 performance telemetry.
- Acceptance: a 100k-file fixture performs no whole rescan after a one-file
  edit; overflow recovery is visible; `/health` p95 stays under 25 ms.
- Primary risk: lost watcher events and stale results.

### M11 — One inspectable conversation-context resolver

- Priority/owner: P0/P1 · Conversation Intelligence.
- Evidence: follow-up logic is split across contextual, format-only, recency,
  relational, venue, dialogue-state, and private engine rewriters; current
  follow-up/context-carry pass rate is 41%.
- Outcome: typed carried slots with source turn, confidence, scope reset, and
  one deterministic precedence policy shared by every mode.
- Dependencies: M01.
- Acceptance: at least 300 sealed multi-turn scenarios reach ≥97% referent/entity
  accuracy, <1% stale-topic carry, zero answer-shape leakage, and mode-invariant
  verified facts.
- Primary risk: over-resolving an intentional new topic.

### M12 — Render proof inside the builder transaction

- Priority/owner: P0/P1 · Builder Platform.
- Evidence: static validation is in the council pipeline, but effective-module
  resolution and screenshot/console proof remain external.
- Outcome: resolve the live module, build on a shadow port, capture console and
  network evidence, run request-specific DOM/visual assertions, then atomically
  promote or retain the previous preview.
- Dependencies: M01 and M20.
- Acceptance: a 20-case React/Next/Vite/monorepo matrix proves the requested
  visible change, exact changed files, zero new console errors, and safe rollback.
- Primary risk: latency and framework detection.

### M13 — Global practical-web research corpus

- Priority/owner: P1 · Research Intelligence.
- Evidence: recent venue work is strong but live proof covers only a small set
  of shops/countries relative to the hours/menu/prices/contact/accessibility
  problem family.
- Outcome: frozen multilingual fixtures plus a separate live canary set across
  20+ countries, 10+ languages, locators, PDFs, delivery menus, closures, and
  ambiguous branches.
- Dependencies: M01 and M11.
- Acceptance: ≥95% requested-fact precision, ≥98% entity/branch accuracy, zero
  unsupported mutation of times/prices/addresses, explicit insufficiency, and
  mode-invariant facts.
- Primary risk: live-site drift and legal/robots boundaries.

### M14 — Normal-app dictation acceptance matrix

- Priority/owner: P0/P1 · Voice Platform.
- Evidence: automatic insert and Copy/Close fallback exist, but the real
  Chrome/Facebook hold and a focused hook-level suite remain incomplete.
- Outcome: repeatable native acceptance for Chromium input/contenteditable,
  Facebook-style composer, Electron, WebView, terminal, and native edit controls.
- Dependencies: M01 and M09.
- Acceptance: ≥99% delivery to unchanged focus, p95 release-to-insert <1.5 s,
  zero stray Enter/focus theft/wrong-window paste, correct clipboard restoration,
  and fallback only when no target is proven.
- Primary risk: accessibility permissions, IMEs, clipboard locks, anti-cheat.

### M15 — Measured voice-accuracy coach

- Priority/owner: P1 · Speech Intelligence.
- Evidence: speech profiles and quality guards exist, but calibrated confidence,
  phrase priming, WER, semantic-drift measurement, and reversible alternatives
  remain incomplete.
- Outcome: private calibration, contextual phrasebook, low-confidence
  alternatives, and measured correction learning.
- Dependencies: M14.
- Acceptance: ≥20% relative WER reduction, ≥30% named-entity error reduction,
  zero unconfirmed semantic flips, and reversible corrections on a fixed corpus.
- Primary risk: privacy, accent overfitting, and fluent meaning changes.

### M16 — Governed memory and persona product loop

- Priority/owner: P1 · Personal Intelligence.
- Evidence: memories are extracted and editable but are not consistently
  consumed by chat; blind compare is serial, in-memory, order-visible, and lacks
  robust partial-failure/cancellation behavior.
- Outcome: scoped/budgeted memory retrieval with visible provenance plus durable,
  randomized, parallel, failure-isolated persona/model comparisons.
- Dependencies: M04, M05, M11, M17.
- Acceptance: ≥90% memory precision, zero cross-workspace leakage, immediate
  delete/archive effect, durable randomized A/B votes, and one-lane failure
  containment.
- Primary risk: stale preferences, privacy, and GPU contention.

### M17 — Accessibility and legibility release gate

- Priority/owner: P1 · Design Systems.
- Evidence: the design language requires 40 px touch targets at narrow widths,
  while current operations UI includes 9 px metadata and small icon actions;
  no dedicated core-flow accessibility gate exists.
- Outcome: keyboard, screen-reader, zoom, focus, reduced-motion, touch-target,
  and live-region acceptance across essential desktop flows.
- Dependencies: begin before expanding M15/M16 surfaces.
- Acceptance: WCAG 2.2 AA, zero serious/critical axe findings, keyboard-only
  completion of core flows, 200% zoom without clipping, and correct focus return.
- Primary risk: harming dense pointer-oriented IDE ergonomics.

### M18 — Deterministic CI, test, and performance system

- Priority/owner: P0 · Developer Productivity.
- Evidence: latest main CI took 18m27s; superseded runs are not cancelled;
  advisory scenario/browser/performance work sits on the critical job; search
  p50/p95 breached 400/1200 ms budgets at 5480/7536 ms without blocking.
- Outcome: concurrency cancellation, timeouts, hard PR lane, parallel advisory
  and nightly lanes, safe test shards, generated-test freshness, flake/timing
  history, and ratified performance budgets.
- Dependencies: M01 and M20.
- Acceptance: p50 critical PR path <8 min, p95 <12 min; superseded runs cancel
  <60 s; deterministic full lane <12 min; flake <0.5%; real budget breaches fail.
- Primary risk: moving valuable signal out of the required lane.

### M19 — Cross-platform release and software-supply chain

- Priority/owner: P0/P1 · Release Engineering.
- Evidence: CI is Ubuntu-only; the release workflow reads a missing root version,
  “succeeds” while skipping release, builds no installer, and publishes no SBOM,
  checksum, provenance, signing, install smoke, or rollback pointer.
- Outcome: one version source, tested-SHA release PR, Windows/macOS/Linux native
  build/launch/health smoke, immutable artifacts, checksums, SBOM, attestations,
  signing/notarization, update and rollback.
- Dependencies: M18 and M09.
- Acceptance: one semver release produces three verifiable native artifacts;
  a failed OS blocks stable publication; clean machines install, launch, answer
  health, preserve user data through update, and rollback.
- Primary risk: signing secret/certificate handling and accidental releases.

### M20 — Privacy-safe observability, recovery, and incident readiness

- Priority/owner: P1 · Site Reliability.
- Evidence: Fastify logging is disabled, runtime diagnostics are scattered
  console lines, backup routes lack full route/drill coverage, and only one
  postmortem exists.
- Outcome: redacted structured logs and correlation IDs, local RED metrics,
  bounded diagnostics export, restore drills, severity/runbook system,
  last-known-good rollback, and failure-injection exercises.
- Dependencies: contracts/constants and M05; supports every later mission.
- Acceptance: golden paths are traceable without prompts/tokens/secrets;
  cross-platform clean-profile restore meets RPO ≤24 h/RTO ≤30 min; rollback
  <10 min; quarterly game day MTTR ≤30 min with permanent regression evidence.
- Primary risk: diagnostic bundles leaking private conversations or credentials.

## Delivery waves

1. **Wave 0 — truth and authority:** M01, M02, M03, M04, M05.
2. **Wave 1 — containment and scale:** M06, M07, M08, M09, M10.
3. **Wave 2 — product intelligence:** M11, M12, M13, M14, M15, M16, M17.
4. **Wave 3 — company reliability:** M18, M19, M20.

M01 begins first because every later dashboard, gate, experiment, and incident
report depends on persisted work being labeled truthfully.
