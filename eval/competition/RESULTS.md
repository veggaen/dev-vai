# Vai Reasoning Competition — results log

Run: `pnpm tsx eval/competition/run.mjs [--split dev|holdout|all] [--meta] [--cat name]`

Suite: 9 categories × 8 tasks per split (compositional, adversarial, multistep,
causal, planning, code, epistemic, memory, control). Dev seed 1000; holdout
seed 500000 — **frozen** (`holdout.frozen.json` pins a SHA-256 of `tasks.mjs`;
a hash mismatch voids holdout numbers). Metamorphic variants (`--meta`) rewrap
each solved single-turn task 3 ways (casual rephrase, colleague framing,
distractor-sentence prefix); a task only counts as meta-consistent if every
variant stays correct.

## Cycle log (2026-07-19)

| run | dev | holdout | meta | change under test |
|---|---|---|---|---|
| baseline | 13.9% | — | — | none |
| +deterministic solvers | 77.8% | — | — | new `models/deterministic-reasoning.ts` wired as Strategy 0.0 |
| +parse fixes | 93.1% | — | — | float-cents rounding, noun-less inventory starts, `none`=0 |
| +misroute fix | 100% | 100% | 69/72 | rule-inference prompts excluded from product-engineering memo |
| +OODA calibration exemption | 100% | 100% | 72/72 | shape-locked answers exempt from "Calibrated take" prefix |

## Diagnosed generalization failures → Vai-owned fixes

1. **No parse-and-compute layer** for chained arithmetic, inventory narratives,
   sum/difference puzzles, dependency ordering, JS output prediction, rule
   inference, odd-one-out → new pure module
   `packages/core/src/models/deterministic-reasoning.ts` (unit tests:
   `deterministic-reasoning.test.ts`, 10 passing). Solvers fire only on a
   complete parse; partial parses fall through to the rest of the chain.
2. **Misroute:** the word "sensor" in a formal-logic question routed to the
   product-engineering memo ("Yes — this is buildable…"). Fixed in
   `chat/product-engineering-intent.ts`: stated-rule inference prompts
   (`Rule: … answer yes or no`) are never planning prompts.
3. **Shape corruption:** the OODA Act phase prepended
   "Calibrated take (lower confidence…)" to deterministic computed answers,
   breaking hard format constraints ("reply with only the number"). Fixed in
   `vai-engine.ts`: `_fastTemplateLock` answers are exempt from the
   calibration prefix — a computed result is not a low-confidence take.

## Scorer integrity

- `tasks.mjs` and `run.mjs` untouched since the freeze (hash-guarded).
- All fixes live in `packages/core/src` — engine capabilities, not checker edits.
- Regression: trick-questions + conversational-handler suites still pass (52/52).

## Next expansion (when re-running, per the forever-goal)

Categories are at ceiling — grow the suite before trusting further gains:
longer op chains with unit conversions, multi-rule inference (3+ premises),
plans with resource conflicts, code snippets with closures/async ordering,
memory across topic-shifted distractor turns, combined constraints
("only the number, in words"). Regenerate ONLY the dev split; mint a new
holdout seed and re-freeze in a new file (never overwrite the old freeze).
