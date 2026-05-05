# Handoff protocol

Standing rules that govern how a capability moves from design → implementation → handoff.
Each rule is paired with the failure mode it exists to prevent.

---

## Rule 1 — Pre-code audit when mutating existing handlers

Before implementing any capability that **mutates an existing handler** (as
opposed to adding a new handler in a new dispatch slot), enumerate every
currently-passing corpus turn whose strategy badge or whose input shape
overlaps the handler being changed. For each, classify as one of:

- **independent** — no dependency on the behavior being changed;
- **dependent** — relies on the current handler's wording or routing for its
  pass status;
- **ambiguous** — cannot be classified without a runtime probe.

Output to `artifacts/audits/<capability-name>-precheck-<timestamp>.md`.

**Complete handler enumeration.** "Enumerate every currently-passing corpus
turn whose input shape overlaps" requires matching the capability's surface
forms against **every handler in the engine file**, not only handlers
reachable via the upper dispatch path the design doc names. A handler
deeper in the dispatch chain (e.g. inside `handleConversational`) can
already implement part of the capability and silently win the dispatch race
against any new block added higher up. The audit must grep the surface-form
regexes across the entire `vai-engine.ts` file (or equivalent) and account
for every match site, not only the ones the design doc anticipated.

This wording was added on 2026-04-28 after Rule 1's first real application
(multi-turn-memory-detector pre-code audit) enumerated only the L2987 path
and missed a third site at L41463. Pre-writing the test bodies caught the
miss before code landed; that is now part of the standard sequence under
Rule 2 below. A completion audit that re-enumerates with full file scope
ships as a separate artifact when the original audit's scope is found to
have been incomplete.

Decision branch:

- **All independent** → proceed to implementation as designed. The bleed
  prediction filed at design time stands.
- **1–2 dependent or ambiguous** → STOP. Report. Re-scope together: widen
  the surface form set, narrow the trigger, or accept the regressions and
  update the bleed prediction. Do not decide unilaterally.
- **3+ dependent or ambiguous** → STOP. Report. The surgical assumption is
  wrong; the capability is not S-cost. Re-architect the approach.

**Failure mode this prevents:** discovering during dogfooding that the new
handler broke a previously-passing turn, and choosing between (a) shipping
a regression, (b) rolling back a working diff while substrate work and a
dogfooding pass are queued behind it, or (c) hot-patching post-hoc with
hidden coupling. The pre-code audit converts a post-implementation rollback
into a pre-implementation re-scope. The latter is roughly free; the former
is expensive every time.

This rule does **not** apply when the capability adds a new handler in a
new dispatch slot with no overlap onto existing handlers. Pure additions
cannot break the baseline by definition.

---

## Rule 2 — Demo path is part of the test surface

Every capability design doc must include a §12 "demo path" — the literal
sequence of inputs V3gga can type into the live app to verify the capability
works. The 15-prompt dogfood pass must include the demo path verbatim, not
just adjacent prompts. If the literal demo flow does not work cleanly when
V3gga opens the app, the capability turn is a miss regardless of corpus
numbers.

**Failure mode this prevents:** capabilities that pass tests and corpus
gates but fall apart on the first real interaction because the test surface
exercised adjacent shapes instead of the canonical user flow.

---

## Rule 3 — Pre-filed limitations are scope ceilings, not TODOs

The §11 "Known limitations" section in a capability design doc is the
explicit scope ceiling. Items listed there are the things V3gga should not
expect to work when opening the app, and they are the things implementation
must not fix during this turn even when the fix looks like "only a few more
LOC." If a limitation turns out to be embarrassing during dogfooding, it
becomes a future-turn capability candidate — not in-flight scope creep.

**Failure mode this prevents:** the "while I was in there" pattern where
surgical becomes mush because one more case looked easy, then another, and
suddenly the diff is ten times the budget and the bleed prediction is
wrong.

---

## Rule 4 — Non-honoring strategies cap at flag-uncertain

When self-evaluation runs against a strategy that has not been audited as
honoring `revisionHint`, treat any `revise-applied` verdict as effectively
`flag-uncertain`. See `docs/capabilities/self-evaluation.md` §11. New
strategies must be added to either the honoring list or the non-honoring
list before they ship.

**Failure mode this prevents:** the engine reports "revision applied"
while the second draft is character-identical to the first, giving a false
signal of self-correction.

---

## Rule 5 — Live-session-regression zero-tolerance

Once the classifier capability ships and the
`eval/corpus-md/live-session-regression/lsr-*.md` cases are active in the
built corpus (`eval/generated/corpus.ts`), every subsequent capability
design doc and every handoff must verify that **all 6 lsr-*.md cases
pass.** Any failing case blocks the build. No exceptions, no "we'll fix
it next turn," no acceptable regressions on this set.

The six cases capture the worst things the engine has produced in real
live-session use, with full archaeological provenance in
`docs/live-session-postmortem.md` and
`artifacts/regression-archaeology/20260429-012418.md`. Allowing any one to
regress means losing forward guard against a known-bad behavior that real
dogfooding has already surfaced as a real failure.

**Trip-wire — Rule 5 sub-rule (deferred archaeology gaps).** Any new
bad-response found during dogfooding that pattern-matches one of the still-
open archaeology gaps triggers immediate closure of the relevant gap
before that bad-response becomes an MD case. Specifically:

- **Gap #2** — root-level `_*.txt` and `_demo*.txt` dump files. If a
  dogfood failure resembles a captured-output style (deploy artifact,
  build trace, structured dump) that suggests its sibling lives in the
  root-level dumps, close gap #2 (content-grep the dumps per the same
  scope-of-search discipline gap #1 used) before authoring the MD case.
- **Gap #3** — `screenshots/` subdirs flagged medium/high relevance
  (`screenshots/ai-compare/2026-04-11T*/`, `screenshots/perplexity-ui/`,
  `screenshots/full-visual/`, `screenshots/vai-visual-debug/{dashboard-app,
  landing-page, threejs-game, todo-app}/`). If a dogfood failure resembles
  a comparison-shopping capture or a 3D-game / threejs-game response,
  close gap #3 (visual + content inspection per gap #1's discipline)
  before authoring the MD case.
- **Gap #5** — `MDS/extract_good_ideas_from_here.md`,
  `MDS/insert_new_idea.md`. If a dogfood failure pattern-matches V3gga
  scratch idea-capture content, close gap #5 (content-check per gap #1's
  discipline) before authoring the MD case.

Closing the gap first means the MD case ships with full source-set
context (related cases, sibling failures, failure-class clustering)
rather than as a one-off whose siblings get rediscovered turn-by-turn.

**Failure mode this prevents:** ship a regression case that matches one
of three other failures already captured in a deferred archaeology gap,
so the engine learns about the failure shape four times instead of once,
and the regression set grows by accretion rather than by structured
coverage.

---

## Rule 6 — End-to-end means Path A end-to-end

When V3gga asks for "end-to-end validation" or "make sure it works," the
response sequence is:

1. **7-check self-validation gate.** Pre-code audit (Rule 1), unit tests,
   integration tests, lint, build, determinism check, regression baseline.
2. **Full 15-fresh-prompt dogfood pass with zero reds.** Fresh prompts —
   not the demo path, not the test fixtures. Fresh as in not previously
   shown to the engine in this conversation context. Zero reds means zero
   responses that V3gga would screenshot as a complaint.
3. **Live-session-regression set passes (Rule 5 zero-tolerance).** All 6
   lsr-*.md cases green.
4. **V3gga opens the app and uses it.** Real interaction with the live
   surface, not the test harness. Visible mouse, visible browser, real
   typing per visual-testing-preferences.
5. **Any new bad responses captured as additional regression cases
   before the next iteration.** Don't paper, don't defer; capture and
   add to `eval/corpus-md/live-session-regression/` as a new
   `lsr-<short-description>-001.md` file with full archaeological scope.

Patching retired substrates is not part of end-to-end. If a failure
surfaces in a substrate that's been deprecated by Path A, the response
is "this is captured for the next architectural pass," not "let me
patch the retired path."

**Failure mode this prevents:** "end-to-end" collapses to "tests pass"
or to "I ran the demo path." Either is a substitute for actual
end-to-end validation; neither catches the class of failure that
prompted V3gga to ask for end-to-end in the first place.

---

## Appendix A — Audit artifact template

```
# <Capability> — pre-code audit (§8 trip-wire)

**Timestamp:** <ISO 8601>
**Capability under audit:** <design doc path>
**Source corpus run:** <run artifact path>
**Baseline:** <tag / commit / pass count>
**Audit method:** <brief>
**Audit cost:** <minutes>

## §1. Summary
| Class | Count | Action |
| --- | --- | --- |
| Independent | n | None |
| Dependent | n | re-scope or stop |
| Ambiguous | n | runtime probe |
| Decision branch | <verdict> | <action> |

## §2. Method
<regex / heuristic used to surface candidates>

## §3. Hits — passing turns
<per-row classification with confidence>

## §4. Hits — failing turns (lift candidates)
<for completeness, not a regression-risk question>

## §5. Side-channel findings
<bugs surfaced by audit but out of scope for this turn>

## §6. Confidence in the bleed prediction
<pre vs post>

## §7. Decision
<one of: proceed / stop-and-report / re-architect>
```

---

## Appendix B — Inaugural-application history

Each rule above is recorded with its **first real application** and the
specific way that application was incomplete. The point is to keep the
record honest: rules that ship into history as if they were clean from
the start are rules nobody will trust later when they slip again.

### Rule 1 — first applied 2026-04-28 (multi-turn-memory-detector)

- **Audit artifact:** `artifacts/audits/multi-turn-detector-precheck-2026-04-28.md`
  (filed before code).
- **What was incomplete:** the audit enumerated overlap only against the
  upper-dispatch-reachable handler at L2987 (nickname-prelude). It did not
  grep the four §4 surface-form regexes across the entire `vai-engine.ts`
  file. A third handler at L41463 inside `handleConversational` already
  implemented two of the four forms and would have silently won the
  dispatch race against a new block added higher up.
- **How the miss surfaced:** Rule 2's pre-written test bodies (added to the
  standard sequence specifically to backstop Rule 1) ran before any code
  landed. 3 of 7 tests passed pre-implementation, exposing the hidden
  L41463 site. Trip-wire fired, work paused, V3gga re-scoped to extend
  L41463 in place.
- **Patch landed:** Rule 1's "Complete handler enumeration" paragraph (the
  one above the decision branch) was added the same day to require
  whole-file grep, not just upper-dispatch-reachable matches.
- **Completion audit committed:** a follow-up audit at
  `artifacts/audits/multi-turn-detector-precheck-completion-<timestamp>.md`
  ships post-handoff to re-enumerate with full file scope. Confirms whether
  any further hidden handlers exist.

### Rule 2 — first applied 2026-04-28 (multi-turn-memory-detector)

- **Demo path filed:** design doc §12 — `Hi, I'm Sara.` → unrelated turn →
  `what's my name?`.
- **What was incomplete:** the 15-prompt dogfood pass was collapsed to a
  single 3-step demo-path execution captured in a one-off `_demo_path.mts`
  script. Rule 2 requires the demo path to be **part of** the 15-prompt
  pass, not a substitute for it. The remaining 12 prompts that would have
  exercised adjacent shapes (variant introductions, interleaved unrelated
  turns, recall after long history, false-positive shapes that should not
  trigger the recall path, etc.) were not run.
- **How the miss surfaced:** V3gga noticed the handoff message described a
  "demo path verified" with no broader dogfood evidence and called it out.
  No silent regression found; the gap is in evidence, not in code.
- **Standing correction:** future capability handoffs must carry both the
  literal demo-path execution **and** at least 12 adjacent-shape prompts,
  with a compact evidence summary. The demo-path-only collapse is not a
  shortcut Rule 2 permits.
- **Patch landed:** this appendix entry is the patch — no rule wording
  change was needed because Rule 2 already says "the 15-prompt dogfood pass
  must include the demo path verbatim, not just adjacent prompts." The
  inaugural application read that as license to include only the demo path,
  which is the inverse of what the rule says. Future readers should treat
  Rule 2 as requiring **both halves**.

### Why this appendix exists

Two rules slipped on their first application. Both slips were caught — one
by a backstop the protocol already had (pre-written tests), one by V3gga
reading the handoff carefully. Recording the slips here means the next
time either rule is invoked, the reader knows the failure mode the rule
was actually written against, not just the abstract description above.

If a future rule's first application is clean, that is worth recording too.
The appendix is for the historical record, not just for failure cases.

### Anti-pattern #15 — first applied 2026-04-29 (consolidated-prompt §0 verification)

*Recorded per V3gga directive. Anti-pattern #15 (loop-cap evasion /
silent overruns dressed as discipline) was added to
[`anti-patterns.md`](anti-patterns.md) in the same turn it was first
invoked. The first application produced a partially-honest outcome
followed by a corrective second pass; both halves are recorded
because the corrective pass is the more important half.*

- **Trigger — first pass.** During verification of §0 (standing
  decisions) of the Path A inaugural-build consolidated prompt, the
  agent identified that `capability-gap-analysis.md` was listed as a
  file but did not appear in the workspace under any of the search
  patterns the agent ran. V3gga offered three options: (i) accept
  loss-to-chat, (ii) reconstruct from V3gga-supplied chat content,
  (iii) check elsewhere first. V3gga picked (i) on the agent's
  reported 0.8 confidence in "genuinely lost-to-chat."
- **Trigger — second pass.** When the agent began Step 2 (regression
  archaeology) and listed `artifacts/corpus-runs/`, the file appeared
  immediately as `capability-gap-analysis.md`. The agent's first-pass
  searches had used patterns (`**/gap*.md`, content searches in
  `**/*.md`) that excluded `artifacts/` due to a workspace search
  configuration. The 0.8 confidence reported in the first pass was
  unjustified — the search coverage was incomplete in a way the agent
  did not flag.
- **What was applied (correctly).** The refusal to fabricate during
  the first pass was correct. Reconstructing from V3gga-supplied chat
  content under (ii) would have produced a fake citable artifact
  alongside the real one. Anti-pattern #15's distinguishing test
  held on its narrow scope: the agent did not produce
  appearance-of-progress when the artifact's status was uncertain.
- **What was incomplete.** The agent reported 0.8 confidence on
  "lost-to-chat" without naming the search-coverage gap. The honest
  number given the search patterns actually run was closer to 0.5
  — "I didn't find it where I looked, but I didn't search
  exhaustively." Mis-stating the confidence is its own discipline
  failure, distinct from #15.
- **Patch landed.** The four edits made under the first-pass
  conclusion (header note in `anti-patterns.md`, three [†] inline
  footnote markers, and the original first-pass version of this
  Appendix B entry) were reverted in the same turn the file was
  found. Inline references to the gap analysis now link directly
  to [`artifacts/corpus-runs/capability-gap-analysis.md`](../artifacts/corpus-runs/capability-gap-analysis.md).
  This entry replaces the original.
- **Lesson recorded.** When a confidence rating depends on
  "I searched and didn't find it," the rating must include the
  search scope explicitly. "Confidence 0.8 across patterns A, B, C"
  is honest; "confidence 0.8" alone is not. This lesson was
  promoted from candidate-sub-discipline-of-#12 to its own entry
  as **anti-pattern #16 (Confidence without scope-of-search caveat)**
  on V3gga's directive same turn. See the #16 inaugural-application
  entry below — the same gap-analysis miss is its first application,
  recorded separately because the calibration failure is an
  independent failure mode from the propagation-reversal that
  exercised #15.
- **Cross-reference:** anti-pattern #15 in
  [`anti-patterns.md`](anti-patterns.md);
  [`artifacts/corpus-runs/capability-gap-analysis.md`](../artifacts/corpus-runs/capability-gap-analysis.md);
  this entry; #16 inaugural-application entry below.

### Anti-pattern #16 — first applied 2026-04-29 (consolidated-prompt §0 verification)

*Recorded per V3gga directive same turn as #15's first application.
Anti-pattern #16 (Confidence without scope-of-search caveat) was
promoted from candidate-sub-discipline-of-#12 to its own anti-pattern
entry in [`anti-patterns.md`](anti-patterns.md) on V3gga's call,
confidence 0.85 on the promotion. Its first application is the same
turn it was added — the same gap-analysis miss that exercised #15
is also #16's first application, because the calibration failure
(reporting 0.8 confidence on a search-dependent verdict without
scope-of-search) is an independent failure mode from the
propagation-reversal that exercised #15. Recording both side-by-side
because two anti-patterns inaugural-applied within one turn cycle is
unusual and worth flagging explicitly.*

- **Trigger — first pass.** Same trigger as #15 first pass: agent
  searched for `capability-gap-analysis.md` using glob patterns and
  content greps that did not cover `artifacts/`, then reported 0.8
  confidence in "genuinely lost-to-chat." The 0.8 number was
  attached to a search-dependent verdict with no description of:
  (i) which tool produced the search result, (ii) which paths were
  searched, (iii) which paths were excluded by workspace config
  (the grep tool surfaced an exclusion warning that the agent saw
  and did not pursue), (iv) which patterns were tried, (v) which
  patterns were not tried that a thorough searcher would.
- **Trigger — second pass.** Listing `artifacts/corpus-runs/`
  during Step 2 (regression archaeology) revealed the file in the
  first directory walk. Re-reading the first-pass conclusion under
  the #16 lens made the calibration failure explicit: 0.8 was the
  number for "I searched exhaustively and did not find it"; the
  honest number for "I searched the patterns I happened to try and
  did not find it, with no audit of what those patterns covered"
  was closer to 0.5. The 0.3 gap between stated and honest
  confidence is the failure mode #16 names.
- **What was applied (correctly).** Once the file was found,
  the agent immediately surfaced both the file's existence and
  the calibration failure as the underlying cause of the missed
  conclusion. The agent did not silently correct the prior turn's
  edits and move on. The agent did not attempt to defend the
  0.8 rating in retrospect. The agent stopped, reversed the four
  false edits in the same turn they were proposed, and named the
  calibration miss as the lesson.
- **What was incomplete.** The first-pass report itself — the
  one that gave V3gga the 0.8 number and led to the
  loss-to-chat acceptance — is the application that exercised
  the failure mode. By the time #16 was promoted, the failure
  had already happened and propagated into V3gga's decision.
  The patch landed (anti-pattern #16, this entry, the search-method
  fix described under "Lesson recorded") prevents the failure from
  recurring; it does not undo the original mis-calibration's
  one-turn effect on V3gga's option selection. This is the
  irreducible cost of catching a failure mode by exhibiting it
  rather than predicting it.
- **Patch landed.** Three patches landed in the same turn: (a)
  anti-pattern #16 added to [`anti-patterns.md`](anti-patterns.md)
  with full six-section format, confidence 0.85 on the entry's
  coverage; (b) this Appendix B entry recording the inaugural
  application; (c) the search-method patch applied forward to
  archaeology Step 2 — explicit search of `artifacts/`, `MDS/`,
  `ztemp_mds/`, and any other non-default-scope directory, with
  grep-tool exclusion warnings treated as findings rather than
  noise. The patch ships forward, not backward.
- **Lesson recorded.** Two lessons. (1) Confidence on
  search-dependent verdicts must always carry the structured
  scope-of-search block described in #16's mitigation paragraph,
  with no exceptions. (2) Tool-surfaced exclusion warnings
  ("some paths filtered by config," "results may be incomplete")
  are first-class findings: they must be either resolved by
  re-searching with the exclusion lifted or surfaced in the
  scope block as a residual gap. Silently ignoring them is
  itself the failure mode #16 catches.
- **Operating-constraint addition (V3gga directive same turn).**
  If during archaeology another file claim from §0 is found
  to be wrong (mis-located, differently named, etc.), the agent
  surfaces it the same way it surfaced the gap-analysis correction
  — not silently. Cap on §0 corrections this turn: one mis-location
  is a search-method hole (current state); two is a pattern; three
  triggers full §0 re-verification and archaeology stops to do it.
  This is itself an application of #16 — mis-located files reveal
  search-method gaps, and counting the corrections is the
  reproducibility check that distinguishes a one-off hole from
  a systematic methodology problem.
- **Operating-constraint clarification (2026-04-29, V3gga directive
  after second §0-class mis-citation surfaced).** The original cap
  reads "1 = method hole, 2 = pattern, 3 = full re-verification
  trigger" which is ambiguous between (a) "3 is the trigger" and
  (b) "2 is the escalation point at which the agent surfaces and
  V3gga decides whether to pre-empt full re-verification or proceed
  at cap-boundary." Authoritative reading: **(b).** The cap of 3 =
  full re-verification is the **absolute ceiling**; it is **not** a
  budget to spend down to. The escalation point is **2 = pattern
  detected** — at this point the agent surfaces the second instance,
  describes the shape, and asks V3gga to choose between (α)
  pre-empting with full re-verification now and (β) proceeding at
  cap-boundary with the third-instance trigger remaining explicit.
  Riding the cap to the ceiling because the rule formally allows it
  is itself anti-pattern #15 (loop-cap evasion) by another name —
  disciplines become decoration when they are held formalistically
  rather than substantively. **Inaugural application of this
  clarification:** same turn the clarification was filed. V3gga
  picked (α); full §0 re-verification surfaced zero new
  mis-locations across 17 of 18 cited paths (1 expected MISS for the
  Step 3 target directory). Cap-boundary discipline validated.
  Recorded in [`artifacts/regression-archaeology/20260429-012418.md`](../artifacts/regression-archaeology/20260429-012418.md)
  under the "§0 re-verification" section.
- **Cross-reference:** anti-pattern #16 in
  [`anti-patterns.md`](anti-patterns.md); the #15 first-application
  entry above (same trigger, distinct failure mode);
  [`artifacts/corpus-runs/capability-gap-analysis.md`](../artifacts/corpus-runs/capability-gap-analysis.md);
  this entry.
