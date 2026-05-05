# Live-session postmortem — 2026-04-28

> Six-exchange dogfooding session in the live VeggaAI app following the
> multi-turn-memory-detector handoff. Three screenshots. Six user turns.
> No fix proposals in this document. Just diagnosis.

---

## Frame

The multi-turn-memory-detector capability ships correctly. The corpus
shifted from 16/38 conversations passing to 17/38 under deterministic
conditions (`mt-context-retention-001` lifted FAIL→PASS, zero
regressions, verified across 5× runs under `--seed 42`).

Then V3gga opened the app and typed six prompts. Five of the six hit
broken responses. The detector that just shipped never fired in any of
them — every one of these turns failed before the conversation reached
a point where memory recall would have mattered.

This document walks the six exchanges and diagnoses each at the
architectural level. The Bergen exchange (Turn 1) is the most
diagnostic and gets the deepest treatment. The single-bug-vs-substrate
question is answered explicitly at the end.

---

## Exchange 1 — "Hello, who is king in norway?"

### What the engine emitted

> bergen is norway's second largest city, founded around 1070 by king
> olav kyrre. the battle of stiklestad (slaget ved stiklestad) took
> place on july 29, 1030 in nord-trøndelag, norway.
>
> - king olav haraldsson (later saint olav) fell in battle against
>   peasant army allied with cnut the great of denmark.
> - despite losing, olav became norway's patron saint his death marked
>   the pivotal moment when christianity was permanently established
>   in norway.
>
> If you need something more specific, paste the file or snippet and
> I'll answer against that directly.

### Strategy that fired

Almost certainly a token-overlap retrieval arm against the curated
knowledge store, emitting a "Norway" primer entry whose tokens score
highest against the query.

### Why that strategy fired (mechanism)

This is the substrate problem in microcosm. Walk it step by step:

1. **Tokenisation.** The query "Hello, who is king in norway?"
   tokenises to roughly `{hello, who, is, king, in, norway}`. After
   stop-list strip: `{king, norway}`.
2. **Index lookup.** The knowledge store contains primers tagged by
   the tokens they contain. Among the primers tagged with both `king`
   and `norway`, the Bergen/Olav-Kyrre/Stiklestad primer scores high
   because it literally contains the words "king" (twice — Olav Kyrre
   and Olav Haraldsson) and "norway" (multiple times).
3. **No entity resolution.** Nowhere in the pipeline is the phrase
   "king in Norway" resolved to a structured slot — `monarch_of(country)
   → Person`. There is no fact store keyed on "current monarch of
   Norway." There is a primer keyed on the *tokens* "king" and
   "norway," and that primer happens to be about an 11th-century king
   and an even-older battle.
4. **No question-shape detection.** The engine does not register that
   "who is X" is a question that requires a named individual as the
   answer. A primer that mentions a different person and never names
   the person being asked about is treated as a valid answer because
   it scores high on token overlap.
5. **No grounding gate.** No predicate runs "did this response identify
   a named individual currently holding the role asked about." The
   self-evaluation umbrella exists, but its predicates are about
   shape, not about whether the response answers the actual question.
6. **Confident emission.** The response is delivered in declarative
   prose with no hedge. The "If you need something more specific..."
   coda implies the engine believes it gave a specific answer and is
   merely offering further depth. It did not give a specific answer
   to the question that was asked.

The Bergen response is not a bug in any one component. It is the
architecture working as designed. Token overlap + primer store +
confident templated emission is, by construction, going to retrieve
the highest-overlap primer regardless of whether that primer answers
the question. The fix is not "add a Harald V fact" — that is
whack-a-mole over an unbounded fact space, with the next question
("who is the prime minister of Norway?", "who is the current
president of France?") landing in the same hole. The fix is a
different substrate.

---

## Exchange 2 — "yes I was asking for something specific... can you tell me the correct answer? and then also tell me the third and fourth word in this sentence or question?"

### What the engine emitted

> is where the stream crossing comes in um with the whole javascript
> question because this was on the grand scale this played out when
> we yank typescript out of turbo um a frontend library that worked
> on for many years we yanked it out like last year and a bunch of
> people showed up to tell me like whether that was the correct
> decision and usually they showed up to say it was not the correct
> decision...

### Strategy that fired

Token-overlap retrieval again. The query contains `{specific, correct,
answer, word, sentence, question}`. The "stream crossing / yank
TypeScript out of turbo" primer (apparently a paraphrased blog post
or talk transcript stored as a primer) scores high because it
contains "correct decision" multiple times, and the surrounding
prose registers as conversational/meta-discussion shape.

### Mechanism

Same architecture as Exchange 1. The user did not ask about
TypeScript, JavaScript, frontend libraries, or any of the topics in
the emitted primer. The primer was retrieved because its tokens
overlapped with the meta-question shape ("correct answer," "word in
this sentence"). The engine has no representation of "this is a
meta-question about the prior turn"; it has token bags and primer
indexes, and primers indexed on "correct" win.

The user's actual sub-question — "what are the third and fourth words
in this sentence" — is a structured task that the engine could solve
trivially with a literal-response arm if the input shape were detected.
It was not detected. The literal-response arm did not fire because the
input did not match its narrow regex for "Reply with exactly N words"
or similar templates.

---

## Exchange 3 — "okay then try this, tell me 10 plus eleven and minus one what is that? and then who is president us currently, reply only the president name + math result"

### What the engine emitted

> I don't have a solid answer for **okay then try** yet.

### Strategy that fired

Fallback with templated subject extraction. The fallback path takes
the first few non-stop-list tokens of the input and substitutes them
into "I don't have a solid answer for **{subject}** yet." Subject
extracted: "okay then try." The actual subject of the question — math
plus a US president lookup — was discarded.

### Mechanism

The fallback subject-extractor takes tokens left-to-right from the
input, strips stop-list, takes the first ~3 words. The user's
prefix "okay then try this, tell me..." is conversational scaffolding
to a routing engine; to the subject-extractor it is the *literal
subject* of the question. The actual two questions in the prompt —
arithmetic ("10 plus eleven minus one") and a factual lookup ("US
president currently") — are completely ignored.

This compounds two failures:

1. The engine has no concept of "this prompt contains two distinct
   sub-questions." It treats the entire input as a single shape to
   route. The math arm — which exists, deterministically, and can
   correctly compute `10 + 11 - 1 = 20` — never fires because the
   input was not classified as math.
2. When a request fails to route, the fallback emits a confident
   "I don't have an answer for X" where X is the wrong noun phrase.
   The user has no signal that the engine misunderstood; they read
   "I don't have an answer for 'okay then try'" and reasonably
   conclude the engine is broken, not that the engine misread the
   subject.

The math arm not firing on this input is fixable surgically — extend
the math regex to handle "ten plus eleven and minus one" word-form
expressions. That fix exists and would be a few dozen LOC. It would
not address the deeper issue: the prompt contained two questions, the
routing layer can only emit one answer, and "compose two arms into
one response" is not in the engine's vocabulary.

---

## Exchange 4 — "can you show me a single page html example of a 3d game that resembles hotline miami? so I can play it in the preview?"

### What the engine emitted

> **TypeScript example:**
>
> ```typescript
> interface User {
>   name: string;
>   age: number;
>   email?: string; // optional
> }
>
> function greet(user: User): string {
>   return `Hello, ${user.name}!`;
> }
>
> const user: User = { name: "Alice", age: 30 };
> console.log(greet(user)); // "Hello, Alice!"
> ```

### Strategy that fired

A "show me an example" matcher routed to a hard-coded TypeScript
canned response. The trigger was almost certainly the word "example"
plus the request shape "show me X." The output is a static fixture,
not a generated response.

### Mechanism

There is a routing arm somewhere in the dispatch chain that, on
inputs matching "show me \w+ example" or similar, emits a fixed
TypeScript User-greet snippet. The matcher does not condition on
the language requested ("html"), the topic requested ("3d game",
"hotline miami"), or the rendering target ("preview"). It conditions
on input *shape* and emits a *constant.*

This is the strongest single piece of evidence in the session for
"the engine is a token-shape router with hardcoded outputs." The
user asked for HTML and a 3D game; the engine emitted TypeScript and
an interface. The mismatch is total. There is no path by which a
matcher reading "html" and "3d game" and "hotline miami" should
produce TypeScript and a User interface, except by ignoring the
content of the request and emitting the canned response keyed on
input shape alone.

This particular arm is fixable surgically — gate the TypeScript
example arm on the word "typescript" actually appearing in the
input. That is one LOC. It would not address the broader pattern
that other arms have the same shape: matched on input *form*,
emit *constant content*, ignore the *substance* of the request.

---

## Exchange 5 — "emm so you can not make games?"

### What the engine emitted

> I don't have enough to go for **emm you can** right now — still
> building my knowledge there.
>
> We were discussing **TypeScript example** — want me to:
>
> - Go deeper on that?
> - Try a different angle?
> - Build something with it?
>
> Or if you meant something else, give me a bit more context and I'll
> take another shot.

### Strategy that fired

Conversational follow-up arm with two compounding failures:

1. **Subject extractor pulled "emm you can"** — same fallback
   subject extractor as Exchange 3, taking the first non-stop-list
   tokens of the input. "emm" (a filler the user typed) survives
   the stop-list; "so" and "not" are stripped; "make games" is
   dropped because the extractor caps at ~3 words.
2. **Conversation topic registered as "TypeScript example"** — the
   "We were discussing X" line takes its X from the prior assistant
   turn's *header text*, not from the actual conversation topic.
   The prior turn's header was the literal string "TypeScript
   example:" (from Exchange 4's hard-coded fixture). So the engine
   now believes the user wants to "go deeper on TypeScript example."

### Mechanism

There are two distinct subject-tracking systems running here and
both are wrong in the same direction. The fallback subject extractor
reads the user's current input as bag-of-words; the conversation-topic
tracker reads the assistant's prior output's header as the topic. The
user's actual conversation has been about Norway kings, TypeScript
example fixtures (unwanted), HTML 3D games (requested, not delivered),
and now whether the engine can make games at all. The engine's
internal model of the conversation is "we were discussing TypeScript
example."

This is not a memory bug — the multi-turn-memory-detector handles
recall correctly when asked. This is a *topic representation* bug:
the engine's notion of "what is this conversation about" is derived
from string fragments of its own outputs, not from any model of what
the user wants. The user typing "emm so you can not make games?" is
a clarifying question about the prior failed interaction, and the
engine reads it as a request for a deeper TypeScript dive.

---

## Exchange 6 — "This chat is not at all like perplexity+base44 and should really be better than base44... help me get there"

### What the engine emitted

A genuinely reasonable Base44-style build flow document — "Core move:
Keep chat as the front door...", followed by an interaction loop and
"Vai skills to improve" and "Failure modes to avoid." Coherent,
on-topic, useful content.

Then below it, a "RELATED" suggestions panel with two follow-up
prompts:

> - How should I structure **emm so you can not make games** in a real project?
> - What is the fastest production-ready path for **emm so you can not make games**?

### Strategy that fired

The body: a curated `taught-doc` or `curated-knowledge` arm that has
a Base44 build-flow primer indexed under tokens like {base44,
perplexity, build, chat, ...}. This arm is doing what the rest of
the engine could in principle do — retrieving a coherent,
on-topic primer and emitting it.

The RELATED panel: an auto-follow-up generator that template-substitutes
prior conversation subjects into question stems. The substituted
subject is "emm so you can not make games" — i.e., the broken bag-of-
words subject from Exchange 5, copy-pasted verbatim into the
follow-up prompt template.

### Mechanism

Two observations:

1. **The engine is capable of correct retrieval** when the user's
   request happens to have a high-quality primer with good token
   overlap. The Base44 response is evidence of this. The substrate
   is not incapable — it is *non-discriminating*. When a query
   matches a good primer, the response is good. When a query
   matches a bad primer (Bergen on "king Norway"), the response is
   bad. The engine cannot tell the difference because it has no
   model of "is this primer actually answering the question."
2. **Failures cascade through the conversation state.** The broken
   subject extracted from Exchange 5 is now embedded in the
   follow-up suggestions of Exchange 6. The engine has no
   self-correction mechanism that says "the prior subject extraction
   produced gibberish, do not propagate it forward." Bad state
   propagates forward and gets surfaced in the UI as authoritative
   suggestions.

---

## Single-bug vs substrate

V3gga's instruction: if a single specific bug explains all six
exchanges and is fixable in <50 LOC, say so loudly with high
confidence. Otherwise diagnose the substrate honestly.

**It is not a single bug.** Confidence: 0.95.

The exchanges break down into three distinct failure classes:

| Failure class | Exchanges | Surgical fix possible? |
|---|---|---|
| Token-overlap retrieval emits unrelated primer | 1, 2 | No — this is the retrieval architecture |
| Subject extractor produces wrong noun phrase | 3, 5 (and propagates to 6) | Yes for the math arm; no for the general extractor |
| Hardcoded constant arm emits canned content ignoring substance | 4 | Yes for the specific TypeScript fixture; no for the pattern |
| Topic tracker reads assistant header as conversation subject | 5 | Yes, narrowly |
| Bad state propagates forward without self-correction | 5 → 6 | No — this is the state architecture |

A surgical patch session targeting Exchange 3's math regex,
Exchange 4's TypeScript-example gate, and Exchange 5's topic-tracker
source would land in <50 LOC and make those three exchanges look
better. **It would not change Exchange 1, Exchange 2, or the RELATED
panel of Exchange 6.** The substrate-level failures — token-overlap
retrieval over a primer store with no question-shape detection and no
grounding gate, plus state that propagates bad subject extractions
forward — are the architecture, not bugs.

The honest diagnosis is what V3gga said in the prompt: the corpus had
been signalling this for ten turns. The live session compressed those
ten turns of signal into 90 seconds of irrefutable evidence. The
detector that just shipped works correctly and does not matter,
because users will rarely reach the conversation depth at which
multi-turn memory becomes the hot path. The first three turns will
either land cleanly on a high-quality primer (Exchange 6's body) or
land on Bergen / TypeScript-fixture / "okay then try" (Exchanges 1,
2, 3, 4, 5).

The substrate is the right scope of question now. The capability list
is not.

---

## What was right about the foundation work

This section exists because V3gga said it explicitly in the prompt
and it would be dishonest to omit it. The corpus + determinism +
self-eval umbrella + dogfooding gate did exactly the job they were
designed for. Without them the screenshots feel like "the bot is
dumb." With them the screenshots feel like "the engine is the wrong
substrate, and we know why each of the six failures happened, and we
can name the three failure classes precisely." That diagnostic
vocabulary is what makes the substrate decision possible. The
foundation is not throwaway. The strategy router and the curated
primer store almost certainly are. The substrate memo's "Live
evidence" addendum picks up from here.
