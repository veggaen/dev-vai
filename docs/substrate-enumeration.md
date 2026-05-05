# Substrate enumeration

> Part 1 of a three-document substrate decision. Pauses for V3gga's
> read before Part 2.
>
> Goal: enumerate every non-LLM architecture for AI assistants
> seriously built or proposed in the last ~30 years. For each: where
> it wins, where it fails, whether the Bergen exchange is in its
> strength set, hardware floor, whether the existing corpus and
> foundation work transfer, confidence in the assessment, and what
> Vai-on-this-substrate would feel like as a product.
>
> Honesty constraints (V3gga's words, copied for accountability):
> "If during enumeration you find a substrate I should know about
> that I haven't named, surface it." "If the list is empty, say so.
> Don't manufacture options to fill it."
>
> Confidence labels used: 0.9+ = "I'd defend this in a review";
> 0.7–0.9 = "well-supported but not definitive"; 0.5–0.7 = "informed
> guess"; <0.5 = "I'm extrapolating from limited evidence."

---

## Reading the Bergen test

Throughout this document, "Bergen test" is shorthand for: would this
substrate, on the question "Hello, who is king in norway?", emit an
answer that names the actual current monarch (Harald V) instead of a
token-overlap fragment about Bergen, Olav Kyrre, or the battle of
Stiklestad?

The Bergen test is a stand-in for the broader category: open-ended
factual questions where the substrate must (a) recognise the question
shape, (b) resolve the entity asked about, (c) retrieve the correct
fact from somewhere, (d) emit a focused answer. The current substrate
fails at step (a). Most of the substrates below pass at (a) and (d)
trivially; the discriminator is whether they have the right kind of
data store to pass (b) and (c).

A "Bergen pass" is not the same as "passes for every factual question
ever." It means the substrate has the architectural shape to handle
the entity-resolution category at all, given the right data.

---

## 1. Rule-based expert systems

**One-line:** Hand-written `if-condition-then-conclusion` rules
chained by a forward- or backward-chaining inference engine over a
domain-specific knowledge base. MYCIN (medical diagnosis), DENDRAL
(chemistry), R1/XCON (DEC computer configuration).

**Strengths:**
- Auditable reasoning chains. You can trace why a conclusion was
  reached, rule by rule.
- Deterministic. Same inputs + same rule base = same conclusion.
- Excellent on narrow, well-bounded expert domains where the
  decision rules are explicitly elicitable from a domain expert.
- Cheap at runtime. A rule chain over a few thousand rules is
  microseconds.

**Weaknesses:**
- Knowledge acquisition bottleneck. Every rule has to be written by
  a human. The MYCIN corpus had ~600 rules covering one disease
  category and took years of expert time to build.
- Brittle outside the rule set. Anything not anticipated in the
  rules either fails to fire or fires wrong rules.
- Combinatorial explosion when rules interact. The 1980s expert-
  system winter happened largely because rule bases past ~10K rules
  became unmaintainable.
- Cannot handle natural language input directly. Needs a separate
  NLU layer.

**Bergen test:** Neither strength nor weakness. The substrate could
pass Bergen if (a) it had a rule "monarch_of(Norway, Harald V) since
1991", (b) it had an NLU layer that translated "who is king in
norway" to `query: monarch_of(Norway, ?)`. The substrate is not the
limiting factor; the data is. Confidence: 0.85.

**Hardware floor:** Trivial. Runs on a Raspberry Pi. Confidence: 0.95.

**Corpus transfer:** Partial. The corpus's `must`/`must_not` predicate
shape maps cleanly onto rule-base assertions about expected outputs.
The conversational/prose-form turns in the corpus don't map well
because expert systems don't naturally produce prose. Confidence: 0.75.

**Foundation transfer:**
- Determinism: native fit, better than the current substrate.
- Predicates: rules *are* predicates. Self-eval umbrella becomes a
  rule-validation layer.
- Dogfooding gate: applies cleanly.
- Thorsen doctrine: applies cleanly; the doctrine's "deterministic
  + auditable + bounded scope" lines up exactly with what expert
  systems are good at.
- Confidence: 0.9.

**Product feel:** A diagnostic / decision-support tool. Vai becomes
"the thing you ask when you have a structured question in a domain
the rule base covers." Closer to a regulatory compliance assistant or
a code-review checklist tool than to a general assistant. Bergen
question gets a "this is outside Vai's domain" response, which is
honest.

**Verdict:** **Viable for narrow expert domains.** Non-viable as a
general assistant. The knowledge acquisition cost is the gating
constraint; for a one-person project, you can author rules for one or
two domains, not the whole world.

---

## 2. Symbolic / formal-logic reasoners (Prolog-shaped, theorem prover-shaped)

**One-line:** Express knowledge as logical clauses (Horn clauses in
Prolog, first-order logic in theorem provers) and answer queries by
unification and resolution. Prolog, Datalog, ACL2, Coq, Lean.

**Strengths:**
- Mathematically rigorous. If the axioms are correct, the conclusions
  are provably correct.
- Natural fit for transitive reasoning. "X is Y's parent, Y is Z's
  parent, therefore X is Z's grandparent" is one clause.
- Excellent for constraint problems, scheduling, type checking,
  formal verification.
- Datalog scales to large fact bases (millions of tuples).

**Weaknesses:**
- Requires the world to be axiomatisable. Most real-world domains
  resist clean axiomatisation. "King of Norway" is fine; "is this
  code idiomatic" is not.
- Negation is hard (closed-world vs open-world assumption matters).
- Performance cliffs on poorly-written clauses. Prolog's depth-first
  search can loop forever or explode exponentially.
- Natural-language input layer is a separate problem the substrate
  doesn't solve.

**Bergen test:** Strength, given data. A Prolog database with
`monarch_of(norway, harald_v, 1991, ongoing).` plus a query parser
that maps "who is king in X" to `monarch_of(X, ?, _, ongoing)` passes
Bergen cleanly. The substrate isn't the limit; the database population
and the query parser are. Confidence: 0.85.

**Hardware floor:** Trivial for small fact bases. Datalog over
millions of facts wants more RAM but still runs on consumer hardware.
Confidence: 0.9.

**Corpus transfer:** Partial. Corpus turns that express factual
queries map cleanly to Prolog queries. Conversational/prose corpus
turns don't map. Confidence: 0.7.

**Foundation transfer:**
- Determinism: native.
- Predicates: the substrate *is* predicates. Self-eval becomes
  redundant in the answer-generation path; useful for input parsing.
- Dogfooding: applies.
- Thorsen doctrine: applies; "auditable + provable" is even tighter
  than "deterministic + bounded."
- Confidence: 0.85.

**Product feel:** A query tool over a structured knowledge base.
Vai becomes "ask precise questions, get precise answers, no
hedging." Strong on facts that fit relational shape. Useless for
"explain this code" or "draft a plan." Bergen question would work if
the database has the fact; answer would be terse.

**Verdict:** **Viable for fact-query and constraint domains.** Non-
viable as a general assistant for the same reason as expert systems.
The query parser is the new hard problem this substrate creates.

---

## 3. Knowledge graph + structured query (Wikidata, DBpedia, Neo4j)

**One-line:** A graph database of entities and typed relationships,
queried by SPARQL, Cypher, or similar. Facts are first-class triples:
`(harald_v, hasPosition, monarch_of_norway)`. Wikidata is the largest
public example (~100M entities, ~1B statements).

**Strengths:**
- Designed exactly for "who is the X of Y" questions. Bergen test is
  the *paradigm case* for this substrate.
- Wikidata is freely available, well-maintained, multilingual,
  updated daily by a community. Harald V's page on Wikidata is
  current. The fact "Harald V holds the position of monarch of
  Norway" is queryable in one SPARQL line.
- Federated: can query across multiple knowledge graphs.
- Determinism: same query + same database snapshot = same answer.

**Weaknesses:**
- Coverage is excellent for famous entities, sparse for niche or
  recent topics.
- Natural-language-to-SPARQL is itself a research problem. The
  current academic solutions are LLM-based; pre-LLM systems used
  template-matching with mediocre accuracy (60–75% on benchmarks
  like LC-QuAD).
- The triple representation handles "who is king of Norway" but not
  "explain how monarchies work" or "draft a constitutional brief."
- Local hosting: a Wikidata mirror is ~150GB on disk for the
  truthy-statements subset. Full dump is ~2TB. The full graph is
  not "old hardware" friendly. A *subset* covering, say, world
  leaders + countries + companies + universities fits in <1GB.

**Bergen test:** Strength, native. Confidence: 0.95.

**Hardware floor:** Depends on graph size. A curated subset of
Wikidata (1–10GB) with a local SPARQL endpoint runs on consumer
hardware. The full Wikidata is not for old hardware. Confidence: 0.85.

**Corpus transfer:** Partial. Corpus turns that ask factual questions
about world entities transfer well. Code questions, conversational
turns, planning turns don't. Confidence: 0.65.

**Foundation transfer:**
- Determinism: native (assuming pinned graph snapshot).
- Predicates: useful as input parsers and output validators.
- Dogfooding: applies.
- Thorsen doctrine: applies cleanly.
- Confidence: 0.85.

**Product feel:** A focused factual-query tool. "Vai, who is the CEO
of Toyota?" gets answered correctly with a citation to the Wikidata
entity. "Vai, write me a Hotline Miami clone in HTML" gets a "Vai
answers structured factual questions; this is outside scope" reply.
Closer to a desktop Wolfram Alpha or DuckDuckGo Instant Answers than
to Perplexity.

**Verdict:** **Viable for factual-question scope.** The natural-
language-to-query layer is the gating problem. If that layer is
template-based, accuracy plateaus at ~70%. If it requires an LLM,
you're back to the LLM substrate question. There is a third option —
constrained input grammar where the user types structured queries
directly — which is the Narrow-Scope answer applied to factual
questions specifically.

---

## 4. Information retrieval over indexed corpora (Lucene/Elasticsearch, no LLM)

**One-line:** TF-IDF or BM25 retrieval over a document corpus,
returning the most relevant document(s) ranked by token overlap with
the query. The architecture behind pre-2020 enterprise search and
older versions of Google/Bing.

**Strengths:**
- Mature, fast, scales to millions of documents on consumer hardware.
- Excellent at "find me the document that mentions these terms."
- Deterministic (given pinned index + query).
- BM25 is a strong baseline that holds up against many learned
  retrieval methods.

**Weaknesses:**
- Returns *documents*, not *answers*. The user has to read the doc
  and extract the answer themselves.
- Vulnerable to lexical mismatch: "king" vs "monarch" vs "ruler"
  retrieves different docs unless query expansion is layered on.
- This is exactly what the current Vai substrate is doing wrong on
  Bergen — emitting the highest-scoring doc as if it were the
  answer.

**Bergen test:** Weakness. Returning the Bergen primer as the top
hit for "who is king in norway" is the *expected* behaviour of a
pure IR system. To pass Bergen, you need entity extraction on top of
retrieval, which is no longer "pure IR." Confidence: 0.95.

**Hardware floor:** Trivial for <1M docs. Confidence: 0.95.

**Corpus transfer:** The corpus is conversational, not document-
shaped. Doesn't map. Confidence: 0.8.

**Foundation transfer:** Determinism and dogfooding apply; predicates
become document-level relevance gates which is a known-hard problem.
Confidence: 0.7.

**Product feel:** Vai becomes a search engine over a curated corpus.
"Find me the document about X" works; "answer my question about X"
returns the document, not the answer. This is what Vai already is,
without the templating that pretends it's giving direct answers.

**Verdict:** **Non-viable as the primary substrate.** This is
basically the current Vai with the templating veneer removed —
honestly returning "here's the most relevant document I have" instead
of pretending to answer. Could be a *component* of another substrate
(retrieval feeds something else that turns docs into answers) but
not a substrate on its own.

---

## 5. Hybrid retrieval-and-template systems (Siri/Alexa-shaped circa 2015)

**One-line:** Intent classifier on the input → entity slot extraction
→ dispatch to a hand-written skill handler → templated response.
"Hey Siri, what's the weather?" → intent=`get_weather`, slot=`location:
current_gps` → call weather API → fill template "It's {temp}° and
{condition} in {city}."

**Strengths:**
- The current production solution for voice assistants for ~10 years.
- Determinism is good when intents are correctly classified.
- Composable: each new skill is a new intent + handler.
- Predictable latency.

**Weaknesses:**
- Intent classifier is the bottleneck. Misclassified intents
  produce wrong-skill responses (Exchange 4's TypeScript-fixture-
  on-Hotline-Miami is exactly this failure mode).
- Long tail of intents is unbounded; you ship the top 100 and the
  101st query feels broken.
- Slot extraction is brittle on naturalistic input.
- Multi-intent queries (Exchange 3's "math + president" combo)
  require explicit multi-intent support which is rare.

**Bergen test:** Pass if `monarch_of_country` is one of the named
intents and Norway resolves as a slot, and the handler queries a fact
source. Fail otherwise. Effectively this reduces to "do you have a
knowledge graph behind the handler?" — see substrate #3. Confidence:
0.85.

**Hardware floor:** Trivial. Confidence: 0.95.

**Corpus transfer:** The corpus's per-turn `must`/`must_not`
predicates map well to per-intent regression tests. Confidence: 0.8.

**Foundation transfer:** Strong. Each intent is a capability;
handoff protocol applies per-intent; dogfooding per intent; Thorsen
doctrine fits. The current Vai substrate is *almost* this shape — it
has handlers and dispatch — but without explicit intent declaration
and slot extraction. Confidence: 0.85.

**Product feel:** A command-style assistant. "Vai, weather", "Vai,
calc 10+11-1", "Vai, build me a vite react app". Feels like a
command palette with a chat UI on top. Bergen question only works
if there's a `who_is_X_of_Y` intent and a fact source behind it.

**Verdict:** **Viable as a successor to the current substrate** if
the failure-mode lessons from the live session are taken seriously
(explicit intents instead of token-pattern routing; explicit "no
intent matched" responses instead of fallback subject extraction;
no hardcoded fixtures emitted from shape-only matchers). This is
essentially the Narrow-Scope option from the prior pivot doc, with
Siri's name on it for honesty about lineage. Worth surfacing as its
own line because the *intent-explicit* version is a real
architectural change from the current shape, not just UI rebadging.

---

## 6. Cognitive architectures (SOAR, ACT-R)

**One-line:** Architectures based on cognitive psychology research,
modelling working memory + long-term memory + production rules +
goal stacks. SOAR (Carnegie Mellon, 1983–present) and ACT-R (also
CMU, 1993–present) are the two living examples.

**Strengths:**
- Models human-like reasoning steps, including learning from
  experience (chunking in SOAR, base-level activation in ACT-R).
- Compositional: complex behaviours built from primitive operators.
- Used in real applications: pilot training simulators, intelligent
  tutoring systems, military planning aids.
- Determinism is achievable at the operator level.

**Weaknesses:**
- Steep learning curve. Both architectures are essentially research
  platforms; documentation is academic.
- Knowledge engineering bottleneck even worse than expert systems
  because you're encoding *cognitive operators* not just facts.
- Production deployments outside research labs are rare.
- No commercial maintenance pressure; the implementations move
  slowly.

**Bergen test:** Could pass with the right knowledge encoding (a
declarative memory chunk for "Harald V is the current monarch of
Norway") plus a production that fires on "who is X" queries.
Effectively the same situation as expert systems plus more
infrastructure. Confidence: 0.65.

**Hardware floor:** Modest. SOAR and ACT-R run on consumer hardware.
Confidence: 0.8.

**Corpus transfer:** Weak. The corpus is response-shaped; cognitive
architectures are reasoning-step-shaped. You'd need a different
evaluation framework. Confidence: 0.65.

**Foundation transfer:** Mixed. Determinism: yes. Predicates: yes,
as goal-test functions. Dogfooding: yes. Thorsen doctrine: yes in
spirit, but the architecture's complexity may swamp the discipline
the doctrine is supposed to provide. Confidence: 0.55.

**Product feel:** A research-grade reasoning assistant. Vai becomes
"the thing you teach a procedure to and then watch it execute the
procedure on new inputs." Closer to an intelligent tutoring system
than to anything in the current AI assistant landscape.

**Verdict:** **Research-only.** SOAR and ACT-R are real and capable,
but the practical engineering cost of building a consumer product on
them is high enough that no one has done it commercially in 30
years. That's not nothing — that's strong negative evidence. Surface
for completeness; don't recommend.

---

## 7. Neuro-symbolic systems (small neural components + symbolic reasoning)

**One-line:** Combine learned components (for perception, parsing,
or pattern-matching) with symbolic reasoners (for logic and
composition). Examples: DeepMind's AlphaProof (theorem proving with
learned heuristics), IBM's Logical Neural Networks, MIT's Scallop.

**Strengths:**
- Learned components handle the "messy input" problem (parsing
  natural language, handling typos) that pure symbolic systems
  struggle with.
- Symbolic core handles composition and explainability.
- Active research area; results are improving year-over-year.

**Weaknesses:**
- The "small neural component" varies wildly in size. Some
  research systems use 10M-parameter networks, some use 1B+. The
  product implications differ by an order of magnitude.
- Engineering tooling is immature. No production-ready
  off-the-shelf framework.
- Training the neural component requires a labelled dataset that
  doesn't exist for most domains.

**Bergen test:** Could pass with a learned NL→SPARQL parser plus a
knowledge graph backend. This is essentially "use a small neural
network for the question parser and a symbolic store for the
answer," which is a real architecture pattern. Confidence: 0.7.

**Hardware floor:** Depends on the neural component size. A 50M-
parameter learned parser runs on CPU at acceptable latency. Anything
above 1B starts hitting LLM-substrate territory. Confidence: 0.6.

**Corpus transfer:** Partial. Could be used to train the neural
parser if it's small enough. Confidence: 0.55.

**Foundation transfer:** Mixed. Determinism: lost in the neural
component, recoverable in the symbolic part. Predicates: useful as
output gates. Dogfooding: applies. Thorsen doctrine: harder to
apply to the neural component (auditability is weak by construction).
Confidence: 0.55.

**Product feel:** A "smart but not creative" assistant. Could be the
right shape for a Vai-as-knowledge-tool product if the parser
component can be kept small. Bergen passes; "write me a poem" fails
explicitly.

**Verdict:** **Viable in principle, not in practice for a one-
person project.** Tooling immaturity is the gating constraint. Worth
revisiting in 18–24 months as the open-source neuro-symbolic stack
matures. For the current decision, treat as research-only.

---

## 8. Pure programmatic agents with hand-built skill modules (current Vai)

**One-line:** A dispatch chain over hand-written skill handlers
indexed by input shape. Each handler emits its response from a
template or a primer. The current Vai substrate.

Listed for honesty per V3gga's instruction. The live-session
postmortem characterises this substrate exhaustively. The
verdict is unchanged: viable for narrowly-scoped workflow tools,
non-viable as a general assistant. Bergen test fail is the
defining property. Confidence: 0.95.

**Hardware floor:** Trivial. Confidence: 0.95.

**Corpus transfer:** Native. Confidence: 0.95.

**Foundation transfer:** Native. Confidence: 0.95.

**Product feel:** Documented in the live-session postmortem and
the pivot-options Narrow-Scope section. Repeated here only to
establish this substrate as one row in the enumeration, not the
default.

**Verdict:** **Viable for narrow workflow scope only.** Already
the substrate. Listed to make explicit that "stay on current
substrate" is one option in the enumeration, evaluated by the same
criteria as the others.

---

## 9. Embedding-based semantic search with structured response templates

**One-line:** Index documents (or facts, or response templates) by
sentence embeddings from a small embedding model (~100M parameters
or less, e.g. all-MiniLM-L6-v2). Query is embedded, nearest-neighbour
search returns top matches. Optionally, structured templates fill
from the matched document's metadata.

**Strengths:**
- Solves the lexical-mismatch problem of pure IR ("king" matches
  "monarch", "ruler" matches "leader").
- Embedding models in the 22M–100M parameter range run on CPU at
  sub-100ms latency.
- Determinism is preserved (same embedding model + same index =
  same nearest neighbours).
- Mature tooling: sentence-transformers, FAISS, hnswlib all
  cross-platform and CPU-friendly.

**Weaknesses:**
- Still returns documents, not entity-resolved answers. Better at
  the retrieval step than substrate #4, equally bad at the
  answer-extraction step.
- Embedding models trained on general web text don't necessarily
  embed factual questions well. "Who is king of Norway?" and "What
  Norwegian monarchical history exists?" might embed similarly,
  retrieving the same Bergen primer.
- Quality of the answer depends entirely on what's in the index;
  curation problem doesn't go away.

**Bergen test:** Marginal improvement over substrate #4 but same
fundamental failure mode. The Bergen primer would still be a
high-similarity match for the king-of-Norway query if it's the only
Norway-related document in the index. Pass requires a *fact-shaped*
index ("Harald V is the current King of Norway" as an indexed
sentence) plus a query-to-fact-mapping that recognises the query's
factual intent. Confidence: 0.7.

**Hardware floor:** ~500MB resident for a small embedding model + a
modest index. Comfortable on consumer hardware. Confidence: 0.85.

**Corpus transfer:** Partial. Corpus turns can be embedded for
similarity-based test selection but the response generation doesn't
transfer. Confidence: 0.65.

**Foundation transfer:** Determinism preserved. Predicates apply
as output gates. Dogfooding applies. Thorsen doctrine applies.
Confidence: 0.8.

**Product feel:** A semantic search tool with templated summary
output. Better than substrate #4 because it handles synonyms and
paraphrase; same as substrate #4 in that it returns "what we have
about X" not "the answer to X." Bergen still fails unless the
index is fact-shaped, in which case it converges with substrate #3.

**Verdict:** **Viable as a component, non-viable as a substrate.**
Embedding-based retrieval is a tool, not an architecture. Layer it
under any of substrates 1, 2, 3, 5, 7, or 10 to improve their
retrieval steps; on its own it doesn't constitute a complete
assistant.

---

## 10. Constraint-satisfaction and planning systems (PDDL, CSP solvers)

**One-line:** Express problems as constraints (CSP: "schedule these
8 tasks subject to these dependencies and resource limits") or
planning domains (PDDL: "given current state, goal state, and
available actions, find the action sequence that reaches the goal").
Solvers are mature, well-studied, fast on small instances.

**Strengths:**
- Optimal for problems that fit the constraint or planning frame.
- Deterministic, complete (will find a solution if one exists,
  given enough time).
- Excellent for scheduling, resource allocation, dependency
  resolution, build planning.

**Weaknesses:**
- The world has to be modeled as constraints or actions/states.
  Most natural-language queries don't fit.
- Modelling effort per problem is high.
- Performance cliff on large instances (NP-hard problems are
  NP-hard).

**Bergen test:** Neither strength nor weakness; the question doesn't
fit the frame. A planning system can't answer "who is king of
Norway" because it's not a planning problem. Confidence: 0.9.

**Hardware floor:** Trivial for small instances; large CSPs need
RAM. Confidence: 0.85.

**Corpus transfer:** Weak. The corpus is response-shaped; planning
systems are state-transition shaped. Confidence: 0.7.

**Foundation transfer:** Determinism: yes. Predicates: useful as
goal-test functions. Dogfooding: yes. Thorsen doctrine: yes.
Confidence: 0.8.

**Product feel:** A specialist tool for planning and scheduling
domains. Vai becomes "the thing you give a build constraint set to
and ask for a deployment plan." Useless for general questions. Could
be a *Builder mode component* in a larger system but not the whole
substrate.

**Verdict:** **Viable as a component for a workflow tool, non-viable
as a general substrate.** Same shape as substrate #9: useful piece,
not a complete architecture.

---

## 11. Case-based reasoning (CBR) systems

**One-line:** Solve new problems by retrieving similar past cases
from a case library and adapting their solutions. A 1990s AI
research paradigm with continuing applications in legal reasoning,
medical diagnosis support, and helpdesk automation.

Surfacing this because V3gga didn't list it and it's directly
relevant: CBR is "retrieve a past case, adapt its solution." This is
*structurally similar* to the current Vai substrate (retrieve a
primer, emit it) but with the critical difference that CBR has an
explicit *adaptation* step where the retrieved case is modified to
fit the new problem. The current Vai does retrieval-then-emit; CBR
does retrieval-then-adapt-then-emit. The adaptation step is what
distinguishes "answer about Bergen" from "answer about the question
that was actually asked."

**Strengths:**
- Honest about being retrieval-based; the architecture *expects*
  the retrieved case to need adaptation, which forces the
  adaptation step to be explicit.
- Good fit for domains where new problems resemble old ones with
  parametric variations (legal precedents, medical cases, helpdesk
  tickets).
- Deterministic given pinned case base.

**Weaknesses:**
- The adaptation step is hand-coded and is the hard part. For
  parametric variations it's tractable; for genuinely novel cases
  it fails the same way expert systems do.
- Case-base curation is the new knowledge-acquisition bottleneck.
- Quality depends on case-base coverage of the problem space.

**Bergen test:** Marginal pass. If the case base contains
"who-is-monarch-of-X" cases for several countries with structured
answer slots, the adaptation step can fill in "Norway" → "Harald V"
correctly. Without that case template, it falls back to the same
retrieval failure as substrate #4. Confidence: 0.6.

**Hardware floor:** Trivial. Confidence: 0.9.

**Corpus transfer:** The corpus *is* a case base. Each turn is a
case. The corpus could be the case library directly. Confidence:
0.75.

**Foundation transfer:** Strong. The handoff protocol's pre-code
audit maps onto "adaptation rule auditing" cleanly. Determinism:
yes. Predicates: useful for adaptation validation. Dogfooding: yes.
Thorsen doctrine: applies. Confidence: 0.8.

**Product feel:** "Show me a case like mine and the answer that
worked there, adapted for my specifics." Useful for templated
domains (legal advice, code review patterns, debugging). Bergen
test marginal. Closer to a knowledge-management tool than to a chat
assistant.

**Verdict:** **Viable for case-template domains.** Worth surfacing
because it's the closest formal architecture to what the current
Vai substrate is *trying* to do, and it includes the missing piece
(explicit adaptation step) that the current substrate lacks. If the
choice is "make the current substrate honest about what it is,"
making it a CBR system is a more architecturally coherent move than
patching individual handlers.

---

## 12. Frame-based / slot-filling systems

**One-line:** Knowledge represented as frames (Minsky 1974), each
with named slots that hold values, defaults, or procedural
attachments. Modern reincarnation: schema.org, JSON-LD. The data
model behind structured data on the web.

Surfacing this because it's the lightest-weight substrate that
passes Bergen cleanly and isn't usually mentioned alongside the
heavyweights above.

**Strengths:**
- Very simple data model: entities have typed slots.
- A `Country` frame with a `currentMonarch` slot, populated for
  Norway with a `Person` frame for Harald V, passes Bergen
  trivially.
- Schema.org-style data is widely available and structured.
- Fits cleanly with TypeScript's type system; no special runtime
  needed.

**Weaknesses:**
- Schema design is a hard problem. What slots does a `Country`
  have? A `Person`? Recursion and edge cases (regents, contested
  monarchies, recent successions) require schema flexibility that
  frames don't naturally provide.
- Coverage problem: someone has to fill the slots for every entity.
- No reasoning beyond slot lookup unless layered with rules
  (substrate #1) or logic (substrate #2).

**Bergen test:** Pass with curated frames. Confidence: 0.85.

**Hardware floor:** Trivial. Confidence: 0.95.

**Corpus transfer:** Partial. Corpus turns can have expected-frame
predicates for evaluation. Confidence: 0.65.

**Foundation transfer:** Strong. Schemas as types fit the existing
TypeScript codebase. Determinism: yes. Predicates: yes.
Confidence: 0.85.

**Product feel:** A structured-data lookup tool with a chat-shaped
interface. Like substrate #3 but with a custom curated schema
instead of Wikidata. Could be combined with substrate #5 (intent
classifier dispatches to slot-fill queries) for a more flexible
product.

**Verdict:** **Viable as a backing data store** for a substrate-
hybrid product. Doesn't constitute a complete substrate alone; pairs
naturally with substrate #5 (intent classifier on top, frame store
underneath) to make a complete architecture.

---

## Summary table

| # | Substrate | Bergen | HW floor | Corpus xfer | Foundation xfer | Verdict | Conf |
|---|---|---|---|---|---|---|---|
| 1 | Rule-based expert system | data-dependent | trivial | partial | strong | viable narrow | 0.85 |
| 2 | Symbolic logic reasoner | data-dependent | trivial | partial | strong | viable narrow | 0.85 |
| 3 | Knowledge graph (Wikidata-shaped) | **pass** | low–mod | partial | strong | viable, NL→query is the gate | 0.85 |
| 4 | IR over indexed corpus | **fail** (current shape) | trivial | weak | partial | non-viable alone | 0.9 |
| 5 | Hybrid intent + skill (Siri-shape) | data-dependent | trivial | strong | strong | viable, intent-explicit version | 0.85 |
| 6 | Cognitive architecture (SOAR/ACT-R) | data-dependent | modest | weak | mixed | research-only | 0.6 |
| 7 | Neuro-symbolic | possible | mod–high | partial | mixed | research-only for one person | 0.6 |
| 8 | Current Vai (programmatic agent) | **fail** | trivial | native | native | viable narrow only | 0.95 |
| 9 | Embedding semantic search | marginal | low–mod | partial | strong | component, not substrate | 0.75 |
| 10 | CSP / planning | n/a | trivial | weak | strong | component for workflows | 0.85 |
| 11 | Case-based reasoning | data-dependent | trivial | strong | strong | viable, current substrate's honest cousin | 0.75 |
| 12 | Frame-based / schema.org | **pass** with curation | trivial | partial | strong | backing store, pairs with #5 | 0.85 |

---

## Substrates I considered and excluded

- **Genetic / evolutionary algorithms.** Optimisation framework, not
  an assistant architecture.
- **Bayesian networks.** A reasoning component, like substrates 9
  and 10. Useful inside something else; not a complete substrate.
- **Markov chains / n-gram models.** Pre-LLM language models. The
  Bergen failure mode would be worse, not better.
- **Hidden Markov Models / classical statistical NLP.** Components
  for parsing or tagging; not substrates.
- **Reinforcement learning agents.** Designed for sequential
  decision-making with reward signals; not a Q&A architecture.
- **Decision trees / random forests / gradient-boosted trees.**
  Classifiers; component-level.
- **Pure RAG (retrieval-augmented generation).** Requires a
  generator, which in modern usage is an LLM. Without an LLM
  generator, RAG collapses to substrate #4 or #9.

If V3gga thinks one of these warrants its own row, name it and I'll
expand.

---

## Composite observations

Three patterns surface across the enumeration:

**1. Bergen-passing substrates split into two camps.** Knowledge
graphs (substrate 3) and frame-based stores (substrate 12) pass
because they have entity-resolved data models. Logic systems (1, 2)
and CBR (11) pass *if* their backing data is shaped for entity
resolution. The other substrates either don't pass or pass only when
they're effectively wrapping one of the entity-resolved ones. The
discriminator is the data model, not the inference engine.

**2. The "natural-language input" problem is shared across all of
them.** Every substrate above either ducks the NL input problem (by
requiring structured queries from the user) or solves it with a
small learned component (substrate 7, neuro-symbolic) or a hand-
coded parser (substrate 5, intent classifier). There is no Bergen-
passing substrate in the list that handles arbitrary natural
language input *and* is non-LLM *and* runs on consumer hardware
*without* either constraining the input grammar or training a small
learned parser. That's a real constraint, not a hedge.

**3. The current Vai substrate's failure mode is *retrieval-without-
adaptation*, which CBR (substrate 11) is the most coherent
non-LLM successor for.** If the call ends up being "rebuild on a
non-LLM substrate that preserves what works in Vai today," CBR with
explicit adaptation rules is closer to home than knowledge graphs
or logic systems. That's not a recommendation — V3gga said no
recommendations — but it's an observation the table doesn't surface
on its own.

---

## What this document does not do

- Does not pick a substrate. Decision is V3gga's after Parts 2 and 3.
- Does not assume the idea (Part 2 will write that down).
- Does not assume which constraints bind hardest (Part 3 will check).
- Does not assume the corpus we have is the right corpus. If the
  product changes shape, the corpus shape may change with it.

Pausing here for V3gga's read before drafting Part 2.
