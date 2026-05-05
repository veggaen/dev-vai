# The decision

> One page. Citable in future turns. The substrate, scope, and
> identity decision for Vai, made 2026-04-28 / 2026-04-29 after
> the live-session postmortem and the three-document substrate
> sequence.
>
> When future-V3gga sees a new AI product launch and feels the
> pull to make Vai better than it, future-V3gga reads §
> "Comparison-shopping protection" below. When future-V3gga cites
> this section in a message, the agent cites it back.

---

## What Vai is

> Vai is not a better answer-generator.
>
> Vai is the deterministic thinking interface that makes
> answer-generators usable, testable, and harder to misuse.
>
> It appears first as V3gga's personal pre-tool reasoning
> system, then later as a public product layer that wraps
> specialized generators behind a mode-driven, memory-aware,
> validation-focused core.

---

## Constraints — what stayed, what dropped

**C1 — Special breed, not LLM. STAYS STRICT.**
Vai is not an LLM, not an LLM wrap, not a fork of someone else's
model substrate. The Path B option (S9: small local LLM + symbolic
guard) was considered and refused because the "not really an LLM
product" claim is a semantic move, not a sharp distinction. Vai
stays Vai.

**C2 — Old hardware. STAYS STRICT.**
Vai runs on V3gga's existing hardware. No GPU-class inference, no
cloud-only deployment, no hardware that V3gga does not currently
own.

**C3 — Better than Perplexity. RETIRED at the answer-generation
layer.**
Vai does not compete with Perplexity at the raw answer-generation
layer. Master.md §6.3 ("thinking partner, not a search engine")
is the citable category statement. C3 originated as a grief
response to the Bergen exchange, not as product reasoning.
**Vai-for-everyone may expose a Perplexity-like research surface
later, with a search backend behind Vai's deterministic interface.
That is product-experience-layer competition, not generator-layer
competition.** The two are different things and the distinction
is load-bearing.

**C4 — Better than Base44. RETIRED at the answer-generation
layer.**
Same shape as C3. Vai is not in the AI-app-builder category at
the generator layer. Vai-for-everyone may expose a Base44-like
app-creation surface later, with code/scaffold generators behind
Vai's interface. Same layer separation.

---

## Substrate adopted

**S7 (FSM) + memory store + heuristic classifier.**

Three load-bearing pieces, all deterministic, all running on
existing hardware:

1. **FSM mode router.** The user is always in exactly one mode.
   Five peer modes: **Make / Understand / Decide / Recall / Run.**
   Each mode has its own response shape, refusal set, and
   validation contract. (Adopted from `docs/path-a-architecture.md`
   §2.7 Sharpened Alternative B, V3gga-committed 2026-04-29.)
2. **Pattern memory store.** Append-only structured record.
   Recall is deterministic key/predicate lookup, not generative
   summarization.
3. **Heuristic weak-prompt classifier.** Surfaces named
   weaknesses in input prompts. Flags, does not rewrite.

Full description in [docs/the-idea.md](the-idea.md). Architecture
sketch in [docs/path-a-architecture.md](path-a-architecture.md).

---

## Dual surface

**Vai-for-V3gga (inaugural).** The shared core in V3gga's
existing chat UI, no external generator integration. Personal
pre-tool reasoning system. The first surface to ship.

**Vai-for-everyone (later).** The same shared core wrapping
specialized generators behind the interface for research, app
creation, code generation, previews, iteration. **Not in the
inaugural slice.** Recorded here so the inaugural architecture
does not foreclose it.

The shared core is shared. The surfaces differ in what
generators (if any) sit behind the interface.

---

## Architectural constraint (from V3gga, 2026-04-29)

The inaugural Vai-for-V3gga surface may use V3gga-specific
memory and examples, but **the shared core must not be
hard-coded to V3gga.** The FSM mode router, weak-prompt
classifier, memory schema, and validation contracts must be
designed as reusable primitives that can later support
Vai-for-everyone surfaces (research, app creation, code
generation, preview validation, iteration).

This constraint is binding on `docs/path-a-architecture.md` and
on every capability design doc that follows. Building "V3gga's
hardcoded helper" instead of "the first surface of a broader
Vai system" is a Phase-4 finding the agent flags immediately, not
a thing the agent silently optimizes toward.

---

## Validation before acceptance — split contract

**"Validation before acceptance" means Vai does not treat an
output as complete merely because a generator produced it. Each
mode defines what acceptance requires.**

**Inaugural validation contract (Vai-for-V3gga):**
*Pre-tool validation only.* Vai validates the prompt before tool
use; it does not validate downstream generated artifacts. This
keeps the inaugural slice buildable on the existing substrate
without requiring browser automation, preview inspection,
Lighthouse, code-review tooling, or app testing on day one.

**Later validation contract (Vai-for-everyone):**
*Pre-tool validation + post-generator validation.* Vai validates
generator outputs, previews, code, research claims, and iteration
results per the active mode's contract. Examples (per V3gga,
2026-04-29):

- *Research mode:* sources checked, claim confidence marked,
  uncertainty surfaced.
- *App-builder mode:* preview renders, key interactions work,
  code compiles, obvious UI text is readable.
- *Code mode:* types/lints/tests pass where available, diffs
  preserve requested behavior.
- *Planning mode:* scope, constraints, next action, and
  acceptance criteria are explicit.
- *Personal deterministic answer mode:* answer is based on
  memory, stable rules, or clearly stated uncertainty.

**The inaugural slice ships pre-tool validation only.** Anything
else is post-generator and belongs in the Vai-for-everyone
expansion.

---

## Mode-surface shape (Q0) — committed for inaugural, deferred for everyone

*Added 2026-04-29 per V3gga commitment, downstream of
`docs/path-a-architecture.md` §2.3 Q0 framing.*

**Vai-for-V3gga inaugural Q0 commitment: (b)-with-observable.**

- The classifier picks the mode silently. The user does not pick
  a mode from a palette or pill before submitting.
- The UI surfaces which mode the classifier picked (badge,
  label, or equivalent — exact UX deferred to a later design
  doc, not blocking inaugural).
- The user can override the classifier's pick (correct it after
  the fact). Override is modeled architecturally as a
  high-weight user-hint signal the classifier consumes on
  re-route; **no separate code path, no API change, no
  branching mode-handler behavior.** See architecture doc §2.7
  caveat: per-mode "branch on routed-vs-forced" is a future
  per-mode commitment, not a substrate commitment.
- Architectural shape under (b)-with-observable is identical to
  the architectural shape under (c) hybrid. The difference is
  UX (override surface prominence), not substrate.

**Vai-for-everyone Q0 commitment: deferred.**

- No fallback assumption recorded. Re-derive from observation
  when Vai-for-everyone is closer to actual work.
- The (b)-with-observable inaugural will produce real evidence
  about how silent classification feels in practice. That
  evidence is the right input to the everyone-Q0 decision.
- Path-a-architecture.md §2.7 noted (c) hybrid as the *likely*
  shape for everyone at 0.65 confidence. That confidence is too
  low to commit. Recorded here as "deferred, no fallback
  assumption" per V3gga 2026-04-29.

---

## What was retired

**B-Live (live-evidence routing).** Formally retired. Not a
fallback if Path A struggles.

**Narrow-Scope-as-originally-framed.** Superseded. Path A is its
sharpened, dual-surface version. Original framing not a fallback.

**More-capability-builds on the current S1 router.** Formally
retired as the operative path. The S1 substrate is being
*replaced*, not *extended further*. Existing capability work that
landed (multi-turn detector etc.) stays in service through the
transition; new capabilities go on the new substrate.

**Side A from the substrate memo** (capability-stacking on S1).
Already struck during the live-session postmortem; reaffirmed
here.

**Path B (S9: small local LLM + symbolic guard).** Considered
and refused. The "not really an LLM" claim is fuzzy. C1 stays
strict.

**The retired-means-retired rule stands.** Retired options stay
in the historical record. They are not fallbacks. If Path A
struggles, the response is *re-derive*, not *drift back to a
retired option*.

---

## What stays from the foundation work

All of the following stay in service through the transition and
into the Path A substrate:

- The corpus and corpus runner (`scripts/conv-loop.mjs`).
- Determinism (frozen clock + mulberry32 RNG).
- The predicate registry pattern.
- The dogfooding gate.
- The handoff protocol, including Appendix B.
- The Thorsen doctrine (especially Phase 4 / Semantic Scan).
- The chat UI as the inaugural surface.
- The math, literal, and personal-intro intercepts.
- The multi-turn-memory detector.
- Master.md as the supreme authority.

The foundation work is not wasted. The foundation work is the
reason Path A is buildable at all. The auditability, determinism,
and Thorsen-governed protocol *are* what makes a deterministic
thinking interface different from an LLM wrap.

---

## What ships next, in order

1. `docs/path-a-architecture.md` (sketch only, not implementation-
   ready) — produced this turn, alongside the pivot-options
   retirement.
2. **First Path-A capability design doc: the heuristic
   classifier.** Per `docs/path-a-architecture.md` §7 (revised
   2026-04-29 under inaugural Q0=(b)-with-observable
   commitment), build order flips from modes-first to
   classifier-first because under silent classification the
   classifier is the user-visible surface. Same Thorsen-governed
   protocol as multi-turn-detector: design doc → pause →
   implement → 7-check gate → 15-prompt dogfood → handoff.
3. Second design doc: FSM mode router (the five peer modes,
   depends on classifier existing to route into them).
4. Third design doc: pattern memory store (depends on modes
   existing to scope what gets remembered per-mode).
5. Repeat per capability until the inaugural Vai-for-V3gga slice
   is end-to-end recognizable as the idea.

---

## Comparison-shopping protection

**Read this section when a new AI product launches and you feel
the pull to make Vai better than it.**

**Rule (state plainly):** Vai is not in the category of cloud
LLM products. Comparisons to Perplexity, Base44, ChatGPT,
Claude, Gemini, Cursor, v0, or any new entrant in those
categories are **category errors at the substrate layer**.

The comparison set for Vai's substrate is:
- deterministic local power-user tools
- structured-workflow assistants
- trustworthy thinking-partner software

Vai-for-everyone may borrow *surface patterns* from successful AI
products (research surfaces, app-builder surfaces, chat surfaces).
Vai must not borrow their *internal drift*. The substrate stays
deterministic, mode-driven, memory-aware, and validation-focused
even when the surface looks familiar.

**Test for "is this a category error":** Are you proposing to
compete with Perplexity/Base44/ChatGPT/etc. at the answer-
generation layer? If yes, category error. Refuse. If you are
proposing to expose a similar *surface* with Vai's deterministic
core underneath and a specialized generator behind the
interface, that is in scope for Vai-for-everyone and not a
category error — but it is also not the inaugural slice.

**Agent-side discipline:** When V3gga cites this section in a
future message, the agent cites it back as the answer to the
proposed comparison. The agent does not silently agree to "let's
make Vai better than [new product]" without first applying the
test above.

The Bergen exchange is the live evidence of why this rule
exists. The grief response that followed it produced C3 and C4.
This rule is the institutional memory that prevents the grief
response from rewriting the substrate decision next time.

**Closing note on how the discipline actually operates.** The
record this rule produces is not "no errors." It is "errors
caught fast, propagation reversed cleanly, citable record stays
honest." Two anti-patterns (#15 loop-cap evasion, #16
confidence-without-scope) were added in the 2026-04-29 turn
cycle, both inaugural-applied within minutes of being recorded,
both surfaced by the agent's own self-correction rather than by
external review. See [`anti-patterns.md`](anti-patterns.md) and
[`handoff-protocol.md` Appendix B](handoff-protocol.md#appendix-b--inaugural-application-history).
The disciplines hold by being applied to themselves on the same
day they ship; that is the operational test, not the absence of
failures. Confidence in this framing: 0.85. (Watch-out: anti-pattern
inflation is itself a failure mode worth tracking. Three new
anti-patterns in three days would itself be signal that the
disciplines are becoming decoration rather than load-bearing.)

---

## One-line citation form

When citing this decision in a future turn, use:

> Per `docs/the-decision.md`: Vai is the deterministic thinking
> interface, not a better answer-generator. C1/C2 strict. C3/C4
> retired at the answer-generation layer. Substrate: S7 + memory
> store + heuristic classifier. Five peer modes: Make /
> Understand / Decide / Recall / Run. Inaugural Q0:
> (b)-with-observable (silent classification, override exposed).
> Everyone Q0: deferred. Dual surface (V3gga inaugural, everyone
> later). Pre-tool validation in inaugural slice; post-generator
> validation deferred to Vai-for-everyone.
