# Research memo — Independence Vectors for Vai

> **Status:** Working material, subordinate to `Master.md`. Validated 2026-06-15.
> Author: Principal Research Engineer (for Vegga Thorsen). Does not override `Master.md`.
> Confidence labels per `docs/the-idea.md`: 0.9+ "I'd defend it"; 0.7–0.9 "well-supported";
> 0.5–0.7 "informed reading"; <0.5 "guess flagged as guess."

**Question:** What prior art most moves Vai toward needing external models *less* over time,
without weakening its deterministic core or adding heavy dependencies?

Grounded in: Master.md §3.3 (eliminate waste), §6.4 (epistemic transparency, compounding
learning), the-idea.md (Vai = deterministic thinking substrate; generators stay outside),
and the capability kernel + evidence-bound capabilities already built on
branch `feat/evidence-bound-capabilities`.

---

## Relevant Projects & Prior Art

1. **Cache & Distil / "Neural Caching"** (Ramírez et al., arXiv:2310.13561). A small local
   *student* model acts as a **smart cache** for an expensive LLM: for each request, get the
   student's answer first, and only call the LLM when a **policy** says the student is
   uncertain. The LLM's answers train the student over time, so it handles a *growing*
   fraction of requests alone. **Why it matters:** this is the rigorous, measured version of
   V3gga's thought #3 ("internalize patterns so the model is needed less"). The call-vs-cache
   policy and uncertainty selection are directly portable. Confidence: 0.9.

2. **Semantic Integrity Constraints (SICs)** (Lee et al., PVLDB 18(11):4073, arXiv:2503.00600).
   A **declarative** way to specify correctness conditions over LLM output — grounding,
   soundness, exclusion, domain — each with precise execution semantics (*what* is checked,
   *when*, *action on failure*) and **reactive vs proactive** enforcement. **Why it matters:**
   it's the formal abstraction Vai's `verify()` gates already implement ad-hoc. Adopting its
   vocabulary turns scattered verify logic into one inspectable contract (V3gga's thought #1).
   Confidence: 0.85.

3. **Letta / MemGPT memory tiers.** OS-inspired memory: *core* (always in-context, like RAM),
   *recall* (conversation history), *archival* (external store, queried explicitly), with
   explicit function calls to promote/demote between tiers. **Why it matters:** Vai has a
   confidence ledger and a knowledge store but no tiered lifecycle. The promote/demote model
   is a clean, deterministic fit. Confidence: 0.8.

4. **Bi-temporal / write-time-curated memory** (ECAI 2025 benchmark arXiv:2504.19413 on
   LOCOMO; Zep "Graphiti"; Mem0). The measured findings: **selective** memory (Mem0) hits
   ~91% LOCOMO at ~7k tokens vs full-context's ~25k+ and 10–17s latency; **pure vector
   similarity fails on time** ("5 minutes ago" and "5 weeks ago" have identical cosine
   distance); **timestamped graph** memory (`valid_at`/`invalid_at`) answers "what did I
   believe at time T"; and **write-time conflict resolution** beats append-only stores.
   **Why it matters:** tells us exactly how to build Vai memory without vectors-as-a-crutch.
   Confidence: 0.85.

5. **DSPy** (Khattab et al., arXiv:2310.03714) — "program, don't prompt." Declarative typed
   *signatures* + *modules* + a *metric*, **compiled** into an optimized artifact tied to a
   model+dataset+metric. **Why it matters:** the *spirit* — compile a reusable, measured
   artifact from examples instead of hand-tuning — is the antidote to the 200-line keyword
   regexes in `vai-engine.ts`. The *letter* (an LLM-in-the-loop optimizer) is NOT a fit.
   Confidence: 0.75.

6. **Open-source guardrail stack** (Guardrails AI, NeMo Guardrails, LMQL). Validate schema
   conformance, citation presence, grounding coverage before the app acts. **Why it matters:**
   confirms Vai's `verify`-before-release is the right shape; mostly a sanity check, low new
   signal. Confidence: 0.7.

---

## Key Patterns Extracted (architecture, not features)

- **Student-as-cache with an uncertainty-gated escalation policy** (from #1). The local model
  answers; an explicit, cheap policy decides whether to escalate; escalations become training
  signal. The decision is the product, not the model.
- **Active-learning selection: escalate on *uncertainty*, learn from the *informative* cases**
  (#1). Margin/entropy sampling beat random by only spending the expensive call where the
  student is genuinely unsure — and only those cases teach the student.
- **Verification as declarative constraints with typed failure semantics** (#2). A constraint
  is `{ what, when, action-on-fail }`; grounding/soundness/exclusion are *kinds*; reactive
  (post-hoc reject) vs proactive (block before release).
- **Memory as tiers with an explicit lifecycle** (#3): promote/demote/retire, not append-only.
- **Bi-temporal facts + write-time curation** (#4): store *when a fact was true*, resolve
  contradictions at write time, retrieve by relevance+recency not raw cosine.
- **Compile a measured artifact from examples** (#5): the optimization target is a metric,
  the output is a deterministic, inspectable artifact — not a frozen hand-written rule.

---

## Comparison to Current Vai (honest gaps & strengths)

**Strengths (already ahead of much of the field):**
- The **capability kernel** (`estimate/resolve/verify` + `boundEvidence`) is a stronger,
  more inspectable contract than most guardrail SDKs — and it gates *before* release.
- The **fair judge** (`judgeAnswers`) + **parity bench** already solve the measurement
  problem that the neural-caching paper assumes you have (a trustworthy correctness signal).
  Most "route to small model" systems lack exactly this and silently regress.
- The **capability-outcome ledger** is already a learning loop; it *is* the student's
  accumulating competence, just not yet driving an escalation policy.
- Evidence-bound, refusal-as-a-feature is native — the SIC "grounding constraint" is built.

**Gaps:**
- **No student-as-cache loop.** The judge decides Vai-vs-model *per turn* but nothing
  *internalizes* a confirmed model win so the next similar turn needs no model. Thought #3 is
  unbuilt. (Highest-leverage gap.)
- **No uncertainty-gated escalation.** Escalation today is a long heuristic cascade
  (`decideVaiFallback`), not a calibrated "the deterministic arm is unsure here" signal.
- **Verification is scattered, not declarative.** Each capability hand-rolls `verify()`; there
  is no shared `{what, when, action}` constraint vocabulary, so the contract isn't uniform
  (thought #1 only ~60% done).
- **Memory is flat.** Confidence ledger + knowledge store exist, but no tiers, no
  bi-temporal facts, no write-time contradiction resolution. The cross-source synthesis we
  built has nothing rich to synthesize *from* yet (thought #2's real gap is memory).
- **The keyword regexes** in `vai-engine.ts` are hand-maintained rules where a compiled,
  example-driven artifact belongs.

---

## Recommendations (prioritized by leverage on independence)

> Each: **impact on independence · difficulty · internalize vs external.**

### R1 — Pattern-internalization cache (the crown jewel, thought #3)
Build a deterministic **answer-memoization layer**: when `judgeAnswers` confirms a model
answer genuinely beat Vai *and* it's a reusable, low-volatility pattern (a definition, an
idiom, a stable how-to — NOT a time-sensitive fact), distill it into a **bound, cited memory
entry** keyed by a normalized intent signature. Next similar turn, Vai serves it
deterministically with provenance ("internalized from <model> on <date>, confirmed by judge")
— **no model call**. This is neural caching with Vai's own twist: the "student" is the
deterministic memory + the judge is the call-vs-cache policy we already built.
- **Impact: very high** (directly reduces model calls over time, compounding).
- **Difficulty: medium.** Reuses `judgeAnswers`, the capability ledger, and the synthesis
  binding model. The hard part is the *volatility gate* (never memoize a fact that expires).
- **Internalize, deterministically.** No new dependency.

### R2 — Uncertainty-calibrated escalation signal
Replace the *trigger* of the fallback cascade with a single calibrated score: how uncertain
is the deterministic arm on THIS turn (low evidence density + low capability-ledger history +
no confident capability match). Escalate only when genuinely unsure — and feed every
escalation back as the training signal for R1. This is the neural-caching policy, adapted.
- **Impact: high** (fewer needless escalations now; clean training signal for R1).
- **Difficulty: medium.** The inputs already exist (`ScoreBreakdown.evidence`, the ledger).
- **Internalize, deterministically.**

### R3 — Unify verification as declarative SICs (thought #1)
Extract a `Constraint = { kind: 'grounding'|'soundness'|'exclusion'|'domain', when, onFail }`
type and express every capability's `verify()` as a list of these. Same behavior, but now the
contract is uniform, inspectable, and composable — and *every* action (tool, model call,
internal step) declares its constraints in one place.
- **Impact: high** (finishes thought #1; makes the system auditable end-to-end).
- **Difficulty: medium.** Mechanical refactor of existing verify logic into one vocabulary.
- **Internalize, deterministically.**

### R4 — Tiered, bi-temporal personal memory (thought #2's real gap)
Give the memory store **tiers** (core/recall/archival with promote/demote) and **bi-temporal
facts** (`valid_at`/`invalid_at`) with **write-time contradiction resolution**. Then the
cross-source synthesis we already built has rich, time-aware, non-contradictory material to
reason over locally.
- **Impact: high** (unlocks "synthesis from memory without a model" for real).
- **Difficulty: medium-high.** This is the largest of the four; flag as the one that may
  warrant its own slice sequence.
- **Internalize, deterministically.** SQLite already present — no vector DB needed; use
  metadata + recency + BM25-style lexical, add embeddings only if measured to help.

### R5 — Compile keyword routers from examples (thought, deferred)
Replace the largest hand-maintained regex routers with a small, deterministic,
example-driven classifier compiled offline (DSPy's *spirit*, not its LLM optimizer).
- **Impact: medium** (reduces maintenance + drift; modest independence gain).
- **Difficulty: medium-high.** Defer until R1–R3 land; needs a labeled set first.
- **Internalize.** Do NOT adopt DSPy itself (LLM-in-the-loop optimizer = wrong dependency).

---

## Risks & Anti-Patterns (what to avoid)

- **Memoizing volatile facts** (R1's main risk). Internalizing "the PM is X" or a price will
  serve a confidently-wrong answer later. The volatility gate is non-negotiable: only memoize
  stable, reusable *reasoning patterns*, never time-sensitive facts. (Matches Master.md §8
  "Confident Bullshitter" anti-pattern.)
- **Letting a vector DB become the crutch.** The measured finding: pure vector similarity
  fails on time and relevance. Don't pull in a heavy vector dependency; lexical + metadata +
  recency on the existing SQLite goes far, and stays local-first.
- **Adopting DSPy / a guardrail SDK wholesale.** They put an LLM (or a heavy runtime) back in
  the loop — the opposite of independence. Take the *pattern*, write the TypeScript.
- **Optimizing against the judge before it's trusted live.** We fixed the judge, but R1's
  internalization must only trust judge verdicts that are *grounded* (evidence-bound), or the
  loop relearns the old LLM-self-rates bias one level up.
- **Big-bang memory rewrite.** R4 is the tempting place to over-build. Keep to one tested
  vertical slice at a time (Master.md §4.7 Completion Over Breadth).

---

## Proposed Next Steps (small, testable, respects current architecture)

1. **R2 first (smallest, unblocks R1):** add `deterministicUncertainty(ctx)` deriving a 0..1
   "unsure" score from evidence density + capability-ledger history; unit-test it; surface it
   in the plan. ~1 slice.
2. **R1 core:** `InternalizedPatternStore` — `memoize(intentSignature, answer, provenance,
   volatility)` + `recall(intentSignature)`; gate memoization on `judge.winner === model &&
   grounded && volatility === 'stable'`; serve on recall as a deterministic capability with a
   `verify()` that re-binds provenance. Tests: memoize→recall round-trip; volatility gate
   refuses a dated fact; recall serves with zero model calls. ~1–2 slices.
3. **Measure it:** extend the parity bench to report **internalization rate over time** (what
   fraction of a repeated task set Vai now serves from memory, no model) — the headline
   independence metric, the direct analogue of neural caching's "online accuracy without LLM."
4. **R3 after:** introduce the `Constraint` type; migrate `gitCapability.verify` and
   `execCapability.verify` to it as the first two; prove identical behavior via existing tests.
5. **R4 as its own planned sequence** (flag for a dedicated plan): tiers first, then
   bi-temporal facts, then write-time curation — each a tested slice.

**Bottom line:** Vai is unusually well-positioned — the judge, the kernel, and the ledger are
the hard parts most "use a small model" systems lack. The single highest-leverage move is
**R1: close the internalization loop so confirmed model wins become deterministic memory**,
gated by the fair judge we just wired in. That is the mechanism by which Vai needs the model
less every week — the literal definition of the vision.
