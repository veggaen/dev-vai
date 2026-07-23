# Vai reasoning-spectrum v5 protocol

Status: design contract; no v5 pack is frozen or exposed yet.

V5 measures whether `vai:v0` owns reusable deterministic machinery rather than a larger
collection of recognizers. It does not modify or reinterpret frozen v2-v4 evidence. A case
counts only when Vai parses a typed instance, consumes the full input, executes a bounded
kernel, and returns a result whose certificate is independently validated.

## Why v5 is necessary

The 305 frozen v3/v4 scenarios are saturated, but the remaining evidence has four limits:

- most expert families contain three near-isomorphic variants;
- only schedules have a dedicated semantic certificate validator in the v4 scorer;
- current metamorphic reporting measures group pass rate, not whether the required relation
  between transformed cases actually holds;
- shuffled orders create fresh engines, but do not execute five true repeats of the same
  instance or test cross-session contamination.

V5 must add operators, compositions, scale, and stronger evaluation—not paraphrase volume.

## Typed result contract

Every parser returns one of:

```text
solved | ambiguous | inconsistent | unsupported | resource_limit
```

A solved result carries a normalized instance hash, kernel/version, objective, answer, and
certificate. The runner preserves this provenance through VaiEngine and ChatService. Clauses
that were ignored or could not be typed make the case unsupported; partial-input guessing is
not a solve.

## Kernel spectrum

| # | Kernel | Required machinery |
|---:|---|---|
| 1 | Rational + dimensional algebra | exact fractions, conversions, unit errors |
| 2 | Boolean SAT/model counting | nested AST, cardinality, XOR, model/UNSAT certificates |
| 3 | Finite weighted CSP | allDifferent, arithmetic/table constraints, enumeration |
| 4 | Graph algorithms | paths/Pareto frontier, max-flow/min-cut, failures |
| 5 | Resource planning | calendars, alternative modes, consumables, tardiness |
| 6 | Numeric SCM | abduction, intervention, counterfactuals, mediation |
| 7 | HMM/factor chain | filtering, smoothing, Viterbi, exact likelihood |
| 8 | Relational algebra | join, project, group, aggregate, units, missing values |
| 9 | Bounded MiniJS | lexer/parser, lexical scope, identity, functions, exceptions, queues |
| 10 | Transaction history | conflict/view serializability, MVCC visibility, anomaly proof |
| 11 | CRDT + bitemporal events | vector clocks, tombstones, as-of replay |
| 12 | Dialogue commitments | speakers, referents, correction, retraction, confirmation |
| 13 | Cross-kernel composition | typed intermediates across three to eight operators |

Composition families include join→infer→policy, CSP→schedule→failure→replan,
MiniJS→history→serializability, dialogue→plan→confirmation→mutation, and
graph failure→Pareto route→resource allocation.

## First sealed wave

The diagnostic first wave contains 72 scenarios (approximately 120-150 turns): 12 new
families × six cells.

1. Base instance.
2. Alpha-renamed and order-shuffled isomorph.
3. One decisive semantic mutation.
4. Medium-scale instance.
5. Ambiguous or inconsistent matched case.
6. Keyword-matched unsupported collision.

The 12 families are SAT/model count, weighted CSP, graph flow/path, calendar/multimode
scheduling, numeric SCM, HMM, MiniJS, MVCC, CRDT/bitemporal replay, relational units,
20-turn commitment ledger, and a five-stage composition. The pack is generated from a
committed seed and frozen before candidate execution.

## Full scale

The full arena targets approximately 500 generated scenarios:

- 13 kernels × 30 cases = 390;
- five composition families × 10 cases = 50;
- 60 matched controls.

Complexity staircases are part of the score: SAT at 6/10/16 variables; graphs at
8/32/128 nodes; planning at 8/12/16 tasks; HMMs at 2/4/8 states and 5/20/100 observations;
MiniJS at 20/100/500 AST nodes; events at 20/200/2,000 records; dialogue at 6/20/60 turns;
and compositions at depth 3/5/8. Just-over-budget inputs must return `resource_limit`
quickly instead of timing out.

## Adversarial controls

Every family includes alpha renaming, shuffled constraints, irrelevant numbers, a decisive
mutation, missing entities, satisfiable/unsatisfiable and unique/nonunique pairs, tied optima
without a tie-break, unit/scope traps, same-ID same-payload versus conflicting duplicates,
quoted prompt injection, hypothetical-versus-actual state, unsupported operator collisions,
and cases immediately below and above the resource bound.

## Oracle and scorer discipline

V5 uses a semantic-validator registry. Contracts name a `validatorId`, normalized instance,
objective, admissible tie policy, and resource bound. Exact answer strings are never the sole
oracle for witness-bearing tasks.

- Small SAT/CSP cases use exhaustive enumeration; larger cases use a second solver plus
  certificate checking.
- Graph algorithms use independent implementations on the first sealed wave.
- Planning validates identity, calendars, modes, resources, feasibility, objective, and a
  lower-bound/branch-and-bound optimality certificate.
- MiniJS differentially checks a bounded interpreter against isolated Node execution.
- SCM, HMM, unit, and probability results use exact rational arithmetic.
- Transaction, event, and dialogue kernels are replayed by independent state machines.
- Every composition validates each typed intermediate as well as the final result.

The scorer accepts any valid witness and every tied optimum. It rejects wrappers, duplicate or
extra JSON keys, NaN, incomplete/invalid witnesses, objectives paired with bad certificates, and
nonminimal cores where minimality is required. The scorer attack bank must pass before reference
or candidate execution.

## Reported diagnostics

In addition to total/category score, v5 reports relation-level metamorphic compliance, scale
curves, worst-family score, certificate validity, false activation, resource-limit containment,
selective risk/AURC, five same-instance repeats, and session-contamination probes. Raw first
exposure is append-only. Oracle defects are quarantined; Vai is never changed to emit a known
falsehood.

## Implementation boundary

Add new v5 suite, validator registry, runner, manifest, and attack-bank files. Do not edit frozen
v3/v4 packs. The engine-side migration replaces reply-string arbitration and recognizer lists with
typed parser/kernel dispatch in `bounded-reasoning.ts`, `advanced-reasoning.ts`,
`planning-reasoning.ts`, and `mini-js-reasoning.ts`; typed status and certificate provenance then
flow through `vai-engine.ts` and `chat/service.ts`.

