# Substrate memo

> Non-blocking parallel artifact. Written during the multi-turn-detector
> pre-code audit. Per V3gga's request: three sides, no recommendation,
> "what would change my mind" closer per side. Read before deciding the
> next set of capability authorizations.

---

## Live evidence — added 2026-04-28 after live dogfooding

> Read this section first. The original three-sides analysis below is
> preserved for the historical record but is no longer the operative
> document; the live session resolved the question Side A was hedging.

V3gga opened the live app immediately after the multi-turn-memory-
detector handoff and ran six prompts. Five of the six produced broken
or off-topic responses. Full diagnosis in
[docs/live-session-postmortem.md](live-session-postmortem.md). The
four most diagnostic exchanges, verbatim:

**Exchange 1 — "Hello, who is king in norway?"**
Engine emitted: "bergen is norway's second largest city, founded
around 1070 by king olav kyrre. the battle of stiklestad..." — i.e.
a Norway primer about an 11th-century king, retrieved by token
overlap on `{king, norway}`, instead of an answer about the current
monarch.

**Exchange 3 — "okay then try this, tell me 10 plus eleven and minus
one what is that? and then who is president us currently, reply only
the president name + math result"**
Engine emitted: "I don't have a solid answer for **okay then try**
yet." — fallback subject extractor took the conversational scaffolding
as the literal subject, ignored both the math sub-question and the
president sub-question.

**Exchange 4 — "can you show me a single page html example of a 3d
game that resembles hotline miami? so I can play it in the preview?"**
Engine emitted: a hardcoded TypeScript User-greet interface code
snippet. Matched on input shape ("show me ... example"), emitted a
constant fixture, ignored the requested language, topic, and
rendering target.

**Exchange 5 → 6 cascade** — Exchange 5's broken subject extraction
("emm so you can not make games") propagated forward into Exchange 6's
"RELATED" follow-up suggestions panel as authoritative auto-prompts:
"How should I structure **emm so you can not make games** in a real
project?"

### What this evidence resolves

The original Side A argument rested on three claims:

1. The substrate measures routing decisions correctly today via
   strategy badges.
2. Determinism makes the corpus a trustworthy truth source.
3. The corpus → 48–52/57 trajectory is a credible six-month path.

Claims 1 and 2 survive. Claim 3 is the one that does not.

The corpus is measuring the wrong thing for V3gga's actual product
goal. Determinism + corpus pass count + strategy badge readability
are excellent properties for *engineering iteration*. They are not
properties of *user-perceived quality*. The 33→35 corpus pass count
delta from this turn's capability work is real, deterministic, and
correctly measured. It also did not move any of the six live-session
failures, because none of those failures are corpus-shaped — they
are substrate-shaped. A substrate that token-matches over a primer
store will fail Exchange 1 every time regardless of how many corpus
turns the surrounding capabilities pass.

### Does Side A's "what would change my mind" closer apply?

The original closer:

> - Two consecutive dogfooding passes where V3gga's first three real
>   prompts to the live app all hit fallback or off-topic responses
>   despite "everything passing the gate." Signal: the corpus is not
>   measuring the thing the user actually wants.

This is exactly what happened in the first dogfooding pass. The
trigger is met after one pass, not two — V3gga's first three real
prompts (Bergen, meta-question, math+president) all hit fallback or
off-topic. The "two passes" hedge in the original closer was an
overcautious threshold. One pass is sufficient when the failure mode
is unambiguous, and Exchange 1's mechanism is unambiguous: token
overlap + primer store + no grounding gate produces Bergen on a
king-of-Norway question, by construction, every time.

### Side A re-evaluated

**Side A does not survive the live evidence as the operative path.**

The argument for keeping the routing engine and deepening it rests on
the assumption that the gap between current corpus performance and
user-perceived quality can be closed by adding more capabilities.
The live evidence shows this assumption is wrong. The gap is not
"more arms needed"; the gap is "the answer-generation strategy is
incompatible with answering open-ended factual questions correctly."
No number of additional capabilities adds a substrate property
(question-shape detection, entity resolution, grounding) that the
substrate does not have.

What this does *not* mean:

- The deterministic arms that *are* correct (math, binary decode,
  literal-response, code review on pasted code, error diagnosis on
  pasted error messages, the L41463 personal-introduction handler)
  remain correct and useful. They keep working in any successor
  substrate.
- The corpus, the determinism work, the self-evaluation umbrella, the
  predicate registry, the dogfooding gate, the handoff protocol, and
  the chat UI remain correct and useful. They become *infrastructure
  for evaluating a different substrate.*
- The work shipped through this turn is not retroactively wrong. It
  was the right work to do *to find this out.* This is what the
  dogfooding loop is for.

What it does mean:

- Side A as the trajectory — "4 → 22 deferred capabilities shipped
  over six months on this substrate" — is no longer rational. The
  capabilities address a corpus that does not measure what V3gga
  needs measured.
- The strategy chain in `vai-engine.ts`, the curated primer store, the
  fallback subject extractor, the hardcoded fixture arms (the
  TypeScript-example arm, the auto-RELATED follow-up generator
  reading prior bad subjects), and the topic tracker that reads
  assistant headers — these are the architecture, not bugs in the
  architecture. They cannot be patched into a system that answers
  "who is king in Norway" correctly. They have to be replaced.
- The decision is now between Side B (wrap-a-small-LLM) and a
  not-previously-considered fourth side (narrow the product scope to
  what the routing substrate is actually good at — see
  [docs/pivot-options.md](pivot-options.md)).

### Sides B and C — do they need re-reading?

Side B becomes more attractive — the live evidence is exactly the
class of failure that a wrapped LLM with retrieval would solve, and
the predicate gate that was Side B's main risk is in fact the part
of the existing engine most worth keeping. The Side B section below
stands as written.

Side C (hybrid) becomes less attractive specifically because the
Bergen and TypeScript-fixture failures are not at the *bottom* of the
routing chain (where the LLM arm would fire as a fallback) — they
are at the *top*, where high-confidence-but-wrong arms intercept the
query before any fallback runs. A hybrid architecture would still
emit Bergen on Exchange 1 because the Bergen arm fires confidently
and the LLM arm never gets the turn. To make Side C work the routing-
decision layer would have to actively *demote* the existing arms,
which is most of the cost of Side B without most of the benefit. Side
C remains as written but it is no longer the comfortable middle path
it appeared to be at design time.

### Standing position after the live evidence

- Side A: not viable as the operative path. Replace with the Narrow-
  Scope option in [docs/pivot-options.md](pivot-options.md) if the
  product target shrinks to fit what the routing substrate can
  actually deliver.
- Side B: viable, more attractive than at design time. Concrete
  proposal in [docs/pivot-options.md](pivot-options.md) as Option
  B-Live with model selection, hardware analysis, two-week sketch.
- Side C: still viable in principle but less attractive than at
  design time given the live evidence shows the failures are at the
  top of the chain, not the bottom.

The decision is V3gga's. The substrate decision can no longer be
deferred for another capability turn.

---

## Frame

The substrate question: is the **routing-engine substrate** that VAI is
built on (heuristic strategy chain → predicate gate → corpus-tested
arms) the right thing to keep investing in, or is the better six-month
trajectory to **wrap a small local LLM** (1–4B params) and rebuild the
existing strengths around it as a verifier / router instead of as the
answer generator?

This memo is not a decision. It lays out three sides honestly. The
"what would change my mind" closer per side is the most useful part —
read those first if you only have five minutes.

Confidence calibration: where I have measured numbers I cite them.
Where I am extrapolating from a single data point or from architecture
reasoning, I say "I don't know" or "best guess." If a number is not
labelled with confidence, treat it as ~0.6.

---

## Side A — Keep the engine. Deepen what's measurable.

### What it is

Continue the current trajectory: a hand-tuned strategy chain in
`vai-engine.ts`, regex-and-heuristic dispatch arms, deterministic
predicates as a self-evaluation gate, a corpus runner as the truth
source, and a learning store for facts. No external LLM in the answer
path; LLMs only as critics / verifiers when needed.

### Six-month trajectory if we go this way

- 4 → ~22 of the 26 currently-deferred capabilities shipped, S-cost or
  M-cost each, gated by the same template-and-predicate process used
  this turn.
- Corpus baseline grows from 33/57 → an estimated 48–52/57. The
  remaining gap is not random — it concentrates in the multi-turn
  reasoning, theory-of-mind, and planning-solver buckets that the
  routing substrate cannot easily express. Confidence: ~0.55.
- The self-evaluation umbrella expands to fact-grounding and
  consistency-checking predicates as enough fresh corpus data piles up
  to set thresholds without overfitting. Already deferred; needs
  dogfood data first.
- Build-quality budget per capability stays measurable: 2–4 days of
  design + audit + implement + dogfood per S-cost capability.

### What this substrate measures correctly today

- **Routing decisions** — every dispatched strategy is observable in
  one ResponseMeta per turn. Bugs are diagnosable by reading the
  strategy badge, not by chasing soft probabilities.
- **Determinism** — same input + same engine state = same output.
  Verified by 3× identical-run hash on the active baseline. This is
  not a small property. It is what makes the corpus a trustworthy
  truth source. Wrap an LLM and this disappears the moment you turn
  on sampling.
- **Cheap iteration** — a capability ships in days, not weeks. The
  template + audit + implement + dogfood loop is now ~2 days for
  S-cost; rough best guess.

### Real cost of the 4 → 22 jump

- Estimated 18 capabilities × ~2 days each ≈ 36 person-days of focused
  work. Confidence: ~0.5; could be 25 or could be 50.
- The remaining ~5 turns to close the corpus gap from 22 → 27 are the
  hardest because they are the multi-turn / planning / world-model
  cases the routing substrate is not great at expressing. Some of
  those become S-cost only because we constrain the surface form
  drastically (this turn's multi-turn-detector is exactly that — four
  prose forms, single-conversation scope, capitalisation-dependent).
  Each constrained subset moves the number 1 turn at a time.

### What does not get fixed by deepening this substrate

- **Compositionality.** The strategy chain is fundamentally a
  switch-on-input-shape architecture. It does not compose: handler X
  cannot easily call handler Y as a sub-step. The corpus tests that
  fail today on multi-step reasoning — "given the user's prior code
  and a new constraint, refactor it" — fail because there is no way
  to express "first parse the prior code, then apply the constraint,
  then re-emit" without writing the whole flow out as a new arm.
- **Long-tail input shapes.** Every new surface form is a new regex,
  a new stop-list entry, a new audit. The §4 four-surface-form scope
  for this turn's detector is a perfect microcosm: V3gga will type a
  fifth form the first time he opens the app and we will have a
  decision to make about whether to widen now or defer.
- **World model.** The engine has no representation of "what does
  this user know about themselves" or "what state is this conversation
  in." Every recall is a regex over `history`. Works at S-cost for
  names; does not generalise to "what was the user trying to build
  three turns ago and what constraint did they add at turn five."

### What would change my mind on Side A

- A capability that took ~3 weeks of S-cost work ships and the corpus
  delta is +1 turn instead of the predicted +2. Signal: the substrate
  is stalling at the natural ceiling.
- Two consecutive dogfooding passes where V3gga's first three real
  prompts to the live app all hit fallback or off-topic responses
  despite "everything passing the gate." Signal: the corpus is not
  measuring the thing the user actually wants.
- A capability bleed prediction is wrong by more than 3 turns despite
  a clean pre-code audit. Signal: the audit isn't catching what we
  thought it caught and the substrate is harder to reason about than
  we believed.

---

## Side B — Wrap a small local LLM. Throw away most of the engine.

### What it is

Stand up a small local LLM (Llama 3.2 1B / Phi-3.5 mini / Qwen 2.5
0.5B-1.5B / SmolLM2 1.7B) as the answer generator. Quantise to
Q4_K_M or Q5_K_M for V3gga's hardware. Wrap it with a thin layer that
does:

- prompt assembly with the corpus-equivalent specs as in-context
  exemplars,
- predicate-gate evaluation on the LLM's output (the existing
  `SelfEvaluator` survives unchanged),
- a small router that picks one of a few system prompts based on
  intent.

The dispatcher chain in `vai-engine.ts` mostly evaporates. Most of the
deterministic arms (math, binary decode, code review, error diagnosis,
literal response) stay because they are correct and cheap; everything
heuristic and keyword-driven (web-stack, framework-devops, taught-doc,
intelligence) gets deleted in favor of a single LLM call with retrieval.

### Six-month trajectory if we go this way

- 1–2 weeks to stand up the local LLM with quantisation that runs at
  acceptable latency on V3gga's hardware. I do not know V3gga's
  hardware specifics. Best guess: a recent CPU + 16–32GB RAM gives
  ~5–15 tok/s on a 1B Q4 model, which is borderline-usable for chat.
  GPU changes everything. Confidence: ~0.4.
- 3–4 weeks to rebuild the surviving deterministic arms as
  pre-LLM intercepts (math etc.) and post-LLM gates (predicates).
- 4–8 weeks for prompt iteration and corpus re-run. The corpus survives
  unchanged as the truth source; what changes is what produces the
  candidate answers.
- Probable corpus delta: I genuinely don't know. The optimistic case
  is a small LLM nails the long-tail multi-turn reasoning that the
  routing substrate cannot express, jumping from 33/57 to 45+/57 in
  a single pass. The pessimistic case is the small LLM hallucinates
  enough that the predicate gate reduces it to flag-uncertain on most
  turns, leaving the actual pass rate at 25/57 with much higher
  variance. Confidence in either direction: ~0.4.

### What survives from the existing engine

- `SelfEvaluator` and the predicate registry — fully reusable as a
  post-LLM gate.
- The corpus and the runner — unchanged. The truth source does not
  care what produces the candidate.
- The 15-prompt dogfooding gate — unchanged.
- The capability template and pre-code audit protocol — unchanged.
  Each future capability becomes "add a predicate" or "add a system
  prompt slice" instead of "add a strategy arm."
- The deterministic arms that are actually correct (math, binary,
  literal-response, utility-question) — kept as pre-LLM intercepts.
  Maybe 800–1200 LOC out of the current vai-engine.ts.

### What gets thrown away

- Most of the routing chain in `generateResponse` — perhaps 5000–7000
  LOC of strategy arms.
- The TF-IDF / fuzzy retrieval logic — replaced by retrieval over the
  corpus and learned facts injected into the LLM context.
- Most of the heuristic gates (`responseMentionsAnyToken`,
  `wantsNonJsLang`, etc.) — the LLM solves these implicitly or fails
  visibly.
- Determinism. Even at temperature 0 a small LLM is not bit-identical
  across runs unless you also pin the inference engine, weights, and
  KV cache implementation. The 3× identical-run hash test goes away
  or becomes a tolerance test.

### Cost of the throw-away

- ~6000 LOC of working code deleted. Some of those arms are buggy and
  the bugs are obvious; some are subtle and have already eaten weeks
  of debugging time. Throwing away buggy code feels good. Throwing
  away subtle, currently-correct deterministic logic is more expensive
  than it looks because the corpus does not exhaustively cover what
  those arms do.
- Loss of "I can read the strategy badge and know exactly what fired"
  diagnosability. The LLM substrate is opaque by default. You can add
  attention-based attribution or token-level confidence reports but
  they are weaker than a strategy badge.
- Latency floor. A 1B Q4 model on CPU is 200–800ms minimum for any
  answer. The current engine routinely answers in <50ms for arms it
  knows. V3gga has noted he cares about feel and fit-and-finish; the
  substrate change is felt.

### What would change my mind on Side B

- A real benchmark run on V3gga's actual hardware showing ≥10 tok/s
  on a quantised 1B model. Without that number Side B is theoretical.
- Three corpus turns the routing substrate cannot solve at any cost
  (no matter how surgical the regex) shipped against a wrapped LLM
  and verified to pass both predicate gates and dogfooding. One data
  point that says "this only works with an LLM" reframes the question.
- A demonstration that the predicate gate catches 90%+ of the small
  LLM's hallucinations on the existing corpus. If the gate works,
  Side B becomes attractive. If it doesn't, Side B is a regression.

---

## Side C — Hybrid. Routing engine for current strengths, small LLM
> for the gap, predicate gate on both.

### What it is

Keep the routing chain as-is for the deterministic arms it already
solves well (math, code review, error diagnosis, literal response,
utility, language-specific arms, etc.). Add a small LLM as a single
new dispatch arm that fires when no other arm has produced a confident
answer — i.e. before `tryWebSearch` and the contextual fallback. Run
the predicate gate on both branches.

The routing layer becomes "decide whether this turn is in the
deterministic arm set or the LLM-needed set" — a smaller and easier
problem than today's "route this turn to one of 60 arms."

### Six-month trajectory

- 2–3 weeks to stand up the LLM arm and integrate it as a new dispatch
  slot. Reuses the LLM-stand-up cost from Side B but skips the
  rewrite-everything cost.
- 2–4 weeks of iteration on the routing-decision layer: which inputs
  go to the deterministic arms vs. the LLM arm. This is the new hard
  problem. Get it wrong and either (a) the LLM swallows easy turns
  the routing arms could have answered cheaply, or (b) the routing
  arms keep trying and failing on inputs the LLM would have nailed.
- Probable corpus delta: 33/57 → 42–50/57. Confidence: ~0.5. Better
  than Side A (which can't address the multi-turn cases without
  surgical regex shrinkage) and lower variance than Side B (which
  is all-or-nothing on the LLM).

### Cost of the routing-decision layer

- A second routing problem on top of the existing one. The current
  chain is a series of gates that say "is this input shape mine?"
  The new top-level gate says "is this input deterministic-solvable
  or does it need an LLM?" That gate is itself a heuristic — and
  heuristics are exactly what we are trying to escape.
- Two strategy badges to read instead of one. Two failure modes per
  turn instead of one.
- The predicate gate has to be tuned for two very different output
  distributions: deterministic templates (low variance, easy to gate)
  and LLM completions (high variance, harder to gate). Some predicates
  that work for the routing arms will be too strict for the LLM and
  vice-versa.

### What survives, what gets thrown away

- Survives: most of `vai-engine.ts`, the corpus runner, the predicate
  gate, the dogfooding loop.
- Thrown away: nothing structural. A few weak arms (the ones that
  consistently bleed against the LLM in head-to-head dogfooding)
  retire one at a time, with audits.
- Net diff: small at first, growing slowly as arms retire. The end
  state could look like Side B over 12–18 months without ever forcing
  a single big rewrite.

### What would change my mind on Side C

- The LLM arm fires on more than 60% of dogfooding turns. Signal: the
  routing arms are losing more than they win, so the hybrid is just a
  slow Side B with more code. Switch to Side B and cut losses.
- The LLM arm fires on less than 10% of dogfooding turns and the
  remaining failures are not in any LLM-shaped category. Signal: the
  LLM was not the missing piece; the substrate is. Switch back to
  Side A and stop maintaining the LLM path.
- The routing-decision layer takes more than four iterations to
  stabilise. Signal: the second routing problem is harder than the
  first and we have made the system worse, not better.

---

## What this memo deliberately does not do

- Does not recommend a side. The decision belongs to V3gga and depends
  on inputs I do not have: hardware specifics, how much V3gga values
  determinism vs. fluency in the live app, six-month opportunity cost
  of either rewrite path.
- Does not score the sides on a rubric. Every rubric I could write
  smuggles in a recommendation through the choice of weights.
- Does not assume the corpus is the ground truth of "good UX." It is
  the best truth source we have for routing correctness. It is a
  worse truth source for "does this feel right when V3gga opens the
  app." Both Side B and Side C will move the dogfooding signal in
  ways the corpus may not register.

## Open questions for V3gga

1. What is the actual hardware target? CPU spec, RAM, GPU presence.
   This collapses ~half the uncertainty in Side B.
2. How much do you weight determinism (3× identical-run hash) vs.
   fluency (small LLM polish on long-tail prompts)?
3. Is the current ceiling — 33/57 with a credible path to ~48/57 over
   six months at S/M cost — acceptable, or is the goal closer to
   55+/57?
4. Would a 7-day side-experiment on Side B (stand up the LLM, run
   the corpus once, measure pass rate + gate-catch rate + latency)
   change the calculation enough to be worth the week?

When you have answers to those four, the right side becomes obvious.
Until then, this memo is the best I can offer without smuggling in
opinions.
