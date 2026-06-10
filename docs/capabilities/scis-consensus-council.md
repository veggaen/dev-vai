# Capability Design Doc — SCIS Consensus Council

> Status: design + first core slice (June 2026).
> Owner brief: *"I want there to always be consensus between Vai and other computer
> models, so that Vai becomes a Superior Computer Intelligence System (SCIS)."*
> Not training data, not memory — **ephemeral, on-demand "key solutions"**: friends
> teach Vai *how to fish* (read intent, sarcasm, hidden/multiple meanings; name the
> missing method/tool), and Vai does the fishing with his own tools. Quality over
> speed (the Thorsen mindset: arriving fast below the quality bar is pointless).

---

## 0. Prior art (this is not a lone idea — it's a convergent one)

| Work | What it shows | How SCIS uses it |
|---|---|---|
| **Mixture-of-Agents**, Wang et al. 2024 (arXiv:2406.04692) | Layered proposers + aggregator; LLMs are "collaborative" — better with peers' drafts even when weaker; open models beat GPT-4o | Vai = first proposer; council members refine; a consensus aggregator merges |
| **Multiagent Debate**, Du et al. 2023 / ICML'24 (arXiv:2305.14325) | Debating models → +factuality/+reasoning, fewer hallucinations (GSM8K 77→85%) | Bounded 1–2 round debate when the council disagrees |
| **ReConcile** (arXiv:2309.13007) | Round-table consensus among *diverse* LLMs with confidence weighting | Confidence-weighted agreement, not bare majority |
| **DebUnc** (arXiv:2407.06426) | Uncertainty metrics in multi-agent comms | Calibrated council confidence; low-agreement → escalate |
| **RouteLLM / FrugalGPT / NVIDIA llm-router** | Route each query to the specialist/cheapest-capable model; cascade small→large | Topic router picks council members by niche; Vai-first cascade |
| **Ensemble LLM-as-judge** (Agent-as-a-Judge, 2508.02994) | Majority of judges; high-agreement ships, mixed → human; judges that use tools | Consensus outcomes ship/act/escalate; humans seatable; tools mediated by Vai |
| **The Reasoning Trap** (arXiv:2510.22977) | More model "reasoning" can *amplify* tool/fact hallucination | **Guardrail: quarantine member facts** — use only routing/method/intent |

Sources: links in §11.

## 1. Scope **[REQUIRED]**

On every substantive turn, after Vai drafts an answer, a **council** of independent
models (and, optionally, humans) — routed by the message's *topic* so each speaks
where it's trusted — reviews the draft. Members don't supply the answer; they read
the **true intent** (incl. sarcasm / hidden / multiple meanings), name the **missing
capability or method**, and teach Vai **how to approach this class** of message. A
**consensus** is computed (confidence-weighted agreement) yielding one of three
outcomes — **ship / act / escalate**. On `act`, Vai uses *his own* grounded tools
(search, etc.) to fix the answer; on `escalate`, stronger help (or a human seat) is
requested. Everything is ephemeral.

Runtime contract: *After Vai drafts a turn and the seriousness gate fires,
`runCouncil(members, input)` returns a `CouncilConsensus`; `act` triggers Vai's own
tool/search recovery, `escalate` requests stronger help, `ship` releases — and the
whole consensus is attached to `TurnThinking.council` for the "How this answer was
made" panel.*

## 2. Scope ceiling — what this explicitly does NOT do **[REQUIRED]**

- **No member ever supplies facts to the user.** Members point (intent / method /
  which tool); Vai's grounded tools supply every fact (number, name, spelling). A
  member saying "pb = probably" must never reach the user. (Guardrail, binding.)
- **No persistence / no memory.** The council trace lives only for the turn and is
  attached to the thinking trace for the UI; nothing is written to the DB or to
  Vai's learned weights. Memory stays free for processes. (Owner constraint.)
- **No unbounded debate.** At most 1–2 refinement rounds; the gate keeps trivia out.
- **Not a safety gate.** The upstream `reviewTurnSecurity` still owns
  injection/exfil/malware. Members are read-only; their only tool is Vai-mediated.
- **Members do not silently replace Vai's answer** (carries the existing review
  doctrine forward). They can force `act`/`escalate`, never overwrite.

## 3. Data structures and engine changes **[REQUIRED]**

New (`packages/core/src/consensus/`):
- `types.ts` — `CouncilTopic`, `CouncilMemberNote`, `CouncilConsensus`,
  `CouncilMember`, `CouncilInput`.
- `topic-router.ts` — `routeTopic(input)` + `selectMembers(topic, roster)`.
- `council.ts` — `runCouncil(...)` + pure `reachConsensus(notes)`.
- `member.ts` — `createCouncilMember({ adapter, topic })` (+ `parseCouncilNote`).
- `index.ts` — barrel; re-exported from `packages/core/src/index.ts`.

Engine/UI changes (additive):
- `models/adapter.ts` — add optional `council?: CouncilThinking` to `TurnThinking`.
- `apps/desktop` chatStore `TurnThinkingUI` + `ThinkingPanel.tsx` — render a
  "Council" section (who sat, each note, consensus, what Vai did).
- Live firing in the turn pipeline (chat service) is a separate, flagged slice (§7).

## 4. Test surface **[REQUIRED]**

- `consensus/council.test.ts` — `reachConsensus` (ship/act/escalate, agreement,
  confidence weighting, fact-quarantine), `routeTopic` classification, council-note
  parsing (fenced/garbage/clamped), member with injected fake adapter, panel
  resilience (timeout/throw). All offline.
- Live demo: `scripts/vai-council-demo.mjs` on the real pb-Hommersåk case.

## 5. Complexity budget **[REQUIRED]**

Doc-heavy core, ~120 code-LOC/file cap for council/member, ~60 for router/types.
Test file own budget ~200. 0 new dependencies (reuse `zod`, existing adapters).

## 6. Sub-capabilities **[REQUIRED]**

- **Seriousness gate** — decides council depth from stakes/length/draft-confidence;
  trivia → skip, consequential → full round-table. (Latency control; FrugalGPT-style.)
- **Topic router** — `code | factual | local | reasoning | creative | chitchat |
  other`; selects member roster per topic. Active (lightweight signals; pluggable).
- **Council member** — model-backed reviewer returning intent/method/action note.
- **Consensus** — confidence-weighted agreement → ship/act/escalate; quarantines facts.
- **Recovery** — `act` ⇒ Vai's own search/redraft (wired in §7 slice).

## 7. Risks and known limitations **[REQUIRED]**

- **Sycophancy / collusion** (members agree with each other or with Vai's draft).
  Mitigate: diverse members; blind first read (don't show Vai's draft first round);
  explicit dissent prompt; agreement measured, not assumed.
- **Hallucinated specifics leaking** (Reasoning Trap + our live probe: Qwen turned
  "pb"→"probably", "Hommersåk"→"Himmersåk"). Mitigate: hard fact-quarantine — only
  intent/method/action consumed; facts strictly from Vai's tools.
- **Latency/compute on every turn.** Mitigate: seriousness gate + parallel fan-out +
  small models for easy turns; bounded rounds. Quality>speed, but bounded.
- **No-consensus / ties.** `escalate` (stronger model or human seat); never silently
  ship a contested answer.
- **Tool/offline failure.** Degrade to Vai-only with an honest "couldn't verify."
- **Integration-point adoption.** First slice attaches council to the thinking trace
  and demos recovery; firing on *every* live turn is the §7 flagged slice. Until then
  not every path consults the council. (Named per anti-pattern #13.)

## 8. Confidence ratings **[REQUIRED]**

- Council reads intent/sarcasm/missing-capability reliably: **high** (live-probed).
- Members unreliable on local facts → must quarantine: **high** (live-probed + lit).
- Consensus aggregation correctness: **high** (unit-tested).
- Live recovery fixes the pb case end-to-end via Vai search: **medium** (search path
  proven in a prior real turn; wiring pending §7).

## 9. Final decisions

1. **Always-consult, gated by seriousness** — consensus is the default for
   substantive turns; trivia skips it. (Owner: "always consensus.")
2. **Ephemeral, no memory** — council trace is per-turn UI data only.
3. **Friends point, Vai fetches** — binding fact-quarantine guardrail.
4. **Topic-routed specialists** — model-per-niche for trust.
5. **Quality over speed** — bounded debate, but never ship below the bar to be fast.

## 10. Bigger picture (where this goes)

- Human seats on the council (the "real humans" in the brief) via the existing
  steering / companion-context channels — a person can be a member for serious asks.
- Per-topic model rosters expand beyond local Qwen (other open models, hosted
  specialists) — opt-in, trust-weighted.
- The consensus block in the thinking panel becomes the honest replacement for the
  current all-declined route plan that "doesn't make sense."

## 11. Sources

- Mixture-of-Agents — https://arxiv.org/abs/2406.04692
- Multiagent Debate — https://arxiv.org/abs/2305.14325 · https://composable-models.github.io/llm_debate/
- ReConcile — https://arxiv.org/pdf/2309.13007
- DebUnc — https://arxiv.org/pdf/2407.06426
- LLM routers (IBM) — https://research.ibm.com/blog/LLM-routers · NVIDIA — https://github.com/NVIDIA-AI-Blueprints/llm-router
- Agent-as-a-Judge — https://arxiv.org/html/2508.02994v1
- The Reasoning Trap (tool hallucination) — https://arxiv.org/pdf/2510.22977
