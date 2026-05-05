# Pivot options — RETIRED

> **Status: ALL OPTIONS IN THIS FILE ARE FORMALLY RETIRED (2026-04-29).**
> Replaced by Path A. See [docs/the-decision.md](the-decision.md)
> for the operative substrate, scope, and identity decision.
>
> **Retired-means-retired rule applies.** None of the options below
> is a fallback. If Path A struggles, the response is to
> re-derive, not drift back to anything in this file.
>
> Originally framed as: "Two real proposals. No recommendation.
> The decision is V3gga's." That neutral framing was less honest
> than it should have been — the live-session evidence already
> ruled out continuing the current substrate, and at least one
> of the two options was a better fit than the other for what
> Master.md actually asks of Vai. The agent's neutral framing
> deferred a decision the evidence already mostly made. That
> framing failure is part of the historical record kept here.
>
> ---
>
> ## Retired options index
>
> | Option | Status | Retired in |
> |---|---|---|
> | B-Live (wrap small LLM, e.g. Qwen 2.5 3B) | RETIRED | the-decision.md |
> | Narrow-Scope-as-originally-framed (mode router as the only product) | SUPERSEDED by Path A | the-decision.md |
> | More-capability-builds on S1 router | RETIRED | the-decision.md |
> | Side A (capability-stacking on current S1) | Already struck in postmortem; reaffirmed | live-session-postmortem.md → the-decision.md |
> | Path B (S9: small local LLM + symbolic guard) | RETIRED | the-decision.md |
>
> ## What replaced these
>
> Path A: deterministic thinking interface (S7 FSM + memory store +
> heuristic classifier), dual surface (Vai-for-V3gga inaugural,
> Vai-for-everyone later), pre-tool validation in inaugural slice.
> See [docs/the-decision.md](the-decision.md) and
> [docs/the-idea.md](the-idea.md).
>
> Narrow-Scope-as-originally-framed deserves a specific note: Path
> A is its sharpened, dual-surface version. Same substrate family
> (FSM-driven explicit modes), but Narrow-Scope-as-originally-framed
> treated the mode router as the *entire product* and capped Vai's
> scope at "build/diagnose/plan/explain workflow tool." Path A keeps
> the FSM modes and *adds* the memory store, the weak-prompt
> classifier, validation contracts, and the dual-surface plan that
> lets the same core later expose research and app-creation
> surfaces with specialized generators behind it. The original
> Narrow-Scope is not a fallback; the *evolved* version is the
> operative path.
>
> ---
>
> The contents below are preserved verbatim from the original
> 2026-04-28 draft as historical record. Do not treat the analysis
> below as current guidance.

---

# Pivot options (original 2026-04-28 draft, retired)

> Two real proposals. No recommendation. The decision is V3gga's. Both
> proposals are honest about what they cost in throwing-out value
> versus what they buy.
>
> Context: the live-session postmortem
> ([docs/live-session-postmortem.md](live-session-postmortem.md)) and
> the substrate memo's "Live evidence" section
> ([docs/substrate-memo.md](substrate-memo.md)) jointly establish that
> the current routing substrate cannot answer open-ended factual
> questions correctly. These two options are the rational responses.

---

## Hardware caveat (applies to both options)

V3gga's exact hardware specs are not on file. The original substrate
memo's open question #1 — "What is the actual hardware target? CPU
spec, RAM, GPU presence." — is unanswered. Both options below make
working assumptions and flag the hardware-dependent claims explicitly.
Reading "old hardware" from V3gga's standing context as: a recent-ish
desktop CPU, 16–32GB RAM, no high-end discrete GPU. If a 12GB+ NVIDIA
GPU is present the model selection in Option B-Live changes
substantially. If RAM is <16GB or the CPU is pre-2018 the model
selection narrows further.

---

## Option B-Live — wrap a small LLM

### Model selection: **Qwen 2.5 3B-Instruct, Q4_K_M quantisation**

Considered three candidates:

| Model | Params | Disk @ Q4 | RAM @ Q4 | Tok/s on CPU (rough) | Instruction quality |
|---|---|---|---|---|---|
| Llama 3.2 3B-Instruct | 3.2B | ~2.0 GB | ~3.5 GB | 4–10 | Good, English-strong |
| Phi-3.5 mini | 3.8B | ~2.4 GB | ~4.0 GB | 3–8 | Strong on reasoning, weaker on chat |
| **Qwen 2.5 3B-Instruct** | 3.1B | ~1.9 GB | ~3.5 GB | 5–12 | Strong, multilingual incl. Norwegian |

**Picking Qwen 2.5 3B-Instruct**, three reasons:

1. **Norwegian competence.** V3gga's first live-session prompt was
   "who is king in norway." Llama 3.2 and Phi-3.5 mini are
   English-dominant. Qwen 2.5's training data has substantially more
   Norwegian and other Nordic-language content. The user is in
   Norway; Norwegian-language prompts and Norway-specific factual
   questions are foreseeable. This is a real product fit, not a
   benchmark abstraction.
2. **Best tok/s in class.** Qwen 2.5 3B with Q4_K_M quantisation
   typically runs 10–30% faster than Llama 3.2 3B on the same CPU
   because of slightly tighter attention head dimensions. On
   16–32GB-RAM consumer hardware without a discrete GPU, this
   difference is the line between "feels OK" and "feels slow."
3. **Apache 2.0 license.** Llama 3.2 has a custom community license
   with restrictions; Qwen 2.5 is Apache 2.0. For a private personal
   project this matters less, but it removes one license-compliance
   axis if the project ever opens up.

**Quantisation: Q4_K_M.** This is the sweet spot for 3B models on CPU:
~1.9 GB on disk, ~3.5 GB resident, minimal quality loss vs FP16 on
chat-style tasks. Q5_K_M is an option if the hardware can spare ~700MB
more RAM and a small latency hit; Q3 quantisation drops measurable
quality and is not recommended at 3B parameter scale.

**Inference engine: llama.cpp.** Cross-platform (Windows/macOS/Linux
per Master.md), CPU-first with optional GPU offload, Node.js bindings
exist (`node-llama-cpp`), single-binary deployable, and the Q4_K_M
quantisation format is its native output. No alternative comes close
on the cross-platform + Node.js axis.

**Realistic tok/s on assumed hardware** (16–32GB RAM, recent consumer
CPU, no discrete GPU): 5–10 tok/s. A typical 200-token response
arrives in 20–40 seconds. This is borderline for chat. **Not knowing
the hardware is the single largest risk in this option.** A real
benchmark on V3gga's actual hardware in the first 24 hours is
mandatory before committing to the two-week build.

### What stays from the current codebase

| Component | Reason it stays |
|---|---|
| Corpus + corpus runner | Truth source. Unchanged. The candidate generator changes; the way we measure correctness does not. |
| Determinism work (`--seed 42` path) | Survives in a degraded form: deterministic prompt assembly + temperature-0 sampling + pinned model weights gives reproducible outputs within a single inference engine version. Bit-identical hash across runs becomes a tolerance test. |
| Self-evaluation umbrella (`SelfEvaluator`, predicate registry) | Core of the new substrate. The LLM produces candidates; the predicate gate decides what ships. This is the part of the existing engine most worth keeping. |
| Predicate infrastructure | Unchanged. Each capability becomes "add a predicate" instead of "add a strategy arm." |
| Dogfooding gate (15-prompt + demo path) | Unchanged. |
| Handoff protocol (rules 1–4 + Appendix B) | Unchanged. The rules apply to predicates and prompts, not just to handlers. |
| Chat UI itself | Unchanged. The substrate change is below the UI line. |
| The deterministic arms that work: math, binary decode, literal-response (when correctly triggered), code review on pasted code, error diagnosis on pasted error messages | Kept as **pre-LLM intercepts.** Math is still cheap and exact; do not pay LLM latency for `10 + 11 - 1`. |
| The L41463 personal-introduction handler and the L6752 recall block (this turn's capability) | Kept as pre-LLM intercepts for the same reason. Conversational acknowledgement is cheap and the LLM does not improve on "Nice to meet you, **Sara**!" |
| Norwegian/multilingual handling that already works | Kept; LLM augments, does not replace. |

### What gets thrown out

| Component | Reason it goes |
|---|---|
| The strategy router as the answer-generation layer | The thing that emitted Bergen on "who is king in norway." The architecture is the bug. |
| The curated knowledge / primer store | The thing that *contained* the Bergen primer that got retrieved. Replaced by retrieval against either (a) the corpus itself as exemplars or (b) a small RAG index over a curated, *structured* fact set, not freeform primers. |
| The L41463/L6752/L2987 dispatch graph for *substantive* answers | Kept only for the cheap intercepts above. The "personal intro" handlers stay; the "answer factual question by token-overlap retrieval" handlers go. |
| Fallback subject extractor | The thing that emitted "okay then try" as the literal subject of Exchange 3. The LLM does not need a regex-based subject extractor; it reads the input. |
| Hardcoded fixture arms (TypeScript User-greet on "show me example", etc.) | The thing that emitted a TypeScript snippet on a Hotline Miami HTML game request. The LLM produces candidate code from the request itself; predicates verify it runs. |
| Auto-RELATED follow-up generator | The thing that propagated "emm so you can not make games" forward as authoritative auto-prompts. Either remove entirely or regenerate via the LLM with the predicate gate filtering out gibberish subjects. |
| Topic tracker that reads assistant header strings | Replaced by the LLM's native context handling; the conversation history is the topic representation. |

### Two-week implementation sketch

**Day 1.**
- Benchmark Qwen 2.5 3B-Instruct Q4_K_M on V3gga's actual hardware.
  Single-prompt latency, sustained tok/s, RAM footprint, idle vs
  active. **Hard gate:** if sustained tok/s < 4, stop and reconsider
  Option Narrow-Scope. Do not proceed on hope.
- Wire `node-llama-cpp` into a thin `LlmAdapter` class that takes a
  prompt + system message, returns a streamed response.

**Days 2–3.**
- Write the prompt-assembly layer. Inputs: chat history + retrieved
  exemplars from the corpus + system prompt. Output: the prompt
  string. Keep this layer narrow and side-effect-free.
- Decide on retrieval: simplest is BM25 over the corpus turns'
  `must` patterns and `say` text, returning top-K examples that match
  the user's input. No vector DB in the first cut. Re-evaluate at
  end of week 1 if BM25 is too noisy.

**Days 4–5.**
- Wire pre-LLM intercepts: math arm, literal-response arm, personal-
  introduction handlers, recall handler. These run first; if any
  emits, the LLM is not called. Predicate gate still runs on their
  outputs.
- Wire the LLM as the default response generator when no intercept
  fires.
- Predicate gate runs on every output regardless of source.

**Days 6–7.**
- Run the full corpus against the new substrate. Capture pass count,
  per-conv strategy badges (now: `intercept-math`, `intercept-recall`,
  `llm-default`, etc.), and identify the new failure modes.
- First dogfooding pass with the six live-session prompts as the
  gate. **Hard gate:** if Exchange 1 (Bergen) does not improve, the
  prompt assembly or retrieval is broken; debug before continuing.

**Days 8–10.**
- Iterate prompt assembly and retrieval based on dogfooding evidence.
- Add or tune predicates that catch the new failure mode (LLM
  hallucination on factual questions outside its training cutoff,
  e.g. "current king of Norway" if the model's knowledge is from
  2024 — though Qwen 2.5's training cutoff is October 2024 which
  covers Harald V's continued reign).
- Audit which existing arms can be retired. Some — the strong
  taught-doc arms like Base44 (Exchange 6 body) — may continue to
  outperform the LLM on their narrow domain and stay as intercepts.

**Days 11–12.**
- Determinism re-establishment: pin model weights (SHA256 the
  `.gguf` file), pin `node-llama-cpp` version, pin temperature to 0,
  pin sampling seed. Re-run corpus 5× and verify normalized SHA
  matches across runs (same standard as the current `--seed 42`
  guarantee). If determinism doesn't hold at temperature 0, document
  the residual variance and decide whether it's acceptable.
- Update the handoff-protocol with new failure modes.

**Days 13–14.**
- Live dogfooding session with V3gga, fresh prompts, the same six
  exchanges plus 9 new ones.
- Gap analysis: what the new substrate gets wrong, what it gets
  better, what the residual disagreements are.
- Decide whether to continue or roll back. The roll-back option is
  cheap because nothing is *deleted* in the first two weeks — the
  old engine is behind a feature flag. Day 15 onwards is when arms
  start retiring permanently.

### What corpus pass-count plausibly looks like at end of week 2

Honest range: **38–50 / 57.** Confidence in either bound: ~0.4.

The optimistic bound (50/57): Qwen 2.5 3B with corpus-exemplar
retrieval and predicate gating handles the multi-turn-reasoning,
theory-of-mind, and planning buckets that the routing substrate
cannot express, jumping the corpus pass rate substantially.

The pessimistic bound (38/57): the LLM hallucinates on factual
questions outside its strongest domains, the predicate gate reduces
many turns to flag-uncertain or rejected, and the new substrate gains
on multi-turn cases but loses on the cases where the routing arms
were currently correct because the predicates were tuned for routing-
arm output distributions.

The midpoint (~44/57) is roughly: keep the ~17 conversations the
current engine passes, lift another ~6 multi-turn/reasoning convs the
routing substrate cannot solve, lose ~2–3 to LLM hallucination on
factual edge cases the predicates don't catch yet.

**Importantly: the corpus pass count is no longer the right primary
metric** under this option. The live-session pass rate (out of 15
fresh dogfooding prompts) is. Side B's premise is that the corpus
underweights what the user actually wants. Continuing to optimise the
corpus number under the new substrate would re-create the same blind
spot.

### Cost summary for B-Live

- ~6000 LOC of working code retired (over weeks 3–8, not all at once).
- ~3.5GB resident memory baseline whenever the chat is active.
- 5–10 tok/s answer streaming on assumed hardware. Borderline.
- Loss of bit-identical determinism; gain of approximate determinism.
- Loss of <50ms response latency on routed turns; pre-LLM intercepts
  preserve that for the cheap arms.
- Two weeks of focused work, with a hard go/no-go gate at end of
  Day 1 (benchmark) and end of Day 7 (Bergen exchange improvement).

---

## Option Narrow-Scope — accept Vai is a routing layer; build the product it can be

### The premise

The routing substrate is *correct* at what it does — it just does
something other than "general chat assistant." Specifically, it is
correct at:

- Deterministic, low-latency response to *narrowly-shaped inputs.*
- Predicate-gated structured outputs.
- Conversational state tracking *when the surface forms are
  enumerable.*
- Reading well-curated knowledge documents and emitting paraphrased
  summaries when the user's request token-matches the document.
- Composing structured handoffs between explicit modes (Chat ↔
  Builder ↔ Preview).

It is *incorrect* at:

- Open-ended factual question answering.
- Compositional reasoning across the conversation.
- Question-shape detection without explicit regexes.
- Anything that requires distinguishing "this primer mentions the
  query tokens" from "this primer answers the query."

The Narrow-Scope option says: stop trying to be a general chat
assistant. Be the thing the substrate is correct at. Make the chat UI
visibly *not* a general chat box — make it visibly the thing it
actually is.

### Concrete proposal: **Builder-mode-first command palette**

Vai becomes a structured-workflow assistant for *building*. The
chat-as-front-door pattern (which Exchange 6's body actually
articulates well) becomes the *only* pattern. Free-form factual chat
is removed from the surface entirely.

The product surface:

- **Primary entry: a command palette / structured prompt entry** with
  declared modes. The user picks "Build", "Diagnose", "Refactor",
  "Plan", "Explain" — the modes are the routing decision, made
  explicit and visible. The user can no longer accidentally invoke a
  routing decision the engine will get wrong, because the user is the
  router.
- **Each mode has a constrained input grammar.** "Build" asks for
  goal + stack + first slice. "Diagnose" asks for the error message
  and the surrounding code. "Plan" asks for the project state and
  the constraint to add. The current routing arms become first-class
  workflows with their own UI, not hidden behind chat token
  matching.
- **General factual questions are explicitly out of scope.** No
  "who is king in Norway." No "show me a 3D game." The product does
  not pretend to answer those. If the user types one, the response
  is a polite redirect: "Vai is a build assistant. Try the Build
  mode for [interpretation], or use [external] for general
  questions." Honest. Bounded. Correct.
- **Builder integration is the headline feature**, not a destination
  the user has to navigate to. The plan-preview-before-code
  workflow Exchange 6 articulated becomes the *default flow*.
- **The corpus retargets.** Drop the conversational, factual, and
  multi-turn reasoning buckets. Add buckets for "build intent
  classification", "spec synthesis", "plan-preview generation",
  "diff-first iteration", "clean build contract." The corpus
  becomes a measurement of what the product actually does, not what
  it pretends to do.

### What survives

Almost everything. The routing substrate is the right substrate for
*this* product. The strategy chain becomes an explicit mode router
controlled by the UI, not a hidden token-matcher. The L41463/L6752/
L2987 handlers stay. The predicate gate stays. The corpus and
determinism stay. The chat UI stays — it's just rebadged as a
command palette with explicit mode entry.

### What gets thrown out

| Component | Reason it goes |
|---|---|
| Free-form chat as the default mode | This is the surface where the Bergen / TypeScript-fixture / "okay then try" failures happen. Removing it is the entire pivot. |
| The curated factual primer store (Norway primers, framework primers, etc.) | The product no longer answers open factual questions, so the primer store is dead weight. Keep the *workflow* primers (Base44 build flow etc.) which are about how to do things in Vai. |
| The "RELATED" auto-follow-up generator | Replace with structured next-mode suggestions tied to the current mode's workflow (after Build, suggest Diagnose or Plan). |
| The fallback subject extractor in its current form | Fallback responses become "this isn't a recognised mode input" with mode suggestions, not "I don't have an answer for [garbled subject]." |
| The hardcoded fixture arms (TypeScript User-greet etc.) | Each fixture either gets attached to a real mode (the TypeScript example becomes part of an "Explain TypeScript" mode if that's a product, or it gets deleted) or it gets deleted. |
| Significant chunks of the existing dispatch chain that handled the "general chat" case | The chat is no longer general. |

### Two-week implementation sketch

**Day 1.**
- Decide the mode list. Start narrow: Build, Diagnose, Plan,
  Explain. Maybe Refactor as a second-week add. Each mode gets a
  one-page spec: required inputs, expected output shape, predicate
  set.
- Mock the new UI: command palette as the default chat surface, mode
  pill always visible, mode switching as cheap as Cmd+K.

**Days 2–4.**
- Build the mode router as a UI component, not an engine layer. The
  user picks the mode; the engine receives `{mode: 'build',
  inputs: {...}}` instead of free-form text.
- Wire Build mode to the existing Builder integration. This is the
  mode with the most work because Exchange 6's body says it well: the
  current Builder hand-off is not actually a workflow; it's a button
  press followed by silence.

**Days 5–7.**
- Wire Diagnose mode. Input: error message + optional code context.
  Output: structured diagnosis with line-level annotations. This is
  the mode that uses the existing error-diagnosis arm correctly —
  the arm already works when the input is *shaped* like an error;
  the mode UI ensures it always is.
- Wire Plan mode. Input: project state description + new constraint.
  Output: file-tree-aware plan preview before any code generation.

**Days 8–10.**
- Wire Explain mode for code/concept explanation. Input: code or
  concept name. Output: explanation with structured sections.
- Polish the no-mode fallback ("Vai is a build assistant. Try
  Build mode for [interpretation], or open a regular search for
  general questions."). This response replaces the entire current
  "fallback with subject extraction" path.

**Days 11–12.**
- Retarget the corpus. Remove conversational/factual/multi-turn
  reasoning buckets that are out of scope for the new product. Add
  build/diagnose/plan/explain buckets. Run the new corpus against
  the new substrate. The pass count is meaningful in the *new* corpus
  only.
- Deprecate the curated factual primer store. Keep only the
  workflow primers.

**Days 13–14.**
- Live dogfooding with V3gga. New session, new prompts, all in
  modes. The six original failing exchanges either:
  (a) become valid in a mode (Exchange 4 in Build mode → runnable
  Hotline Miami HTML 3D game starter, real first-pass attempt),
  (b) get the polite-redirect treatment (Exchange 1 "who is king in
  Norway" → "Vai is a build assistant; try a search engine for
  general factual questions"), or
  (c) reveal a missing mode that should be added to the mode list.

### Cost summary for Narrow-Scope

- Significant **product scope reduction.** The product is no longer
  a chat assistant. It's a build/diagnose/plan/explain workflow tool
  with a chat-shaped UI. V3gga has to be willing to give up the
  general-chat aspiration.
- Most of the engine code survives, structurally. The retirement is
  of the curated factual primer store and the parts of the dispatch
  chain that pretended to handle general questions.
- All of the determinism, predicate, and dogfooding infrastructure
  remains exactly as built. The corpus retargets but the *runner*
  doesn't change.
- The pivot is far cheaper to execute than Option B-Live (no model
  wrapping, no quantisation work, no LLM latency floor) but more
  expensive in *product ambition.*
- The product becomes correct at what it does and explicitly bounded
  in what it does not. This is V3gga's call about whether that's the
  right product.

### What corpus pass-count plausibly looks like

The current corpus stops being the meaningful number. The new
mode-targeted corpus would start from a small base (maybe 10–15
specs in week one across the four modes) and grow with the product.
Pass rate on the new corpus would plausibly be 80%+ at end of
week 2 because the modes are designed around what the substrate
already does well.

The old corpus's 33/57 number becomes a historical reference, not a
target. The honest answer is "this option does not optimise the same
thing the old corpus measured because the old corpus measured the
wrong product."

---

## Honest accounting of what's thrown away in each option

| Asset | B-Live treatment | Narrow-Scope treatment |
|---|---|---|
| Corpus | Kept as exemplar source + secondary truth source | Retargeted; old corpus archived |
| Determinism work | Degraded to approximate determinism | Kept as-is |
| Self-evaluation umbrella | Promoted to core gate over LLM output | Kept as-is |
| Predicate registry | Retuned for LLM output distributions | Kept as-is |
| Dogfooding gate | Kept as-is | Kept as-is |
| Handoff protocol + Appendix B | Kept as-is | Kept as-is |
| Chat UI | Kept as-is | Rebadged as command palette |
| Math / binary / literal-response arms | Kept as pre-LLM intercepts | Kept as mode handlers |
| Personal-intro handlers (this turn's capability) | Kept as pre-LLM intercepts | Kept; arguably outside any mode |
| Strategy router as answer generator | Retired | Made explicit and visible (UI-driven) |
| Curated factual primer store | Replaced by structured retrieval / RAG | Retired (workflow primers stay) |
| Fallback subject extractor | Replaced by LLM context handling | Replaced by mode-not-recognised redirect |
| Hardcoded fixture arms | Retired | Either retired or attached to a mode |
| Auto-RELATED generator | Retired or LLM-regenerated with gating | Replaced with mode-aware next-step suggestions |
| Topic tracker (assistant-header-as-subject) | Retired | Retired |

---

## What both options share

- Six live-session failures are the trigger evidence, not opinion.
- Multi-turn-memory-detector and the personal-intro handler stay.
- Corpus, determinism, self-eval, predicates, dogfooding, handoff
  protocol all survive in both.
- Strategy router as the *general* answer generator does not survive
  in either.
- Curated factual primer store does not survive in either.
- Decision is V3gga's. Both options have hard go/no-go gates inside
  their two-week window so neither is a one-way door.

---

## What this document deliberately does not do

- Does not recommend either option.
- Does not propose a hybrid. The substrate memo's Side C analysis,
  re-read against the live evidence, shows hybrid is the worst path
  because the failures are at the top of the chain, not the bottom.
  Hybrid would still emit Bergen.
- Does not propose a third "small refactor" option that keeps the
  substrate and patches the six failures. The single-bug-vs-substrate
  analysis in the postmortem is unambiguous: it is not a single bug,
  surgical patches close 3 of 6 exchanges, the substrate-level
  failures (Exchanges 1, 2, and the 5→6 cascade) are unaddressable
  without architectural change.

---

## Why this file still exists

This file is preserved — not deleted — because future-V3gga or a
future collaborator will, at some point, feel the same
comparison-shopping pull or substrate-grief response that produced
the original B-Live and Narrow-Scope options. When that happens,
the right move is not to re-derive from scratch; the right move is
to read the work that already disposed of those questions. The
retired-options file shows that work.

The file also preserves an agent-side framing failure as part of
the record: the original 2026-04-28 framing of "two real proposals,
no recommendation, the decision is V3gga's" was less honest than it
should have been. The live-session evidence had already ruled out
continuing the S1 substrate, and the agent's neutral both-sides
posture deferred a judgement call the evidence had already mostly
made. Neutral framing is not the same thing as honest framing.
This is the kind of failure mode the handoff protocol's Appendix B
is meant to catch — recording it here so the same shape gets
recognized faster next time.

The retired-means-retired rule still applies. Reading this file is
for *understanding what was already considered and rejected*, not
for *finding something to drift back to*. If something in this
file feels like it should be reconsidered, the response is to
re-derive against current evidence per `docs/the-decision.md`'s
comparison-shopping protection rule, not to silently pick an
option out of the historical record.
