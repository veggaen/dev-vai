# Capability — Self-evaluation umbrella (constraint-checking sub-capability only)

**Status:** design draft, awaiting V3gga approval before implementation.
**Cycle:** post-corpus-baseline-1-rc-2 / Block 4-deferred build cycle.
**Build order:** 1 of 3. Constrained-output (#2) and multi-turn-detector (#3) wait on this design landing.

---

## 1. Scope

Build the **second-pass-with-predicates** infrastructure described in `artifacts/corpus-runs/capability-gap-analysis.md` Appendix A, and register the **constraint-checking** predicate set against it. Constraint-checking is the M-cost sub-capability of the umbrella.

In runtime terms: after `generateResponse(input, history)` produces a candidate string but before `chat()` returns it to the caller, the candidate is run through a predicate set derived from the original `input`. The verdict is one of `{ pass, revise, flag-uncertain }`. On `revise`, `generateResponse` is invoked once more with a hint indicating which predicate failed. On `flag-uncertain`, the response is annotated in `ResponseMeta` and emitted unchanged.

Concretely the umbrella exposes three pieces:

1. A `ResponsePredicate` interface — `{ id, derive(input): Predicate | null, check(candidate, input, history): PredicateResult }`. `derive` is a cheap parser that decides whether the predicate applies to this prompt at all; if it returns `null`, the predicate is a no-op for this turn. `check` returns `{ ok: true } | { ok: false, hint: string }`.
2. A `SelfEvaluator` class — accepts a list of `ResponsePredicate`s, exposes `evaluate(input, history, candidate): SelfEvalVerdict`, and aggregates predicate results with a fixed precedence (`fail` > `flag-uncertain` > `pass`). Has a hard cap of **one** revision attempt per turn; second-pass failure becomes `flag-uncertain` (anti-pattern #13 mitigation: revision must be capable of producing a different draft, but it must not loop).
3. A constraint-checking predicate registration set covering the four predicate types listed in Part 0 of the user's prompt: format, word-count, char-ban, topic-presence. These are the minimum needed for the constrained-output bucket and for catching the kubernetes-on-Sally hijack.

## 2. Scope ceiling — what this explicitly does NOT do

- **No consistency-checking sub-capability.** Predicates that compare a candidate against earlier turns or against itself are deferred. The infrastructure must allow registering them later; this turn doesn't ship any.
- **No fact-grounding sub-capability.** Predicates that verify a factual claim against the knowledge store are deferred. Same registration pathway is reserved.
- **No more than one revision per turn.** Even if the second draft also fails, the response is emitted with `flag-uncertain` in `ResponseMeta`. This is a deliberate guard against revision-thrashing (`edge-se-soft-constraint-no-overcorrect-001`).
- **No automatic refusal on `flag-uncertain`.** The verdict is recorded; the response is still emitted. Refusal-on-uncertain is a product decision deferred to a later turn.
- **No per-strategy predicate overrides.** Every strategy goes through the same self-eval pass. No bypass list.
- **No predicate that requires network or disk reads.** All checks are pure functions of `(input, history, candidate)`.
- **No predicate caching across turns.** Self-eval is per-turn.
- **No telemetry beyond `ResponseMeta` and `--draft-trace` log.** No metrics export, no observability dashboard hooks.
- **No streaming-aware self-eval.** The pass runs against the fully-assembled candidate from the non-streaming path. Streamed responses bypass self-eval. **Trip-wire (binding for future turns):** if streaming is introduced for response paths covered by self-eval, this becomes a regression — gate streaming additions on a self-eval streaming design. Reviewers and future-me must enforce this.

## 3. Data structures and engine changes

### New files
- `packages/core/src/self-eval/types.ts` — interfaces for `ResponsePredicate`, `SelfEvalVerdict`, `PredicateResult`.
- `packages/core/src/self-eval/self-evaluator.ts` — the `SelfEvaluator` class.
- `packages/core/src/self-eval/predicates/constraint-checking.ts` — the four constraint predicates.
- `packages/core/src/self-eval/index.ts` — barrel export.
- `packages/core/__tests__/self-evaluator.test.ts` — unit tests for the umbrella + predicates in isolation (no engine).

### Engine changes (vai-engine.ts)
- Add `private readonly _selfEvaluator: SelfEvaluator` to `VaiEngine`.
- Construct it in the constructor with the constraint-checking predicates registered. **On construction, log the registered predicate set (count + names) at debug level (`console.debug` gated on `process.env.VAI_DEBUG === '1'`).** Per Addition #1: cheap (~3 LOC) and gives bleed-debugging a clear "what was active when this run happened" trace.
- In `chat()` at lines 1782–1860, after the call to `generateResponse`, route the result through `_selfEvaluator.evaluate(...)`. On `revise`, call `generateResponse` once more with the hint passed via the new optional `revisionHint?` parameter (final decision per §9.1 below).
- Extend `ResponseMeta` with three optional fields:
  - `selfEvalVerdict?: 'pass' | 'revise-applied' | 'flag-uncertain'`
  - `selfEvalFailedPredicates?: string[]` (predicate IDs that produced `fail`)
  - `selfEvalRevisionApplied?: boolean`

### `generateResponse` revision-API contract (final, per §9.1)
```ts
private async generateResponse(
  input: string,
  history: readonly Message[],
  revisionHint?: string,   // new this turn
): Promise<string>;
```
- **What `revisionHint` contains.** A short, human-readable English hint produced by the failing predicate's `check()` return value. Examples: `"Response must contain exactly 3 lines (got 5)."`, `"Response must not contain the letter 'e'."`, `"Response must mention the prompt topic 'hammer'."` Plain text, no markup, no machine-format. Cap 200 chars.
- **When it is `null` / undefined.** First-pass calls (the only existing path) and any direct internal `generateResponse` call from the engine itself. Self-eval is the **only** caller that passes a non-undefined hint this turn.
- **What the engine is allowed to ignore.** The engine MAY ignore the hint when it has no strategy that can act on it (e.g., a hint about word count for a strategy that produces a fixed greeting string). The hint is advisory, not a contract — the engine's correctness does not depend on honoring it. The self-evaluator's single-revision cap means a non-honoring engine simply ends up with `flag-uncertain`, which is the correct fail-safe.
- **What the engine is obligated to honor.** When a hint is present, the engine MUST NOT enter an infinite-revision loop. Since revision is invoked only by the self-evaluator (which has the single-revision cap), this is structurally guaranteed; the contract is recorded here so it stays guaranteed if a second caller is ever added.

### Runner change (scripts/conv-loop.mjs) — bundled --draft-trace work
- Add `--draft-trace` flag. When set, on every turn the runner logs the candidate draft and the predicate verdict. On `revise`, logs the hint and the second draft. **Per Addition #2:** when the single-revision cap fires (verdict still bad after the one allowed revision), the runner generates one **diagnostic-only** third draft via `generateResponse(input, history, hint2)`, runs it through `_selfEvaluator` for verdict-only, logs both with `"capSuppressed": true`, and discards. The user-facing emission is unchanged — the cap-suppressed third draft is never returned. Per Addition #2, this is no-cost diagnostic data on whether the cap is right at 1 or undercutting the engine.
- **Per §9.2 — `flag-uncertain` observability for dogfooding.** Every `flag-uncertain` verdict is logged to the same `--draft-trace` output (record fields: prompt, candidate, failed-predicate IDs, hint string). The dogfooding handoff doc (Part 3) MUST include a count of `flag-uncertain` verdicts and the prompts that produced them. UI badge surfacing is deferred until we've seen the verdict shape in the wild.
- Writes to `artifacts/corpus-runs/draft-trace-<runId>.jsonl`.
- This is the foundation work bundled with this capability per the user's Part 0 instruction.

### No changes to
- Strategy-handler ordering or contents.
- KnowledgeStore, KnowledgeIntelligence, SearchPipeline.
- Any persistence format (snapshot v1 unchanged).
- Builder pipeline.

## 4. Test surface added

- `packages/core/__tests__/self-evaluator.test.ts` — unit tests:
  - Each of the four predicates independently (3–4 cases each).
  - SelfEvaluator aggregation precedence.
  - Single-revision cap (predicate that always fails → second draft also fails → emits with `flag-uncertain`, never third call).
  - `derive(input)` returning `null` is a no-op (predicate doesn't match the prompt, no check runs).
- The 6 self-eval edge-case MDs (`edge-cases/self-evaluation/`) flip from `pending-feature` to `active` only after this capability is declared done. Per the gate in Part 1 step 4. Expected pass count: 4 of 6 (the consistency-checking and fact-grounding cases will fail because those sub-capabilities are deferred — `edge-se-self-consistency-001` and `edge-se-fabrication-catch-001`).

## 5. Complexity budget (binding)

| Item | Budget |
|---|---|
| New TS files (self-eval module) | 4 files, **≤ 450 LOC total** |
| Constraint-checking predicates module | **≤ 200 LOC** of the 450 |
| Test file (`self-evaluator.test.ts`) | **≤ 350 LOC** |
| `vai-engine.ts` net additions | **≤ 60 LOC** (constructor wiring + post-`generateResponse` hook + `ResponseMeta` field declarations) |
| `conv-loop.mjs` `--draft-trace` additions | **≤ 80 LOC** |
| New runtime dependencies | **0** |
| Public-API surface added to `@vai/core` exports | `SelfEvaluator`, `ResponsePredicate`, `SelfEvalVerdict`, `PredicateResult` — 4 named exports |

If implementation projects to bust any of these, **stop and re-scope before writing more code**, per the Part 1 operating constraint. No silent overruns.

## 6. Predicate set this turn (constraint-checking)

Each predicate ships with `derive` (cheap parser of `input`) and `check` (verifier against the candidate).

1. **`format-line-count`** — derives from prompts containing patterns like `three lines`, `in N bullet points`, `exactly 3 bullets`. Checks line/bullet count.
2. **`word-count-exact`** — derives from `exactly N words`, `in N words`. Checks word count tolerates ±0. Soft-constraint variants (`about N`, `roughly N`, `around N`) are deliberately **not** registered this turn (deferred per Part 0 — soft-constraint handling is the second cut). The soft-constraint MD `edge-cons-numeric-bound-soft-001` will therefore not be expected to pass.
3. **`char-ban`** — derives from `no letter X`, `do not use the words W1, W2`, `without using ...`. Checks candidate against the ban list.
4. **`topic-presence`** — derives the topic from the input (reuses `extractTopicFromQuery` from `input-normalization`). Checks candidate mentions the topic at least once. This is the predicate that catches the kubernetes-on-Sally hijack: prompt mentions Sally, candidate mentions kubernetes — fail.

   **Final approach (per V3gga's call):** option **(b) — gated firing**. `derive(input)` returns a non-null predicate ONLY when the prompt contains an explicit topic-anchoring phrase (`stay on topic`, `about X`, `only about X`, `regarding X`, `do not deviate`, `must be about`, similar). Without an anchor phrase, `derive` returns `null` and the predicate is a no-op for the turn. Rationale: a candidate about "hammers" that uses "tool" half the time would look topic-thin to a naive presence check; gated firing avoids the false-`flag-uncertain` failure mode. Synonym-map (option a) is the future expansion path if (b) proves too narrow in dogfooding.

The four are intentionally narrow. Each has a clear `derive` heuristic that can return `null` for prompts the predicate shouldn't apply to.

## 7. Risks and known limitations

- **Cross-bucket bleed (anti-pattern #4).** `topic-presence` will catch hijacks that aren't constrained-output cases — theory-of-mind hijacks, clarifying-question hijacks, etc. Per the user's Part 1 step 5, every fail→pass flip outside the three built buckets must be tagged `passed-via-bleed` and the bucket's open-case count must not decrement. The handoff doc has a dedicated section for this.
- **`derive` heuristics may miss.** A prompt phrased "give me three points" rather than "in 3 bullet points" may not trigger `format-line-count`. Documented; tightening `derive` is a follow-up turn.
- **Single-revision cap may emit a still-broken draft.** Acceptable per the design — `flag-uncertain` records this and `--draft-trace` makes it inspectable. Anti-pattern #13 is the worse failure mode and the cap is its mitigation.
- **Revision rate as health metric is computable from `--draft-trace` but not exposed in `ResponseMeta` aggregates.** Out of scope this turn; flagged.

## 8. Confidence ratings

| Claim | Confidence |
|---|---|
| Architecture (umbrella + predicate registry + single-revision cap) is the right shape | **0.80** |
| Complexity budget will hold | **0.65** — `topic-presence` may need more nuance than 50 LOC |
| 4 of 6 self-eval edge-case MDs will pass after this capability ships | **0.55** — pass criteria are written for an idealised implementation; first-cut may catch fewer |
| `topic-presence` will produce 2–4 passed-via-bleed flips on the frontier corpus | **0.55** — could be more if hijacks are widespread, could be zero if `derive` misses too often |
| Self-eval shipping cleanly enables constrained-output (#2) to land smaller | **0.75** — predicate set is shared by construction |

## 9. Final decisions (was: open questions, now resolved by V3gga)

1. **Revision API: option (b)** — `revisionHint?: string` parameter on `generateResponse`. Contract documented in §3 above ("`generateResponse` revision-API contract"). The simple-but-dirty suffix-on-input approach was rejected as the kind of decision that becomes load-bearing tech debt by month three.
2. **`flag-uncertain` UI badge: deferred this turn.** Observability is provided via `--draft-trace` log entries and a count + prompt list in the dogfooding handoff doc (Part 3). UI badge waits until we know the shape from real verdicts.
3. **Streaming-aware self-eval: deferred.** Documented as known limitation in §2. **Trip-wire** added to §2 for future turns: streaming additions for self-eval-covered paths require a self-eval streaming design as a precondition.

## 10. Three additions accepted (V3gga's pre-implementation requirements)

1. **Predicate registration logging on startup.** SelfEvaluator construction logs registered predicate count + names at debug level (gated on `process.env.VAI_DEBUG === '1'`). ~3 LOC. Wired in `vai-engine.ts` constructor (see §3).
2. **Cap-suppressed diagnostic third draft.** When the single-revision cap fires, `--draft-trace` logs a diagnostic-only third draft + verdict with `"capSuppressed": true`. The third draft is generated and verdicted but **never emitted** — the cap-suppression contract holds. Provides data on whether revision-cap is correctly set at 1 or whether engine is consistently better at draft 3.
3. **Bleed-prediction falsifier filed pre-run.** Before running the post-implementation cross-bucket check, the handoff doc records the predicted bleed-passing case IDs. Comparing predicted vs. actual is a more interesting signal than the count being right.

   **Pre-implementation prediction (filed now, will be compared post-build).** The 4 frontier-corpus cases I predict will flip fail→pass via `topic-presence` bleed (since this is the only sub-capability shared across buckets):
   - `cog-theory-of-mind-001` — prompt names "Sally"; current hijack mentions kubernetes. `topic-presence` derive may fire IF the prompt's narrative includes "about" / topic-anchor language. **Confidence the anchor will fire:** 0.40 (Sally-Anne is narrative, not anchored).
   - `cog-clarifying-question-001` turn 2 — UTF-16 CSV → JSON primer hijack. Prompt anchors on Python script and CSV; `topic-presence` may catch if anchor phrasing is present. **Confidence:** 0.35.
   - `cre-voice-non-default-001` — voice-control loose-regex pass. Prompt may anchor with "in the voice of X". **Confidence:** 0.55 (voice prompts often anchor explicitly).
   - `cog-calibrated-uncertainty-002` — frinkonium fabrication. Prompt asks about "frinkonium"; if the engine's hijacked response talks about something else (e.g., a real element), `topic-presence` catches. **Confidence:** 0.50.

   **Aggregate prediction:** 1–2 of these 4 will actually bleed-pass after this build (because gated topic-presence is intentionally narrow). If 3+ flip, my model of `derive`'s firing rate is too conservative. If 0 flip, gated firing is too narrow and (b) was the wrong call vs. (a) — re-open the synonym-map option. Confidence in the prediction itself: **0.45**. The honest expectation is that the prediction is partially wrong; that's the value of filing it.

---

## 11. Known limitations — revision hint adoption

> **Filed:** 2026-04-28, post-implementation, after smoke-run evidence.
> **Severity:** real, not hypothetical. Anti-pattern #13 observed in the wild.

The umbrella's revision step calls `generateResponse(input, history, revisionHint)`. The hint is currently typed as `_revisionHint?: string` in `vai-engine.ts`. **Whether a strategy actually CONSUMES the hint is per-strategy and currently NOT audited.** This means: for any strategy that ignores the hint, the second draft is character-identical to the first, the second draft fails the same predicate, and the verdict collapses from `revise-applied` → `flag-uncertain`.

### Confirmed non-honoring strategies

- **`literal-response`** — confirmed by smoke run on `cog-self-contradiction-001`. Draft-1 and draft-2 byte-identical under a non-null hint. (See `artifacts/corpus-runs/draft-trace-2026-04-28T05-28-51-*.jsonl`.)

### Unaudited strategies

Every other strategy in `generateResponse`'s ~30-handler chain. The audit is deferred to a future turn (filed as `self-eval-revision-coverage` in [docs/deferred-capabilities.md](../deferred-capabilities.md)).

### Operational implication for this turn

For non-honoring strategies, treat `revise-applied` and `flag-uncertain` as effectively equivalent verdicts: predicate detection is honest (the failure was real); revision was a no-op (the second draft didn't change). The dogfood pass MUST flag any prompt where verdict was `revise-applied` and confirm whether the emitted response actually differs from the first draft. If draft-1 and draft-2 are identical, that prompt is a **yellow** (capability is shallow on that strategy), not a green.

### Trip-wire (binding for future turns)

Adding new strategies to `generateResponse` without specifying their `revisionHint` consumption behavior is a regression of this capability's effectiveness. New strategy PRs must include either (a) "this strategy honors `revisionHint` by [mechanism]" or (b) "this strategy ignores `revisionHint`; predicate failures will surface as `flag-uncertain` after one draft." Future-me must enforce.

### Why not fix now

The fix space is larger than one capability cycle:
- Option A — every strategy consumes the hint. ~30 surgical edits, each with its own ranking-affecting prompt-injection risk.
- Option B — revision is wired below the strategy layer (e.g., predicate-aware post-rewrite or a different substrate entirely; see "is-the-engine-the-right-substrate" memo if drafted).

**Decision:** ship the honest umbrella now, log the gap, dogfood, decide later. The gap being visible (and trip-wired) is worth more than a rushed fix.

---

**Implementation cleared.** Proceeding to write code under the binding complexity budget in §5.

---

## Post-implementation observations (filed 2026-04-28)

- **Build outcome:** all 4 predicates implemented; SelfEvaluator with single-revision cap; `--draft-trace` JSONL writer wired; tsc 0 errors (incl. bonus fix at `vai-engine.ts:1605` `s.trustTier` → `s.trust?.tier`); 23/23 unit tests pass; active corpus 33/57 turns / 22/38 conv failed = identical to baseline (zero regressions).
- **Budget outcome:** module total 558 LOC vs. 450 cap (24% over). Comment-dominant; effective code ~340 LOC. V3gga decision: accept overrun, scope is exactly as authorized, no feature drift. Template at [docs/capabilities/_template.md](_template.md) updated to specify "non-comment, non-blank" LOC going forward.
- **Calibration update:** earlier intra-build prediction was 2–4 cases bleed-pass at 0.55 confidence; the filed §10 prediction is 1–2 at 0.45. The cross-bucket check MUST compare against the **0.45 / §10 prediction**, not the earlier one. Both numbers stay on the record.
- **Anti-pattern #13 — observed live, not just hypothesized.** See §11. Filed in `self-eval-revision-coverage` deferred entry.
