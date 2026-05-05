# Deferred capabilities — registry

> Capabilities, sub-capabilities, and infrastructure pieces that have been
> explicitly considered and explicitly deferred. Each entry has an owner-time
> decision attached. **Expiry is optional**: some deferrals stay open until
> dogfood data resolves them.

Format per entry:

```
### <id>
- **Status:** deferred
- **Source:** <where it was raised — turn / capability doc / dogfood note>
- **Why deferred:** <one or two sentences>
- **Resolution trigger:** <what would unblock it — e.g., "dogfood data on X" / "after capability Y ships" / explicit date>
- **Expiry:** <ISO date or "none — gated on resolution trigger">
- **Notes:** <optional>
```

---

### theory-of-mind
- **Status:** deferred
- **Source:** Block 4 capability picks (turn pre-implementation).
- **Why deferred:** Not in the authorized 3 for this build cycle. The capability is real but high-cost (L) and was not picked.
- **Resolution trigger:** explicit re-prioritization by V3gga.
- **Expiry:** **2026-07-28** (90 days from authorization). Re-evaluate then.

### planning-solver
- **Status:** deferred
- **Source:** Block 4 capability picks.
- **Why deferred:** Same as above. L-cost, not picked.
- **Resolution trigger:** explicit re-prioritization.
- **Expiry:** **2026-07-28**.

### self-eval-consistency-checking
- **Status:** deferred
- **Source:** [docs/capabilities/self-evaluation.md](capabilities/self-evaluation.md) §2.
- **Why deferred:** The umbrella ships with constraint-checking only this build. Consistency-checking sub-capability uses the same registration pathway and can be added later without architectural change.
- **Resolution trigger:** **after constraint-checking ships and dogfood data accumulates.** No date yet.
- **Expiry:** none — gated on resolution trigger.

### self-eval-fact-grounding
- **Status:** deferred
- **Source:** [docs/capabilities/self-evaluation.md](capabilities/self-evaluation.md) §2.
- **Why deferred:** Same umbrella, same registration pathway, deferred for the same reason as consistency-checking.
- **Resolution trigger:** **after constraint-checking ships and dogfood data accumulates.**
- **Expiry:** none — gated on resolution trigger.

### relevance-gate-strategy-badge-mismatch
- **Status:** deferred (filed 2026-04-28, pre-implementation of multi-turn-memory-detector)
- **Source:** Side-channel finding in [artifacts/audits/multi-turn-detector-precheck-2026-04-28T07-35Z.md](../artifacts/audits/multi-turn-detector-precheck-2026-04-28T07-35Z.md) §5.
- **Why deferred:** Direct-match-shaped content emits with `strategy-badge=fallback` despite the L3100 gate naming this case (Quisling biography example for input "Hey, my name is Mira"). Symptom will be masked by multi-turn-memory-detector once shipped (the new `nickname-prelude` bare-introduction branch fires before `direct-match` even runs). Filing now so the bug survives the symptom going quiet.
- **Resolution trigger:** resurfaces in dogfooding under a different input shape, OR a future corpus run produces the same badge/content mismatch on a non-introduction input.
- **Expiry:** none — gated on resurfacing under a shape the multi-turn detector doesn't intercept.
- **Notes:** Two failure modes are possible and the audit could not distinguish them: (a) the relevance gate at vai-engine.ts L3100 is being bypassed entirely on this input shape; (b) the gate works but a downstream step overwrites the strategy badge to `fallback` while letting the original content through. Repro requires a corpus turn whose user input matches a `direct-match` candidate that the gate is supposed to reject; once the multi-turn detector ships, the cleanest known repro disappears.

### self-eval-revision-coverage
- **Status:** deferred (newly filed — 2026-04-28)
- **Source:** smoke-run finding during self-eval implementation. `cog-self-contradiction-001` produced character-identical draft-1 and draft-2 under a non-null `revisionHint`. The `literal-response` strategy (and an unaudited number of others) does NOT consume the hint, which means `revise` verdicts on those strategies effectively collapse to `flag-uncertain` because the second draft is identical to the first.
- **Why deferred:** Anti-pattern #13 ("performative self-eval") risk realized in the wild. Real fix is either (a) every strategy in `vai-engine.ts` consumes `revisionHint`, or (b) revision is wired at a layer below all strategies (post-generation rewriter, predicate-aware regeneration loop, or substrate change). Both are larger than a single capability cycle. **Don't build now** — need dogfood data to know whether the gap is painful enough to prioritize over other authorized capabilities.
- **Resolution trigger:** dogfood data showing user-visible impact of revise→flag-uncertain collapse on any of the strategies in scope. Specifically: if dogfooding produces ≥2 prompts where a `flag-uncertain` verdict matches a "revision should have helped here" feeling, this becomes urgent.
- **Expiry:** none — gated on dogfood data.
- **Notes:** Audit list (which strategies honor `revisionHint` vs. which don't) is captured in [docs/capabilities/self-evaluation.md](capabilities/self-evaluation.md) §11 "Known limitations — revision hint adoption."

### corpus-region-split-schema
- **Status:** deferred (filed 2026-04-29 during Path A inaugural-build Step 3)
- **Source:** Authoring of [eval/corpus-md/live-session-regression/lsr-multi-question-okay-then-try-001.md](../eval/corpus-md/live-session-regression/lsr-multi-question-okay-then-try-001.md) and [eval/corpus-md/live-session-regression/lsr-base44-with-broken-related-panel-001.md](../eval/corpus-md/live-session-regression/lsr-base44-with-broken-related-panel-001.md). Both cases need finer-grained predicates than the current schema's flat `must` / `must_not` against the whole response can express.
- **Why deferred:** The cycle-1 schema collapses every predicate to a substring/regex check anywhere in the response body. Two structural needs surfaced during Step 3 authoring that this collapse cannot express precisely: **(a)** Region split — cases where the response has a body region (free-form chat output) and a related-panel region (auto-generated follow-up suggestions, RELATED panel question-stem grid, or any structurally-distinct section), and pass criteria differ between regions. The `lsr-base44-with-broken-related-panel-001` case probes exactly this: body should be correct (build-flow content) while the related-panel propagates a broken subject. The current schema collapses to a single `must_not` against the broken subject anywhere in the response; cycle-2+ may need `must_not_in_related` / `must_in_body` qualifiers to distinguish isolation-failure (body OK, panel broken) from total-failure (body broken too). **(b)** Per-predicate failure attribution — cases with parallel `must:` predicates that probe distinct sub-questions or distinct response properties, where knowing *which* predicate failed is the diagnostic signal, not just whether any failed. The `lsr-multi-question-okay-then-try-001` case has two `must:` entries (math AND president); current schema reports the AND-fail as a single failure rather than "math missing" vs. "president missing" vs. "both missing."
- **Resolution trigger:** ≥3 future regression cases need the region split or named-predicate-groups, OR cycle-2+ implementation phase finds that the collapse is masking diagnostic signal during dogfooding (multiple regression cases failing for indistinguishable reasons).
- **Expiry:** none — gated on resolution trigger.
- **Notes:** Two sub-features bundled in one entry because they share the same root cause (cycle-1 schema's flat-region predicate model). Splitting into two entries if the resolution triggers fire on different timelines. Cross-references: [docs/handoff-protocol.md](handoff-protocol.md) Appendix B (filing-pre-lint discipline per anti-pattern #15 forward-applied this turn).

### corpus-multi-group-must-and-semantics
- **Status:** deferred (filed 2026-04-29 during Path A inaugural-build Step 3)
- **Source:** Authoring of [eval/corpus-md/live-session-regression/lsr-multi-question-okay-then-try-001.md](../eval/corpus-md/live-session-regression/lsr-multi-question-okay-then-try-001.md). The case has two parallel `must:` predicates (math: `\b20\b` AND president: `\b(?:trump|biden)\b`) that must both match for pass.
- **Why deferred:** Existing corpus cases use multi-entry `must:` arrays elsewhere (multi-turn cases, e.g. `mt-context-retention-001.md`), so the runner is **expected** to interpret list entries as AND-conjoined predicates. **Confidence on existing AND-semantics being honored: 0.70** — contingent on what the corpus runner actually resolves the `must:` array to in practice. If the runner OR-conjoins them (any one match = pass), this case has weaker probe semantics than intended and will produce false passes when the engine answers only one of the two sub-questions. If the runner AND-conjoins them (this entry is closed by current behavior), the deferred-capability is just a sharpening: named groups (`must_math`, `must_president`) for per-predicate failure attribution rather than a pass/fail boolean.
- **Resolution trigger:** Lint or first run on `lsr-multi-question-okay-then-try-001` reveals the actual semantics. If AND: this entry collapses into the broader `corpus-region-split-schema` named-predicate-groups sub-feature. If OR: this becomes urgent — the case as currently written has weaker semantics than V3gga's schema decision intended, and either (a) the runner must be patched to honor multi-entry `must:` as AND, or (b) the case must be rewritten as a single regex with positive lookaheads (`(?=.*\b20\b)(?=.*\b(?:trump|biden)\b)`).
- **Expiry:** none — gated on first runner observation of the multi-must case.
- **Notes:** This entry exists because the lint outcome was honestly uncertain at authoring time. Filing pre-lint per anti-pattern #15 forward-applied (V3gga directive 2026-04-29: "files that exist in a candidate state during a pause window get either committed or lost"). Cross-reference: [docs/the-decision.md](the-decision.md) Comparison-shopping protection — the discipline of filing the open question separately from the case file means the lint outcome is a clean fork rather than an after-the-fact cleanup.

---

## Calibration tracking

Predictions filed pre-build vs. observed outcomes are kept in the originating capability doc (§10). When a prediction is resolved, summarize the calibration delta here in one line so the cross-turn trend is visible.

| Date filed | Capability | Prediction | Observed | Delta |
|---|---|---|---|---|
| 2026-04-28 | self-evaluation §10 | 1–2 of 4 frontier cases bleed-pass via `topic-presence`; confidence 0.45 | _pending cross-bucket check_ | _pending_ |
| 2026-04-28 | multi-turn-memory-detector — design (§8/§10) | bleed 0 ± 1 turns; confidence 0.7 | observed range across two consecutive corpus runs: [33/57, 35/57] vs 33/57 baseline → net Δ ∈ [0, +2] | within prediction at 0.7; central estimate fits, upper bound exceeds by 1 |
| 2026-04-28 | multi-turn-memory-detector — post-audit revision | bleed 0 ± 1 turns; confidence 0.92 | same as above (Δ ∈ [0, +2]) | central estimate fits; the +2 upper observation is outside the ±1 band, so 0.92 was overconfident — the audit underestimated run-to-run corpus variance and underestimated how many already-failing convs would lift once intro-acknowledgement worked |

**Note on this capability's prediction record:** the design doc filed one prediction at 0.7 confidence; the pre-code audit produced an update to 0.92 confidence on the same numerical prediction (0 ± 1). Only the confidence moved, not the central estimate. V3gga's message implied three predictions including a 2–4@0.55 and 1–2@0.45; those numbers are from the self-evaluation capability's prediction history, not this one. Recorded honestly here so future calibration trend math isn't poisoned by misattributed entries.

### browser-agent-e2e-coverage
- **Status:** deferred (filed 2026-04-29 during Path A inaugural-build Step 4 / classifier handoff turn)
- **Source:** V3gga raised browser-agent tooling (Vercel-labs agent-browser, Browserbase) mid-classifier-design as a candidate for testing infrastructure. Self-pushback in same message identified the request as anti-pattern #15-shaped (cosmetic discipline producing the appearance of progress over decision-relevant work) and explicitly deferred it.
- **Why deferred:** Browser-agent tooling is useful for end-to-end coverage of applications that already work end-to-end. Path A does not work end-to-end yet because the classifier is unbuilt as of filing. Adding tooling before the classifier ships moves no decision-relevant floor and consumes a turn that should ship the inaugural capability. **Non-blocking on inaugural classifier work; explicitly named as not-this-turn in the prompt that authorized this entry.**
- **Resolution trigger:** **classifier ships and survives one dogfooding cycle.** At that point Path A has a real end-to-end surface worth exercising with browser-agent coverage. Re-look question to answer at trigger time: which user flows benefit most from agent-driven coverage (chat send/receive, mode badge surface when shipped, override UI when shipped, sandbox dispatch when `Run` mode ships).
- **Expiry:** none — gated on classifier-ships-and-survives-dogfood trigger.
- **Notes:** Confidence on "this is the right next testing infrastructure once classifier ships" is **0.55** — the alternative is Playwright with the existing visual-testing-preferences mouse+keyboard discipline, which is already operative and may be sufficient. Re-look should compare both against decision-relevant criteria (test authoring cost, signal quality, integration with regression corpus). Candidates noted: Vercel-labs agent-browser, Browserbase. Cross-reference: visual-testing-preferences in user memory ("real Puppeteer or Playwright browser window with headless: false").

### lighthouse-perf-audit
- **Status:** deferred (filed 2026-04-29 during Path A inaugural-build Step 4 / classifier handoff turn)
- **Source:** V3gga raised Lighthouse for Chrome alongside browser-agent tooling. Same self-pushback applied.
- **Why deferred:** Lighthouse audits perf/accessibility/best-practices baselines on a working UI. The Path A chat UI is unchanged user-facing this cycle (classifier ships behind the existing surface). Running Lighthouse now produces a baseline that will shift the moment override-UI / mode-badge ship in subsequent capability turns, and the baseline is not actionable until something user-facing changes. **Non-blocking on inaugural classifier work.**
- **Resolution trigger:** **classifier ships and survives one dogfooding cycle, AND at least one user-facing surface change has shipped (mode badge, override UI, or `Run` mode handler).** Re-look question: what perf/a11y/best-practices baseline matters for V3gga's actual use, given the app is private and primarily for V3gga.
- **Expiry:** none — gated on combined trigger.
- **Notes:** Confidence on "Lighthouse is the right perf tool for Vai" is **0.65** — the app is private, single-user, on V3gga's hardware; some of Lighthouse's signals (e.g., mobile-first perf, public-internet constraints) are less load-bearing than for a public product. Re-look should consider whether a custom perf harness focused on first-token-latency, full-response-latency, and chat-scroll-jank (the V3gga-relevant surfaces) is a better fit than a Lighthouse run.

### prior-session-corpus-mining
- **Status:** deferred (filed 2026-04-29 during Path A inaugural-build Step 4 / classifier handoff turn)
- **Source:** V3gga raised reading all prior VS Code chat sessions (Claude Code Chat / Augment) as a way to give the agent full project history. Self-pushback in same message identified this as the same shape as the earlier "find the old screenshots" trap, larger scope, motivation honest but mechanism doesn't work, value-per-effort low because the conclusions of those sessions are already absorbed into [docs/the-decision.md](the-decision.md), [docs/the-idea.md](the-idea.md), [docs/path-a-architecture.md](path-a-architecture.md), and the `eval/corpus-md/live-session-regression/` set.
- **Why deferred:** **Default disposition: not needed; existing canonical artifacts are the canonical record.** Volume of prior sessions is large enough that parsing them risks the very chat-stability failures the user has flagged repeatedly (chat-stability-preferences memory: "VS Code Copilot chat sessions often crash when they get long or noisy"). Even setting aside crash risk, the conclusions are already extracted into the four canonical documents above. Doing the recovery turn produces no decision-relevant artifact those documents do not already contain.
- **Resolution trigger:** **a future turn surfaces a missing-context failure that the existing decision/idea/architecture docs cannot resolve.** Specifically: if the agent makes a recoverable but real mistake during implementation or dogfood that traces to a decision made in a prior session and not absorbed into the canonical four, then a targeted recovery turn becomes worth doing — but with a specific decision-relevant question to answer, not exhaustive context recovery. **No blanket "let's read everything" trigger.**
- **Expiry:** none — gated on resolution trigger.
- **Notes:** Confidence on "default disposition is correct" is **0.85** — the four canonical documents have been the substrate of the last 30+ turns of work without surfacing missing-decision failures attributable to lost prior-session context. Cross-reference to closing-line-was-retired exchange in handoff log: the closing line "we should read all devlogs" contradicted the body's "no new tools, no session recovery" and was retired by V3gga in the same turn after agent surfaced the contradiction. The retirement is itself a Phase-4-discipline-on-V3gga-side instance worth noting in case the impulse resurfaces.
