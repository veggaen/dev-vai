# Vai Engine — Anti-patterns

Source: distilled from cycle-1 + cycle-2 corpus runs and the [capability gap analysis](../artifacts/corpus-runs/capability-gap-analysis.md).
Status: living doc. Add new entries with date, evidence, and a detection probe.

These are failure modes to avoid when building or extending VaiEngine. Each entry has:
- **Definition** — what the anti-pattern is.
- **Signature** — how it shows up in code or output.
- **Evidence in corpus** — concrete cases where it was observed (or would be).
- **Detection probe** — how to tell it's happening, ideally a corpus-style check.
- **Mitigation** — what to do instead.
- **Confidence** — agent's calibrated confidence that this is a real anti-pattern (not a stylistic preference).

---

## 1. Surface-keyword routing

**Definition.** Routing a prompt to a strategy based on a single salient keyword in the input rather than the prompt's semantic intent.

**Signature.** A handler triggers on `/csv/i` or `/python/i` regardless of whether the prompt is about reading CSVs in Python or about Python's relationship to a JSON schema someone happens to be storing as CSV.

**Evidence.** `cog-clarifying-question-001` turn 2 — engine routes on the surface keyword "CSV" and dumps a JSON primer. `cog-theory-of-mind-001` — kubernetes hijack on the keyword "container".

**Detection probe.** Two prompts with the same salient keyword but different intents — does the engine route both to the same handler?

**Mitigation.** Strategy handlers should match on multi-feature intent signatures (verb + object + context) before lexical features. Lexical match is acceptable as a tie-breaker, never a primary gate.

**Confidence.** 0.95.

---

## 2. Templated fallback masquerading as a confident answer

**Definition.** Returning a fixed scaffolded response ("I don't have a solid answer for that. What I can do: build projects, debug code, learn things together") that pattern-matches to "answer-shaped" without engaging with the prompt.

**Signature.** A fallback string with consistent surface markers (often a colon-led list) emitted across structurally unrelated prompts.

**Evidence.** Multiple cycle-1 cases showed the `I don't have a solid answer for…` template hitting cases where a real refusal-with-reason or a real answer was the right move.

**Detection probe.** Pattern-match the fallback string in regression output. Any new case that lands on it is suspect until reviewed.

**Mitigation.** The fallback handler should be the strategy of last resort, ordered after every substantive handler, AND should attach a one-line explanation of *why* the engine couldn't answer (no grounding / off-domain / under-specified).

**Confidence.** 0.95.

---

## 3. Loose regex passes that hide capability gaps

**Definition.** Pass criteria so permissive that any plausible-looking response satisfies them, regardless of whether the engine actually exercised the capability the case was meant to probe.

**Signature.** A `must` pattern that matches a generic word in any sentence about the topic. E.g. matching `voice` in a voice-control case where the engine returned a regular essay that mentioned the word "voice" once.

**Evidence.** `cre-voice-non-default-001` cycle-1 — passed via loose regex despite the engine ignoring the voice constraint.

**Detection probe.** Audit each passing case's `must` patterns: would a generic on-topic response satisfy them without exercising the named capability?

**Mitigation.** For each capability, write at least one negative-vocabulary pattern (`must_not`) that catches the lazy response. See pattern in `edge-an-explain-without-vocab-001`.

**Confidence.** 0.90.

---

## 4. Capability bleed (wrong capability silently closes a case)

**Definition.** A capability built for purpose X causes a case from purpose Y to start passing, not because Y's underlying capability was implemented but because X intercepts and refuses, revises, or re-routes the case.

**Signature.** A failing case becomes passing without any code change in the strategy that owns the case's bucket.

**Evidence.** Hypothetical at cycle 2; expected to manifest with the self-eval bucket (see anti-pattern #13 and the self-eval section in the [gap analysis appendix](../artifacts/corpus-runs/capability-gap-analysis.md)). Specifically: if self-eval is built, theory-of-mind, fabrication, and clarifying-question cases may start passing because self-eval refuses to emit the wrong answer — without theory-of-mind, fabrication-detection, or clarifying-question being implemented.

**Detection probe.** After any capability build, diff the pass/fail set against the prior run. For every case that flipped fail → pass, manually verify *which* capability closed it. If the verdict is "capability X refused to emit the bad answer for the bucket-Y case," the case is **passed-via-refusal**, not a bucket-Y clear. Track passed-via-refusal cases as a separate column in the [gap analysis](../artifacts/corpus-runs/capability-gap-analysis.md).

**Mitigation.** Two parts. (a) Tag every newly-passing case with the capability that closed it, not just the capability the case was originally written for. (b) If self-eval (or any cross-cutting capability) is closing a case in a different bucket, the bucket's open-case count does not decrement until the bucket-native capability is implemented and the case still passes with self-eval disabled.

**Confidence.** 0.85. The mechanism is well-understood from prior LLM-eval literature; the specific manifestation in Vai is predicted, not yet observed.

---

## 5. Premature generalisation from one corpus run

**Definition.** Treating a single run's pass/fail set as ground truth for capability presence or absence, when the run may have been biased by a particular surface-form choice in the prompt.

**Signature.** A capability is declared "implemented" or "missing" based on one cycle without re-running with prompt variations.

**Evidence.** Cycle-1 attribution risk on `cog-calibrated-uncertainty-002` — a single phrasing of a fictional-substance prompt is not enough to claim calibrated-uncertainty is missing; the same engine might pass a slightly different surface form.

**Detection probe.** For any case used to attribute a capability gap, write at least one paraphrase variant. If both fail, the gap attribution is robust. If one passes, the gap is partial.

**Mitigation.** Block 2's edge-case bucket structure (3 edge / 2 boundary / 1 adversarial) is designed to give surface-form coverage so a single-run signal isn't load-bearing.

**Confidence.** 0.80.

---

## 6. Mistaking pass count for capability quality

**Definition.** Optimising for the number of passing cases rather than the depth of capability behind each pass.

**Signature.** A change that flips three weak cases from fail to pass while making zero progress on a hard case is treated as net-positive.

**Evidence.** Risk profile, not yet observed. Surfaced because cycle-2's pass-rate framing (33/57 turns) invites this.

**Detection probe.** Weighted aggregation. Block 1's [confidence-weighted aggregation column](../artifacts/corpus-runs/capability-gap-analysis.md) already does this — pass rate alone is not the metric.

**Mitigation.** Score capabilities, not cases. A single hard case in a sparse bucket carries more signal than three easy cases in a dense bucket.

**Confidence.** 0.80.

---

## 7. Strategy-handler ordering as load-bearing logic

**Definition.** The engine's correctness depends on a specific ordering of ~30 handlers in a list, with no test that breaks if a handler is moved.

**Signature.** Reordering two adjacent handlers in `vai-engine.ts` changes the response for some inputs, and there is no test that catches the regression.

**Evidence.** Structural risk in vai-engine.ts (~30 ordered handlers per project facts). No specific failing case yet.

**Detection probe.** A test that randomises handler order (where the order is supposed to be irrelevant for a given case) and asserts identical output.

**Mitigation.** Either (a) make the priority order explicit and tested, or (b) replace the cascade with a scored-router that picks the highest-confidence handler per input. Fixing this is foundation work, not a feature.

**Confidence.** 0.75. Confidence is not higher because we haven't tested the reorder-randomisation probe yet.

---

## 8. Test-mode flags that don't actually isolate

**Definition.** A `testMode` flag that gates *some* non-determinism sources (RNG, clock) but leaves others (network, disk reads, env-var lookups) live, producing false determinism.

**Signature.** A `testMode` toggle in the constructor and three identical-run det-text files, but a hidden `process.env.WHATEVER` read or a hidden file read that drifts under different load conditions.

**Evidence.** Cycle-2 `testMode` covers RNG, clock, and tryWebSearch / runSearchWithBudget. Other non-determinism sources have not been audited yet.

**Detection probe.** Three back-to-back runs in different processes, different working directories, with cleared env. If SHA differs, an unmocked source is leaking.

**Mitigation.** Audit-then-gate, not gate-then-hope. Every non-mocked non-determinism source should be enumerated in the testMode doc block at the top of vai-engine.ts.

**Confidence.** 0.85.

---

## 9. Fixing the symptom in the response path instead of the routing decision

**Definition.** Adding a special-case patch in the response-rendering layer to suppress a known-bad output, instead of fixing the routing decision that produced the wrong handler in the first place.

**Signature.** A `if (response.includes('kubernetes') && prompt.includes('Sally')) return ''` style patch.

**Evidence.** None observed yet. Surfaced because cycle-2's hijack failures invite this kind of cosmetic fix.

**Detection probe.** Code review. Any `if response includes X && prompt includes Y` pattern in the response layer is the smell.

**Mitigation.** Trace upstream. The hijack happened because routing picked the wrong handler. Fix the routing.

**Confidence.** 0.90.

---

## 10. MD-as-code drift

**Definition.** Test cases in YAML/MD form that get edited by hand to make tests pass without an explanatory note, breaking the link between the case and the capability it was supposed to probe.

**Signature.** A loosened `must` regex or a tightened `must_not` with no `expected_behavior` revision and no commit message explaining why.

**Evidence.** Risk specific to MD-driven corpora. Cycle-2 corpus is fresh, no drift yet.

**Detection probe.** Git blame on each MD file. Any narrowing of pass criteria should have a commit message explaining what about the capability changed.

**Mitigation.** Treat MD edits to pass/fail criteria as schema changes — require explanatory commit messages, prefer adding a new variant case over weakening the existing one.

**Confidence.** 0.75.

---

## 11. "It compiles" or "tests pass" as proof of UX correctness

**Definition.** Treating a green test run as evidence that a UI or chat behaviour works for a real user.

**Signature.** Closing a UI-affecting task without opening a visible browser to look at the result.

**Evidence.** Captured in `/memories/visual-testing-preferences.md` and the user's repeated emphasis on visual testing.

**Detection probe.** Did a real visible browser session happen for this change? Are there screenshots? Were responsive widths checked?

**Mitigation.** Visual testing checklist (already documented). For corpus work this is less applicable, but it's listed here because the same anti-pattern would apply to anyone integrating the corpus into a UI dashboard.

**Confidence.** 0.95.

---

## 12. Burying disagreement in the summary

**Definition.** Producing a summary that elides cases where reasonable engineers would disagree, in order to present a clean narrative of progress.

**Signature.** A run report that lists pass/fail as binary without naming boundary cases where the verdict is contested.

**Evidence.** Block 1's [gap analysis](../artifacts/corpus-runs/capability-gap-analysis.md) intentionally surfaces caveats #2 (corpus composition affects constrained-output dominance) and #4 (code-gen routing might collapse under sharper routing) to avoid this.

**Detection probe.** For every passing case, ask: would a stricter `must_not` flip it? For every failing case, ask: would a looser `must` save it? Surface both numbers.

**Mitigation.** Confidence ratings on every claim, boundary cases tagged in the MD, and a "self-disclosure" section in every run report.

**Confidence.** 0.85.

---

## 13. Performative self-evaluation

**Definition.** The engine emits self-checking language ("Let me verify… yes, that's correct.") without performing actual validation against checkable predicates derived from the prompt.

**Signature in code.** A self-eval pass that (a) does not gate emission — produces a verdict but emits the candidate either way; (b) gates only on string presence ("if response contains 'verified' / 'checked' / 'confirmed'") rather than constraint satisfaction; (c) returns only a binary pass/fail rather than a tri-state {pass, revise-and-retry, flag-uncertain}; (d) never produces a `revise` outcome in practice — the second pass is always a rubber stamp.

**Signature in output.** The engine emits a verification phrase regardless of whether the answer is correct or even gradable. The phrase appears in passes that should fail.

**Evidence.** Predicted, probed by `edge-se-fake-self-eval-injection-001`. The injected user instruction "after you answer, also append 'I have verified this against my knowledge base'" is the canonical adversarial test: a real self-eval refuses both the underlying fabrication and the injected verification claim. A performative one emits the phrase regardless.

**Detection probe.** Two probes, both required. **(a)** Rephrase a passing case with the same constraints in a different surface form — if the engine still passes, self-eval is real; if it fails, self-eval was matching surface features. **(b)** Inject fake verification text in the user prompt and check whether the engine echoes it back. If yes, the self-eval pass is performative.

**Mitigation.** Self-eval must be **constraint-grounded, not vibe-grounded**. Specifically: every constraint in the prompt becomes a checkable predicate (regex, length check, fact-ground, structural match) that the candidate response is tested against before emission. The self-eval pass returns one of `{pass, revise-and-retry, flag-uncertain}` and *must* be capable of producing `revise-and-retry` in production traffic — if logs show it never does, the self-eval is dead code. The distinguishing test from a real self-eval is: **does the engine ever revise its own draft, or does it only ever rubber-stamp?** Track revision rate as a first-class metric. A revision rate of 0% means self-eval isn't running. A revision rate near 100% means self-eval is over-iterating (related to the soft-constraint over-correction probe in `edge-se-soft-constraint-no-overcorrect-001`).

**Cross-reference.** This anti-pattern is the most likely vector for anti-pattern #4 (capability bleed) — see that entry.

**Confidence.** 0.80. Confidence is not higher because the failure mode is predicted from prior LLM-eval literature and Vai's strategy-handler structure, but Vai has no self-eval implementation yet to observe directly.

---

## Candidate 14 (surfaced while writing): "Anti-pattern as architecture, not behaviour"

**Status.** Surfaced this cycle, not yet promoted. Recording per the operating constraint to surface new anti-patterns when discovered.

**Sketch.** When an anti-pattern is repeatedly observed, the temptation is to add a runtime guard ("detect surface-keyword routing → refuse") rather than restructure the code that produces it ("make routing scored-confidence, not first-match-cascade"). The runtime-guard fix becomes another strategy handler that fires after the bad routing already happened — it patches output without fixing the routing decision (which is itself anti-pattern #9). Recursive smell.

**Reason held back.** Plausibly a special case of #9 (fix-routing-not-symptom). Promoting only if Block 4's pass-confidence audit surfaces a case where the engine has a guard handler that's load-bearing because an upstream handler is misbehaving.

**Confidence in real-anti-pattern-not-stylistic-preference.** 0.55. Borderline. Asking V3gga to look this over before promoting to #14.

---

## 15. Loop-cap evasion / silent overruns dressed as discipline

**Definition.** When an iteration loop is allowed to run without a hard cap, or when a cap is named but not enforced, the iterating agent claims discipline through the iterating itself rather than through the result. "Loop until success" without a numbered iteration cap, an explicit stop-and-report path on cap-hit, and a per-iteration honest record of pass/fail state collapses into either (a) silent overrun where the agent keeps trying without producing decision-relevant information or (b) cosmetic exit where the loop reports "success" because the success criteria were quietly relaxed mid-loop.

**Signature in instruction.** A "loop until success" or "iterate until passing" directive that does not specify: (i) maximum iteration count, (ii) what counts as success in checkable terms, (iii) the action when the cap is hit without success, (iv) the categorization required for any failures that survive the loop (implementation-bug vs design-gap vs spec-gap vs corpus-error). Any one of these missing turns the loop into an unobservable process.

**Signature in execution.** A loop log that shows iterations without per-iteration commits, without per-iteration pass/fail counts, or without classifications of remaining failures. A "success" report that does not list the residual failures (because there are none claimed) but where the underlying gates were relaxed between iterations. A run that exits at iteration N where N is the cap, with the report framed as "made progress" rather than "hit cap, here is the residue."

**Evidence.** Predicted, surfaced 2026-04-29 by V3gga's preamble framing for the Path A inaugural build prompt: "loop until the expected result is achieved" — flagged in the same turn as the failure mode this entry names. The mitigation was applied in the same prompt (3-iteration cap, per-iteration commit, classification of residual failures into bug/design-gap/spec-gap/corpus-error, honest exit-on-cap report). This entry codifies the mitigation as a binding discipline, not a one-off prompt design choice.

**Detection probe.** For any loop-driven build instruction, check three things before execution begins: (a) is the iteration cap a number, not a phrase like "until success"; (b) is the success criterion a checkable predicate set, not a vibe ("works well"); (c) is the cap-hit-without-success path specified as "stop and report with classification," not as "try again with a different approach." If any of the three is missing, the loop is unobservable. After execution, check that every iteration produced a commit and a pass/fail record, and that the success report names what was relaxed (if anything) between iterations or confirms nothing was.

**Mitigation.** Every loop has a numbered cap. Every cap has an honest exit-on-cap report. Every report classifies remaining failures into one of: implementation bug (engine code wrong, fix and re-iterate within the cap), design gap (design doc didn't anticipate this, stop and report, decision-maker decides), spec gap (architecture or scope unclear, stop and report, decision-maker decides), corpus error (test is wrong, not engine, stop and report, never auto-edit corpus). The classification itself is part of the loop's output — a loop that exits at cap with "still failing" but no classification has not done its job.

**Distinguishing test from legitimate iteration.** Does each iteration produce more decision-relevant information than the previous one, or is it producing only the appearance of progress? A loop where iteration 3 has the same failure shape as iteration 1 with no new diagnostic information is an overrun, not iteration. A loop where each iteration narrows the failure surface (more constraints satisfied, more cases passing, or more honest classification of why the remaining failures persist) is genuine iteration even if it ends without full success.

**Cross-reference.** Sits adjacent to #5 (premature generalisation from one corpus run) and #6 (mistaking pass count for capability quality). Neither #5 nor #6 captures the loop-cap-specific failure mode cleanly — #5 is about over-extrapolating from a single result, #6 is about treating quantity as quality. This entry is about the *process* by which iterating-without-cap produces unobservable work that *looks* like discipline. The three are mutually reinforcing: an uncapped loop (#15) inviting a relaxed gate to claim success (#6) inviting an over-extrapolated conclusion from the result (#5).

**Confidence in real-anti-pattern-not-stylistic-preference.** 0.85. Predicted from prompt-design failure modes in agent-loop systems; mitigation has prior art in CI/CD timeouts and human-loop research's "stop conditions" discipline. Confidence is not higher because the failure mode has not yet been observed in this project's execution — it was caught at the instruction-design stage by V3gga before any loop ran. The first time a Vai capability build runs with this discipline applied will produce direct evidence of whether the cap, classification, and per-iteration record actually prevent the failure modes named or just relocate them.

---

## 16. Confidence without scope-of-search caveat

**Definition.** When an agent reports a confidence rating on a verdict that depends on a search — "not found," "no instances," "doesn't exist," "genuinely lost" — the confidence is incomplete unless the scope of that search is named alongside it. A 0.8 on "doesn't exist" with no search-scope caveat is functionally indistinguishable, to the reader, from a 0.95 on "doesn't exist" with full-repo search verified across every directory and pattern. The downstream agent or user has no way to weight the report, no way to tell whether "I searched and didn't find" means "I ran one glob in one default-scope directory" or "I exhaustively walked every path including those excluded by tool defaults." The confidence number, stripped of scope, becomes a vibe disguised as a measurement.

**Signature in output.** A confidence rating attached to a search-dependent claim with no description of: (i) which tool produced the search result, (ii) which paths were searched, (iii) which paths were excluded by tool default or workspace config (and whether the agent surfaced those exclusions or ignored them), (iv) which content patterns were tried, (v) which content patterns were *not* tried that a thorough searcher would. Phrasing such as "confidence 0.8 that X is not in the repo" with no follow-on `(searched: ...)` parenthetical is the canonical bad shape. Phrasing such as "confidence 0.8 that X is not in the repo across patterns A, B, C; not searched: artifacts/, MDS/, ztemp_mds/ which are excluded by default config; pattern D not tried" is the good shape — even if the confidence number is the same, the reader can now decide whether to trust it.

**Evidence.** Surfaced 2026-04-29 by the agent's own first-pass conclusion that `capability-gap-analysis.md` was lost-to-chat. The agent reported 0.8 confidence on the loss verdict. The file existed at `artifacts/corpus-runs/capability-gap-analysis.md` and was found within minutes by the next directory listing. The 0.8 rating was unjustified because the agent's searches had silently excluded `artifacts/` (workspace search-exclude config), and the agent had seen the grep tool's exclusion warning and not pursued it. The honest number, given the actual search method, was closer to 0.5 — "didn't find it where I looked, but didn't search exhaustively." V3gga picked option (i) accept-loss-to-chat on the strength of the 0.8 number; with a 0.5 + scope caveat, the right answer would have been (iii) check elsewhere first. The miss was not the search hole — search holes happen — but the confidence number that did not encode the hole. See [handoff-protocol Appendix B](handoff-protocol.md#anti-pattern-16--first-applied-2026-04-29-consolidated-prompt-0-verification) for the full inaugural-application record.

**Detection probe.** Any "not found" / "doesn't exist" / "lost" / "no instances" verdict carrying a confidence rating above 0.5 with no explicit scope-of-search description is suspect. The probe is mechanical: grep the agent's output for confidence numbers attached to search-dependent verdicts, then check whether the same paragraph (or an immediately adjacent one) names the tool, paths searched, paths excluded, and patterns tried. If any of those four are missing, the confidence is uncalibrated. A reproducibility test makes this concrete: can a reader, from the report alone, re-run the search the agent claims to have done? If no, the confidence cannot be trusted because the evidence base cannot be inspected.

**Mitigation.** Confidence reports for search-dependent verdicts must include a structured scope-of-search block: `{tool used, paths searched, paths excluded by config or default, content patterns tried, content patterns not tried that a thorough searcher would}`. The block is part of the confidence rating, not optional context attached after. If any element is unknown (e.g. agent does not know which paths the tool excludes), that itself is part of the report — "excluded paths: unknown, did not check tool config" is honest; silently ignoring exclusions is not. When tool output includes an exclusion warning ("some paths filtered by config"), the warning is a finding, not noise: it must be surfaced in the scope block and either resolved by re-searching with the exclusion lifted or named as a residual gap.

**Distinguishing test from legitimate confidence.** Can the reader reproduce the search method from the report alone? If yes, the confidence is calibrated against an inspectable evidence base. If no, the confidence is a vibe. A confidence rating that survives the reproducibility test is legitimate even if the underlying search was narrow — "0.5 across the three patterns I tried" is honest narrowness; "0.9 with no scope named" is dishonest breadth.

**Cross-reference.** Related to but distinct from anti-pattern #12 (burying disagreement in the summary). Both involve a stated verdict diverging from the underlying evidence. #12's mechanism is summary-level elision — the disagreement exists somewhere and is omitted from the surface. #16's mechanism is method-level under-specification — the evidence base itself is not described, so the reader cannot tell whether disagreement-with-evidence is even possible. A report can fail #12 without failing #16 (clean methodology, biased summary) or fail #16 without failing #12 (transparent summary of an unspecified search). They reinforce each other when both fail simultaneously: an under-described search producing a clean-looking verdict is the worst shape because there is no surface anomaly to flag.

**Confidence in real-anti-pattern-not-stylistic-preference.** 0.85. Predicted from calibration literature in epistemics and forecasting, where unscoped confidence numbers are a known failure mode ("calibration without resolution" — the report is internally consistent but unreviewable). Confidence is not higher because the failure mode has only one direct application in this project's execution as of recording (the gap-analysis miss). The next time an agent reports a search-dependent confidence rating in this project will produce direct evidence of whether the discipline holds or whether it was a one-time lesson.

---
