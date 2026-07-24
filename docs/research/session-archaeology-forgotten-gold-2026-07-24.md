# Project-session archaeology: forgotten gold

Status: completed 2026-07-24. This is a bounded, privacy-preserving review of
project-linked local sessions, not a transcript archive or an authority source.

## Outcome

The old position that prior sessions had no decision-relevant material outside
the canonical docs was too strong. Most historical ideas have been absorbed, but
five useful product gaps and three important partially absorbed directions
survived a fresh-context review.

The highest-leverage concrete gap is not another model feature. Vai still
exposes a second agent-task input inside the workspace even though the owner
already said all work should begin in the main conversation composer. The
highest-leverage architectural gap is context provenance: the repo has a design
for a token-budget receipt, but no implemented receipt that tells a human or Vai
what context was used, considered, omitted, or unavailable.

No historical transcript is promoted as instruction. The catalog below is a
human-readable reinterpretation checked against the current repository.

## Coverage ledger

The final reproducibility pass scanned 3.40 GiB of project-attributed local data
and normalized 3,032 human messages plus 22,763 assistant messages. Tool results, subagent
payloads, hidden reasoning, obvious provider envelopes, unrelated Codex working
directories, and imported duplicate Vai event streams were excluded.

| Source | Project sessions found | Sessions represented in normalized evidence | Human messages | State |
|---|---:|---:|---:|---|
| Codex | 59 of 87 discovered | 59 (58 with a human turn) | 1,254 | Covered with format limit: 8 oversized lines skipped |
| VS Code chat | 90 of 91 discovered | 54 | 415 | Partial: 154 oversized state snapshots skipped |
| VS Code Claude extension | 40 | 40 | 427 | Covered; one malformed line rejected |
| Cursor | 15 | 13 | 266 | Covered for readable main-agent transcripts; subagents excluded |
| Antigravity | 14 of 36 discovered | 14 | 20 | Project-attributed SQLite trajectories decoded; 22 legacy protobuf files had no safe project attribution |
| Grok | 19 | 18 (16 with a human query) | 29 | Covered after separating `<user_query>` from workspace/rules envelopes |
| Native Vai conversations | 472 | 472 (466 with a human turn) | 621 | Covered as product-use/evaluation evidence; imported editor logs excluded |

The total is 709 project/product-linked sessions. “Represented” does not mean
every byte was semantically useful. It means at least one bounded user or
assistant message survived parsing and filtering.

### Honest limits

- VS Code stores some session snapshots as individual 100 MiB-to-gigabyte JSON
  lines. Reading those whole would recreate the stability problem the audit is
  meant to study. Incremental rows recovered 54 sessions; the other 36 are
  inventory-only in this pass.
- Codex was filtered by the actual `session_meta.cwd`. The older bridge's title
  index can label unrelated sessions as `dev-vai`; that index was not trusted.
- Antigravity's 22 legacy `.pb` files were not attributed from filenames or
  guesses. Only 14 SQLite trajectories containing project evidence were read.
- Native Vai conversations include real usage and evaluation prompts, not only
  development planning. They were useful as behavior evidence but did not
  receive extra weight as product decisions.
- Browser-hosted conversations that were never persisted locally, deleted
  sessions, encrypted hidden reasoning, and provider cloud history are outside
  this report.
- Timestamps and provider/session IDs are retained for auditability. Raw local
  paths, transcript bodies, credentials, cookies, and unrelated content are not
  reproduced here.

## Fresh-context method

The extraction produced 1,000 high-recall, exact-deduplicated candidate
passages. A second pass grouped semantic repeats and rejected:

- copied system prompts, handoff boilerplate, patches, logs, and tool output;
- model suggestions the owner never adopted or repeated;
- ideas already shipped with stronger verification;
- attractive concepts with no safe, testable product behavior;
- project directions already represented faithfully in the active 20-mission
  portfolio.

Each surviving idea was then read as if it were Vai's founding message. The
score is an editorial aid, not a benchmark: usefulness, meaning/alignment,
clarity, current relevance, and actionability are each worth 20 points.

## Ranked catalog

### 1. One composer owns every instruction — 98/100

**State:** still missing.

**Representative provenance:** Grok session
`019f3dbd-4039-7e72-8142-291cf9d8ad03`, 2026-07-08. The owner said the two
places to type were confusing and that agent work must remain rooted in the
original chat.

**First-message rewrite:** There is one place where a human tells Vai what to
do: the conversation composer. Selecting a file, app, diff, browser step, or
workspace changes the context attached to that composer; it must not create a
second conversational command box.

**Why it survives:** This is immediately understandable to a new user and
reduces mode errors. It also makes voice, attachments, approvals, memory,
personas, and reconnect behavior share one tested input path.

**Current comparison:** the primary composer is in `ChatWindow`, but
`WorkspaceLauncher.tsx:251` still renders `Ask the coder to change this file…`
with its own Generate and Council actions. That is the exact interaction the
historical message rejected. The code editor textarea is legitimate direct
manipulation; the second natural-language task input is the conflict.

**Smallest experiment:** write a design note for composer ownership, replace
the workspace task field with a “mention this file in chat” action, and send the
selected file/role as typed composer context. Test one file edit, one Council
edit, keyboard focus, voice dictation, and narrow layouts.

**Disproof:** do not remove the field if a blinded usability test shows that
people complete file edits more reliably with two command surfaces and can
correctly explain their different ownership in at least 95% of trials.

### 2. Crash-safe portable work checkpoints — 96/100

**State:** partially absorbed and already represented by M08, but cross-tool
continuity remains missing.

**Representative provenance:** VS Code Claude sessions
`86035f85-0315-4ed1-a85c-dc35b68f6309` (2026-06-20) and
`8e7bddbf-6130-41e4-adc3-8ca1f43dbcfa` (2026-06-21), plus Codex session
`019e859a-7154-77d3-9fdd-78c2b01780da` (2026-06-01). Each begins by manually
reconstructing work after an editor/app crash.

**First-message rewrite:** After every meaningful state change, Vai can recover
the work from a compact, user-owned checkpoint: objective, decisions, changed
files, uncommitted state, completed and failed gates, open risks, and the next
safe action. A new provider may import that checkpoint as untrusted evidence,
not blindly continue a transcript.

**Why it survives:** It solves the repeated human experience behind this audit:
the owner should not have to paste the tail of a crashed chat into another tool.
Compact checkpoints also avoid feeding enormous provider snapshots back into a
model.

**Current comparison:** the 2026-07-09 backlog entry proves reload recovery for
Vai's own project-bound chat edits. The active staff portfolio's M08 correctly
specifies a durable journal and reconnect cursors. Neither is yet a portable,
provider-neutral handoff record for VS Code, Cursor, Codex, Antigravity, and
Grok.

**Smallest experiment:** add a schema-only `WorkCheckpoint` contract and a
read-only exporter for one Vai agent session. Include evidence pointers rather
than transcript bodies. Validate an import into a fresh session without granting
capabilities or replaying old actions.

**Disproof:** retire the portable layer if restart/provider-switch chaos tests
show native journals recover the same objective, file state, decisions, and
failures with no manual reconstruction and no provider lock-in.

### 3. Inspectable context provenance — 95/100

**State:** partially absorbed as a design, not implemented.

**Representative provenance:** VS Code Claude session
`2e8a83d7-22db-4f71-816d-ac4ee4b3a6d2`, 2026-06-20. The owner described
“used context, unused context and considered context” and tied it to Council
members receiving the right view and tools.

**First-message rewrite:** Every model or Council contribution carries a
context receipt. It names the material used, considered but excluded, unavailable,
or rejected as unsafe; why each decision was made; its token cost; and which
claims depend on it. Humans can inspect the receipt without exposing hidden
reasoning.

**Why it survives:** This converts “the model had context” from a claim into
evidence. It helps diagnose wrong answers, context-window pressure, stale
memory, cross-workspace leakage, and needless token use.

**Current comparison:** `docs/design/adoption/10-context-budgeting.md:13`
requires an inspectable budget receipt, but repository search found no
production context-receipt implementation. Current process receipts describe
what ran, not the inclusion/exclusion lineage of model context.

**Smallest experiment:** define a schema-only receipt with source ID, trust
class, decision, reason code, estimated tokens, scope, and consumer. Emit it in
shadow mode for 100 turns before changing prompts or UI.

**Disproof:** stop after shadow mode if receipts cannot predict or explain any
misroute, stale-memory error, injection rejection, or material token saving, or
if they require storing sensitive text instead of safe references.

### 4. Proof-carrying Council contributions — 94/100

**State:** partially absorbed by the adoption control plane; member-level
experiments remain incomplete.

**Representative provenance:** the same VS Code Claude session
`2e8a83d7-22db-4f71-816d-ac4ee4b3a6d2`, 2026-06-20. The owner wanted members
to test their ideas independently, prove a state difference, and present that
proof for synthesis.

**First-message rewrite:** Council members do not win by sounding convincing.
For change proposals, each member returns a bounded experiment receipt:
hypothesis, isolated scope, exact change or artifact, tests run, result,
resource cost, known failure, and rollback. Vai compares proof packets and owns
the final decision.

**Why it survives:** It preserves the institution-over-model doctrine and makes
Council disagreement useful. It also prevents a persuasive model from turning
untested speculation into self-modifying code.

**Current comparison:** M02 now deduplicates proposals, enforces owner decisions,
requires evidence and rollback, and credits only positive measured shipments.
The adoption design and worktree-session design do not yet prove that each
Council member can run a bounded isolated experiment and submit the same typed
receipt before consensus.

**Smallest experiment:** extend one M02 work item with an `ExperimentReceipt`
from a read-only diagnostic or a tiny isolated worktree test. Do not allow
automatic merge or full-suite fan-out.

**Disproof:** keep Council at critique-only if isolated member experiments add
more latency/compute than verified information, repeat identical work, or cannot
be contained under capability scopes.

### 5. Private project chronicle and intent graph — 92/100

**State:** partially designed, not implemented as cross-conversation intent.

**Representative provenance:** Codex session
`019dbbd1-522a-70b3-a2e3-3793d5e36d75`, 2026-04-24. An old advisor proposed a
private cross-conversation graph of goals, projects, and recurring themes.

**First-message rewrite:** Vai maintains a private, user-owned chronicle that
links goals, decisions, experiments, files, sessions, runs, and evidence across
providers. A new chat may offer relevant prior threads with provenance, but
only the human chooses what enters the current context.

**Why it survives:** This is the product form of “forgotten gold.” It makes
long-running human intent recoverable without loading every transcript and
without pretending a summary is authoritative.

**Current comparison:** `docs/design/adoption/15-linked-navigation.md:5`
designs a typed link index across files, sessions, runs, docs, and memories.
Current capability docs still list persistent cross-conversation personal
context as absent, and classifier signals remain last-N-turn only. The design
does not yet model goal/decision/evidence edges or cross-provider provenance.

**Smallest experiment:** import only explicit goals and decisions from a small
user-selected session set into a versioned JSON graph. Show every edge's source
and offer “attach to this chat”; do not auto-inject.

**Disproof:** do not generalize if a sealed review cannot reach 90% precision on
relevant-thread suggestions, if deleted material resurfaces, or if any
cross-workspace canary leaks.

### 6. Visible, replayable browser work — 91/100

**State:** still missing.

**Representative provenance:** Cursor session
`65df2041-26ac-4f02-8e43-1003380ec5d1`, 2026-06-12. The owner disliked a blank,
unfocusable automation browser and asked for browser work to be visible inside
the chat.

**First-message rewrite:** When Vai uses a browser, the turn shows a bounded
browser-work artifact: current site, safe action timeline, relevant screenshots,
extracted evidence, status, and stop/close controls. The artifact is replayable
after the turn. Credentials, cookies, hidden pages, and unrelated tabs are never
captured.

**Why it survives:** Visible tools are how a human steers Vai and verifies that
the source, branch, menu, or page is the intended one. A full interactive
browser is not required to deliver the first benefit.

**Current comparison:** `SidebarPanel.tsx:894-898` explains that the ghost
`about:blank` Chrome window is an external agent browser and tells the owner how
to close or run it headed. There is no chat-native browser event or replay
artifact.

**Smallest experiment:** add a redacted browser-tool receipt with URL origin,
action kind, timestamp, screenshot/evidence references, and terminal status.
Render it as an expandable chat card for one search path before attempting live
remote control.

**Disproof:** fall back to a redacted evidence timeline if screenshot capture
cannot reliably prevent secret/PII exposure or materially degrades browsing.

### 7. Consent-based correction learning — 90/100

**State:** partially absorbed for voice; not generalized.

**Representative provenance:** VS Code session
`dea19507-af3d-4979-85cb-1dcc370c25a8`, 2026-07-03. The owner asked Vai to
notice a two-word correction, understand why, and remember it for future
dictation.

**First-message rewrite:** A user edit is evidence, not permission. Vai may show
the before/after difference and ask whether to remember a pronunciation, name,
format, or style preference. Accepted lessons retain context, confidence,
revision history, and delete/undo controls; rejected or ambiguous edits teach
nothing.

**Why it survives:** Corrections are higher-signal than guesses about personal
style. The consent boundary keeps personalization useful instead of invasive.

**Current comparison:** the voice pipeline has a local speech profile,
post-dictation correction detection, and a confirmed “Remember correction”
flow. The backlog correctly keeps confidence, contextual pairs, WER, and
semantic-drift validation open. This is active work, not a forgotten new
feature; the fresh review mainly clarifies its consent contract.

**Smallest experiment:** finish M15's fixed voice corpus and store accepted
correction pairs with target app, device/language, confidence, and undo. Do not
generalize to arbitrary editor or assistant-message edits until voice precision
is proven.

**Disproof:** stop promotion if corrections overfit one context, silently flip
meaning, or fail to improve named-entity error/WER on a held-out corpus.

### 8. Reversible memory consolidation proposals — 82/100

**State:** still missing, with material safety constraints.

**Representative provenance:** Codex session
`019dbbd1-522a-70b3-a2e3-3793d5e36d75`, 2026-04-24. An old advisor called it
“Sleep Consolidation”: combine many low-level memories into a higher-level
concept.

**First-message rewrite:** Vai may periodically propose that redundant memories
be grouped into a concise concept. It never rewrites or deletes originals
automatically. The proposal shows every source, contradiction, age, scope, and
confidence; a human approves, edits, rejects, or rolls it back.

**Why it survives:** The current request proves that unstructured history grows
faster than humans can review it. Safe consolidation could reduce prompt/index
noise while preserving the evidence chain.

**Current comparison:** memory and agent-authored skill records are now visible,
editable, deletable, scoped, and confidence-aware. Repository search found no
memory-consolidation implementation. A naive nightly model summary would violate
Vai's trust model, so only a reversible proposal is promotable.

**Smallest experiment:** run a read-only duplicate/contradiction report over a
small synthetic memory set. Measure precision and provenance preservation; do
not write to the memory store.

**Disproof:** reject the feature if proposals merge materially different
contexts, conceal contradictions, lose source lineage, or save too little
retrieval budget to justify review cost.

## Absorbed or superseded themes

These ideas were valuable historically but should not be rediscovered as new
missions:

- **Dynamic human-like competition:** absorbed into the identity-blind
  competition, mutation waves, controls, and v5 protocol.
- **Physical-world product planning:** absorbed into
  `product-engineering-intent.ts`, including hardware, sensors, BOM,
  compatibility, enclosure, and sourcing signals.
- **Creative and casual turns:** `write a haiku` and `gg wp` now have explicit
  routing regressions.
- **Echo/reusable skill extraction:** absorbed in the inspectable,
  confidence-scored agent-authored skills service and UI. Low-confidence skills
  remain flagged rather than silently trusted.
- **Proactive adversarial weakness hunting:** absorbed into sealed holdouts,
  realistic mutation waves, independent grading, and the improvement loop.
- **Action instead of code dump:** substantially absorbed by chat-to-edit,
  reversible sandbox actions, concise receipts, and rendered-proof work.
- **Different process surfaces should show different information:** represented
  in the design language, ComposerDock changed-files activity, nested process
  views, and truthful turn receipts. Remaining UI duplication should be tested
  under the one-composer mission rather than reopening the whole visual system.
- **Global shop/restaurant knowledge:** active as M13's multilingual practical
  web corpus. The recent Jønk/Jafs/venue work is evidence, not general proof.
- **Automatic Council self-modification after a bad answer:** superseded by the
  safer M02 adoption control plane. Bad responses may nominate work; they may
  not grant mutation authority or bypass owner review and gates.
- **File-over-app, exports, personas, blind comparison, worktrees, reconnect,
  capability scopes, health, and cross-platform release:** already represented
  by the 19 adoption designs and 20-mission engineering portfolio.

## Recommended order

Do not start eight parallel builds. Respect the current M02 WIP limit.

1. Treat one-composer ownership as the smallest independent UX correction.
2. Make context and experiment receipts dependencies of future Council/context
   expansion rather than another dashboard.
3. Deliver portable checkpoints with M08's durable journal.
4. Build the project chronicle on top of checkpoints, linked navigation, export,
   memory governance, and deletion semantics.
5. Add browser replay only after its redaction contract is proven.
6. Keep correction learning inside M15 until measured.
7. Evaluate memory consolidation last, in read-only proposal mode.

## Reproducibility and privacy

The bounded extractor and review helper used for this audit live under the
ignored `Temporary_files/session-archaeology/` directory. They:

- read external stores without modifying them;
- filter Codex by real working directory and editor stores by mapped workspace;
- bound individual JSON lines, reject malformed rows, and record format limits;
- retain explicit human/assistant text only and exclude tool/subagent payloads;
- extract Grok's real `<user_query>` instead of its injected environment;
- redact obvious token/secret patterns before derived output;
- write only local inventory, normalized-message, and candidate files.

The durable report intentionally contains no transcript source paths or raw
conversation archive. Re-running may change counts for sessions that are still
being written, but the provider parsing and coverage limits are explicit.
