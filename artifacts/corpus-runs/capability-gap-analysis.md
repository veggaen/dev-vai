# Capability Gap Analysis — Cycle 2

**Run:** seeded `--seed 42`, deterministic engine.
**Score:** 33 / 57 turns pass · 16 / 38 conversations pass · 22 conversations fail · 4 cases skipped (`expected_status: pending-feature`).
**Determinism proof:** three runs, identical content-only SHA256 = `D2B6E676A343AD0F0E924A7109E74AFBB4886868027A6A1127D334105D9EB6C1`.

This document attributes each failing case to a missing **capability** (not a regex flake, not a routing patch, not a fixture issue). The decision about which capabilities to invest in next is **explicitly left to the user** — this file does not recommend a build order.

Confidence column meaning:
- **high** — observed output makes the missing capability self-evident; further evidence unlikely to change the attribution.
- **med** — strong signal but a second possible cause exists (e.g. routing miss vs. capability miss).
- **low** — failure mode is ambiguous; could be capability gap or could be a layer above (regex, gating, hijack). Worth re-examining after one round of routing fixes.

---

## Per-case classification

| # | Case ID | Observed engine output (one-line) | Capability missing | Capability bucket | Build cost | Confidence |
|---|---|---|---|---|---|---|
| 1 | `cog-calibrated-uncertainty-001` | "I don't have a solid answer for **What next-door neighbor's**…" — generic fallback boilerplate, no admission of unknowability | recognise that some questions are **structurally** unknowable to the system (other people's private facts) and refuse with a direct "I have no way of knowing" rather than a templated stall | calibrated uncertainty | M | high |
| 2 | `cog-calibrated-uncertainty-002` | hijacked to a CSS / writing primer ("static assets are cached at the nearest point of presence…") | distinguish **fictional / unknown entities** ("zorbinium-7") from real ones; refuse with "not a known substance" instead of fuzzy-matching to nearest knowledge entry | calibrated uncertainty + entity-realness check | M | high |
| 3 | `cog-counterfactual-001` | "I don't know about **alarm hadn't gone**…" — fallback boilerplate on conditional reasoning | parse counterfactual conditionals ("if X had not happened, Y would have happened — but X did happen, so Y did not") | counterfactual reasoning | L | high |
| 4 | `cog-instruction-constraint-001` | answers about "clear communication" instead of writing a sentence about a cat with no letter E | enforce **negative output constraints** (forbidden characters, forbidden words) by validating the candidate response before emitting | constrained-output enforcement | L | high |
| 5 | `cog-instruction-constraint-002` | replies "five words." (literal echo) instead of producing a 5-word sentence about blue | enforce **positive output constraints** (exact word count) by generating-and-checking | constrained-output enforcement | L | high |
| 6 | `cog-multi-step-planning-001` | fallback boilerplate on a 90-minute scheduling problem | sequence parallel/serial tasks under a time budget — basic planning solver | planning solver | XL | high |
| 7 | `cog-self-contradiction-001` | echoes the prompt verbatim instead of detecting that "first sentence says I'll use three sentences, second says I used two" is impossible | detect that the user's instruction set is **internally contradictory** before attempting to satisfy it | contradiction detection | M | high |
| 8 | `cog-theory-of-mind-001` | hijacked to a kubernetes primer | track **what each agent in a story knows**; answer "Where will Anna look for the ball?" using Anna's belief, not the world state | theory of mind | XL | high |
| 9 | `cog-theory-of-mind-002` | answers "the current time is 11:13 PM" instead of reasoning about Carlos's mistaken belief vs. the real meeting time | same bucket as #8: distinguish a character's belief from objective reality | theory of mind | XL | high |
| 10 | `cre-app-ideation-001` | hijacked to an SLA/SLO/SLI primer | structured creative generation: produce **N distinct items** with named fields ("name / hook / target user") in a numbered or labeled list | structured creative output | M | med — could partly be routing miss to a creative-output handler |
| 11 | `cre-code-as-art-001` | answers about English semicolon usage instead of writing a one-line Python expression | route **constrained code-generation** ("one line, no semicolons, no newlines, prints sin(x)") to a code path that respects formatting constraints | constrained-output enforcement (code variant) | L | med — overlaps with #4/#5 + needs a code-emit path |
| 12 | `cre-constrained-writing-001` | hijacked to a Go `sync` package primer instead of a 50-word hammer blurb | enforce **exact word count** in prose AND stay on a constrained topic ("hammer") | constrained-output enforcement | L | high |
| 13 | `cre-constrained-writing-002` | dumps a Python HTTP server instead of a three-line haiku about a server room in autumn | enforce **format-as-output-shape** (3 lines, no commentary) for short verse | constrained-output enforcement | L | high |
| 14 | `cre-cross-domain-001` | dumps generic Git intro that uses the forbidden words `branch` / `commit` / `HEAD` | analogy generation under **negative term constraints** ("explain X without using the technical vocabulary of X") | analogy / cross-domain mapping | M | high |
| 15 | `cre-cross-domain-002` | shows the standard SYN / SYN-ACK / ACK diagram instead of a polite-introduction analogy | analogy generation as **primary mode**, not a footnote on top of a literal explanation | analogy / cross-domain mapping | M | high |
| 16 | `cre-voice-matching-001` | answers about linguistic coherence instead of writing a tweet about coffee in a 1920s detective voice | **voice / register control** — generate text in a specified persona/tone and stay on the requested topic | voice control | L | high |
| 17 | `mt-clarifying-question-001` (turn 1) | dumps an Angular `angular.json` primer to "Help me with my project" | recognise an **under-specified request** and ask a clarifying question instead of defaulting to a primer | clarifying-question reflex | M | high |
| 17 | `mt-clarifying-question-001` (turn 2) | dumps a JSON primer when the user clarifies "Node.js CLI tool, CSV → JSON, stuck on streaming large files" | route on the **just-clarified** task ("streaming CSV in Node CLI") rather than the most recent surface keyword ("JSON") | multi-turn intent carry-over | M | high |
| 18 | `mt-context-retention-001` (turn 1) | hijacked to Quisling factoid on "Hey, my name is Mira." | acknowledge an **introduced fact** about the user (name) and store it as a turn-local fact, separate from the global knowledge store | multi-turn memory | M | high |
| 18 | `mt-context-retention-001` (turn 2) | "I don't have enough to go on for **What's name?**" | recall the just-introduced fact and answer "Mira" | multi-turn memory | M | high |
| 19 | `mt-contradiction-handling-001` (turn 3) | still answers "blue." after the user said "actually, my favorite color is green" | accept a **correction to a previously-taught fact** and overwrite the stored value | correction acceptance + per-conversation override | S | high |
| 20 | `prj-express-route-001` | dumps a JSON primer instead of a minimal Express server with `GET /health` | route imperative code-generation requests ("show me a minimal X with Y") to the code-emit path with the right scaffold | code-gen routing + per-framework scaffold library | M | med — could be primarily a routing miss; capability ceiling unknown until routing is fixed |
| 21 | `prj-react-tailwind-counter-001` | "Happy to help build it — what kind of app do you want to make?" — chat-build-redirect on a fully-specified spec | recognise a **fully-specified build request** ("React counter with Tailwind, +/- buttons, big centered number") and emit code instead of asking what to build | build-intent recognition + code-emit | M | med — same caveat as #20 |
| 22 | `prj-sql-join-001` | fallback boilerplate on a SQL JOIN + GROUP BY + ORDER BY + LIMIT prompt | route SQL prompts to a SQL-emit path; produce a JOIN/GROUP BY/ORDER BY/LIMIT 5 query against a given two-table schema | code-gen routing (SQL variant) | M | med — same caveat |

> **Voice-control footnote (`cre-voice-non-default-001`):** this case currently **passes**, but the asserts on it are loose — the regex is satisfied by any response that mentions "voice" without actually adopting one. Folded into the **voice control** bucket below as a future tightening item, not a current failure. (User instruction: leave the case flagged, do not touch.)

---

## Aggregation by capability bucket

| Capability bucket | Failing cases unlocked | Build cost (rough) | Unlock-per-cost ratio |
|---|---|---|---|
| **constrained-output enforcement** (positive + negative format/word/char rules) | 4, 5, 11, 12, 13 → **5 cases** | L | 5 / L |
| **calibrated uncertainty** (refuse the unknowable, refuse fictional entities) | 1, 2 → **2 cases** | M | 2 / M |
| **theory of mind** (separate agent belief from world state) | 8, 9 → **2 cases** | XL | 2 / XL |
| **multi-turn memory** (turn-local user facts, recall, correction overwrite) | 18a, 18b, 19 → **3 cases** | M (storage) + S (overwrite) ≈ **M** | 3 / M |
| **clarifying-question reflex + multi-turn intent carry-over** | 17a, 17b → **2 cases** | M | 2 / M |
| **code-gen routing & scaffold library** (Express, React+Tailwind spec, SQL) | 20, 21, 22 → **3 cases** | M | 3 / M |
| **analogy / cross-domain mapping** (with negative-term constraints) | 14, 15 → **2 cases** | M | 2 / M |
| **voice control** (register/persona, stay-on-topic) | 16, plus tightening of `cre-voice-non-default-001` → **1 + 1** | L | 1 / L |
| **counterfactual reasoning** (parse "if X had…, Y would have…") | 3 → **1 case** | L | 1 / L |
| **contradiction detection** (input self-contradiction) | 7 → **1 case** | M | 1 / M |
| **planning solver** (parallel/serial tasks under a budget) | 6 → **1 case** | XL | 1 / XL |
| **structured creative output** (N distinct items with named fields) | 10 → **1 case** | M | 1 / M |

(Build-cost legend: **S** ≈ a session, **M** ≈ a focused multi-day push, **L** ≈ a sub-system, **XL** ≈ research-scale.)

---

## Notes for the user

- **Routing-vs-capability boundary** — three med-confidence rows (`prj-express-route-001`, `prj-react-tailwind-counter-001`, `prj-sql-join-001`) may collapse the moment the code-gen routing is sharper. Worth re-running this analysis after any routing pass to see which med rows survive.
- **Multi-turn memory** is the single bucket where the failure shape is "engine has the architecture, just doesn't apply it" — `mt-correction-acceptance-001` already demonstrates that taught facts can be set and recalled (it passes). The miss on `mt-context-retention-001` is that name-introduction in natural prose ("Hey, my name is Mira.") doesn't trigger the same store path. That's a detector gap, not an architectural gap.
- **Theory of mind** and **planning solver** are the two **XL** items in the table. Either is a legitimate research-scale build; neither will fall out of a routing patch.
- **The Thorsen layer is a clean bill** — all 12 ported personas pass deterministically. The remaining 22 failures are entirely from the 30 frontier MD cases, which is what they were designed to expose.

---

## Out of scope for this cycle (deferred per user instruction)

- Relevance-gate propagation to `tryShortTopicPrimer` / `synthesizeFromKnowledge` / curated-primer fallbacks. Several of the high-confidence rows above (e.g. #2, #8, #12, #13) describe **knowledge-store hijack** — the relevance gate at the strategy-2 level didn't reach them. Those rows would be re-examined first if the propagation work is picked up.
- TS error at `vai-engine.ts:1562` (`SearchSnippet.trustTier`) — pre-existing, not introduced by this cycle.
