# Constraint reconciliation

> Part 3 of the substrate decision. Takes the four constraints
> V3gga has stated, the twelve substrates from Part 1, and the
> idea-version from Part 2, and marks which combinations are
> satisfiable, in tension, or mutually exclusive.
>
> Per V3gga's instruction: if the intersection is empty, that is
> the finding. The work after that point is dropping a constraint.
> Which one V3gga drops is the product decision; this document
> does not pre-make it.
>
> Confidence labels: 0.9+ "I'd defend it"; 0.7–0.9 "well-supported";
> 0.5–0.7 "informed reading"; <0.5 "guess flagged as guess."

---

## The four constraints (as V3gga has stated them)

**C1 — Special breed, not LLM.**
Vai must not be an LLM, an LLM wrap, or a fork of someone else's
model substrate. Vai stays Vai. Stated repeatedly throughout the
session; reinforced by Master.md §2.1 ("an evolving cognitive
partner — not a chatbot, not a search engine") and §6.1 ("designed
intent: Vai exists to assist V3gga in serious thinking, building,
and learning — not to entertain or to substitute for thinking").
Confidence in restatement: 0.95.

**C2 — Old hardware.**
Vai must run on V3gga's existing hardware. Specific specs not
named in this conversation; the prior substrate memo flagged this
as an open question. Reading it strictly: Vai must not require
GPU-class inference, cloud-only deployment, or hardware V3gga
does not currently own. Confidence in restatement: 0.7. Specs
genuinely unknown.

**C3 — Better than Perplexity.**
Vai must outperform Perplexity on whatever ground V3gga uses
Perplexity for. Said verbally during the live session as part of
the grief response to the Bergen exchange. **Master.md does not
contain this constraint.** Master.md §6.2 says the opposite: "Many
assistants optimize for breadth of information instead of depth of
reasoning... Vai should be trained around cognitive skills." And
§6.3: "thinking partner, not a search engine." Confidence in
restatement: 0.85 (V3gga did say it); confidence that it belongs
in the constraint set: **0.4** (Master.md actively contradicts it).

**C4 — Better than Base44.**
Vai must outperform Base44 on whatever ground V3gga uses Base44
for. Same provenance as C3: said verbally during the session, not
in Master.md. Base44 is in the AI-app-builder category; Master.md
does not name app generation as Vai's domain. Confidence in
restatement: 0.85; confidence it belongs in the constraint set:
**0.4**.

**Note on C3 and C4 before the matrix:** I am holding both in the
constraint set as V3gga stated them, and marking them in the
matrix. But the cleanest finding from Part 2 is that *these two
constraints are likely category errors* — Vai is not in those
products' categories. I'm letting the matrix show what happens
when you take them literally; the result will speak for itself.

---

## The twelve substrates (recap from Part 1)

S1. Token-overlap retrieval over curated primer store *(current)*
S2. Embedding retrieval over curated primer store
S3. Symbolic rule engine
S4. Bayesian network / probabilistic model
S5. Constraint-satisfaction / SAT-style
S6. Decision tree / ID3-style classifier
S7. Hand-written FSM with explicit dialogue states
S8. Small local LLM (Qwen 2.5 7B / Phi 3.5 / Llama 3.2 3B)
S9. Hybrid: small LLM + symbolic guard
S10. Pure templating + slot-filling (no inference)
S11. Case-based reasoning (retrieve closest prior case + adapt)
S12. Frame-based / schema.org-style ontologies

---

## The idea-version (from Part 2)

Vai is a process-improvement layer for V3gga's collaborations
with AI tools. Watches framing, catches weak prompts before they
go out, surfaces patterns across sessions, refuses to compete
with answer-generators on their own ground. Inaugural slice:
standalone reframing tool plus one external-tool integration.

The substrate must support: (a) process visibility (read inputs
the user is about to send elsewhere), (b) reframing suggestion
(output: a better version of the user's prompt, with reasoning),
(c) pattern memory across sessions, (d) refusal when a request is
not in scope, (e) auditability (every output traces to a rule).

---

## Constraint × substrate matrix

Legend: ✅ satisfies; ⚠️ tension (satisfiable with significant
work); ❌ violates. Per-cell confidence in parens.

| Sub | C1 not-LLM | C2 old hw | C3 > Perplex | C4 > Base44 | Idea fit |
|-----|------------|-----------|--------------|-------------|----------|
| S1  | ✅ (0.95)  | ✅ (0.95) | ❌ (0.95)    | ❌ (0.95)   | ❌ (0.9)  |
| S2  | ✅ (0.85)  | ✅ (0.8)  | ❌ (0.9)     | ❌ (0.9)    | ⚠️ (0.6)  |
| S3  | ✅ (0.95)  | ✅ (0.95) | ❌ (0.95)    | ❌ (0.95)   | ⚠️ (0.65) |
| S4  | ✅ (0.9)   | ✅ (0.85) | ❌ (0.9)     | ❌ (0.9)    | ⚠️ (0.6)  |
| S5  | ✅ (0.95)  | ✅ (0.9)  | ❌ (0.95)    | ❌ (0.95)   | ❌ (0.7)  |
| S6  | ✅ (0.95)  | ✅ (0.95) | ❌ (0.95)    | ❌ (0.95)   | ⚠️ (0.6)  |
| S7  | ✅ (0.95)  | ✅ (0.95) | ❌ (0.95)    | ❌ (0.95)   | ⚠️ (0.65) |
| S8  | ❌ (0.85)  | ⚠️ (0.6) | ⚠️ (0.55)    | ⚠️ (0.5)    | ✅ (0.7)  |
| S9  | ⚠️ (0.55) | ⚠️ (0.55) | ⚠️ (0.55)    | ⚠️ (0.5)    | ✅ (0.75) |
| S10 | ✅ (0.95)  | ✅ (0.95) | ❌ (0.95)    | ❌ (0.95)   | ❌ (0.85) |
| S11 | ✅ (0.85)  | ✅ (0.85) | ❌ (0.9)     | ❌ (0.9)    | ⚠️ (0.65) |
| S12 | ✅ (0.9)   | ✅ (0.9)  | ❌ (0.9)     | ❌ (0.9)    | ⚠️ (0.6)  |

---

## Per-row reasoning (compressed)

**S1–S7, S10–S12 on C3/C4:** All non-LLM substrates fail "better
than Perplexity" and "better than Base44" *if those constraints
mean "do the same job better."* Perplexity has live web indexing;
no rule/embedding/template system competes on factual breadth.
Base44 generates apps from briefs using LLM-class models; no
non-LLM substrate generates apps. Confidence ~0.9 each.

**S8 on C1:** Small local LLM violates "not LLM" by definition.
The argument that it doesn't is semantic and weak. Confidence
0.85 it violates.

**S8 on C2:** Qwen 2.5 7B Q4 runs ~4–8 GB RAM, ~10–20 tok/s on
modest CPU; Phi 3.5 mini smaller. Probably fits "old hardware"
but depends on what "old" means. Tension marked. Confidence 0.6.

**S8 on C3/C4:** A small local LLM is closer to Perplexity's and
Base44's substrate class than rule systems are, so it's *less
clearly worse*; "better than" still depends on what V3gga uses
those products for. Tension. Confidence 0.55, 0.5.

**S9 (hybrid LLM + symbolic guard) on C1:** Half-violates by
containing an LLM; the symbolic guard makes it not-purely-LLM.
Whether this counts as "not LLM" is V3gga's call. Tension marked.
Confidence 0.55.

**S9 on idea fit:** Best fit among substrates. Symbolic guard
handles refusal, audit, determinism, pattern memory; LLM handles
free-form reframing of weak prompts (which is genuinely a
language-understanding task). Confidence 0.75.

**S1 (current) on idea fit:** Token-overlap retrieval has no
mechanism for "is this prompt well-framed." Cannot reframe
because reframing requires understanding what the user *meant*
vs *said*; token overlap only sees what was said. Hard ❌.
Confidence 0.9.

**S10 (templating) on idea fit:** Templating can fill slots but
cannot detect that a user's prompt to Claude is ambiguous. Hard
❌. Confidence 0.85.

**S3, S6, S7, S11, S12 on idea fit:** All can support refusal,
audit, and pattern memory cleanly. None can reframe a free-form
prompt without a language model component. The reframing step
is the substrate-blocking requirement of the idea. ⚠️ marked
because they could support partial scope (refuse + flag, no
reframe). Confidences 0.6–0.65.

---

## Substrates that satisfy all four constraints simultaneously

**Reading the constraints strictly (C3 and C4 mean "outperform
those products on their own ground"):**

Substrates with no ❌ across all four constraints: **none.**

The matrix has at least one ❌ in every row when C3 and C4 are
read strictly.

**This is the empty-list finding V3gga predicted.**

---

## What this means

Per V3gga's epilogue from the Part-1 commission: "If Part 3 comes
back with an empty list — no substrate satisfies all four
constraints — that result is itself the answer, and the work after
that point is dropping a constraint. Which one you drop is the
product decision."

The result is empty. A constraint must be dropped. The four
candidates for the drop, in the order that makes most sense to
me from the evidence:

**Drop candidate #1 — Drop C3 (better than Perplexity).**
Strongest case for dropping. Master.md §6.3 explicitly says Vai
is not in Perplexity's category ("thinking partner, not a search
engine"). C3 was stated during a grief response to the Bergen
exchange, not during product reasoning. Dropping it is a return
to what Master.md says, not a retreat. **Recommendation: drop.**
Confidence: 0.85.

**Drop candidate #2 — Drop C4 (better than Base44).**
Same case as C3, less explicitly addressed in Master.md but
implied throughout. Vai is not an app-builder. Master.md never
positions Vai in the build-app-from-brief category. **Recommendation:
drop.** Confidence: 0.8.

**Drop candidate #3 — Drop C1 (not LLM).**
Strong case against dropping. C1 is in Master.md repeatedly. C1
is the strongest identity claim Vai has. Dropping it would make
Vai another LLM wrap and dissolve the "special breed" claim.
**Recommendation: do not drop.** Confidence: 0.9 in the recommendation.

**Drop candidate #4 — Drop C2 (old hardware).**
Weak case for dropping. The hardware constraint affects which LLMs
could be considered if C1 were also softened. Dropping C2 alone
without dropping C1 doesn't help. **Recommendation: do not drop
unilaterally.** Confidence: 0.75.

---

## What the matrix looks like with C3 and C4 dropped

If C3 and C4 are dropped (the recommendation), the matrix collapses
to: which substrates satisfy C1 (not LLM) + C2 (old hardware) + the
idea fit?

| Sub | C1 | C2 | Idea | Verdict |
|-----|----|----|------|---------|
| S1  | ✅ | ✅ | ❌  | Out (current substrate; idea-blocked) |
| S2  | ✅ | ✅ | ⚠️  | Possible w/ work |
| S3  | ✅ | ✅ | ⚠️  | Possible w/ work |
| S4  | ✅ | ✅ | ⚠️  | Possible w/ work |
| S5  | ✅ | ✅ | ❌  | Out |
| S6  | ✅ | ✅ | ⚠️  | Possible w/ work |
| S7  | ✅ | ✅ | ⚠️  | **Strongest fit; see below** |
| S8  | ❌ | ⚠️ | ✅  | Out (violates C1) |
| S9  | ⚠️ | ⚠️ | ✅  | **Only path if C1 softened** |
| S10 | ✅ | ✅ | ❌  | Out |
| S11 | ✅ | ✅ | ⚠️  | Possible w/ work |
| S12 | ✅ | ✅ | ⚠️  | Possible w/ work |

**The honest finding** is that even with C3 and C4 dropped, no
substrate is a clean ✅ across the remaining three constraints.
The reframing requirement of the idea pushes hard toward S9
(LLM + guard), which softens C1.

The two paths forward:

**Path A — Keep C1 strict; soften the idea.**
Drop "free-form prompt reframing" from the idea. Keep "weak-prompt
detection" (a classification task that S3/S7/S11 can do via
heuristics) and "pattern memory" (which S7 + a memory store can
do). The product becomes: "Vai flags weak prompts and surfaces
patterns; it does not rewrite them." The user does the rewriting
themselves once Vai has flagged the issue. **This is a real
product, more limited than Part 2's vision, fully consistent with
Master.md.**
Substrate: **S7 (FSM) + memory store + heuristic classifier.**
Confidence in viability: 0.75.

**Path B — Soften C1; ship the full idea.**
Accept S9 (small local LLM + symbolic guard) as Vai's substrate.
Argue that an LLM running locally, used only for reframing under
strict gating, is "not an LLM product" in the meaningful sense
even if it contains an LLM. This is a semantic move and V3gga
should be honest with himself about whether it's a real
distinction or a face-saving one.
Substrate: **S9.** Confidence in viability: 0.7. Confidence
that it actually satisfies C1's spirit: 0.4.

---

## My recommendation

Drop C3 and C4. They are category errors and Master.md already
disagrees with them.

Then choose between Path A and Path B with eyes open:

- **Path A** (keep C1, soften idea) preserves identity, is
  Master.md-consistent, ships a smaller real product, and avoids
  the LLM wrap V3gga has explicitly resisted. **My recommendation.**
- **Path B** (soften C1, ship full idea) gets you the more
  ambitious product but at the cost of the strongest identity
  claim Vai has. The semantic distinction between "S9 is not an
  LLM product" and "S9 is an LLM product" is genuinely fuzzy and
  should not be pretended to be sharp.

Either path gets Vai out of the Bergen-emitting failure mode the
current substrate is in. Both paths involve real work. Neither is
free.

The product decision is V3gga's. This document's job was to make
the empty intersection visible and name the candidates honestly.

---

## What this document does not do

- Does not pick the path. V3gga picks.
- Does not rank S2/S3/S4/S6/S7/S11/S12 against each other in
  detail. If Path A is chosen, that ranking becomes the next
  document.
- Does not specify the migration plan from S1 to whichever
  substrate is chosen. Migration plan also becomes the next
  document.
- Does not address the chat-UI-shape contradiction surfaced in
  Part 2. The UI shape decision is independent of the substrate
  decision but should follow it.

End of three-document substrate decision sequence.
