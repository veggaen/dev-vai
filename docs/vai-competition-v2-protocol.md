# Vai reasoning-spectrum v2 protocol

This competition measures how much bounded reasoning `vai:v0` can own without Council,
retrieval, or a response model. It deliberately mixes simple controls with multi-step,
adversarial, causal, planning, code-execution, epistemic, memory, and constructive tasks.
The purpose is not to teach answer strings. Each failed wave must expose a reusable
representation or verifier that belongs inside Vai.

## Contestants and scorer

- **Vai:** current-source `VaiEngine({ testMode: true })`, with `noLearn: true`. Multi-turn
  cases receive the same transcript that a real conversation receives.
- **Codex reference:** principal-engineer answers authored before Vai sees a frozen wave.
  These are disclosed references, not a separately metered API run.
- **Scoring:** `scoreAnswer()` receives only an answer and rubric. It never receives a
  contestant identity. Label/order invariance controls must pass before the runner writes
  an accepted report.
- **Structured output:** JSON comparisons are recursive; `exactKeys` rejects hidden extra
  keys. Exact, avoid, critical, and weighted checks remain deterministic and inspectable.

## Immutable waves

Once a fingerprint below has had a first-exposure run, its prompts, references, and rubrics
are immutable. Fixes may only change Vai. A future rubric defect is quarantined and reported;
it is never silently repaired to improve a historical score.

| Wave | Scenarios / turns | SHA-256 fingerprint |
|---|---:|---|
| Base: visible + holdout + mutation | 45 / 47 | `41a4c549d261972e117be3b2f5a09e38182676970652212455ebf0e003bcadaf` |
| Visible | 18 / 20 | `c61f40520a10b4fb9258c6f02d5893da997d804f103810cc028f2021e9140b98` |
| Holdout | 15 / 15 | `17679e1f6df7821f3e80965c1000372ec7fe8c804259a9bd21922991a6694ce0` |
| Mutation | 12 / 12 | `6ade70cde9be911be4fd95b9982e308fa1597dced8b4cde16fbff998289c5227` |
| Fresh metamorphic wave 1 | 17 / 18 | `009cc02f5f8dc8e9c8a7168cd17f8a79fc474f61acef2d4dfa1c3c74e6f4dd76` |
| Fresh reasoning-family wave 2 | 8 / 9 | `6f27de0f9336597695643cd2968880d4e741d891493fdabfac3af1891ff8c98a` |
| Fresh saturation/metamorphic wave 3 | 10 / 11 | `6c69fd30eaf209eed7e002bbe7954b5228ca90dfc46a88dd4095813d232c9b4f` |

The combined `expanded3` set contains 80 scenarios and 85 turns. It spans 21 category
labels, including conditional logic, decision reasoning, constructive reasoning,
compositional reasoning, logical consistency, and state revision in addition to the base
spectrum.

## Iteration contract

1. Run the full frozen suite and a newly frozen metamorphic wave.
2. Diagnose the broadest repeated capability gap, not an individual missed answer.
3. Add a Vai-owned parser, intermediate representation, executor, and invariant check.
4. Return `null` for unsupported or non-unique inputs; never guess to inflate coverage.
5. Rerun the exact fingerprint. Reject a change if holdout does not improve or if the
   visible/holdout gap widens materially.
6. Regress all older waves. When a category saturates, add a structurally new family.
7. Restart the runtime and prove at least one new behavior through persistent ChatService.
8. Record raw and validity-adjusted results, per-category deltas, test evidence, and known
   limitations.

## Frozen invalid-item quarantine

The mutation recurrence says `x1=1; x(n+1)=2*x(n)+2n` and freezes `22` as its reference
for `x4`. Direct substitution gives `x2=4`, `x3=12`, and `x4=30`. Vai correctly returns
`30`, so the identity-blind frozen scorer marks it wrong. The item and fingerprint remain
unchanged. Reports therefore retain both views:

- raw expanded score: **79/80 scenarios, 98.8% rubric score**;
- mathematically valid subset: **79/79 scenarios, 100%**.

This quarantine is not a waiver for Vai. It applies only to this proved arithmetic defect.

## Commands

```powershell
node --test scripts/lib/vai-competition-core.test.mjs
node --import tsx scripts/vai-competition-v2.mts --split visible --out artifacts/vai-competition-v2/latest-visible.json
node --import tsx scripts/vai-competition-v2.mts --split holdout --out artifacts/vai-competition-v2/latest-holdout.json
node --import tsx scripts/vai-competition-v2.mts --split mutation --out artifacts/vai-competition-v2/latest-mutation.json
node --import tsx scripts/vai-competition-v2.mts --split fresh1 --out artifacts/vai-competition-v2/latest-fresh1.json
node --import tsx scripts/vai-competition-v2.mts --split fresh2 --out artifacts/vai-competition-v2/latest-fresh2.json
node --import tsx scripts/vai-competition-v2.mts --split fresh3 --out artifacts/vai-competition-v2/latest-fresh3.json
node --import tsx scripts/vai-competition-v2.mts --split expanded3 --out artifacts/vai-competition-v2/latest-expanded3.json
```

Cycle-by-cycle evidence and per-category deltas are in
`artifacts/vai-competition-v2/cycle-ledger.md`.
