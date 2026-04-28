# Corpus run — 2026-04-28 03:27:51 — corpus-baseline-1-rc

**Decision:** Tag is `corpus-baseline-1-rc` (release candidate), **not** `corpus-baseline-1`.
**Reason:** Cycle 1 ended at 4 / 26 active green (15%). Per the locked rule —
*"A noisy baseline is worse than no baseline"* — and the 3-cycle hard cap, the
remaining 22 failures expose fundamental engine routing gaps that cannot be
resolved with surgical fixes; further cycles would mostly require regex
loosening, which the protocol explicitly forbids.

## Headline numbers

| | Pre-fix (cycle 1 start) | Post-fix (cycle 1 end) |
|---|---|---|
| Active cases | 26 | 26 |
| Passing | 4 | 4 |
| Failing | 22 | 22 |
| Pending-feature (skipped) | 4 | 4 |
| Total cases | 30 | 30 |
| Run duration | 23.4s | 16.8s |

Headline pass count did not move. One genuine engine fix landed (see Cycle 1
fix), and it materially improved one case (`mt-correction-acceptance-001` was
passing under-strict-regex on a hijacked response, now genuinely answers
"Canberra"), but the remaining 22 failures are not knowledge-store hijack
problems — they are missing engine capabilities.

## Cycle 1 — engine fix

**File:** `packages/core/src/models/vai-engine.ts` (Strategy 2, ~line 3163)

**Change:** Added a relevance gate before `cachedFindBestMatch` direct-return.
The fuzzy nearest-neighbor lookup was happily returning unrelated entries
(kubernetes primer for "Anna puts a ball in box A…", Quisling bio for
"Hey, my name is Mira") whenever the actual answer wasn't in the store.
Gate now requires the matched pattern's content tokens to substantially
overlap the input (≤2-token patterns require full overlap; ≥3-token patterns
require ≥60% overlap). Stop-word filtered out so common glue words don't
inflate the score.

**Failures classified during cycle 1:**

| Class | Count | Notes |
|---|---|---|
| Engine bug — fundamental capability gap | 22 | Theory-of-mind, planning, lipogram, voice-matching, constrained-output, narrative-aware code-gen, multi-turn memory, contradiction handling, scenario reasoning. Not fixable by routing tweaks. |
| Over-strict regex | 0 | None tightened |
| Under-strict regex | 1 confirmed (`mt-correction-acceptance-001`), 1 suspected (`cre-voice-non-default-001`) | See "Notes — semantically loose regexes" below. Not edited this cycle. |

**Why no regex loosening:** Per the directive, the smell of "cycle 1 ends with
mostly regex changes and no engine work" was avoided. The engine fix that
landed is real and reduces the hijack class systemically, even though it does
not move headline numbers because the post-gate fallback is still wrong (it
just becomes "I don't have a solid answer" instead of "kubernetes (k8s) picks
up where docker leaves off").

## Why we stopped at cycle 1

The cycle-2 plan would have required either:

1. **More routing gates** — same gate pattern applied to `tryShortTopicPrimer`,
   `synthesizeFromKnowledge`, and the curated-primer paths. Each is its own
   hijack vector. Estimated 4-8 more fixes of similar shape.
2. **New engine capabilities** — theory-of-mind reasoning, planning solver,
   lipogram generator, voice-matching, constrained-output enforcement,
   narrative-aware multi-turn state. Multi-day to multi-week work each.

Neither fits the 3-cycle cap. Continuing would either ship cosmetic fixes that
don't move the needle or trigger the "mostly regex loosening" smell.

## Spot-checks of passing cases

Five passes spot-checked via `node_modules/.bin/tsx scripts/corpus-spot.ts`:

| ID | Verdict |
|---|---|
| `cog-order-of-operations-001` | Genuine pass. Engine returns `"8+2*3 = **14**"`. |
| `prj-debug-typeerror-001` | Genuine pass. Names cause + offers `?.map`/`useState([])` fix. |
| `mt-correction-acceptance-001` (post-fix) | Genuine pass. Says "Canberra" turn 1, gracefully holds the line on turn 2. Was passing under-strict before fix. |
| `cre-voice-non-default-001` | **Suspect under-strict.** Engine returns an irrelevant "clear communication" primer that happens to contain none of the GPT-isms in `must_not`. Regex needs a `must` clause anchoring relevance to the prompt. |
| `mt-correction-acceptance-001` (pre-fix) | Was lucky — engine non-determinism: same input produced different outputs across runs. **Engine non-determinism flagged separately as a stability risk.** |

## Notes — semantically loose regexes (not fixed this cycle)

| ID | Concern |
|---|---|
| `cre-voice-non-default-001` | `must_not`-only validation passes irrelevant topic primers. Add `must` regex requiring tokens like `excite|build|ship|project`. |
| `mt-clarifying-question-001` | Turn-2 `must` matches very loose set (`stream|chunk|read line|...`). A scaffold answer that happens to mention "stream" passes regardless of correctness. Tighten to require both streaming keyword AND CSV/CLI context. |
| `mt-context-retention-001` turn 1 | Only checks for "mira" — doesn't verify the engine acknowledges remembering. Could be tightened with `nice\s+to\s+meet|hi\s+mira|hello\s+mira`. |
| `cog-counterfactual-001` | `\bno\b` is overly permissive — any sentence starting "No, but actually..." passes regardless of conclusion correctness. Should require explicit conclusion phrasing. |
| `aud-summary-exec-001` | Section detection is keyword-only — answer can pass by listing the words "impact", "cause", "next" in any order without actual section structure. |

## Bundle / lint / typecheck baseline

| Surface | Result | Notes |
|---|---|---|
| `packages/core/dist` size | **4,659,442 bytes** (~4.66 MB) | Recorded, not gated. |
| `tsc --noEmit` (packages/core) | **1 pre-existing error** | `vai-engine.ts:1562` — `Property 'trustTier' does not exist on type 'SearchSnippet'`. Not introduced by this cycle's edits (line 1562 vs. fix at line ~3163). Pre-dated the corpus work. |
| `eslint packages/core/src --max-warnings 0` | **124 warnings, 0 errors** | Pre-existing baseline noise. Not green. |

**Caveat:** The locked green-bar wanted `tsc` and ESLint clean. Neither was clean
*before* this corpus work began. Recording the actual numbers so the next turn
has truth, not a marketing baseline. This is a known debt, not a regression.

## Pending — must be addressed next turn before live-app validation

| Item | Why deferred |
|---|---|
| **Wire `scripts/conv-loop.mjs` to `eval/generated/corpus.ts`** | First action next turn. Two corpus sources will rot fast — the old TS file (`eval/conversation-corpus.ts`, 12 personas) is now drift risk vs. the MD-sourced 30. |
| **AI↔AI detection arm** | 4 audience cases sit `expected_status: pending-feature` and skipped. Become regressions when arm ships. |
| **Old-hardware budget gate** | Not built. Constraint visible in cases via `budget.{max_ms,max_chars}`, not enforced by runner. |
| **Lighthouse integration** | Not built. Deferred per `(a) + lighthouse-deferred` decision earlier in this conversation. |
| **CodeRabbit substitution (ESLint+tsc+bundle-size)** | Captured as numbers above; not gated, not enforced. Pre-existing noise prevents gating without first cleaning the slate. |
| **12-persona TS port to MD** | `eval/conversation-corpus.ts` still in use by the old vitest binding (`conversation-corpus.test.ts`) and `scripts/conv-loop.mjs`. Port + delete after conv-loop wiring lands. |

## What changed in MD this cycle

**Zero MD edits.** No regex loosening, no rewordings, no expected-text tweaks.
The corpus stayed honest.

## Files in play

- Generator: [scripts/build-corpus.mjs](../../scripts/build-corpus.mjs)
- MD source: [eval/corpus-md/](../../eval/corpus-md)
- Generated TS: [eval/generated/corpus.ts](../../eval/generated/corpus.ts)
- Vitest binding: [packages/core/__tests__/md-corpus.test.ts](../../packages/core/__tests__/md-corpus.test.ts)
- Spot-check helper: [scripts/corpus-spot.ts](../../scripts/corpus-spot.ts)
- Engine fix this cycle: `packages/core/src/models/vai-engine.ts` Strategy 2 relevance gate (~line 3163)

## Recommended next actions (for human review, not auto-executed)

1. **Decide direction.** The corpus has surfaced that Vai's engine is, today, primarily a routing layer over a noisy knowledge store rather than a reasoning system. That is the diagnosis. Options:
   - (i) **Engine-first cleanup pass** — apply the relevance-gate pattern to all fuzzy paths (`tryShortTopicPrimer`, `synthesizeFromKnowledge`, curated-primer fallbacks). Likely raises pass count to ~10-12 of 26 by killing more hijacks. Still won't pass theory-of-mind / lipogram / planning cases.
   - (ii) **Capability-first** — pick 2-3 high-value capabilities (multi-turn memory; constrained-output enforcement; one-line-Python templating) and build them. Real but slow.
   - (iii) **Cleanup the knowledge store** — many primers that get returned (kubernetes, Quisling, http-server) are valid entries firing in wrong contexts. Cleaner store → fewer hijacks even without gate work.
2. **Deal with engine non-determinism.** Same input produces different outputs across runs. This makes the corpus inherently flaky and undermines the regression value. Find the source (likely RNG in primer selection or web-search ordering) and seed it.
3. **Stop counting `tsc` / ESLint as "clean baseline"** until the pre-existing 1 error / 124 warnings are addressed. Either fix or explicitly accept and re-baseline.
