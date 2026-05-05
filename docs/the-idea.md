# The idea — Path A scope, dual-surface

> **Status: Path A adopted (2026-04-28). Dual-surface framing
> adopted same day.** C3 (better than Perplexity) and C4 (better
> than Base44) retired as category errors *at the answer-generation
> layer*. C1 (special breed, not LLM) and C2 (old hardware) stay
> strict. Vai is a deterministic thinking interface; the
> answer-generators stay outside the substrate.
>
> **Dual surface:**
> - **Vai-for-V3gga** — personal pre-tool reasoning system. The
>   inaugural surface. Mode router, weak-prompt classifier,
>   pattern memory, scope-control. Substrate: S7 (FSM) + memory
>   store + heuristic classifier.
> - **Vai-for-everyone** — later public product surface that may
>   wrap research, app creation, code generation, previews, and
>   iteration. Specialized generators sit *behind* Vai's interface;
>   Vai's substrate stays deterministic. Not in the inaugural
>   slice; recorded here so the personal surface is not
>   architected in a way that forecloses it.
>
> See `docs/the-decision.md` for the citable decision.
>
> Confidence labels: 0.9+ "I'd defend it"; 0.7–0.9
> "well-supported"; 0.5–0.7 "informed reading"; <0.5
> "guess flagged as guess."

---

## The biggest finding before I write anything else

Master.md already says what the idea is. It has said it since
2026-04-11. The live-session failures are not failures of an
unstated mission — they are failures against an explicitly stated
one.

Master.md §6.2: "Many assistants optimize for breadth of
information instead of depth of reasoning... Vai should be trained
around cognitive skills that do not expire."

Master.md §6.3: "The relevant class of user is a power user who
needs a thinking partner, not a search engine."

Master.md §8 names six anti-patterns Vai must reduce. Three of them
are *exactly* what the live session demonstrated:

- The Confident Bullshitter (Exchange 1, Bergen on king-of-Norway)
- The Template Matcher (Exchange 4, TypeScript fixture on Hotline
  Miami HTML request)
- The Literal Interpreter (Exchange 3, "I don't have a solid answer
  for okay then try yet")

And §2.3: "Vai may monitor interactions with other models or
people and suggest better framing when misunderstanding, weak
prompting, or under-delivery is likely."

That last sentence is the strongest "fourth path" pointer in the
entire repository, and none of the substrate analyses (mine
included) treated it as the primary product. We've all been
treating it as a footnote. It's the headline. Confidence: 0.85.

The rest of this document follows from taking Master.md at its
word.

---

## What problem Vai solves for the user

**Stated mission (from Master.md):** Help V3gga think clearly,
make strong decisions, evolve software, and build things that
matter. Eliminate waste in framing, prompting, reasoning, retries,
and low-signal output. Be the assistant V3gga would want in the
room for the hardest problem he is facing.

**Restated in the language the live session forced on us:** V3gga
already has access to good answer-generators (Claude Opus 4.7 and
4.6 as mentor models named in Master.md §2.4, plus GPT-5.5, GPT-5.4,
Composer 1.5, and whichever models V3gga works with day-to-day).
V3gga does not need another answer-generator. V3gga needs a
*thinking layer that sits between him and those models*, watching
the framing, catching the weak prompts before they go out, surfacing
the better question when the asked question is misframed, and
remembering the patterns of where V3gga's iterations waste motion.

The problem is not "answer V3gga's questions." The problem is
"reduce the waste in V3gga's collaboration with AI tools." Those
are different problems with different substrate requirements.

**Confidence in this restatement:** 0.75. This is my reading of
Master.md §3.3 ("eliminate waste") + §6.5 ("prompting is interface
design for intelligence") + §2.3 (the monitoring-other-models
clause) as a coherent product thesis. V3gga may have intended a
narrower or wider scope.

---

## Who the user is

**Stated (Master.md §6.3):** Primarily V3gga. More generally, a
power user who needs a thinking partner, not a search engine.

**Concrete archetype:** A solo or small-team builder who already
uses AI tools fluently — Claude in the IDE, GPT for second
opinions, Cursor or Copilot for code, sometimes a search engine,
sometimes a domain specialist tool. They are not new to AI
assistance. They have noticed that their AI tools are not
collaborators, they are oracles. The tools answer what is asked;
they do not push back on the asking. The user has noticed they
spend significant time *prompting better* and they want a
collaborator that helps them do that, not yet another oracle.

**Not the user:**
- People who want a smarter Google. (Use Perplexity.)
- People who want code generated from a brief. (Use Cursor, v0,
  Base44.)
- People who want a chatbot to talk to. (Use ChatGPT.)
- People who don't already use AI tools. (Vai's value depends on
  there being a workflow with AI in it that Vai can improve.)

**Confidence:** 0.7. The "not the user" list is my reading; V3gga
may want to keep some of those cases in scope.

---

## What the user opens Vai for

This is the question the chat UI has been answering badly. The chat
UI invites the user to type a factual question, which is the wrong
shape for what Vai actually does. The current shape leads to Bergen.

**What I think the user should open Vai for** (guess flagged as
guess, confidence 0.55):

- "I'm about to ask Claude a hard question. Help me frame it."
- "Claude gave me this answer. Is it good? What's it missing?"
- "I've been iterating on this prompt three times and it's not
  improving. What's wrong with how I'm asking?"
- "I'm stuck on this problem. What's the actual question I should
  be asking?"
- "I've been working on X for two weeks. What patterns am I
  repeating that aren't helping?"
- "I want to make a decision about Y. Help me think through what
  I'm not seeing."

These are not "answer my question" requests. They are "help me
ask better, decide better, notice patterns better" requests. The
substrate requirement for these is *meta-reasoning about the
user's process*, not *answer generation about a topic.*

**Alternative reading I considered and rejected:** Vai is for
cognitive-skill exercises (calibration training, first-principles
practice, reasoning drills). Master.md §7 names timeless
foundations including calibrated uncertainty, first-principles
reasoning, meta-learning. A reading of Vai as a "skill trainer for
your own thinking" is consistent with Master.md but doesn't fit
the §2.3 monitoring clause as cleanly. I'm picking the meta-
collaboration reading because it integrates more of the evidence,
but the skill-trainer reading is genuinely defensible. V3gga should
say which.

---

## What Vai does that no existing tool does **[Path A, dual-surface]**

**Vai is a deterministic thinking interface that can power
multiple AI product surfaces. Its core advantage is not better
answer generation; it is structuring the path from intent to
outcome through modes, memory, validation, scope control, and
explicit handoff to specialized tools.**

### The shared core (both surfaces)

- **FSM mode router.** The user is always in exactly one mode
  (**Make / Understand / Decide / Recall / Run** — the five peer
  modes adopted from `docs/path-a-architecture.md` §2.7
  Sharpened Alternative B). Each mode has its own response shape,
  its own out-of-scope refusal set, and its own validation
  contract. The current substrate's failure mode (one router,
  one shape) goes away by construction.
- **Heuristic weak-prompt classifier.** Runs over input text.
  Surfaces named weaknesses (*vague intent*, *missing scope*,
  *scope-too-broad*, *missing example*, *ambiguous referent*,
  *implicit acceptance criteria*). Does not rewrite. Signals
  are explicit and inspectable.
- **Pattern memory across sessions.** Append-only structured
  store of prompts, decisions, retired options, vocabulary,
  corpus anchors. Recall is deterministic key/predicate lookup,
  not generative summarization.
- **Refusal as a first-class output.** Out-of-scope requests
  return a named refusal plus a routing suggestion to the
  appropriate specialized tool.
- **Validation before acceptance.** Whatever a downstream
  generator produces (code, prose, plan, search result) passes
  through Vai's validation contract for the active mode before
  being accepted.
- **Deterministic answers when possible.** Calculations, recall
  of stored facts, predicate-verifiable claims, structural code
  refactors — Vai answers these directly without invoking
  external generators.

### Vai-for-V3gga (inaugural surface)

The shared core, exposed in V3gga's existing chat UI, with no
external generator integration. Personal pre-tool reasoning
system. The classifier flags weak prompts before V3gga sends
them to Claude/GPT/Cursor; the memory store records V3gga's
patterns; the modes shape what kind of response Vai itself
produces. The Bergen failure mode goes away because *Explain*
mode's refusal set explicitly includes open-ended factual
lookup, and *Build/Diagnose/Plan* never invite that question
shape.

### Vai-for-everyone (later public surface)

The same shared core, exposed as a general AI product layer
that may wrap research (Perplexity-like), app creation
(Base44-like), code/project generation, previews, and
iteration. Specialized generators (search engines, code-gen
LLMs, app-builders) sit *behind* Vai's interface; Vai's
substrate stays deterministic. Vai may *look* like Perplexity
for research and *look* like Base44 for app creation, but Vai's
core is mode-driven, memory-aware, validation-focused, and
deterministic. Vai borrows surface patterns; Vai does not
borrow internal drift.

**Not in the inaugural slice.** Vai-for-everyone is recorded
here so the inaugural Vai-for-V3gga architecture does not
foreclose it. Specifically: the FSM modes, the memory store
schema, and the classifier signals must be designed as
extensible, not hard-coded to V3gga's personal use. Cross-
surface architectural pressure-testing belongs in `docs/
path-a-architecture.md`.

### What is *not* Vai's job, on either surface

- Generating long-form prose, marketing copy, or creative
  writing. (LLM territory. If Vai-for-everyone exposes a
  writing surface, the LLM does the writing; Vai handles
  modes/memory/validation/scope.)
- Live web search and citation. (Perplexity territory. If
  Vai-for-everyone exposes a research surface, a search backend
  does the search; Vai structures the question, validates the
  result, and refuses out-of-scope follow-ups.)
- App scaffolding from a brief. (Base44/v0/Cursor territory. If
  Vai-for-everyone exposes an app-builder surface, those
  generators do the scaffolding; Vai handles the brief
  classification, scope control, and validation gates.)
- Pretending to know things it doesn't. Master.md §8's first
  anti-pattern. Architecturally impossible under Vai's substrate
  (deterministic predicates only emit when their predicate is
  true), not just policy-discouraged.

Confidence: 0.8 on the dual-surface framing. 0.75 on the shared-
core decomposition. 0.6 on the four-mode set (inherited from the
prior pivot doc; may sharpen in `docs/path-a-architecture.md`).

---

## What Vai explicitly does not do

This is where the Perplexity and Base44 comparisons get resolved
cleanly — by stating what Vai is *not* competing on.

Vai does not:

- **Answer open-ended factual questions.** "Who is king of Norway"
  is not Vai's job. Use a search engine. Vai might suggest *which*
  search engine and *how* to phrase the search, but it does not
  answer the question itself.
- **Generate prose, marketing copy, creative writing, or long-form
  content.** Use an LLM. Vai might help frame the brief better
  before you give it to the LLM.
- **Build apps from a one-line description.** Use Base44, v0,
  Cursor, or any of the dozen tools designed for that. Vai might
  help refine the brief and notice when the brief is missing
  decisions you'll regret later.
- **Be a chatbot.** Vai is not for general conversation. Vai is
  for moments when V3gga's collaboration with AI tools could be
  better and Vai can help.
- **Compete on breadth of knowledge.** Master.md §6.2 explicitly
  says this. Vai's competence is *cognitive skill*, not *facts.*
- **Pretend to know things it doesn't.** Master.md §8 names "the
  Confident Bullshitter" first in the anti-patterns. The Bergen
  exchange violates this directly. Whatever substrate Vai ends up
  on must make confident bullshitting architecturally impossible,
  not just policy-discouraged.

Confidence: 0.85. This list is mostly direct extension of Master.md
plus the live-session diagnoses.

---

## The "special breed" claim made concrete

V3gga has repeatedly said Vai is "special breed." That phrase has
been doing a lot of work without being defined. My best attempt to
make it concrete in *mechanism, not vibes:*

**Special breed (mechanism):** Vai is the only assistant in
V3gga's tool set whose primary job is to *improve V3gga's process*
rather than *answer V3gga's questions.* Every other tool — Claude,
GPT, Cursor, search engines, Base44 — is in the answering business.
Vai is in the *meta* business. That positioning is structurally
different, not just better.

**Mechanism #1 — Process visibility.** Vai sees what V3gga is
doing across tools (with V3gga's explicit permission for each
integration). That visibility is the raw material; no answer-
generator has it because answer-generators are downstream of
prompts, not upstream.

**Mechanism #2 — Pattern memory across sessions.** Vai remembers
V3gga's framings, recurring weaknesses, recurring strengths,
vocabulary, what V3gga means by specific words ("shipped" for
V3gga is "passed dogfooding," not "merged to main"). This memory
compounds; the longer V3gga uses Vai, the better Vai gets at
catching V3gga's patterns. No general assistant has this because
they reset per session or operate on global users.

**Mechanism #3 — Refusal as a feature.** Vai's willingness to say
"this isn't my job — go to Claude with this version of the
question" is a feature, not a bug. The competition is built to
maximize answer engagement; Vai is built to minimize wasted motion.
Refusal is how minimization shows up at the surface.

**Mechanism #4 — Auditability.** Determinism + predicate gates +
the corpus + the handoff protocol mean every Vai output can be
traced to its rule. No black-box reasoning. V3gga can see why Vai
flagged a prompt as weak, and Vai can be wrong in a way V3gga can
inspect and correct. The foundation work — which the live session
made feel like wasted effort — is exactly the property that makes
this mechanism possible.

**Confidence in the "special breed" definition:** 0.6. This is my
synthesis. The four mechanisms are real and consistent with Master
.md, but V3gga may have meant something different by "special
breed" that I am not capturing.

---

## The minimum viable scope where the idea is recognizable as itself **[Path A]**

Path A scopes the inaugural product to three load-bearing pieces,
all deterministic, all running on existing hardware:

1. **The FSM mode router.** Build / Diagnose / Plan / Explain (or
   the sharper set Path-A-architecture lands on). The user is
   always in exactly one mode; transitions are explicit; each
   mode has its own response shape and its own out-of-scope
   refusal set.
2. **The memory store.** Append-only structured record of past
   prompts, decisions, retired options, vocabulary, and corpus
   anchors. Recall is deterministic key/predicate lookup, not
   generative summarization.
3. **The heuristic weak-prompt classifier.** Runs over input
   text. Surfaces named weaknesses (*vague intent*,
   *missing scope*, *scope-too-broad*, *missing example*,
   *ambiguous referent*, *implicit acceptance criteria*). Does
   not rewrite. Signals are explicit and inspectable.

The inaugural slice (recognizable as the idea, cheapest to
build) is: **the FSM mode router + the weak-prompt classifier,
wired into the existing chat UI, with the memory store stubbed
but not yet populated.** That gets the new product posture in
front of V3gga end-to-end on the existing substrate. The memory
store comes second because it depends on the modes existing to
scope what gets remembered per-mode.

No cross-tool monitoring in the inaugural slice. No browser
extension. No paste-a-prompt tool. The starting surface is the
chat UI V3gga already uses, restructured around the four modes
and the classifier. Cross-tool monitoring is a later capability
layered on the same substrate, not the inaugural one.

**Confidence:** 0.7 on the three-piece decomposition. 0.6 on the
slice-ordering (modes + classifier first, memory second). The
actual sequencing decision waits for `docs/path-a-architecture.md`.

---

## Internal contradictions I found while drafting **[Pre-Path-A, retained]**

Per V3gga's instruction to surface contradictions rather than
hide them. **Walked under Path A in the next section.**

**Contradiction #1 — The chat UI shape vs the cognitive-partner
mission.**
The chat UI invites the user to type a question and expect an
answer. That UI shape is structurally an answer-generator UX. If
Vai's job is process improvement and reframing, the UI should
look more like a code-review-comments-overlay or a sidebar-on-
your-other-tools, not a chat box. The chat box was inherited from
the AI assistant vernacular and doesn't match the mission. The
Bergen exchange happened in part because the chat box invited
"who is king in Norway" as a reasonable thing to type. Resolution:
the UI needs to change shape with the mission, or Vai's "no, ask
Claude with this reframing" responses need to be the default and
the UI made to support them being the dominant pattern. **High
confidence this is a real contradiction.**

**Contradiction #2 — "Better than Perplexity / Base44" vs Master.md.**
Master.md never names Perplexity or Base44 as the comparison set.
Master.md names anti-patterns Vai must avoid. The "better than
Perplexity" framing came from V3gga's grief during the live
session, not from the stated mission. Resolution: drop the
comparison set. Vai is not in the same product category as
Perplexity. They don't compete. "Better than Perplexity" is a
category error. **High confidence this is a real contradiction.**

**Contradiction #3 — "Compounding learning" vs deterministic
substrate.**
Master.md §6.4 lists "compounding learning" as a core requirement.
The current substrate has no learning loop except the corpus and
the manual capability builds. Compounding learning requires either
(a) an explicit memory store that accumulates V3gga's patterns
without retraining anything, or (b) a small learned component, or
(c) a different definition of "compounding learning" that means
"the corpus grows over time as V3gga's patterns are encoded into
new test cases." Resolution: pick one. (a) is the cleanest fit
with the deterministic-substrate constraint. **Medium confidence
this is a real contradiction; (a) is plausibly already what Master
.md means.**

**Contradiction #4 — "Adaptive depth" vs the substrate.**
Master.md §6.4: "simple questions deserve crisp answers; complex
questions deserve real analysis." The current substrate cannot
distinguish simple-vs-complex; it dispatches by token shape.
Reading-the-room is not a property routing arms can have without
a higher-order classifier. Resolution: needs an explicit
question-difficulty classifier or a different substrate shape.
**Medium-high confidence this is a real contradiction.**

**Contradiction #5 — "Proactive reframing" vs answer-generation
mode.**
If Vai's primary mode is reframing, then "answer the question
directly when you can" needs to be the *fallback*, not the
default. The current substrate has the inverse polarity — answer
first, never reframe. Resolution: invert the default. **High
confidence.**

---

## Walking the contradictions under Path A **[Path A]**

For each of the five contradictions surfaced above, does Path A
resolve it? If not, the survival is named here, not buried.

**Contradiction #1 — Chat UI shape vs cognitive-partner mission.**
*Status under Path A: partially resolved, with the residue named.*
Path A keeps the chat UI (per V3gga's explicit list of what stays
from the foundation work) but restructures it around the four
FSM modes and the weak-prompt classifier. The user no longer
types a free-form question into a generic box; the user is in a
mode, and the input field is shaped by the mode. The Bergen
failure mode goes away because *Explain* mode's out-of-scope
refusal set explicitly includes open-ended factual lookup, and
*Build/Diagnose/Plan* never invite that question shape. The
residue: the chat metaphor still suggests "ask and receive," and
the classifier's *flag-don't-rewrite* posture will feel
unfamiliar in a chat surface. The architecture doc should
explicitly address how the classifier's output renders inside a
chat turn without becoming itself a generative response. **Real
residue, surfaced for the architecture doc.** Confidence the
residue is real: 0.75.

**Contradiction #2 — "Better than Perplexity / Base44" vs
Master.md.**
*Status under Path A: resolved by layer separation.* Vai does
not compete with Perplexity or Base44 at the answer-generation
layer; that comparison was a category error and stays retired.
Vai *may* compete at the product-experience layer in the
Vai-for-everyone surface, where research and app creation
become surfaces Vai exposes with specialized generators behind
the interface and Vai's deterministic core in front. The
Master.md §6.3 line ("thinking partner, not a search engine")
is preserved: Vai does not become a search engine even when
exposing a research surface, because the substrate stays
deterministic and the search backend is the generator, not
Vai. `docs/the-decision.md` carries the comparison-shopping
protection rule and the surface-vs-substrate distinction.
Confidence resolved: 0.85.

**Contradiction #3 — "Compounding learning" vs deterministic
substrate.**
*Status under Path A: resolved by adoption of explicit memory
store.* Path A's piece #2 (the memory store) is exactly the
"option (a)" the original draft named — an explicit, structured,
append-only store that accumulates V3gga's patterns without any
learned/trained component. Compounding happens because lookups
over the store get more useful as the store grows; no model is
updated. Consistent with C1 (not LLM) and C2 (old hardware).
Confidence resolved: 0.85.

**Contradiction #4 — "Adaptive depth" vs the substrate.**
*Status under Path A: resolved by FSM modes.* The four modes
*are* the adaptive-depth mechanism. Build mode is shallow and
fast; Plan mode is wider and slower; Diagnose mode follows a
rooted-cause walk; Explain mode is calibration-aware. The mode
is the depth contract. The current substrate's token-shape
dispatch is replaced by explicit mode dispatch. Confidence
resolved: 0.8. Residue: the mode set itself may be wrong, in
which case adaptive depth is achieved on the wrong axes. The
architecture doc should pressure-test the mode set.

**Contradiction #5 — "Proactive reframing" vs answer-generation
mode.**
*Status under Path A: partially resolved, scope changed.* Path
A does not do proactive *reframing* (rewriting the user's
prompt). Path A does proactive *flagging* (naming the weakness
and letting the user rewrite). This is a deliberate scope cut
to stay non-LLM. The contradiction in its original form —
"reframe vs answer" — dissolves because Vai now does neither
as a primary mode; Vai does *flag, mode-route, and refuse*.
The residue: "flag without rewrite" may feel insufficient in
practice and may pull V3gga back toward wanting generative
rewrite. That pull is the same pull that introduced C3 and C4;
the comparison-shopping protection rule covers it. Confidence
resolved-with-residue: 0.7.

**Summary:** Two contradictions fully resolved (#2, #3). Two
resolved with named residue for the architecture doc to address
(#1, #4). One scope-cut rather than resolved, with the pull
back toward generative reframe explicitly named as the drift
risk going forward (#5). **No contradiction is silently
surviving Path A.**

---

## What this draft is missing

Per V3gga's instruction to mark guesses:

- I do not know V3gga's exact daily AI tool stack. The "monitor
  other models" mechanism design depends on which tools V3gga
  uses most. Best guess: VS Code with Copilot Chat (this
  conversation), Claude desktop, possibly Cursor, possibly GPT
  for second opinions. **Guess.**
- I do not know V3gga's hardware specifics. Affects reading 1's
  feasibility (cross-tool integration latency, local memory
  store size). **Open question from the prior substrate memo,
  still unanswered.**
- I do not know whether V3gga wants Vai to be eventually shippable
  to other users or remain a personal tool indefinitely. Affects
  several things including whether the Norwegian-language
  competence I cited as a Qwen 2.5 advantage actually matters.
  **Open question.**
- I am extrapolating from "Vai is special breed" into the four
  mechanisms in §"special breed claim." That extrapolation is
  mine; V3gga may have meant something else. **Flagged guess.**
- I am picking Reading 2+1-integration as the inaugural slice.
  V3gga may pick a different slice. **Flagged.**

---

## Summary (V3gga edit, accepted) **[Path A, dual-surface]**

> Vai is not a better answer-generator.
>
> Vai is the deterministic thinking interface that makes
> answer-generators usable, testable, and harder to misuse.
>
> It appears first as V3gga's personal pre-tool reasoning
> system, then later as a public product layer that wraps
> specialized generators behind a mode-driven, memory-aware,
> validation-focused core.

Confidence: 0.85 on the three-line form. The anchor phrase is
V3gga's verbatim. The third line is the citable dual-surface
expansion.
