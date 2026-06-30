# Spec: Honest Async-Audit + Revise-in-Place UX (v4, build-grade)

> Written 2026-06-30 for V3gga. v4 = incorporates external-AI review and the blocking durable auditMeta correction.
> Revalidated against the FULL council loop and the real desktop component/tokens.
> **Every factual claim cites a real `file:line` you can open and verify.** If a
> citation doesn't match the code, that claim is wrong — flag it. This is the
> anti-hallucination contract. An AI reviewer should execute §5 slice-by-slice from
> this doc alone.

---

## TL;DR + decision record (read this first)

**What:** Make Vai's already-built async council audit HONEST in the UI — show
whether the answer was reviewed, kept, or revised after the council reviewed it.

**Why it's mostly safe:** the engine already does fast-draft → council-audits-after →
revise-in-place (`service.ts:1663-1855`, `:3441-3447`). The advisory LOGIC is
unchanged. BUT (v4 correction) durable `auditMeta` must be persisted (Slice A) — it is
NOT "just UI". No vectors (deferred by council vote, F11), no new infra.

**Honesty law (v4, review §11 — first principle):** the word **"Verified" is BANNED**
— a council `ship` / budget-timeout / empty-redraft is NOT verification. Honest
labels: Reviewed / Review time-boxed / Reviewed-unchanged / Original kept / Revised
(not re-checked) / Revised & re-reviewed. The surface must NEVER make the user FEEL a
serious verification happened when the audit was advisory, budgeted, or partial. This
is audit honesty, not audit theater.

**Design law:** *Very complex & interactive underneath — minimal in feel.* Density
revealed on hover/click, never on the resting surface. BANNED persistent chrome:
pills, badges, chips, uppercase micro-labels, status dots, toasts. (Temporary honest
text — onboarding line, hover peek, plain labels — is allowed.)

**Resting affordance:** one quiet `VaiNode` at the answer's end → hover peeks → click
grows open the full deliberation. On REVISED turns (O7/O8) the node gets a faint
accent ring + a one-time onboarding line; reviewed-clean turns stay minimal (§10.1).

**Build order (HARD, v4):** Slice 0 (measure, ≥30 turns) → **Slice A (durable
auditMeta — BLOCKING backend)** → Slice 1 (state model + tests) → **STOP & judge
data** → Slice 2 (node+peek+ring) → Slice 3 (grow + sanitized revision diff) →
Slice 4 (optional). Do not skip the stop-gate.

**Open decision for V3gga:** confirm the stop point (recommend 0→2) and whether the
visual layer goes to Fable-5 (recommended, §4b).

**Status:** Slice A implemented and tested. Slice-0 measurement is still a hypothesis.

---

## 0. Thesis (unchanged, now stronger)

The async-audit ENGINE (fast draft → council audits after → revise in place)
**already exists and is more complete than v1 claimed** — it has a full round-1 →
redraft → round-2 loop with budget gates and outcome-keeping logic
(`packages/core/src/chat/service.ts:1663-1855`). The gap is purely that the UI
does **not narrate the audit outcome honestly**. This spec adds an honest
audit-state layer + a future-grade surface.

> **v4 correction (external review, §11):** "without touching the engine" was WRONG.
> The audit metadata (`outcome`, `revised`, `draftStrategy`, `resetFired`,
> `realIntent`, `methodLesson`, pre-reset text) is NOT durably persisted to the
> committed message — `liveDraft` is wiped on `done` (F8) and pre-reset text is lost
> (F9). So a **blocking metadata-persistence slice (Slice A)** is required before any
> visual work. The engine LOGIC is unchanged, but the turn must EMIT durable
> `auditMeta`. This is plumbing, not advisory-logic change — but it is real backend
> work, not "just UI."

---

## 1. Verified foundation (open these — they are the proof)

| # | Claim | Evidence |
|---|---|---|
| F1 | Council runs AFTER the draft, advisory, so it doesn't delay the user | `consensus/council.ts:46-52` |
| F2 | Whole council loop is wall-clock budgeted; over-budget ships round-1 | `service.ts:1672-1685, 1735-1742, 1804-1812` |
| F3 | Draft streams with lifecycle `{phase, turnId, seq}`, phases `start\|delta\|reset\|committed` | `service.ts:3221-3225` |
| F4 | On council revise, draft is `reset` in place | `service.ts:3441-3447` |
| F5 | Verdict rendered as `info_block` (outcome/agreement/read-as) | `service.ts:3452-3470` |
| F6 | Desktop renders the live draft block, distinguishes "revised by council" | `MessageBubble.tsx:592-615` (`revised = phase==='reset'`, `:603-604`) |
| F7 | Draft block ONLY shows while `!content.trim()` (dies on commit) | `MessageBubble.tsx:989-990` |
| F8 | Store wipes `liveDraft` to null on `done` (commit & retire same tick) | `chatStore.ts:1146-1153` |
| F9 | Store overwrites draft `text` cumulatively (pre-reset text lost) | `chatStore.ts:1112-1121` |
| F10 | Council/facts quarantined — never injects member "facts" | `council.ts:8-9, 298, 583-629` |
| F11 | Vector/memory layer DEFERRED by 3/3 council vote | `memory/project_async_audit_and_memory_decision.md` |
| F12 | Tokens are CSS vars from 5 core colors (`--border`,`--panel-bg-muted`,`--chat-body`,`--chat-muted`) | `lib/odysseus-theme.ts:1-70`; usage `MessageBubble.tsx:599-610` |

---

## 2. The REAL outcome matrix (this is what v1 got too simple)

`runCouncilLoopGen` (`service.ts:1663-1855`) returns `CouncilLoopResult =
{ council?, finalText, revised }`. Tracing every `return`, the engine produces
**eight** distinguishable outcomes. The audit-state model MUST map all eight, or
it will mislabel turns. Each row cites the exact `return`:

> **v4 LABEL LAW (external review §11.1 — BLOCKING):** the word **"Verified" is
> BANNED** for every outcome below. A council `ship` is not verification; a budget
> timeout is emphatically not verification; an empty redraft is not verification.
> "Verified" may ONLY ever be used if a real grounding/test/tool process ran (source
> checks, evidence, executed tests) — which the council audit path does NOT do.
> Using "Verified" here would be the exact audit-theater this feature exists to
> prevent. The honest verb is **"Reviewed."**

| Engine outcome | `revised` | Honest user-facing label (v4) | Source |
|---|---|---|---|
| O1 Quick depth — council skipped | false | (nothing — user chose speed; no node) | `service.ts:1683-1685` |
| O2 Council couldn't convene | false | (nothing, or muted "review unavailable") | `service.ts:1698-1701` |
| O3 Round-1 `ship` (panel agreed) | false | **Reviewed** *(council agreed)* | `service.ts:1729-1731` |
| O4 Budget spent before redraft | false | **Review time-boxed** *(not fully reviewed)* | `service.ts:1735-1742` |
| O5 Redraft produced nothing/identical | false | **Reviewed, unchanged** | `service.ts:1766-1775` |
| O6 Redraft drifted off a linked page — kept original | false | **Original kept** *(revision drifted)* | `service.ts:1781-1790` |
| O7 Revised, round-2 skipped (budget) | true | **Revised after review** *(not re-checked)* | `service.ts:1805-1812, 1827-1834` |
| O8 Revised, round-2 confirmed improvement | true | **Revised & re-reviewed** | `service.ts:1836, 1852-1854` |

PLUS the UI-layer suppression (F4 path): even when `revised===true`, a grounded
`url-request` draft suppresses the in-place `reset` (`service.ts:3439-3447`) →
state must read as **Original kept (grounded source)**, NOT "revised", because the
user's visible answer did NOT change.

**Design consequence:** `revised` boolean alone is insufficient. The honest state
must be derived from `{outcome, revised, draftStrategy, didResetFire}`. Accessible
labels and hover copy must be BRUTALLY PLAIN (§11.5) — visual elegance must never
soften the truth of O4/O7/O2.

---

## 3. The gaps (refined)

- **Gap A — outcome is invisible.** All 8 outcomes above currently collapse to
  "the draft block appears then disappears." The user never learns whether the
  council *agreed*, *considered and kept*, or *revised*. The data exists (§2); the
  surface doesn't.
- **Gap B — no provenance on revision.** When O7/O8 fire, the user sees new text
  but not WHAT changed or WHY (the council's `realIntent`/`methodLessons` are in
  `councilThinking` but only shown as a flat key-value block, F5).
- **Gap C — surface is "10%".** Plain HTML table vs. the clean, feature-dense,
  animated, transitional surface V3gga wants.

---

## 4. Design language — content-as-interface (NOT status chrome)

> **LOCKED PRINCIPLE (V3gga):** *Very complex & interactive underneath — MINIMAL IN
> FEEL.* The system SHOULD be deeply capable, feature-dense, and richly interactive.
> That depth is a feature, not a compromise. But the EXPERIENCE must read as
> minimalistic, futuristic, clean, and open. The complexity NEVER crowds the resting
> view — it is REVEALED through interaction (hover to preview, click to grow,
> drill deeper on intent). Default = calm, empty, open. Reach in = layers of power
> unfold. If a reviewer or Fable-5 reads "feature-dense" as "busy UI," they have
> misread this spec: density is earned by interaction, the surface stays serene.

> **Anti-pattern ban (Opus-4.8 UI tells to AVOID).** The first draft of this spec
> reached for a **status pill / badge / chip** — a colored capsule with an icon and
> an uppercase micro-label sitting beside the answer. That is the generic, lazy
> mapping and it is explicitly NOT what V3gga wants (`feedback_ui_defer_to_fable5`:
> "Opus 4.8 WEAK at UI; anchor on Fable-5"). **Banned in this feature:**
> - ❌ pills / badges / chips / capsules to encode audit state
> - ❌ icon + UPPERCASE tracking-wide micro-labels (`✓ VERIFIED`) as the design
> - ❌ a separate status object competing with the answer for attention
> - ❌ traffic-light color dots as the primary signal
> - ❌ a "toast" announcing the revision
> The reviewing AIs should REJECT any implementation that reintroduces these.
>
> **v4 clarification (review §11.10):** the ban is on *persistent status chrome*.
> TEMPORARY explanatory text that improves honesty or discoverability — the one-time
> onboarding line, the hover-peek sentence, the plain-language labels inside the
> opened deliberation — is ALLOWED and encouraged. The real anti-pattern is
> generic, loud, fake-trust chrome sitting on the resting surface, not text per se.
> (The reviewer argued the ban was "too ideological"; V3gga named pills/badges
> explicitly, so the persistent-chrome ban STANDS — but transient honest text was
> never banned.)

**The philosophy (V3gga, locked): MINIMAL AT REST, RICH ON INTENT.** The surface is
clean and open by default. Depth is REVEALED through interaction — hover to preview,
click to expand / transition / grow. Nothing shouts; everything is available. This
is calm progressive-disclosure-by-motion — the genuinely future-grade pattern. The
audit state is **latent**, not constant chrome: the answer rests clean, with a single
quiet locus that *grows open* when the user reaches for it.

**The locus: the VaiNode, repurposed as a living disclosure anchor.** Vai already
owns the right object: `VaiNode` (`VaiNode.tsx:1-13`) — the brand glyph that
**"BREATHES while thinking and SETTLES to a solid accent dot when done."** It becomes
the single, minimal at-rest mark of "the council looked at this." Reaching for it
reveals the whole deliberation. No pill, no badge, no panel-by-default.

**The four behaviors (reveal-on-intent; each a checkable acceptance test):**

1. **At rest: one quiet node, nothing else.** After a turn settles, a single small
   `VaiNode` sits unobtrusively at the END of the answer (inline, baseline-aligned,
   `--phase-verify` hue when reviewed-clean, `--accent` + faint ring when revised —
   §10.1). That is the ENTIRE resting chrome. While the council is still auditing it
   BREATHES (reuse `.vai-node--thinking`); when done it SETTLES. *Test:* a settled
   non-revised turn shows exactly one `[data-vai-node]` at the answer tail and zero
   other audit affordances; O1/O2 (no council) show NO node at all. **The node does
   NOT imply verification** — its label says "Reviewed"/"Review time-boxed"/etc.
   (§2 label law), never "Verified".

2. **Hover the node → a peek, no commitment.** Hovering (or keyboard-focusing) the
   node reveals a light, fast PREVIEW near it: one plain-language line — "Council
   agreed — verified." / "Revised after review." — that grows in (scale 0.96→1 +
   opacity, ~140ms from the node's origin). Mouse-out dismisses it. This is the
   "hover to see" layer. *Test:* `:hover`/`:focus-visible` on the node mounts
   `[data-audit-peek]` with a full sentence; no layout shift (it's an overlay,
   `transform`-only).

3. **Click the node → the deliberation GROWS OPEN.** Clicking expands an inline,
   in-flow region that animates open (height/opacity via a measured grow, or a
   clip-path reveal — Fable-5's call) showing the council's actual work: the
   members who spoke, agreement, the `realIntent`, the `methodLesson`, and — when
   the answer was revised (O7/O8) — the BEFORE→AFTER of what changed, rendered as a
   quiet in-place comparison. Click again / Esc collapses it back to the single
   node. This is the "click to transition / grow" layer and the home for ALL the
   feature-density, kept entirely out of the resting view. *Test:* click toggles
   `[data-deliberation]` open/closed; open state contains member list + reason +
   (for revised turns) a before/after; collapses on Esc; the grow animates
   `transform`/`clip-path`/`opacity` only.

4. **Revision is felt in the prose, discovered in the panel.** On O7/O8 the changed
   passage settles in place with a feather-light one-time shimmer as it commits (so
   a watching user notices *something* refined), but the WHAT/WHY is not forced —
   it lives one click away in behavior 3. Reduced-motion ⇒ instant, no shimmer.
   *Test:* revised turns mount the changed span with prior text present-then-removed;
   the reason text exists only inside `[data-deliberation]`, never as resting chrome.

**Silence is a designed state, not a gap.** O1/O2 → no node, no peek, nothing. The
clean answer alone. *Test:* council-disabled turn renders zero `[data-audit*]` nodes.

**Cross-cutting acceptance tests (apply to all four):**
- **Minimal at rest:** the settled, non-interacted answer adds AT MOST one inline
  node. *Test:* resting DOM around the answer contains ≤1 audit affordance; the
  peek and deliberation regions exist only under `:hover`/`:focus`/clicked state.
- **Motion only on `transform`/`opacity`/`clip-path`**, ≤240ms (grow may be ≤320ms),
  eased; `prefers-reduced-motion` ⇒ instant reveal, no breathing, no shimmer
  (rubric: `feedback_ui_design_rubric`).
- **A11y honest:** the node is a real `<button>` (focusable, `aria-expanded`,
  `aria-controls` → the deliberation region); one `aria-live="polite"` region
  carries a *plain-language* sentence. Sighted users get hover/click motion; keyboard
  & SR users get focus + expand + the sentence. *Test:* axe-core 0 violations; node
  is keyboard-operable; live-region text is a full sentence, not a label token.
- **Token-bound:** all hues via `--vai-node-hue`, `--phase-verify`, `--accent`,
  `--border` (F12 + VaiNode). *Test:* grep the new components for `#`/`zinc-`/
  `violet-`/`rounded-full.*bg-.*500`/`uppercase` → 0 hits.
- **One audit context per turn.** *Test:* `document.querySelectorAll('[data-audit-root]').length === 1`.

### 4b. Fable-5 hand-off + SINGLE QUALITY OWNER (review §11.7)
Per `feedback_ui_defer_to_fable5`, Fable-5 AUTHORS the visual/motion direction for
behaviors 1–4. But split "Fable owns vibe, Opus owns logic" is a quality escape
hatch (reviewer's point, accepted). **Therefore: ONE named owner is accountable for
the SHIPPED component end-to-end**, and "done" is defined by a VERIFICATION GATE, not
by Fable's taste nor Opus's integration:
- **The gate (all must pass for "done"):** real-frame capture per outcome class +
  keyboard-only operation + `prefers-reduced-motion` path + visual-regression
  snapshot + the §4/§11 acceptance + comprehension tests (§11.8).
- **Owner:** whoever runs the gate owns shipped quality. Fable-5 informs the design;
  the gate informs "done." Quality is owned by the gate, held by one person.
Hand Fable-5: §4, the token list (F12), `VaiNode.tsx`, the resting `MessageBubble`
layout, and the §2 label law (so its copy can't drift back to "Verified").

---

## 5. Build slices (executable; each shippable + independently verifiable)

> Order is dependency-correct. Do NOT start a slice before its predecessor's
> verification passes. Stop point is V3gga's call (§7).

### Slice 0 — MEASURE the visible council window (evidence, no build)
**Why:** v1 hole H1 — the "reviewing" state may flash and be theater (F7/F8: draft
retires the same tick content commits). Decide with data.
**Do (v4 sample hardened, review §11.9):**
- Drive **≥30 real turns** via Playwright (`?devAuthBypass=1`; harness pattern in
  `project_chat_switch_state_bugs`), **≥5 per category**: trivial (O1), factual
  (O3), prose (O3/O5), compare (O7), url-paste (O6/suppress), deep-mode (O7/O8).
- Instrument `chatStore` draft handler to time from first `committed` draft phase →
  `done`, per turn. **Also log the engine outcome (O#) and the visible-text delta**
  so revision FREQUENCY is measured, not just timing (frequency drives §10.1).
- Report **p50, p75, p95** per category (not just median). Note dev vs
  production-like latency separately. Capture whether the state was PERCEIVABLE
  (≥ a human-noticeable dwell), not merely that it technically existed.
**Decision gate:** if p50 visible window <600ms across categories → DROP the animated
"reviewing" shimmer; ship only the persistent post-commit states. ≥600ms → keep it.
AND: if O7/O8 (real revisions) are rare → the revised-ring/hint (§10.1) matter MORE.
**Output:** fill the §8 table (category → p50/p75/p95 → outcome mix → perceivable?).

### Slice A — DURABLE auditMeta persistence (BLOCKING; backend; do FIRST after Slice 0)
**Why (review §11.3 — was wrongly called "just UI"):** the audit state needs
`outcome, revised, draftStrategy, resetFired, realIntent, methodLesson`, council
availability, AND the pre-reset draft text — but `liveDraft` is wiped on `done` (F8)
and pre-reset text is lost (F9). **The UI cannot derive truth from data that no
longer exists.** So the turn must EMIT a durable `auditMeta` envelope onto the
committed message before any visual work.
**Do:**
- In `service.ts` where the council loop resolves (`:3430-3447`), assemble an
  `auditMeta` object: `{ outcomeKind (O1–O8), convened, revised, resetFired,
  draftStrategy, visibleTextChanged, realIntent, methodLesson, priorTextExcerpt? }`.
  `visibleTextChanged` is computed server-side (revised AND not grounded-suppressed).
- Capture `priorTextExcerpt` (bounded, sanitized — see §11.4 quarantine) ONLY when a
  before/after will be shown, BEFORE the `reset` overwrites it.
- Emit `auditMeta` on the `done.thinking` (typed, optional, back-compatible). Persist
  it with the message so it survives reload (mirror how `thinking` is already stored).
- Client: `chatStore` reads `done.thinking.auditMeta` onto the committed message;
  also stash pre-reset `prev.text` on `reset` (the F9 ~3-line fix) as a fallback.
**Verify:** server unit test asserting each O1–O8 emits the right `outcomeKind` +
`visibleTextChanged`; a reload test proving `auditMeta` survives. **Risk:** medium
(backend) — but isolated, typed, additive; no advisory-logic change.

### Slice 1 — Pure audit-state model (logic + tests, NO UI)
**Why:** the part that must not hallucinate state; verifiable by reading tests.
**Create:** `apps/desktop/src/components/chat/audit-state.logic.ts`
+ `audit-state.logic.test.ts` (repo convention: `*.logic.ts` like
`ProcessTree.logic.ts`). Consumes the Slice-A `auditMeta`.
**Signature (v4 — "verified" REMOVED per §2 label law):**
```ts
export type AuditState =
  | { kind: 'none' }                                          // O1/O2
  | { kind: 'reviewing' }                                     // only if Slice 0 says visible
  | { kind: 'reviewed'; sub: 'agreed'|'unchanged'|'time-boxed' } // O3 / O5 / O4
  | { kind: 'kept'; reason: 'drift-guard'|'grounded' }        // O6 / suppress
  | { kind: 'revised'; reChecked: boolean; reason: string };  // O7(false)/O8(true)

export function deriveAuditState(meta: AuditMeta): AuditState; // AuditMeta from Slice A
```
**Test matrix (review §11.6):** one case PER row O1–O8 + grounded-suppress + an
EXPLICIT case for `revised===true but visibleTextChanged===false` → must return
`kept(grounded)` (the E2 trap). Assert exact `kind`+`sub`. Anti-hallucination gate.
- Keep all variants in the MODEL; a separate `auditDisplay(state)` maps to the ≤5
  user-facing strings (§11.2 model/UI split) — display granularity tuned after
  Slice-0 frequencies. **Verify:** `vitest` green.
**Risk:** low. Pure; no UI; reads Slice-A meta.

### Slice 2 — The audit node at rest + hover-peek (behaviors 1–2)
**No pill. No badge. No left-edge bar.** One quiet node; everything else is revealed.
**Where:** render a single `AuditNode` (wrapping `VaiNode` in a real `<button>`) at
the END of the committed answer body in `MessageBubble` (answer renders near
`MessageBubble.tsx:610`), NOT in the draft block (F7).
**Mechanism:**
- At rest the node is the ONLY chrome: `VaiNode` breathing (`.vai-node--thinking`,
  reuse from `index.css` — don't duplicate, VaiNode doc `VaiNode.tsx:11-13`) while
  the council is still auditing; SETTLED to `--phase-verify` (verified) or `--accent`
  (revised) once `done`. `none`/`O1`/`O2` ⇒ node not rendered at all.
- **Hover/focus → peek:** an overlay (one plain sentence) grows from the node's
  origin (scale 0.96→1 + opacity, ~140ms, `transform`-only, no layout shift).
  Dismiss on mouse-out / blur.
- Drive node state + peek text from the Slice-1 `AuditState`.
**A11y:** node is a focusable `<button>` with `aria-expanded`/`aria-controls`; the
peek sentence also lands in the `aria-live="polite"` region (§4 cross-cutting).
**Verify by RUNNING (`feedback_eyes_on_verification`):** Playwright drives one turn
per outcome class; capture frames at rest + on hover; show V3gga the real frames;
say plainly working/not/inconclusive. Confirm minimal-at-rest: resting DOM around the
answer has ≤1 audit affordance and ZERO pill/badge
(`[class*="rounded-full"][class*="uppercase"]` near the answer === 0).
**Risk:** medium (UI = weak spot). Mitigated: Fable-5 authors the motion (§4b),
reuses proven VaiNode keyframes, token-bound, §4 tests, real-frame verification.

### Slice 3 — Click-to-grow deliberation + in-place revision (behaviors 3–4)
**No "diff panel" card forced on screen.** Clicking the node GROWS OPEN the full
council deliberation inline; the revision is felt in the prose, detailed on click.
**Depends on:** stashing pre-reset draft text (F9: overwritten today).
**Do (mandatory store change, ~3 lines):** in `chatStore` draft handler
(`chatStore.ts:1112-1121`), when incoming `phase==='reset'`, copy CURRENT
`prev.text` into a new `priorDraftText` field BEFORE overwriting; retain it onto the
committed message (don't null with `liveDraft`, F8).
**UI — two parts:**
1. **Click-to-grow deliberation (`[data-deliberation]`):** clicking `AuditNode`
   animates open an IN-FLOW region (measured-height grow or `clip-path` reveal,
   ≤320ms, Fable-5's choreography) holding the dense layer: members who spoke,
   agreement, `realIntent`, `methodLesson`, and — for revised turns — a quiet
   BEFORE→AFTER. Click-again / Esc collapses to the single node. ALL feature-density
   lives here, off the resting surface (LOCKED PRINCIPLE).
2. **In-place revision shimmer:** on O7/O8 the changed clause settles in place with a
   feather-light one-time shimmer (`opacity`/`transform`, ~220ms staggered; prior
   text present-then-removed) so a watcher notices a refinement — but the WHAT/WHY
   is not forced; it lives one click away in part 1. `prefers-reduced-motion` ⇒
   instant swap, no shimmer.
**Verify:** an O7/O8 turn (a) shimmers the changed span (prior text present→removed),
(b) on node-click grows open `[data-deliberation]` with members + reason + before/after,
(c) collapses on Esc, (d) shows NO forced panel/card at rest.
**Risk:** medium. Gated behind 1–2. Whole-answer-rewrite edge case: fall back to a
single before/after summary inside the grown region rather than per-clause shimmer.

### Slice 4 (OPTIONAL) — verdict panel redesign
**Why:** Gap C, but pure polish on my weak spot. **Defer** until 1–3 proven live.
Replace the key-value `info_block` (`service.ts:3452-3470`) with an animated panel:
agreement ring, per-member dots reusing `memberStatuses` (`council.ts:109-126`),
dissent surfacing (`council.ts:267-284`). Keep it behind a flag; A/B against the
current block. **Do not start without an explicit go from V3gga.**

---

## 6. Edge cases & gotchas (the pre-mortem, expanded)

| # | Edge case / gotcha | Handling |
|---|---|---|
| E1 | Council finishes ~instantly → "reviewing" flashes | Slice 0 gate; drop the animation if window <600ms |
| E2 | `revised===true` but `reset` suppressed (grounded url) | derive `kept(grounded)`, not `revised` — visible answer didn't change (§2 note, `service.ts:3439`) |
| E3 | Redraft identical to original | O5 → `verified(considered)`, never "revised" (`service.ts:1766`) |
| E4 | Drift-guard kept original | O6 → `kept(drift-guard)` with honest reason (`service.ts:1781`) |
| E5 | Council couldn't convene at all | O2 → `none`; never fabricate "verified" |
| E6 | Quick depth (user chose speed) | O1 → `none`; respect the user's choice, no pill |
| E7 | Chat-switch mid-audit (stale message) | gate on `activeStreamingAssistantId` like existing handler (`chatStore.ts:1105`); drop stale-seq frames (F3) |
| E8 | Theme switch while pill shown | tokens are CSS vars → re-renders for free (F12); no JS recolor |
| E9 | Reduced-motion users | §4.4; morph disabled, labels remain |
| E10 | Screen reader spam from rapid state changes | single `aria-live="polite"` region; debounce announces |
| E11 | `councilThinking` undefined on fast non-council turns | `deriveAuditState` returns `none` (Slice 1 test) |
| E12 | Desktop is a BUILT binary, not live source | edits show on `localhost:5173` dev server (hot reload); built app needs `pnpm app:update` (`project_desktop_build_deploy`) — verify on dev server first |

---

## 7. Why / Why-not (honest case, both sides)

**Why do it:**
- Delivers V3gga's literal ask ("if it's inaccurate or about to change, display this").
- The persistent **verified vs revised vs kept** signal is valuable on EVERY turn,
  independent of E1 — even if "reviewing" gets dropped, the post-commit honesty win lands.
- Near-zero engine risk: derive-and-render off data that already flows.
- No model spend; no new infra; aligns with the deferred-vector decision (F11).

**Why NOT / what would kill it:**
- If Slice 0 shows the window is theater AND O7/O8 (actual revisions) are rare in
  practice, the feature is honest but low-frequency → still ship the cheap states,
  skip animation. (Measure revision frequency in Slice 0 too.)
- Slice 4 is genuinely deferrable polish on my weak spot — resist building it early.
- Risk of over-decoration (rubric warns: anti-pattern inflation). Keep §4.7 "calm
  by default" strict.

**What this spec deliberately does NOT do:** no sqlite-vec/vectors (F11), no MCP/
Fastify/Named-Pipes/DirectML/ReFS (category error per `the-decision.md:271-307`),
no engine or council logic change.

---

## 8. Slice-0 measurements (to be filled in BEFORE Slice 1)

| Turn type | Prompt | Visible window (committed→done) ms | Engine outcome (O#) |
|---|---|---|---|
| trivial | | | |
| factual | | | |
| prose | | | |
| compare | | | |
| url paste | | | |

> Empty until measured. Filling this honestly is the gate for the animated state.

---

## 9. Validation checklist for the reviewing AIs

1. Open every `file:line` in §1 and §2; confirm the quoted code exists and the
   8-outcome matrix is faithful to the `return` statements in
   `service.ts:1663-1855`.
2. Confirm no slice requires a vector DB, external service, or new network protocol.
3. Confirm the acceptance criteria in §4 are mechanically checkable (DOM/CSS/axe),
   not subjective.
4. Confirm the edge cases in §6 each map to a real code path.
5. Challenge: is any state in §2 mislabeled? Is `kept-despite-advice` (E2) really
   distinct from `verified`? (It is — the visible answer differs in provenance.)
If all hold, this is grounded engineering, not hallucination.

---

## 10. External-AI review responses & mitigations (v3)

An external AI reviewed v2. Each point below is logged with an honest verdict:
**ACCEPT** (folded in), **ADAPT** (accepted with a change), or **PUSH-BACK** (kept,
with reasoning). These are now binding parts of the spec.

### 10.1 "The no-persistent-signal bet may make the feature invisible" — ACCEPT + ADAPT
Correct, and it's the biggest risk. A calm signal nobody discovers is just absent.
Resolved WITHOUT breaking the locked principle by adding signal *where it matters*:
- **Revised turns (O7/O8) get a faint accent RING on the node** (`--accent`, a 1px
  glow, `transform`/`opacity` only) — NOT a pill, just slightly more present because
  the answer actually changed. Verified turns stay fully minimal. This is the
  reviewer's preferred option.
- **One-time onboarding:** the FIRST time a user ever sees a revised turn, the node
  pulses once with a tiny inline hint ("Vai revised this — click to see why") that
  then never shows again (persisted flag). Complements the ring.
- **Slice 0 also measures revision FREQUENCY**, not just timing — if O7/O8 are rare,
  the ring matters more, not less.
**Binding:** add `revised-ring` + `first-revision-hint` to Slice 2/3 acceptance tests.

### 10.2 "State machine may be over-engineered vs. real usage" — ACCEPT (model/UI split)
Keep all 5 variants + sub-reasons in the `AuditState` MODEL (cheap; they are the
anti-hallucination gate — removing them would let turns mislabel). But **collapse them
in the UI layer** after Slice 0 frequency data: the model is precise, the presentation
is simple. e.g. UI may show `kept(*)` sub-reasons as one "considered — kept" unless
the user opens the deliberation. **Binding:** Slice 1 keeps the full model; a UI-map
function (added post-Slice-0) decides display granularity from measured frequencies.

### 10.3 "Shimmer can glitch on large changes / be missed on tiny ones" — ACCEPT
Make change-size a real gate. **Binding (replaces Slice-3 part 2):** compute a
char/clause delta; per-clause shimmer fires ONLY when the change is small AND
localized (e.g. < ~25% of the answer and contiguous). Otherwise: no shimmer; the
before→after lives only in the click-to-grow region as a calm summary. Tiny changes
(< a few words) still shimmer but the ring (10.1) carries the discoverability.

### 10.4 "Node-at-end is a discoverability cliff for keyboard/SR" — ACCEPT (strongest point)
Under-weighted in v2. The node-only affordance is hard to reach on long answers.
**Binding additions:**
- A **keyboard shortcut** focuses the current turn's audit node (skip the tab-march).
- The **`aria-live` sentence fires on settle** for revised/kept turns so SR users are
  TOLD without hunting ("Answer revised after review — reason: …").
- The revised-ring (10.1) is a visual+structural cue that helps everyone find it.
- Accept explicitly: deep deliberation drill-down is primarily for engaged users; the
  *honest one-sentence outcome* is for everyone and must reach SR users passively.

### 10.5 "Spec is long; add TL;DR" — ACCEPT
Done — see the TL;DR + decision record at the top.

### 10.6 Execution tips — ACCEPT ALL (now hard requirements)
- **Slice 0 → Slice 1 → STOP & judge the data.** Highest-leverage; everything else is
  conditional. (Already the build order; now bolded as a hard stop-gate.)
- **Prototype the AuditNode in ISOLATION** (a standalone test page / story) before
  touching `MessageBubble` — the motion is the highest-risk visual part.
- **Add the `revised===true but content identical` test** → must return
  `kept(grounded)` (this is E2; now an explicit named Slice-1 case).
- **Reduced-motion is the DEFAULT you test FIRST**, not an afterthought.
- **Before/after = simple old→new (strikethrough + addition), not a full diff UI.** Calm.
- **Telemetry (post-ship, high value):** track node-hover rate, deliberation-open
  rate, especially on revised turns → tells us fast if "latent" is too quiet and the
  ring/hint need to be louder. (Telemetry must be local/free per the project's
  free-first principle — no paid analytics.)

### 10.7 Net effect on the locked principle
None of these break "minimal in feel." The revised-ring and one-time hint are the
only additions to the resting surface, both tiny, both motion-only, both gated to the
turns that actually changed. Reviewed/kept turns remain a single quiet node. The
density still lives behind hover/click.

---

## 11. SECOND external-AI review (round 2) — responses (v4)

A second review (harder than the first) found a genuine flaw in v3: the spec said
"honest audit" but used **trust language and a thesis that were not honest.** The
reviewer's verdict — "great direction, not yet build-grade; trust language and
metadata plumbing must be hardened first" — is ACCEPTED. Verdicts below.

### 11.1 "'Verified' is dangerous language" — ACCEPT (BLOCKING; headline fix)
Correct and damning. A council `ship` is not verification; a budget timeout is not;
an empty redraft is not. Calling them "Verified" = false trust = the exact audit
theater this feature exists to prevent. **"Verified" is now BANNED** (§2 label law).
New honest labels: Reviewed / Review time-boxed / Reviewed, unchanged / Original kept
/ Revised after review (not re-checked) / Revised & re-reviewed. "Verified" returns
ONLY if a real grounding/test/tool process runs — which this path does not.

### 11.2 "VaiNode may be too invisible" — ACCEPT (already addressed §10.1)
Agreed; resolved by the revised-ring + one-time onboarding line (§10.1). Slice 0 now
measures revision frequency so we know how loud the signal must be.

### 11.3 "'Without touching the engine' is false; needs durable metadata" — ACCEPT (BLOCKING)
Correct — the hard part is WHERE durable audit metadata lives after `liveDraft` is
wiped (F8) and pre-reset text is lost (F9). v2/v3 underplayed this. Now **Slice A
(durable `auditMeta` persistence)** is a blocking backend slice BEFORE any UI. Thesis
corrected (top of §0).

### 11.4 "Before/after underspecified + may leak quarantined intermediate text" — ACCEPT (sharp)
The reviewer caught a real safety hazard: the pre-reset draft may contain content the
revision REMOVED for correctness/safety, and showing it would defeat fact-quarantine
(F10). **Binding diff policy:** small localized edit → inline word-level; paragraph
rewrite → "changed section" summary, not raw diff; very long → changed excerpt only;
**ALWAYS run the pre-reset excerpt through the same sanitation/quarantine guard before
display** — never expose removed intermediate content verbatim. If sanitation can't
confirm it's safe, show only the AFTER + a neutral "revised for accuracy" reason.

### 11.5 "'Council looked at this' flattens different trust states" — ACCEPT
The node must not emotionally imply "safe/audited/reliable" when O4/O7/O2 mean
something weaker. **Binding:** accessible label + hover copy are BRUTALLY PLAIN per
outcome — "Reviewed by council." / "Review was time-boxed." / "Revised after review,
not re-checked." / "Original kept because the revision drifted." / "Council could not
review this." Visual elegance must never soften these.

### 11.6 "Eight outcomes is too much for users" — ACCEPT (model/UI split, reaffirmed §10.2)
Keep 8 internal (implementation truth); compress to ≤6 user-facing meanings (product
truth) via `auditDisplay()`. Too much nuance reads as legal disclaimers and erodes
trust. Internal precision, simple surface.

### 11.7 "Fable/Opus handoff is a quality escape hatch" — PARTIAL ACCEPT (went further)
Agreed the split diffuses accountability. Fix in §4b: ONE named owner is accountable
for the shipped component, and "done" is defined by a VERIFICATION GATE (real frames +
keyboard + reduced-motion + visual-regression + comprehension), not by Fable's taste
or Opus's integration. Quality owned by the gate, held by one owner.

### 11.8 "Acceptance tests too DOM-focused; add comprehension tests" — ACCEPT (important)
DOM tests verify structure, not understanding. **Binding new tests:** a tiny dogfood
(5–8 people) where, given a turn, users must NOT call O4 "verified", must understand
O7 was revised-but-not-re-checked, O6 kept-because-drift, O1/O2 not-reviewed. This is
the test that actually matters; DOM/a11y tests are necessary but not sufficient.

### 11.9 "Slice 0 sample too small (8 turns)" — ACCEPT
Raised to ≥30 turns, ≥5/category, p50/p75/p95, dev-vs-prod-like latency separated,
perceivability captured (§ Slice 0). 8 turns is network/cache noise.

### 11.10 "No-pill ban may be too ideological" — PUSH BACK (mostly)
The reviewer says the anti-pattern is "fake-trust chrome," not pills per se — true in
the abstract. BUT V3gga named pills/badges/uppercase-labels as an EXPLICIT taste
constraint; I will not relax a user's stated preference on a general principle. The
ban on PERSISTENT status chrome STANDS. The reviewer's valid sub-point — temporary
explanatory text is fine — was already true here (onboarding line, hover peek, plain
labels are all text) and is now stated explicitly (§4 ban clarification).

### 11.11 The biggest-blocker takeaway
The reviewer's core warning — "it risks creating audit THEATER while claiming to be
honest audit" — is the most valuable sentence in either review. Every v4 change above
serves ONE goal: the surface must never make the user FEEL a serious verification
happened when the engine was advisory, budgeted, partial, or unable to revise. That is
now the spec's first principle, enforced by the §2 label law, §11.5 plain copy, and
§11.8 comprehension tests.

### 11.12 Updated build order (v4)
**Slice 0 (measure, ≥30) → Slice A (durable auditMeta, BLOCKING backend) → Slice 1
(pure state model + tests) → STOP & judge data → Slice 2 (node+peek+ring) → Slice 3
(grow + gated revision + sanitized diff) → Slice 4 (optional, deferred).** Slice A is
new and blocking; without it the UI is guesswork.
