# Capability: Classifier — input-shape → mode router (Path A inaugural)

> Conforms to `docs/capabilities/_template.md` v1.

**Status:** design — pending V3gga approval.
**Authorization:** Path A inaugural-build Step 4 (consolidated prompt).
**Scope tier:** M (medium). New module + dispatch-call site in engine; persona layer reads it. Multi-turn-memory-detector signals consumed via existing engine state.

---

## §1. Scope **[REQUIRED]**

The classifier is a deterministic, persona-agnostic, signal-based router that maps a single user message (with optional last-N-turn context) to one of six emissions: `Make`, `Understand`, `Decide`, `Recall`, `Run`, or `no-mode-confident`. It produces no generated output, performs no domain reasoning, and carries no persona-specific tuning. The shared core ships with default weights and a default per-mode threshold; the persona layer (Vai-for-V3gga) supplies its own weights via configuration. After the engine receives a user message, the classifier is invoked; if it returns a confident mode, the engine routes to the corresponding mode handler; if it returns `no-mode-confident`, the engine surfaces the override UI per Q0=(b)-with-observable.

## §2. Scope ceiling — what this explicitly does NOT do **[REQUIRED]**

- **No generated output.** The classifier is pure routing. It does not synthesize, retrieve, fetch, or compose any response text.
- **No domain reasoning.** It does not understand the user's question; it only categorizes the input shape and intent.
- **No streaming-aware behavior.** Inputs are treated as complete utterances. Streaming/partial-input classification is deferred.
- **No persona-specific weight tuning in shared core.** Defaults ship; persona overrides via config. Architecture §3.3 binding constraint.
- **No semantic embedding lookups.** Heuristic + regex + signal aggregation only this turn. Embedding-based signal extraction is deferred (`classifier-semantic-signals` will be filed if it becomes load-bearing).
- **No mode handlers.** This capability ships the router. Each of the five mode handlers (`Make`, `Understand`, `Decide`, `Recall`, `Run`) is a separate capability in subsequent turns. Inaugural ships with stub handlers that emit `mode-stub: <mode-name>` so the routing path is end-to-end exercisable but does not produce real responses yet.
- **No threshold-tuning UI.** The threshold is configurable via persona config; no in-app threshold-tuning surface this turn.
- **No multi-mode confidence emission.** The classifier emits one mode (or `no-mode-confident`); it does not return a probability distribution across modes for downstream blending. Blending is deferred (`classifier-multi-mode-blend` will be filed if needed).
- **Trip-wire (binding for future capability work):** any future capability that adds a sixth mode must update the classifier's mode taxonomy in shared core AND every persona's weight map. No silent mode addition. Persona-specific modes are forbidden — modes are shared-core; only weights/enables are per-persona.

## §3. Data structures and engine changes **[REQUIRED]**

**New files:**

- `packages/core/src/classifier/types.ts` — public types: `Mode`, `ModeOrNoConfident`, `ClassifierSignal`, `ClassifierInput`, `ClassifierOutput`, `ClassifierWeights`, `ClassifierThresholds`, `ClassifierConfig`. Persona-agnostic.
- `packages/core/src/classifier/signals.ts` — signal extractors (one function per signal class). Each extractor takes `ClassifierInput`, returns `ClassifierSignal | null`. Persona-agnostic.
- `packages/core/src/classifier/classify.ts` — main `classify(input, config)` entry point. Aggregates signals, applies persona weights, computes per-mode confidence, applies threshold gate, emits `ClassifierOutput`. Persona-agnostic.
- `packages/core/src/classifier/defaults.ts` — default weights + thresholds shipped with shared core. Persona-agnostic; persona overrides via config.
- `packages/core/src/classifier/index.ts` — barrel export.

**Engine changes:**

- `packages/core/src/vai-engine.ts` (single dispatch call site, location TBD by pre-code audit per Rule 1) — invoke `classify(input, config)` at top of `generateResponse` before any existing handler dispatch; route on result. Stub mode-handler invocations emit `mode-stub: <mode-name>` for inaugural; existing handlers stay reachable as fallback when feature flag is off (rollback path).
- `packages/core/src/persona/vai-for-v3gga.ts` (or equivalent persona config file; verified by pre-code audit) — supply `ClassifierConfig` with persona weights and thresholds.

**Public-API changes (signatures):**

```typescript
// types.ts
export type Mode = 'Make' | 'Understand' | 'Decide' | 'Recall' | 'Run';
export type ModeOrNoConfident = Mode | 'no-mode-confident';

export interface ClassifierSignal {
  readonly kind: SignalKind;          // see §6 for SignalKind enumeration
  readonly modeAffinity: Partial<Record<Mode, number>>;  // raw signal contribution per mode, before weights
  readonly diagnostic: string;        // human-readable trace fragment
}

export interface ClassifierInput {
  readonly text: string;
  readonly contextTurns: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>;  // optional last-N
}

export interface ClassifierOutput {
  readonly mode: ModeOrNoConfident;
  readonly confidence: number;         // 0..1; reflects winning-mode confidence (0 if no-mode-confident)
  readonly signals: ReadonlyArray<ClassifierSignal>;
  readonly modeScores: Readonly<Record<Mode, number>>;  // per-mode aggregated score for diagnostic / override UI
}

export interface ClassifierWeights {
  readonly perSignalKind: Readonly<Record<SignalKind, number>>;  // multiplicative weight applied to signal's modeAffinity
  readonly perMode: Readonly<Record<Mode, number>>;              // global per-mode bias (default 1.0)
}

export interface ClassifierThresholds {
  readonly perMode: Readonly<Record<Mode, number>>;              // minimum aggregated score to emit that mode
}

export interface ClassifierConfig {
  readonly weights: ClassifierWeights;
  readonly thresholds: ClassifierThresholds;
  readonly enabledSignalKinds: ReadonlySet<SignalKind>;          // persona may disable specific signal classes
  readonly contextWindow: number;                                // last-N turns; default 4
}

// classify.ts
export function classify(input: ClassifierInput, config: ClassifierConfig): ClassifierOutput;
```

**Engine signature unchanged.** `generateResponse(message, history, ...)` keeps its existing shape; the classifier invocation is internal.

## §4. Test surface **[REQUIRED]**

- **Unit tests:** `packages/core/__tests__/classifier/classify.test.ts` (main `classify()` happy path + boundary cases per signal class), `packages/core/__tests__/classifier/signals.test.ts` (one test per signal extractor — happy path + boundary). Per Thorsen Phase 3 doctrine.
- **Integration tests:** `packages/core/__tests__/classifier/engine-integration.test.ts` — exercises the end-to-end dispatch path: input → classify → stub mode handler → output contains `mode-stub: <mode-name>` marker. Exercises feature-flag on/off rollback path.
- **Multi-turn-memory-detector signal integration:** existing detector outputs (name introduction, recall request) consumed as classifier signals; a regression test verifies the `lsr-emm-so-you-can-not-make-games-001` Turn 2 receives the right multi-turn signal contribution.
- **MD-driven corpus coverage:** the six `lsr-*.md` cases are the gating regression suite. All must pass before classifier ships. (Per §10 prediction + §11 binding constraint.)
- **Determinism check:** `packages/core/__tests__/classifier/determinism.test.ts` — same input + same config = same output across 100 invocations; same input + same config + different config-irrelevant context (e.g., trailing whitespace in irrelevant history turn that contextWindow excludes) = same output. No `Math.random`, no `Date.now`, no async ordering effects allowed in the classifier.
- **Smoke-run command:** `pnpm test -- classifier && pnpm corpus:lint && pnpm corpus:build && pnpm vitest run packages/core/__tests__/classifier`.

## §5. Complexity budget **[REQUIRED]**

LOC = non-comment, non-blank lines (per `_template.md` disambiguation).

| File | Code-only LOC cap | Comment density expectation |
| --- | --- | --- |
| `classifier/types.ts` | ≤ 80 | ~50% (contract surface; doc-heavy) |
| `classifier/signals.ts` | ≤ 220 | ~25% |
| `classifier/classify.ts` | ≤ 120 | ~30% |
| `classifier/defaults.ts` | ≤ 60 | ~40% (defaults + reasoning) |
| `classifier/index.ts` | ≤ 10 | barrel export |
| `vai-engine.ts` net delta | ≤ 35 added (signed delta) | n/a |
| `persona/vai-for-v3gga.ts` net delta | ≤ 45 added (config block) | ~25% |
| **Production code total** | **≤ 570** | — |
| Test files (combined) | ≤ 450 | n/a |

**Trip-wire — budget bust:** STOP and report per `_template.md` reporting requirement (file-by-file actual vs. cap, comment-dominant or code-dominant, what would come out to fit). Do not silently exceed.

**Dependencies:** **0 new runtime deps.** Confirmed before implementation. Any dep is a separate explicit decision.

## §6. Sub-capabilities / predicates / handlers **[REQUIRED]**

### Mode taxonomy (shared core, persona-agnostic)

Five emit-modes plus `no-mode-confident`:

| Mode | One-line semantics | Inaugural status |
| --- | --- | --- |
| `Make` | User wants a build/scaffold/template/code/asset produced | this turn (stub handler) |
| `Understand` | User wants explanation/concept/literal-task answer | this turn (stub handler) |
| `Decide` | User wants comparison/choice/recommendation/judgment | this turn (stub handler) |
| `Recall` | User wants retrieval of prior fact/personal-context/state | this turn (stub handler) |
| `Run` | User wants execution/automation/command-side-effect | this turn (stub handler) |
| `no-mode-confident` | No mode cleared its threshold | this turn (override UI surface in §11) |

### Signal taxonomy (shared core, persona may enable/disable per-class via `enabledSignalKinds`)

`SignalKind` enumeration with one-line description and load-bearing rating:

| SignalKind | Description | Inaugural load-bearing? |
| --- | --- | --- |
| `intent-shape-question` | Input parses as a question (interrogative pronoun, question mark, polar/wh-question structure) | **Yes — 0.95.** Foundational shape signal. |
| `intent-shape-command` | Input parses as imperative ("make X", "build Y", "run Z") | **Yes — 0.95.** |
| `intent-shape-statement` | Input parses as declarative without question/imperative shape | **Yes — 0.85.** Used as soft prior; less discriminative on its own. |
| `intent-shape-meta-question` | Question whose subject is the input itself ("what is the third word in this sentence?") — load-bearing for `lsr-meta-question-yank-typescript-001` | **Yes — 0.90.** Closes Postmortem Exchange 2. |
| `topic-domain-make` | Input contains build/scaffold/code/asset request markers (`example`, `app`, `template`, `html`, `single page`, `<lang>` keywords) | **Yes — 0.90.** |
| `topic-domain-understand` | Input contains explanation markers (`what is`, `how does`, `explain`, `define`, conceptual nouns) | **Yes — 0.85.** |
| `topic-domain-decide` | Input contains comparison/choice markers (`vs`, `better than`, `should I`, `which`, `recommend`) | **Yes — 0.85.** |
| `topic-domain-recall` | Input contains personal-recall markers (`my name`, `who am I`, `do you remember`, `what did I tell you`) | **Yes — 0.90.** Wired to multi-turn-memory-detector. |
| `topic-domain-run` | Input contains execution markers (`run`, `deploy`, `start the server`, `execute`, command verbs with operational object) | **Yes — 0.80.** |
| `mt-name-introduction` | Multi-turn-memory-detector emitted a name-introduction event in current input | **Yes — 0.85.** Consumed from existing engine state. |
| `mt-recall-request` | Multi-turn-memory-detector emitted a recall-request event in current input | **Yes — 0.90.** Consumed from existing engine state. |
| `math-literal-intercept` | Math expression detected (`\d+\s*[\+\-\*/]\s*\d+`, `plus`/`minus`/`times` between numbers) | **Yes — 0.85.** Consumed from existing engine intercept. |
| `personal-intro-intercept` | Personal-intro intercept detected (existing engine signal) | **Yes — 0.80.** |
| `multi-question-composition` | Two or more sub-questions joined by `and also`, `;`, `, and`, `+`, parallel question marks — load-bearing for `lsr-multi-question-okay-then-try-001` | **Yes — 0.90.** Closes Postmortem Exchange 3. |
| `self-contradiction` | Conflicting constraints detected within the same input | Nice-to-have — 0.60. Inaugural ships extractor returning `null` for this turn; full implementation deferred (`classifier-self-contradiction-detector`). |
| `empty-or-edge-case` | Empty input, single emoji, single token, or pathological-length input (>5000 chars) | **Yes — 0.95.** Routes to `no-mode-confident` deterministically. |
| `user-hint` | High-weight reserved signal for future Q0=(c) compatibility (explicit user mode-hint) | Reserved — 0.50. Inaugural ships extractor returning `null`; placeholder for the future override-as-hint surface. |

**Sub-capability registration pathway reservation:** `self-contradiction` and `user-hint` extractors ship as no-op stubs returning `null` so adding them later requires only filling the function body and adjusting weights — not adding new SignalKinds or modifying the aggregation logic.

### Persona-coupling discipline (binding code-level contract)

Per architecture §3.3:

- **Shared core (`packages/core/src/classifier/`) owns:** `Mode` enum, `SignalKind` enum, `ClassifierSignal` shape, `ClassifierInput` / `ClassifierOutput` shape, `classify()` algorithm, default weights and thresholds in `defaults.ts`. None of these reference V3gga, Vai, the persona name, V3gga's domain (game dev, three.js, Norwegian), or V3gga's phrasing patterns.
- **Persona layer (`packages/core/src/persona/<persona>.ts`) owns:** the `ClassifierConfig` instance — `weights`, `thresholds`, `enabledSignalKinds`, `contextWindow`. Persona may downgrade or upgrade any signal weight. Persona may NOT add a new SignalKind (would require shared-core change).
- **Code-level enforcement:** shared-core files import from `./types`, `./signals`, `./defaults`. Persona files import from `@core/classifier`. Shared-core files MUST NOT import from `@core/persona/*`. Enforced by an ESLint `no-restricted-imports` rule shipped alongside the module (added to `eslint.config.js`).

### Threshold framework

- Each `Mode` has a per-mode threshold (default uniform: `0.55` ship value, see §11 reasoning).
- Aggregated score for mode `M` = sum over enabled signals of `(signal.modeAffinity[M] ?? 0) * weights.perSignalKind[signal.kind] * weights.perMode[M]`, then normalized to `[0, 1]` via `1 - exp(-score / scale)` with `scale = 2.0` (sigmoid-ish saturation; deterministic; closed-form).
- If `max(modeScores) >= thresholds.perMode[winningMode]`, emit that mode. Else emit `no-mode-confident`.
- Tie-break: in case of exact tie at the threshold, emit `no-mode-confident` (do not pick alphabetically or by mode-order — silent veto bias is anti-pattern; see §7).

## §7. Risks and known limitations **[REQUIRED]**

### Phase-4 audit failure modes (binding watch list)

1. **Hard-coded V3gga domain.** Shared-core code references game dev, three.js, Norwegian, V3gga's project list, or any Vai-for-V3gga-specific topic. **Detection:** any string literal in `packages/core/src/classifier/*` matching `/v3gga|vai|three\.?js|norwegian|norge|hotline/i` is a fail. **Audit step:** grep before commit; CI check ships in §4 test surface.
2. **Hard-coded V3gga phrasing.** Shared-core regex matches V3gga-specific turns of phrase ("emm so you", "emm you can"). **Detection:** all regexes in `packages/core/src/classifier/signals.ts` reviewed against the persona phrasing list (Vetles material). **Audit step:** part of pre-commit review checklist in §4.
3. **Weights bleed into shared core.** Shared-core `defaults.ts` is supposed to ship neutral defaults; persona overrides them. If the defaults are tuned to match Vai-for-V3gga's preference distribution rather than a neutral midpoint, the persona-coupling line is violated. **Detection:** `defaults.ts` weights must be derivable from a documented neutral-distribution argument (uniform `1.0` per-mode, signal weights set proportional to load-bearing rating in §6 with explicit reasoning). **Audit step:** review `defaults.ts` against the documented justification.
4. **Forced misroute instead of refusal — `no-mode-confident` collapsed silently.** The classifier silently routes to highest-scoring mode even when no mode clears threshold. **Detection:** unit test in `classify.test.ts` constructs an input where every mode scores below threshold; expect output mode = `no-mode-confident`, NOT highest-scoring. Regression risk if a future weight tweak makes some mode always clear threshold by accident.
5. **Silent veto under (b)-with-observable.** UI badge does not surface when classifier emits `no-mode-confident`, so the override mechanism is invisible. **Detection:** integration test verifies that `no-mode-confident` emissions propagate to the UI badge surface. UI badge visibility is binding constraint, not preference (per Q0 architecture decision).

### Other risks

- **Stub mode handlers.** Inaugural ships with `mode-stub: <name>` handlers. The classifier's correctness can be verified end-to-end via routing trace, but the user-visible response is a placeholder until each mode handler ships. Risk: V3gga uses the inaugural app and sees stub responses. Mitigation: clear messaging in the demo path; stub responses include explanatory text per persona.
- **Weight tuning by hand for inaugural.** No data-driven weight learning this turn; defaults are derived from §6's load-bearing ratings via documented heuristic. Risk: defaults under-perform on real prompts. Mitigation: persona override is one config edit; dogfood data informs subsequent tuning turn.

### Known limitations — multi-turn-memory-detector signal adoption

The `mt-name-introduction` and `mt-recall-request` SignalKinds depend on the existing multi-turn-memory-detector emitting structured events the classifier can read. The current detector emits these implicitly (via response-side handlers); the classifier needs the events as **explicit signals readable from engine state before response generation runs**. Two options for adoption:

- **(a) Surface detector signals via engine state field.** Add a small engine state field `_lastClassifierSignals` populated by the existing detector handlers; classifier reads from it. Requires touching the existing detector — Rule 1 pre-code audit applies. Implementation cost: ~10 LOC in detector handlers + read in classifier.
- **(b) Re-derive detector signals inside classifier signal extractors.** Duplicate the detector's surface-form regexes inside `signals.ts`. No engine touch. Risk: regex drift between detector and classifier — same anti-pattern as duplicate utility scan (Thorsen Phase 2). NOT preferred.

**Decision:** option (a) is preferred. Pre-code audit will verify the detector handlers are mutable per Rule 1. If not, option (b) is the fallback with a deferred-capability entry to consolidate later (`classifier-detector-signal-consolidation`).

## §8. Confidence ratings **[REQUIRED]**

| Claim / prediction | Confidence | Notes |
| --- | --- | --- |
| Mode taxonomy (5 modes + `no-mode-confident`) is complete for Path A inaugural | 0.85 | A sixth mode could surface during dogfooding (e.g., `Reflect` for self-eval-like turns); §2 trip-wire covers addition. |
| Signal taxonomy in §6 covers the load-bearing surface for the six lsr-*.md cases | 0.85 | Each case maps to ≥1 signal; confidence bounded by stub `self-contradiction` extractor potentially being needed for `lsr-base44-with-broken-related-panel-001` related-panel cascade detection. |
| Default threshold value `0.55` is correct for inaugural | 0.65 | Tuning is data-thin; threshold may shift after dogfood data accumulates. Deliberately conservative-low so `no-mode-confident` is not under-emitted. |
| Persona-coupling discipline as code-level contract (ESLint `no-restricted-imports`) is enforceable | 0.95 | Standard ESLint rule; well-supported. |
| Determinism check passes (no `Math.random`, no `Date.now` in classifier) | 0.95 | Hard contract; failure means a bug, not a tuning question. |
| Stub mode handlers approach is acceptable for inaugural | 0.80 | Risk that V3gga's "actually start implementing" call expects real responses, not stubs. §9 surfaces this as decision point. |
| No new runtime deps required | 0.95 | All needed primitives are in `core/src` already (regex, string utils). |
| Pre-code audit per Rule 1 will surface ≤2 dependent overlaps in `vai-engine.ts` | 0.55 | The engine is large and the classifier inserts at the top of `generateResponse`; overlap with existing intercepts is non-trivial. The audit might surface 3+ overlaps and force re-architecture. |

## §9. Open questions / decisions needed from V3gga **[REQUIRED at draft]**

1. **Stub mode handlers vs. one real mode handler.** Inaugural plan ships five stub handlers (`mode-stub: <name>`). Alternative: ship one fully-functional mode handler this turn so V3gga can use the app for real on at least one mode. Recommend: ship `Recall` as the fully-functional mode this turn (already has multi-turn-memory-detector wired; smallest delta to working). Stub the other four. **V3gga decision needed.**
2. **Default threshold value.** §11 commits `0.55` ship value with conservative-low reasoning. Alternative: `0.65` (more `no-mode-confident` emissions, more override-UI exposure during dogfood; higher signal on whether the override surface is usable). **V3gga decision needed.**
3. **Multi-turn-memory-detector signal adoption — option (a) vs (b).** §7 recommends (a) (engine-state field, ~10 LOC in detector). Falls back to (b) (regex duplication) if Rule 1 audit blocks (a). **V3gga acknowledgment needed; (a) is the default unless V3gga overrides.**
4. **`Run` mode scope for inaugural.** `Run` mode is meaningful only if there's an execution surface. Vai-for-V3gga's app has the runtime sandbox; classifier emitting `Run` is correct, but the stub handler's "run" behavior is unclear. Options: (i) stub handler emits a placeholder, (ii) inaugural temporarily disables the `Run` mode (downgrade `topic-domain-run` weight to 0), (iii) ship `Run`-mode handler this turn as a thin wrapper around the existing sandbox dispatch. **V3gga decision needed.**
5. **Persona-coupling enforcement layer.** ESLint `no-restricted-imports` is the recommended enforcement. Alternative: TypeScript project references with restricted boundaries. ESLint is cheaper and faster to add; project references are stronger but require tsconfig surgery. **V3gga decision needed; default ESLint unless overridden.**
6. **Override-UI surface scope this turn.** Q0=(b)-with-observable means the UI shows a mode badge and accepts override-as-correction. The classifier emits the data; the UI surface itself is a separate concern. Options: (i) ship a minimal mode badge + override surface this turn, (ii) defer UI to a separate capability turn and ship classifier with a logged-only emission for inaugural. **V3gga decision needed.**

## §10. Pre-implementation predictions **[REQUIRED if capability has corpus impact]**

Filed BEFORE the build runs. Calibration measured against actuals during validation gate; both numbers stay in this doc and the delta lands in `docs/deferred-capabilities.md` Calibration tracking table.

- **Prediction A — live-session-regression set.** Of the 6 lsr-*.md cases, **4** will pass on first implementation. Confidence: **0.55**. Rationale: cases 1–3 (`lsr-norway-king-bergen-001`, `lsr-meta-question-yank-typescript-001`, `lsr-multi-question-okay-then-try-001`) pass cleanly because the classifier routes to `Recall` / `Understand` / `Decide` stubs that emit non-Bergen / non-TypeScript-fixture / non-`okay then try` responses. Case 4 (`lsr-html-3d-game-typescript-fixture-001`) probably passes because the `Make` stub doesn't emit the hardcoded TypeScript User fixture by construction — but the case requires `must:` HTML+game markers which the stub may not produce. Cases 5–6 (`lsr-emm-so-you-can-not-make-games-001`, `lsr-base44-with-broken-related-panel-001`) are multi-turn cascades that depend on stub handlers behaving consistently across turns; the related-panel propagation in case 6 in particular depends on the stub having no broken-subject propagation, which it shouldn't, but the case body's `must:` engages with build-flow content which the `Make` stub won't emit. **Prediction is bounded by stub handlers being passive — the lsr cases were authored to catch the failures the classifier is supposed to fix, not to require full mode-handler responses.** §11 binding constraint: even if prediction is wrong, all 6 must pass before classifier ships (zero-tolerance).
- **Prediction B — frontier corpus turns affected.** Of the 38 frontier turns (those between strict pass and clear fail), **6 ± 4** will be affected (positive or negative) by the classifier shipping with stubs replacing some intercepts. Confidence: **0.45**. Rationale: the classifier sits at the top of `generateResponse` and may intercept inputs that currently fall through to existing handlers. Stubs returning `mode-stub:` markers will fail any corpus turn whose `must:` predicates expect real response content. Mitigation: feature flag (per §3 engine changes) defaults OFF for corpus runs that don't explicitly enable it. With flag OFF, prediction collapses to `0 ± 1` (architectural addition, no behavior change). **Final prediction depends on the feature-flag default decision, which is V3gga's call in §9 question 6 framing.**
- **Prediction C — pre-code audit dependent-overlap count.** **2 ± 1** dependent overlaps in `vai-engine.ts` `generateResponse`. Confidence: **0.55** (matches §8 row above). If 3+, Rule 1 trip-wire fires and re-architecture is required.

## §11. Definition of done (binding for shipping)

Per V3gga directive: **all 6 lsr-*.md cases must pass before classifier ships. Zero exceptions.**

Definition-of-done checklist:

- [ ] Pre-code audit per Rule 1 filed at `artifacts/audits/classifier-precheck-<timestamp>.md`. Decision branch resolved (proceed / re-scope / stop).
- [ ] All §4 unit tests pass.
- [ ] All §4 integration tests pass.
- [ ] All 6 `eval/corpus-md/live-session-regression/*.md` cases pass.
- [ ] Determinism test passes (100 invocations identical).
- [ ] No regressions on the 33/57 active corpus baseline (or any regressions classified per the standard taxonomy and accepted by V3gga).
- [ ] Phase-4 audit failure modes 1–5 (§7) verified clean by grep + integration test.
- [ ] Code-only LOC budget (§5) verified within cap.
- [ ] 0 new runtime deps verified.
- [ ] Demo path (§12) executable end-to-end in the live app.
- [ ] §10 predictions vs. actuals filed in this doc and in deferred-capabilities Calibration tracking table.

**Default threshold ship value: `0.55`** (uniform across modes for inaugural). Reasoning: conservative-low so `no-mode-confident` is not under-emitted during dogfood — better to surface the override UI too often than silently misroute. Per-mode thresholds are configurable in `defaults.ts`; inaugural ships uniform.

## §12. Demo path (used in handoff)

Per Rule 2 (demo path is part of test surface). After implementation and dogfood, V3gga should be able to open the app and verify by typing the following in a fresh chat session:

1. `Hello, who is king in norway?` → mode badge shows `Recall` (or `no-mode-confident` with `Recall` close), response does NOT contain `bergen|olav kyrre|stiklestad`. (Closes `lsr-norway-king-bergen-001`.)
2. `single page html example of a 3d game that resembles hotline miami?` → mode badge shows `Make`, response does NOT contain `interface User|function greet|typescript`. (Closes `lsr-html-3d-game-typescript-fixture-001`.)
3. `10 plus eleven and minus one is what number, and also who is president us currently, reply only the president name + math result` → mode badge shows `Decide` or `Understand` with multi-question signal active, response contains `20` AND a US president name. (Closes `lsr-multi-question-okay-then-try-001`.)
4. Type any input, observe mode badge surfaces correctly. Try a deliberately ambiguous input (e.g. single emoji) → mode badge shows `no-mode-confident` and the override UI is visible.

If any demo step fails in the live app, the capability does not ship.

## §13. Stop conditions (trip-wires, binding)

1. Implementation requires touching a fourth file beyond `classifier/*` (5 files), `vai-engine.ts`, and `persona/vai-for-v3gga.ts`. → **STOP. Report.**
2. Any of the 6 lsr-*.md cases doesn't pass after iteration 1; classify the failure per the standard taxonomy (implementation bug / design gap / spec gap / corpus error). → **STOP. Report.** Iteration 2 only proceeds with V3gga-acknowledged classification.
3. Code-only LOC budget bust beyond authorized (§5). → **STOP. Report.** Per `_template.md` reporting requirement.
4. Determinism breaks. → **STOP. Report.** No "this is deterministic enough" — exact identity required.
5. Persona-specific behavior leaks into shared core (Phase-4 audit failure modes 1–3 firing). → **STOP. Report.** Re-extract the leak before continuing.
6. Pre-code audit per Rule 1 surfaces ≥3 dependent overlaps in `vai-engine.ts`. → **STOP. Report.** Re-architect approach; the surgical assumption is wrong.
7. Loop cap: **3 iterations.** Per anti-pattern #15. If iteration 3 doesn't produce success on §11 definition-of-done, stop, tag work-in-progress, full report. No iteration 4 silently.

## §14. Non-goals this turn

- Real mode handlers for any of the four non-`Recall` modes (deferred to subsequent capability turns).
- Persistent classifier output store / telemetry sink (engine-side log only this turn).
- UI threshold-tuning surface (defaults in code only).
- Embedding-based signal extraction (stubs ship as `null` returners).
- Multi-mode confidence emission / blending (single-winner emission only).
- Cross-conversation persona memory feeding classifier signals (per-conversation history only, last-N turns).
- Streaming/partial-input classification.
