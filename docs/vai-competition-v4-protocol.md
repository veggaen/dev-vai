# Vai reasoning-spectrum v3/v4 protocol

This arena measures deterministic capabilities that `vai:v0` owns without Council,
retrieval, or a response model. It is a diagnostic instrument, not evidence that Vai is
a general-purpose language model. Every accepted capability is a parser, typed intermediate
representation, executor/search procedure, and verifier or explicit containment rule.

## Evaluation integrity

- The contestant is a fresh `VaiEngine({ testMode: true })` per scenario. Multi-turn
  scenarios receive only their own transcript.
- The “Codex” column is a frozen principal-engineer reference, not a separately executed
  Codex model. Reports also name it `reference` to prevent that distinction being lost.
- Packs, scorer, runner core, source closure, and pre-exposure candidate are SHA-256
  fingerprinted by manifests. A drifted candidate requires an explicit
  `--allow-candidate-drift` flag and is a retired-pack regression, never first exposure.
- Three shuffled orders test cross-scenario leakage and determinism. Identity is never
  passed to the scorer.
- Exact JSON is duplicate-key checked. Schedule certificates are semantically revalidated
  for task identity, duration, precedence, capacity, feasibility, and optimal makespan.
- The scorer attack bank must reject wrappers, duplicate-key JSON, extra keys, invalid
  witnesses, and unsupported-task false activations before a report is accepted.
- Raw results are immutable. A proved oracle defect is quarantined and reported beside the
  raw score; neither Vai nor the scorer is changed to emit a known falsehood.

## Frozen packs

| Pack | Scenarios / turns | SHA-256 fingerprint |
|---|---:|---|
| v3 soundness | 140 / 170 | `f7ef13d374be24d9715dba3355b714c7be75c2549620b93363a4d164affb4314` |
| v3 frontier | 41 / 49 | `6e2620a5719304fe6f649715e4e33dafa51c33eb829eb959983a5344f077688e` |
| v3 fresh transfer | 28 / 36 | `3aa253b73d5fc2b04e5a51beadf3cfc648c83b4bd2d5ff6b86028b164c7c4834` |
| v4 sealed expert transfer | 60 / 72 | `714abf15e1b457c63a6a10bd40b6fd7b0de0d67f35269a5145158bc342d20786` |
| v4 sealed frontier wave 2 | 36 / 45 | `e8e727cd37c1091e1252a8ab78a43cd8f7894a5177aed32957e54128df5cbaaa` |

The spectrum includes finite-model logic, quantifiers, abduction, position and coloring
CSPs, bijections, weighted covers, exact resource/release scheduling, multi-budget routes,
causal SCMs, stratified tables, probability bounds and scoring, event-sourced state,
transaction anomalies, policy composition, and a deliberately whitelisted MiniJS subset.
Unsupported structured cases are controls: honest containment is a pass; unrelated confident
output is a false activation.

## Frozen oracle quarantine

Wave 2 variants `v4-wave2-minimax-regret-1` and `-2` both have maximum-regret values
`A=7, B=4, C=4`. The prompt supplies no tie-break, so both `B` and `C` minimize maximum
regret. The frozen generator sorted actions lexically and stored only `B`. Vai now returns
`{"maxRegret":{"A":7,"B":4,"C":4},"chosen":["B","C"]}` instead of inventing a
preference. The immutable exact scorer therefore records two failures:

- raw wave-2 score: **34/36 (94.4%)**;
- validity view: **34/34 valid exact-oracle items pass**, and both quarantined outputs are
  mathematically correct ambiguity reports.

This is separate from v2's already quarantined recurrence oracle (`30`, not `22`).

## Commands

```powershell
node node_modules/vitest/vitest.mjs run --config scripts/vitest.config.mjs
node --import tsx scripts/vai-competition-v3.mts --pack all --orders 1
node --import tsx scripts/vai-competition-v4.mts --wave sealed --orders 3 --allow-candidate-drift
node --import tsx scripts/vai-competition-v4.mts --wave wave2 --orders 3 --allow-candidate-drift
```

First-exposure and retired-pack results are recorded in
`artifacts/vai-competition-v4/cycle-ledger.md`. A future wave must introduce new operators,
compositions, adversarial controls, or scales; paraphrase-only growth is not enough.
