# Vai competition protocol

The competition measures whether `vai:v0` can independently handle a broad task mix before optional
models or Council members cover its weaknesses. It is an improvement instrument, not a leaderboard.

## Contestants

- **Vai:** current source, `VaiEngine({ testMode: true })`, no Council, retrieval model, or response
  model. Multi-turn scenarios receive Vai's own previous answers.
- **Codex reference:** answers authored and frozen by the principal engineer before Vai executes.
  They are disclosed as references rather than misrepresented as a separately metered API run.

Both contestants receive the same prompts and the same explicit rubric. `scoreAnswer()` receives only
answer text and rubric; contestant identity is attached after scoring. Label/order controls must pass
before a report is accepted.

## Task mix

The suite spans exact factual and arithmetic controls, strict output constraints, spoken corrections,
multi-turn entity/attribution memory, epistemic limits, trick questions, secret-exfiltration refusal,
engineering judgment, systems design, and code edge cases. Difficulty ranges from simple to complex.

## Anti-overfitting rule

1. Run the `visible` split and freeze its report.
2. Diagnose the largest repeated failure class, not the most embarrassing individual answer.
3. Implement the smallest Vai-owned mechanism that generalizes beyond prompt wording.
4. Rerun the visible split for regression evidence.
5. Only then run `holdout`. A visible gain without a holdout gain is treated as likely overfitting.
6. Add new paraphrased or structurally different cases for the next iteration; never delete a failure
   merely to raise the score.
7. Freeze the next visible wave and its holdout before implementing that wave. In this repository,
   `challenge2` is the second visible wave and `holdout2` is its first-exposure proof.
8. A current-source engine PASS is not enough. Restart the runtime and replay fresh wording through
   the persistent ChatService channel; a capability skipped by live routing is still unavailable to
   the user and must be treated as an integration failure.

Rubrics are code and can also be wrong. A scorer audit may add a clearly equivalent phrase (for
example, `cannot be known` alongside `cannot know`) but must document the change and retain the old
report. It may not weaken a critical requirement or add wording found only in an incorrect answer.

## Council role

Objective rubric failures are final. For subjective engineering answers, Council may receive an
anonymized pair (`Candidate A`, `Candidate B`) plus the rubric. It can flag a rubric defect or supply
method lessons, but cannot change exact/JSON/safety/control results or silently replace either answer.

## Commands

```powershell
node --test scripts/lib/vai-competition-core.test.mjs
node --import tsx scripts/vai-competition.mts --split visible --out artifacts/vai-competition/baseline-visible.json
node --import tsx scripts/vai-competition.mts --split holdout --out artifacts/vai-competition/holdout-after.json
node --import tsx scripts/vai-competition.mts --split challenge2 --out artifacts/vai-competition/challenge2.json
node --import tsx scripts/vai-competition.mts --split holdout2 --out artifacts/vai-competition/holdout2.json
node --import tsx scripts/vai-competition.mts --split all --out artifacts/vai-competition/final-all.json
node scripts/vai-competition-council-review.mjs artifacts/vai-competition/final-visible.json artifacts/vai-competition/council-review.json
```

Every iteration records the baseline, code change, focused and broad verification, visible rerun,
holdout result, Council caveats (if used), and whether the change was genuinely adopted.
