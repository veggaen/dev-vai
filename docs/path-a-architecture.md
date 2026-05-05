# Path A architecture — sketch only

> Sketch, not design. Architectural relationships and contracts.
> No implementation specifics, no LOC budgets, no file paths. The
> per-capability design docs come later, governed by the Thorsen
> protocol (design doc → pause → implement → 7-check gate →
> 15-prompt dogfood → handoff).
>
> **Status: Path A adopted, dual-surface (2026-04-28 / 2026-04-29).**
> See [docs/the-decision.md](the-decision.md) for the citable
> decision. See [docs/the-idea.md](the-idea.md) for the scoped
> idea.
>
> Confidence labels: 0.9+ "I'd defend it"; 0.7–0.9 "well-supported";
> 0.5–0.7 "informed reading"; <0.5 "guess flagged as guess."
>
> **Two specific requirements anchored in Phase-4 flag #2:**
> 1. Mode-set pressure test (don't accept Build / Diagnose / Plan
>    / Explain inherited).
> 2. Vai-for-everyone extensibility, made concrete per load-bearing
>    piece.
>
> Both are in this document as their own top-level sections.

---

## §1 — The three load-bearing pieces

Path A's substrate is three pieces, all deterministic, all on
existing hardware:

1. **FSM mode router.** The user is always in exactly one mode;
   each mode has its own response shape, refusal set, and
   validation contract.
2. **Pattern memory store.** Append-only structured record;
   recall is deterministic key/predicate lookup.
3. **Heuristic weak-prompt classifier.** Surfaces named
   weaknesses in input prompts; flags, does not rewrite.

Plus the validation-before-acceptance contract, which is **a
property of each mode**, not a fourth piece. Inaugural slice =
pre-tool validation only (`docs/the-decision.md` §"Validation
before acceptance — split contract").

The three pieces compose in a single user turn as:

```
INPUT → [classifier flags weakness?] → [mode router selects/confirms mode]
      → [mode handler runs, consults memory, applies pre-tool validation]
      → [output: refusal | deterministic answer | flagged-prompt-with-suggestions]
```

Confidence on this composition: 0.75. The exact ordering of
classifier-vs-mode-router is the single most consequential
architectural decision below. See §6 ("How the three pieces hand
off") for the analysis.

---

## §2 — Mode-set pressure test (flag-2 requirement)

### §2.1 — Mapping the inherited modes against eight use cases

Inherited mode set: **Build / Diagnose / Plan / Explain**.

Five Vai-for-everyone validation examples (per V3gga, 2026-04-29):

| Use case | Inherited mode | Confidence | Notes |
|---|---|---|---|
| Research (Perplexity-like) | Explain | 0.4 | Explain-as-framed is "explain a concept I already named." Research is "find sources I don't have for a topic I'm exploring." Different shape; the Explain mode would have to broaden substantially or a new Research mode is needed. |
| App-builder (Base44-like) | Build | 0.85 | Clean fit. Build is exactly the spec→preview→iterate workflow Base44 surfaces invite. |
| Code (write/debug/explain) | Build / Diagnose / Explain | 0.5 | Code spans three modes. "Write new function" is Build; "this throws an error" is Diagnose; "what does this regex do" is Explain. One mode does not cover code; the three modes each handle a slice. The 0.5 confidence reflects that *the modes do work for code, but no single mode is a "code" mode.* That may be fine — code is a domain, not a mode. Or it may indicate the mode taxonomy is on the wrong axis. |
| Planning | Plan | 0.85 | Clean fit. |
| Personal-deterministic (Vai-for-V3gga's daily structured workflows) | (none) | 0.3 | Doesn't map to any inherited mode. It's the Vai-for-V3gga-specific surface where a stored fact, a calibration check, a "what did I decide last time about X" lookup happens. Could be a fifth mode (Recall / Personal). Could be a non-mode mechanism that runs *underneath* every mode (memory recall as a primitive, not a mode). The architecture below picks the second reading. |

Three Vai-for-V3gga-specific use cases drawn from this conversation:

| Use case | Inherited mode | Confidence | Notes |
|---|---|---|---|
| Corpus iteration (run conv-loop, read failures, decide what to add) | Diagnose | 0.45 | Diagnose-as-framed is "this thing is broken, find why." Corpus iteration is partly diagnose, partly plan, partly review. Mostly fits but uncomfortably. |
| Capability design-doc cycle (multi-turn-detector style) | Plan | 0.6 | Reasonable fit but design-doc work is also part-Build (the doc itself is an artifact) and part-Diagnose (audits of prior doc choices). Design work might be its own shape. |
| Code archaeology before edits (read 200 lines, decide where to cut) | Explain | 0.55 | Closest to Explain (understand existing code) but "archaeology to make a decision" is more goal-shaped than Explain's "understand for understanding's sake" framing. |

**Mapping summary.** Of eight use cases, **three** clear-fit
(App-builder→Build, Planning→Plan, and Code-as-debug→Diagnose
within the multi-mode code case). **Five** poor-or-ambiguous-fit.

**Verdict on the inherited mode set:** confidence drops below 0.7
on five of eight use cases. By the rule V3gga set ("if confidence
drops below 0.7 on any of the eight, the mode set is wrong"), the
inherited mode set is wrong as the basis for Path A. Confidence
in this verdict: 0.8.

### §2.2 — Three alternative mode sets

#### Alternative A — Intent-shape modes (5 modes)

**Modes:** Build / Diagnose / Plan / Explain / Research.

Adds Research as a peer of Explain: Explain answers a concept-shaped
question with a structured explanation; Research explores a topic-
shaped question by surfacing sources and structured claim-
confidence. Personal-deterministic stays as a memory primitive,
not a mode.

| Use case | Mode | Confidence | Δ vs inherited |
|---|---|---|---|
| Research | Research | 0.85 | +0.45 |
| App-builder | Build | 0.85 | 0 |
| Code (write/debug/explain) | Build / Diagnose / Explain | 0.55 | +0.05 |
| Planning | Plan | 0.85 | 0 |
| Personal-deterministic | (memory primitive, all modes) | 0.7 | +0.4 |
| Corpus iteration | Diagnose | 0.5 | +0.05 |
| Capability design-doc cycle | Plan | 0.6 | 0 |
| Code archaeology | Explain | 0.6 | +0.05 |

**Where it covers more cleanly:** Research becomes first-class
(critical for Vai-for-everyone wrapping a search backend).
Personal-deterministic becomes a primitive available in every
mode (more honest than treating it as a mode).

**Where it covers worse:** Nowhere materially worse than
inherited.

**Confidence on Alternative A:** 0.7.

#### Alternative B — Goal-shape modes (4 modes, recut axis)

**Modes:** Make / Understand / Decide / Recall.

A re-cut of the axis. "Make" covers Build + App-builder + write
new code + write a doc. "Understand" covers Explain + Diagnose +
research-to-understand + code archaeology. "Decide" covers Plan +
design-doc work + capability prioritization + substrate
decisions. "Recall" surfaces stored facts, decisions, prior
patterns from memory.

| Use case | Mode | Confidence |
|---|---|---|
| Research (with claim verification) | Understand | 0.7 |
| Research (to find a specific source) | Recall extended to web | 0.4 (Recall doesn't cleanly extend to external lookup) |
| App-builder | Make | 0.85 |
| Code (write) | Make | 0.85 |
| Code (debug) | Understand | 0.75 |
| Code (explain to self) | Understand | 0.85 |
| Planning | Decide | 0.85 |
| Personal-deterministic | Recall | 0.85 |
| Corpus iteration | Understand → Decide (mode chain) | 0.7 |
| Capability design-doc cycle | Decide (with Make subsections) | 0.7 |
| Code archaeology | Understand | 0.85 |

**Where it covers more cleanly:** Code stops being three modes —
"Make new code" and "Understand existing code" are crisply
different things and the goal-shape axis matches that.
Personal-deterministic gets a real home (Recall). Design work
gets a real home (Decide).

**Where it covers worse:** Research splits across Understand and
Recall depending on whether the user wants to understand the
topic or find specific sources. The split may be a feature (it
forces the user to clarify intent) or a bug (it pushes
classification work onto the user). Confidence: 0.5 it's a
feature, 0.5 it's a bug.

**Confidence on Alternative B:** 0.7.

#### Alternative C — Surface-shape modes (variable count, hierarchical)

**Top-level modes:** Personal / Build / Research / Plan / Explain.
Each top-level mode has sub-modes that specialize the response
shape. Build has sub-modes Code / App / Document. Research has
sub-modes Topic / Source / Claim-Verification. Plan has sub-
modes Project / Capability / Decision. Explain has sub-modes
Concept / Code / Reasoning. Personal has sub-modes Recall /
Calibration / Daily-Workflow.

| Use case | Mode/sub-mode | Confidence |
|---|---|---|
| Research (Perplexity-like) | Research/Topic | 0.85 |
| App-builder (Base44-like) | Build/App | 0.85 |
| Code (write) | Build/Code | 0.85 |
| Code (debug) | Diagnose (would need to add) | 0.4 (no clean home in this alternative) |
| Planning | Plan/Project | 0.8 |
| Personal-deterministic | Personal/Daily-Workflow | 0.85 |
| Corpus iteration | Plan/Capability | 0.65 |
| Capability design-doc cycle | Plan/Capability | 0.75 |
| Code archaeology | Explain/Code | 0.8 |

**Where it covers more cleanly:** Each surface gets a precise
home. Vai-for-everyone surfaces map directly (Research/Topic for
Perplexity-like; Build/App for Base44-like). Personal-deterministic
gets first-class status with sub-modes for V3gga's actual
workflows.

**Where it covers worse:** Diagnose-style debugging has no clean
home (would need to add). Hierarchical modes are more cognitive
load on the user — the mode picker is now two-deep. Risks
becoming "every workflow is its own sub-mode" creep.

**Confidence on Alternative C:** 0.55. The hierarchical structure
buys precision at a cost in complexity that may not be worth it
for the inaugural slice.

### §2.3 — Q0: should Vai have user-facing modes at all?

*Added in revision per V3gga, 2026-04-29. The original §2.3
recommended Alternative B at 0.65 confidence with a named
weakness. A 0.65 recommendation that depends on a future
capability doc to resolve a load-bearing weakness is the agent
telling V3gga "I think this, but barely." Mode set is too
load-bearing for that confidence level. Three sharpenings
follow. Q0 is the prior question that the original §2
should have raised before pressure-testing inherited modes.*

**Q0:** Are modes (a) **user-facing surfaces** the user picks
between (button row, command palette, mode pill), (b) **internal
classification** the user never sees (classifier picks, handler
runs, user sees a response in the right shape), or (c) **hybrid**
(classifier picks a default, user can override)?

Master.md §6.3 framing is "thinking partner, not search engine."
Thinking partners read context; they do not ask the user to pick
a mode. Mode-pickers are an interface for systems that cannot
read context, where the user does the routing because the
system can't. The Path A substrate already contains a heuristic
classifier. The original turn-one spec (Master.md §2.3) said Vai
should "consider whether it is speaking to an AI or human and
adapt" — that is auto-classification, not user-picked modes.

**The original §2 sketched modes as a user-facing surface
("command palette", "mode pill") without raising Q0. That was an
inherited UX assumption from Narrow-Scope-as-originally-framed,
and it was not pressure-tested.**

**Three honest answers to Q0:**

- **(a) User-facing.** User picks. Pro: explicit, predictable,
  the user is the router so the system can't get the routing
  wrong. Con: contradicts "thinking partner reads context."
  Adds cognitive load. Inherited from search-engine and IDE
  command-palette UX.
- **(b) Silent.** Classifier picks. The user sees a response in
  the right shape but never picks a mode. Pro: matches Master.md
  "thinking partner" framing. Removes the entire mode-picker UI
  surface. The §4 ordering question (classifier-vs-mode-router)
  dissolves — classifier is forced first because there is no
  user-facing router to bypass it. Con: when the classifier gets
  it wrong, the user has no clean override; misclassifications
  cost a turn.
- **(c) Hybrid.** Classifier picks default; user can override.
  Pro: gets the silent case right most of the time, gives the
  user the override hatch. Con: the override UI is a mode picker,
  so most of the cost of (a) returns; and the implementation has
  to support both paths cleanly (which is real architecture work).

**My read on Q0** (V3gga decides): for Vai-for-V3gga inaugural,
**(b) silent is the right shape.** Reasons:

- Master.md alignment is direct.
- The §4 classifier-ordering decision dissolves at confidence
  ~0.85 (classifier first is forced).
- Cognitive load on V3gga is minimized; he is the user and his
  feedback when the classifier gets it wrong becomes the
  calibration signal for the classifier itself, which is exactly
  the compounding-learning loop Master.md §6.4 names.
- The classifier has to be good. That's a real cost — but it's a
  cost Path A already accepted in the substrate triple.

For Vai-for-everyone, **(c) hybrid is the most likely right
shape.** Reasons:

- A general user does not have V3gga's tolerance for
  classifier-misroute-cost-a-turn.
- Surfaces like "Research surface" and "App-builder surface" are
  themselves explicit user choices at the surface-selection
  level, which means *some* user-facing routing already exists
  at that layer; mode-picking inside a surface becomes additive
  rather than a new pattern.
- Persona layer can pick whether the override is exposed.

**(a) user-facing-only is rejected** at confidence 0.8. It buys
predictability at the cost of the "thinking partner" framing
that Master.md anchors. Path A was chosen partly to honor that
framing; reintroducing user-as-router contradicts that choice.

**Confidence on the Q0 reading:** 0.7 on (b) for inaugural;
0.65 on (c) for everyone. V3gga decides.

### §2.4 — Sharpening (a): is Research-split architecture or weakness?

Original §2.2 marked Alt B's Research-split between Understand
and Recall as a weakness ("the split may be a feature or a bug…
confidence 0.5/0.5"). V3gga's revision question: **is the split
actually correct architecture, with Alt A's bundling-into-one-
Research-mode being the actual mistake?**

Re-examined. Two genuinely different tasks live under "research":

- **Find a pattern I already know exists** (find a specific
  source, recall a specific fact, locate a known reference).
  Recall-shaped. The user has prior knowledge that the answer
  exists; the work is retrieval.
- **Build new understanding from unfamiliar sources** (explore a
  topic, synthesize across multiple sources, develop a position).
  Understand-shaped. The user has a question; the work is
  comprehension.

These are genuinely different in:

- *Success criterion:* Recall-research succeeds when the right
  source is found. Understand-research succeeds when the user
  has built a defensible position.
- *Validation contract:* Recall-research validates by source-
  matched; Understand-research validates by claim-confidence and
  uncertainty-surfaced.
- *Refusal set:* Recall-research refuses when no matching source
  exists; Understand-research refuses when the topic is too
  underspecified to explore.
- *Memory interaction:* Recall-research consults memory first;
  Understand-research builds new memory entries as it proceeds.

Four axes of difference is not noise. **Alt B's split is
architecturally correct.** Alt A's bundling of both into a single
Research mode was the mistake — it creates one mode with two
incompatible success criteria, validation contracts, refusal
sets, and memory-interaction patterns. That is the symptom of a
mis-cut taxonomy, not a feature.

**Revised Alt B confidence on the Research handling:** 0.85
(the split is correct). Up from 0.5/0.5 hedge.

**Implication for Alt A:** Alt A's confidence of 0.85 on Research
was misleading because it compressed two tasks into one mode.
Honest re-rating of Alt A on Research: 0.55 (covers one of the
two task shapes, fails on the other). This re-rating drops Alt A's
overall confidence as well — see §2.6 for the re-run matrix.

### §2.5 — Sharpening (b): does Personal-deterministic genuinely fit Recall?

Original Alt B placed Personal-deterministic in Recall at 0.85
confidence. V3gga's revision question: **distinguish "remember a
pattern" from "run a pattern." If running-a-pattern is its own
category, Recall is bundling two things and Alt B has the same
weakness Alt A had, relocated.**

Re-examined. Two genuinely different tasks under
Personal-deterministic:

- **Remember a pattern.** "What did I decide about substrate on
  2026-04-28?" "What's my morning routine?" "What is V3gga's
  vocabulary for shipped?" Pure lookup over the memory store.
- **Run a pattern.** "Run my morning routine now." "Execute the
  capability-design-doc cycle for X." "Apply my standard
  validation checklist to this design doc." Action over a stored
  pattern; uses Recall to fetch the pattern, then *does
  something* with it.

These are genuinely different in:

- *Output shape:* Remember returns a record. Run returns a
  workflow trace, a checklist application, or an executed
  artifact.
- *Validation contract:* Remember validates by record-matched.
  Run validates by pattern-faithfully-applied + outcome-matches-
  acceptance-criteria.
- *Failure mode:* Remember fails by missing record. Run fails by
  applying-the-pattern-incorrectly even when the pattern was
  recalled correctly.
- *Composition:* Run *uses* Remember internally, plus other
  modes (likely Make and/or Decide depending on the pattern).

**This is a real third category.** Alt B's Recall covers
Remember cleanly but bundles Run uncomfortably. That is exactly
the critique V3gga warned might appear, and it does appear.

**Three honest options for Alt B:**

- **B-as-stated:** Recall covers both. Bundles Run into Recall
  with the named weakness. Confidence on Personal-deterministic
  drops from 0.85 to 0.6 honestly.
- **B-with-Run:** Add a fifth mode, Run. Modes become Make /
  Understand / Decide / Recall / Run. Personal-deterministic
  splits cleanly: Remember-a-pattern → Recall, Run-a-pattern →
  Run. Confidence rises to 0.85 on the split.
- **B-with-Run-as-meta-mode:** Run is not a peer mode but a
  meta-mode that *composes* other modes. Run consumes a stored
  pattern (via Recall) and dispatches to Make/Understand/Decide
  as the pattern dictates. Architecturally cleaner than a fifth
  peer mode but adds composition complexity.

**My read** (V3gga decides): **B-with-Run as a peer mode is the
right move for the inaugural slice.** Reasons:

- The composition complexity of B-with-Run-as-meta-mode is real
  architectural work that the inaugural slice does not need.
- A peer Run mode is implementable as another FSM state with its
  own input contract ("which stored pattern") and output
  contract ("workflow trace + acceptance check"). Same shape as
  the other four modes.
- Distinguishes the two task shapes V3gga's revision named.

**Mode set under sharpened-B becomes: Make / Understand / Decide
/ Recall / Run.** Five modes, not four.

Confidence on the B-with-Run sharpening: 0.75.

### §2.6 — Sharpening (c): re-run the eight-use-case mapping under three Q0 shapes

Re-running the eight use cases against:

- **Sharpened Alt A** (intent-shape, 5 modes, with Research-as-
  bundled-mode honestly downgraded per §2.4).
- **Sharpened Alt B** = B-with-Run, mode set Make / Understand /
  Decide / Recall / Run.
- **Alt C** as originally stated (no sharpening because V3gga's
  revision questions don't bear on it).

Each against three Q0 shapes: (a) user-facing, (b) silent, (c)
hybrid.

#### Sharpened Alt A under each shape

| Use case | (a) user-facing | (b) silent | (c) hybrid |
|---|---|---|---|
| Research — find pattern I know exists | 0.5 | 0.55 | 0.55 |
| Research — build new understanding | 0.6 | 0.6 | 0.6 |
| App-builder | 0.85 | 0.8 | 0.85 |
| Code (write/debug/explain) | 0.55 | 0.6 | 0.6 |
| Planning | 0.85 | 0.8 | 0.85 |
| Personal-deterministic (remember) | 0.7 | 0.7 | 0.7 |
| Corpus iteration | 0.5 | 0.55 | 0.55 |
| Capability design-doc cycle | 0.6 | 0.6 | 0.6 |
| Code archaeology | 0.6 | 0.6 | 0.6 |

*Average (9 cells per column):* (a) 0.64 · (b) 0.64 · (c) 0.65.

*Note: Personal-deterministic split into one row in this matrix
because Alt A treats it as a memory primitive, not as Recall+Run.
The Run-shaped sub-task simply has no home in Alt A.*

#### Sharpened Alt B (B-with-Run) under each shape

| Use case | Mode | (a) user-facing | (b) silent | (c) hybrid |
|---|---|---|---|---|
| Research — find pattern I know exists | Recall | 0.8 | 0.85 | 0.85 |
| Research — build new understanding | Understand | 0.85 | 0.85 | 0.85 |
| App-builder | Make | 0.85 | 0.8 | 0.85 |
| Code (write) | Make | 0.85 | 0.85 | 0.85 |
| Code (debug) | Understand | 0.75 | 0.8 | 0.8 |
| Code (archaeology) | Understand | 0.85 | 0.85 | 0.85 |
| Planning | Decide | 0.85 | 0.8 | 0.85 |
| Personal-deterministic (remember) | Recall | 0.85 | 0.85 | 0.85 |
| Personal-deterministic (run) | Run | 0.85 | 0.85 | 0.85 |
| Corpus iteration | Decide (with Understand chain) | 0.7 | 0.75 | 0.75 |
| Capability design-doc cycle | Decide | 0.75 | 0.75 | 0.75 |

*Average (11 cells per column — the matrix expanded because
Research and Personal-deterministic both genuinely split into
two cells under sharpened-B):* (a) 0.82 · (b) 0.82 · (c) 0.83.

#### Alt C under each shape

Alt C's hierarchical mode set was rated at 0.55 originally. The
Q0 dimension does not improve it materially because the
hierarchy itself is the cost. Re-running:

*Average:* (a) 0.66 · (b) 0.62 · (c) 0.65.

Silent classification under hierarchical modes is harder than
under flat modes because the classifier has to pick top-level
*and* sub-mode; the (b) column drops slightly.

#### Combined matrix

| Alternative | (a) user-facing avg | (b) silent avg | (c) hybrid avg |
|---|---|---|---|
| Sharpened Alt A | 0.64 | 0.64 | 0.65 |
| Sharpened Alt B (B-with-Run) | **0.82** | **0.82** | **0.83** |
| Alt C | 0.66 | 0.62 | 0.65 |

**Decision criterion (V3gga's rule):** any combination clearing
0.75 average is in play.

**Three combinations clear 0.75:** Sharpened-B under (a), (b),
and (c). All three.

**No combination of A or C clears 0.75 under any shape.**

### §2.7 — Verdict

The sharpening produced an unambiguous result:

**Recommended mode set: Sharpened Alternative B — Make /
Understand / Decide / Recall / Run.** Five modes, not four. The
fifth mode (Run) was discovered by the Personal-deterministic
sharpening, exactly as V3gga's revision instruction predicted
might happen.

**Confidence in the recommendation:** 0.8. Up from 0.65.

**Recommended Q0 shape for inaugural Vai-for-V3gga: (b) silent.**
Classifier routes; user never picks a mode. Confidence: 0.7.

**Recommended Q0 shape for Vai-for-everyone: (c) hybrid.**
Classifier picks default; persona layer decides whether to
expose override. Confidence: 0.65. (This decision can defer to
the Vai-for-everyone build; inaugural is unblocked.)

**Key consequences if V3gga adopts the recommendation:**

1. The mode set in `the-idea.md` and `the-decision.md` must
   propagate to Make / Understand / Decide / Recall / Run. The
   propagation is verbatim swap, not paraphrase — per V3gga's
   non-binding observation about citable artifacts.
2. The §4 classifier-vs-mode-router ordering decision
   dissolves. Under (b) silent, classifier-first is forced (no
   user-facing router to bypass). The 0.6 flag is removed and
   replaced with: "classifier-first is forced under Q0 shape (b);
   confidence 0.85."
3. The §7 build order may flip. Under (b) silent, the classifier
   is the user-visible surface (the user sees its routing
   decision implicitly through which response shape arrives).
   Building modes-first with stub classifier means the inaugural
   user-visible surface is *missing*. Re-derive: classifier
   first, modes second, memory store third. §7 needs revision
   if V3gga adopts (b).
4. The wider mode space gains Run as a permanent fifth mode
   (not a reserved-for-later slot like Validate). Validate stays
   reserved for Vai-for-everyone post-generator-validation.

### §2.8 — What if the recommendation is still wrong

The sharpening is honest but not infallible. Three ways the
recommendation could still be wrong:

- **Q0 (b) silent might fail in practice.** If V3gga's actual
  use of Vai reveals that classifier misroutes cost too many
  turns to absorb, fall back to (c) hybrid. The mode set stays
  sharpened-B; only the Q0 shape changes. Architecture supports
  the fallback because the override hatch is additive.
- **Run might decompose further.** "Run a stored pattern" might
  itself split into "run a workflow" vs "apply a checklist" if
  evidence accumulates. The first capability design doc that
  touches Run should pressure-test this exactly the way §2.4
  pressure-tested Research.
- **A use case not in the eight might surface a sixth mode.** The
  eight use cases are V3gga's named examples plus three from this
  conversation. They are not exhaustive. The first month of
  inaugural use is itself a pressure test; if a recurring use
  case has confidence < 0.7 in all five existing modes, that's a
  sixth-mode signal.

These are not reasons to defer the decision. They are the named
residue. The recommendation stands at 0.8 confidence.

---

## §3 — Vai-for-everyone extensibility, per load-bearing piece (flag-2 requirement)

The decision-doc constraint (`the-decision.md` §"Architectural
constraint"): the inaugural Vai-for-V3gga surface may use V3gga-
specific memory and examples, but the shared core must not be
hard-coded to V3gga. This section operationalizes that constraint
per piece.

### §3.1 — FSM mode router

**V3gga-specific layer (sits on top):** the inaugural mode set
selection (Make / Understand / Decide / Recall), the V3gga-specific
default mode for ambiguous input (probably Decide, given V3gga's
design-doc-cycle workload), V3gga-specific intra-mode shortcuts
(e.g., the Recall mode auto-includes recent corpus runs, prior
decisions, retired options).

**Shared-core API:** a registry of `Mode` records. Each mode
declares: `name`, `inputContract`, `responseShape`,
`refusalSet`, `validationContract`, `subModeRegistry?`. The router
itself is a function `(input, currentMode, history) → (mode,
modeInputs)`. The registry is data; the router is generic.

**Hypothetical second user's persona-layer:** a researcher persona
might select modes Make + Understand + Recall + Validate (no
Decide), with Research as a Validate sub-mode. The mode registry
stays the same shape; the persona layer chooses which modes are
exposed in the UI and what their defaults are.

**Phase-4 audit failure modes to watch for:**

- Hard-coding V3gga's vocabulary into the mode `inputContract`
  (e.g., a Decide mode that expects the word "capability" because
  V3gga uses it for capability design docs). Catch: the
  `inputContract` should be in terms of *shapes*, not *V3gga's
  domain words*.
- Hard-coding the V3gga default mode into the router itself
  rather than the persona layer. Catch: the router takes a
  `defaultMode` parameter; it does not embed one.
- Hard-coding mode-transition rules around V3gga's typical
  workflow (e.g., Decide → Make is always allowed but Recall →
  Make is denied because V3gga doesn't do that). Catch:
  transitions are persona-layer policy, not router logic.

Confidence on §3.1: 0.7. The registry-driven router shape is
defensible; the persona-layer separation is the right shape but
the API surface above is sketch-confidence.

### §3.2 — Pattern memory store

**V3gga-specific layer:** the actual stored content (V3gga's
prompts, decisions, retired options, vocabulary, corpus
anchors). Persona-specific recall heuristics (e.g., V3gga
weights recent decisions higher than long-ago decisions because
his project state shifts fast).

**Shared-core API:** an append-only log of `MemoryRecord`s.
Each record declares: `recordType`, `timestamp`, `key`,
`payload`, `tags`. A query interface
`(predicate) → MemoryRecord[]`. A small set of standard
record types (`Decision`, `RetiredOption`, `VocabularyEntry`,
`PatternObservation`, `CorpusAnchor`, persona-extensible).

**Hypothetical second user's persona-layer:** the same store
shape, populated with the second user's content. The recall
heuristics are persona-configurable (recency weight, tag-set,
pattern-detection signals). The store schema does not depend on
the user.

**Phase-4 audit failure modes to watch for:**

- Hard-coding V3gga-specific record types (e.g., a "Thorsen
  doctrine reference" record type that only makes sense for
  V3gga). Catch: standard record types are domain-neutral; V3gga-
  specific record types live in the persona layer as extensions.
- Hard-coding V3gga vocabulary into the indexer (e.g., index
  on the literal string "capability" because V3gga uses it).
  Catch: the indexer indexes on `tags` and `key` shape, not
  domain words; vocabulary is persona-layer.
- Hard-coding personal references (e.g., the store assumes a
  single user named V3gga). Catch: persona is a parameter, not
  a constant.

**One genuine concern surfaced by this audit:** the recall
heuristics are *partly* persona-coupled by nature. A Vai-for-
everyone surface may need different recall behavior than Vai-for-
V3gga — e.g., a research-surface user wants Recall to include
external sources, a build-surface user wants Recall to exclude
old retired patterns to avoid distraction. The shared-core API
must expose enough configurability for personas to encode their
recall behavior without the core needing to know about the
specific personas. Confidence the API can be designed this way:
0.7. **Non-zero risk this one piece is harder to keep persona-
agnostic than the other two.**

Confidence on §3.2: 0.65. The store shape is defensible; the
recall configurability is the risk.

### §3.3 — Heuristic weak-prompt classifier

**V3gga-specific layer:** the V3gga-specific signal weights and
threshold tuning. V3gga-specific examples that the classifier was
calibrated against. V3gga-specific phrasing of the surfaced
weakness messages (the messages may use V3gga's vocabulary; the
underlying signal taxonomy does not).

**Shared-core API:** the signal taxonomy itself
(`vague intent`, `missing scope`, `scope-too-broad`,
`missing example`, `ambiguous referent`, `implicit acceptance
criteria`, persona-extensible). Under inaugural Q0=(b)-with-
observable + classifier-first build order (committed 2026-04-29),
the **primary** classifier signature is
`(input) → (mode, confidence, signals[])` — the classifier
emits the mode. A **secondary** signature
`(input, mode) → signals[]` survives as the mode-aware
second-pass check available inside each mode's validation
contract for the "weak-prompt-wrong-for-every-mode" case (per
§4 honest-hybrid resolution). Each `signals[]` entry is a
`(signal, confidence, location, suggested-fix-template)` tuple.
The classifier is deterministic and inspectable; signals are
explicit.

**Hypothetical second user's persona-layer:** their own signal
weights, their own example calibration set, their own phrasing.
Possibly persona-specific signals on top of the standard taxonomy
(e.g., a researcher persona adds a `missing-citation-scope`
signal).

**Phase-4 audit failure modes to watch for:**

- Hard-coding V3gga's domain (programming, AI substrate work) into
  the signal definitions. Catch: signals are about prompt
  *shape*, not prompt *topic*. `vague intent` means "the user's
  goal is not clear from the prompt"; it does not mean "the
  prompt does not say what programming language."
- Hard-coding V3gga's phrasing into the suggestion templates.
  Catch: the suggested-fix-template is a parameterized string
  with persona-layer fill-ins, not a hardcoded V3gga voice.
- The single most subtle failure mode: tuning signal weights on
  V3gga's prompt corpus and silently calling the result the
  "shared core" because the *code* is generic even though the
  *weights* are V3gga-specific. Catch: the persona layer owns
  the weights; the shared core owns the algorithm and the signal
  taxonomy. The weights are an asset of the persona, not the
  shared core.
- **Forced misroute instead of refusal** *(added 2026-04-29
  under classifier-first build order)*. When no mode clears the
  confidence threshold, the classifier must emit
  `(no-mode-confident, confidence, signals[])` as a first-class
  routing signal — refusal-as-output — not silently pick the
  highest-scoring mode. Front-door status makes this load-
  bearing in a way it was not under the original modes-first
  ordering, where a downstream classifier could augment a
  user-picked mode rather than carry the routing decision
  alone. Catch: the first capability design doc must specify
  the no-mode-confident emission contract before any forced-
  pick fallback.
- **Silent veto under (b)-with-observable** *(added 2026-04-29)*.
  The user sees the mode badge, but if the classifier picks the
  wrong mode and the badge is easy to ignore, the disagreement
  is invisible — the user gets a wrong-shaped response and may
  blame the response rather than the routing. The override
  surface UX (deferred to a later design doc, not blocking
  inaugural) has to make the badge unignorable enough to surface
  disagreement, not merely available enough to allow correction.
  This is exactly the failure mode "observable" was added to (b)
  to prevent; the audit names it explicitly so the override-
  surface design doc inherits it as a binding constraint, not as
  a UX preference.

**Genuine concern surfaced by this audit:** the classifier *will*
need persona-specific calibration to perform well, by the nature
of the task. The discipline is to keep the calibration in the
persona layer and not let it leak into the algorithm. Confidence
the algorithm can be persona-agnostic: 0.75. Confidence the
calibration data can be cleanly scoped to a persona: 0.7.

Confidence on §3.3: 0.7.

### §3.4 — Summary of the extensibility audit

| Piece | Persona-agnostic shared core feasible? | Confidence | Risk surface |
|---|---|---|---|
| FSM mode router | Yes | 0.7 | Mode-transition rules sneaking V3gga's workflow into the router |
| Pattern memory store | Yes, with care | 0.65 | Recall heuristics being partly persona-coupled by nature |
| Heuristic classifier | Yes, with discipline | 0.7 | Calibration weights being silently V3gga-specific |

**No piece fundamentally fails the persona-agnostic test.** The
classifier and the memory store have real risk surfaces that need
to be respected through the inaugural build, not papered over.
The right discipline is: every capability design doc that touches
one of these three pieces must check itself against this section
and explicitly state where persona-coupling is occurring (with a
justification) or confirm it is not.

If a future capability design doc proposes work that violates
this contract, the contract makes the violation visible. That
is what this section is for.

---

## §4 — How the three pieces hand off in a single user turn

Sketch:

```
1. INPUT arrives in the active mode (or no mode set yet).

2. Heuristic weak-prompt classifier runs over the input.
   Outputs: list of (signal, confidence, location, suggested-fix-template).

3. Mode router:
   a. If no mode active: classify input shape, propose a mode,
      ask for confirmation if confidence < threshold.
   b. If mode active: confirm input fits the mode's inputContract.
      If not, propose a mode-switch.

4. Mode handler runs:
   a. Consults memory store for relevant prior records (deterministic
      key/predicate lookup, scoped by mode and tags).
   b. Applies the mode's response shape.
   c. Applies the mode's pre-tool validation contract:
      - Are the required input fields present?
      - Has the classifier flagged any prompt weakness above the
        mode's tolerance threshold?
      - Is the user's apparent goal in scope for the mode? If not,
        emit refusal + routing suggestion.

5. Output: one of
   - Refusal with named reason and suggested external tool / mode-switch.
   - Deterministic answer (calculation, recall, predicate-verifiable claim).
   - Mode-shaped response with surfaced classifier flags as
     inline annotations ("your prompt was missing acceptance
     criteria; here's a Decide-mode response that names them
     explicitly").
   - Question back to user (when mode/scope/intent is unclear and
     the user-facing classifier flag is a productive prompt for
     refinement).
```

**The single most consequential ordering decision:** classifier
runs *before* mode router or *after*?

- *Before* (sketch above): the classifier sees raw input, mode-
  agnostic. Pro: classifier signals can inform mode selection.
  Con: classifier can't use mode-specific tolerance thresholds
  to decide what to flag.
- *After*: mode is selected first; classifier runs in mode
  context. Pro: classifier knows what acceptance looks like for
  this mode. Con: a weak prompt that's wrong for *every* mode
  doesn't get caught until after a wrong mode is committed to.

The sketch above runs classifier first (mode-agnostic) and then
allows the mode handler to *re-run* a mode-specific second-pass
classifier check inside its validation contract. This is the
honest hybrid. Confidence: 0.6. Could be wrong.

**Resolved 2026-04-29 under inaugural Q0=(b)-with-observable
commitment.** Under silent classification, classifier-first is
forced — there is no user-facing mode-router for the user to
bypass the classifier with. The classifier emits `(mode,
confidence, signals[])`; the FSM router consumes that emission
directly. Mode-specific second-pass classifier checks remain
available inside each mode's validation contract for the
"weak-prompt-wrong-for-every-mode" case. **Confidence in
classifier-first ordering: 0.85.** The 0.6 ambiguity above is
preserved as historical context but no longer load-bearing.

---

## §5 — Foundation work transfer audit (honest map)

*Revised 2026-04-29 per V3gga's walk-back. The original §5
framed the foundation work as "the substrate of the substrate."
That framing was warmer than accurate. The honest version below
lists each foundation piece by transfer status: clean transfer,
transfer with adaptation, retired, or marginal-value-in-Path-A.
Not everything transferred. Naming what didn't is the discipline.*

| Foundation piece | Transfer status | Role in Path A |
|---|---|---|
| Corpus + corpus runner (`scripts/conv-loop.mjs`) | **Clean transfer.** | Truth source. The runner is unchanged. The corpus retargets to mode-shaped specs over time, but old convs remain in service through the transition. |
| Determinism (frozen clock + mulberry32 RNG) | **Clean transfer.** | The new substrate is more deterministic than the old one because there is no token-overlap probabilistic retrieval. |
| Predicate registry pattern | **Clean transfer.** | Native vocabulary of Path A. Each mode's validation contract is implemented as a predicate set. |
| Dogfooding gate (15-prompt + demo path) | **Clean transfer.** | Same standard, applied per capability. |
| Handoff protocol w/ Appendix B | **Clean transfer.** | Rules apply per capability design doc on the new substrate exactly as on the old. |
| Thorsen doctrine (Phase 4 / Semantic Scan) | **Clean transfer.** | Governance, not architecture. Becomes more important under Path A because the persona-coupling audit is a Phase-4 discipline applied at architecture time, not just code time. |
| Anti-patterns doc (Master.md §8) | **Clean transfer.** | Six anti-patterns remain the discipline against which Path A outputs are checked. |
| Math / literal / personal-intro intercepts | **Clean transfer.** | Become deterministic-answer paths inside the relevant modes (math in Make-or-Recall depending on context; personal-intro recall in Recall). |
| Multi-turn-memory detector | **Transfer with adaptation.** | Becomes one of the classifier's input signals (a "this rhymes with a prior turn" signal feeds Recall mode's relevance scoring). The detector itself doesn't change; its consumer does. |
| Chat UI | **Transfer with adaptation.** | Survives as the inaugural Vai-for-V3gga surface. Restructured around the classifier's response-shaping (under Q0 shape (b) silent: no mode pill, no command palette — the surface looks like the existing chat UI but the underlying response generation is mode-routed). |
| Self-evaluation umbrella (`SelfEvaluator`) | **Marginal value in Path A.** | Built as a generative-output validator for the S1 substrate's free-form responses. Path A's deterministic mode handlers don't generate freely; predicates handle gating directly. The SelfEvaluator pattern may inform the validation-contract API per mode, but the umbrella class itself does not transfer. |
| Strategy router (S1) | **Retired.** | The thing that emitted Bergen on king-of-Norway. The architecture was the bug. No value transferred to Path A. |
| Curated factual primer store | **Retired.** | Contained the Bergen primer. Replaced by the memory store's structured records (which are V3gga-pattern records, not factual-claim records — different shape). No primer content transfers. |
| Fallback subject extractor | **Retired.** | Emitted "okay then try" as the literal subject of Exchange 3. Path A's classifier reads input directly; no regex-based subject extractor needed. |
| Hardcoded fixture arms (TypeScript User-greet, etc.) | **Retired.** | Path A modes generate responses from mode contracts and stored patterns, not hardcoded fixtures. |
| Auto-RELATED follow-up generator | **Retired.** | Propagated broken subjects forward as authoritative auto-prompts. Path A's mode handlers may surface next-step suggestions but they come from the active mode's contract, not a generic propagator. |
| Topic tracker (assistant-header-as-subject) | **Retired.** | Path A's classifier reads conversation context directly; no header-string parsing needed. |
| Master.md as supreme authority | **Unchanged — above the substrate.** | Path A is downstream of Master.md. Master.md is the authority that made the Path A decision possible. |

**Transfer summary.**

- **Clean transfer:** 8 pieces (corpus + runner, determinism,
  predicate registry, dogfooding gate, handoff protocol,
  Thorsen doctrine, anti-patterns doc, deterministic intercepts).
- **Transfer with adaptation:** 2 pieces (multi-turn detector,
  chat UI).
- **Marginal value in Path A:** 1 piece (self-eval umbrella).
- **Retired:** 6 pieces (strategy router, curated primer store,
  fallback subject extractor, hardcoded fixture arms,
  auto-RELATED, topic tracker).
- **Above the substrate:** 1 piece (Master.md).

Roughly two-thirds of the foundation work transfers cleanly
or with adaptation. One-third was built for a substrate that's
now retired or has marginal value in Path A. That is a normal
and honest outcome of the substrate decision — not a failure,
not a vindication, just the actual map.

The earlier framing ("substrate of the substrate") was warmer
than this map. The honest version is: **most foundation work
transfers cleanly to Path A; some doesn't; here's which.** When
a future capability design doc claims to depend on a foundation
piece, the design doc names which row in this table it depends
on and whether the dependency is on the clean-transfer
behavior or on adapted behavior. That is the discipline. The
template's existing Phase-4 review is sufficient — no new
template sentence needed.

---

## §6 — Phase-4 self-check on this document

Read what I wrote, checked against `the-decision.md` and
`the-idea.md`. Three flags:

**Flag 1.** §2's recommendation (after revision) is **Sharpened
Alternative B: Make / Understand / Decide / Recall / Run**, with
recommended Q0 shape (b) silent for inaugural and (c) hybrid for
Vai-for-everyone. **V3gga committed 2026-04-29:** mode set
adopted as Sharpened-B; inaugural Q0 committed to
(b)-with-observable (silent classification, override exposed,
architecturally identical to (c) hybrid per agent's UX-vs-
architecture analysis at 0.75 confidence); everyone Q0 deferred.
Mode names propagated verbatim to `the-idea.md` and
`the-decision.md`. §4 ordering and §7 build order revised
accordingly (this turn).

**Flag 1b (raised by §2 revision, resolved 2026-04-29).** Under
Q0=(b)-with-observable: §4's classifier-vs-mode-router ordering
resolved to classifier-first at 0.85 confidence; §7's build
order flipped from modes-first to classifier-first because the
classifier is the user-visible surface under (b). Both revisions
applied this turn. Per-mode "branch on routed-vs-forced"
behavior is named as a future per-mode commitment risk (0.75
confidence on substrate-level UX-only) — not blocking inaugural
but to be revisited when each mode handler design doc is
produced.

**Flag 2.** §3.2 surfaced a real concern: the memory store's
recall heuristics are *partly* persona-coupled by nature. The
mitigation (push the heuristics into a persona layer above the
shared-core query API) is plausible but not proven. The first
capability design doc that touches the memory store must address
this directly; if the design doc cannot keep recall heuristics
out of the shared core cleanly, that finding must be surfaced
and the dual-surface plan re-examined for that piece.

**Flag 3.** §4's classifier-before-or-after-mode-router decision
is at confidence 0.6 — load-bearing on every mode handler's
behavior and made on sketch-level evidence. The first capability
design doc for either the classifier or the FSM router must
revisit this ordering with implementation-level evidence and
either confirm or correct it. This is *the* single most likely
place this sketch will turn out to be wrong, and it's where the
Thorsen Phase-4 review of the design docs should focus first.

**No silent absorptions.** Three real risks named, all routed
to specific future design docs.

---

## §7 — What ships next

*Revised 2026-04-29 under inaugural Q0=(b)-with-observable
commitment. The original §7 recommended modes-first because
modes were the load-bearing piece other components composed
with. Under silent classification, the classifier becomes the
user-visible surface (the user sees its routing decision through
which response shape arrives plus the observable mode badge).
Build order flips: classifier first, then modes, then memory
store.*

Per `the-decision.md` §"What ships next, in order":

1. This document (path-a-architecture.md) — produced.
2. Pivot-options.md retirement — produced.
3. **First Path-A capability design doc: the heuristic
   classifier.** Under inaugural Q0=(b)-with-observable, the
   classifier is the user-visible surface — the user sees its
   routing decision implicitly (response shape) and explicitly
   (mode badge). Building modes first with stub classifier means
   the inaugural user-visible surface is missing. Build order:
   classifier → modes → memory store.
   The FSM router and memory store can stub for the first
   capability slice (router emits the only-available mode;
   memory store returns empty recall) without preventing the
   classifier from being end-to-end testable against V3gga's
   chat input.
4. Second design doc: FSM mode router (depends on the
   classifier emitting `(mode, confidence, signals[])` so the
   router knows what mode to enter).
5. Third design doc: pattern memory store (depends on modes
   existing to scope what gets remembered per-mode).

**Dependency analysis confidence:** 0.8. Higher than the
previous 0.75 because Q0=(b) commitment removes the
modes-first-vs-classifier-first ambiguity. The remaining
uncertainty is whether the classifier can be built
end-to-end-testable with stubbed modes — that's the question the
first design doc has to answer in its scope analysis.

---

End of sketch. No implementation specifics. No file paths. No
LOC budgets. Architectural relationships and contracts only, per
the sketch-only scope V3gga set.
