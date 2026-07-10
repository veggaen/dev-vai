# Proposed Master.md Amendment — VAI IDE and Thorsen Computer Intelligence

**Status:** Proposed — awaiting authorization from Vegga Thorsen (Master.md §1: only Vegga may authorize changes)
**Proposed:** 2026-07-10, by the VAI engineering team
**Insertion point:** new section `12.6`, immediately after `12.5 Architecture Direction — The Orchestrator / Bridge`
**Effect:** additive. Nothing above §12.6 is overridden. Where this section names existing doctrine, it extends it.

---

## Why this amendment

`Master.md` was last validated 2026-04-11 and amended 2026-06-01 (§12.5). Since then the
product direction has crystallized into an IDE where humans and agents share one workspace
(`docs/vai-ide-vision.md`, approved 2026-07-07, and `docs/council-ide-roadmap.md`), and the
work now underway names two things the constitution doesn't yet know about: **VAI IDE** as
the product, and **Thorsen Computer Intelligence (TCI)** as the intelligence layer. Per §1,
building against unnamed doctrine invites drift; this amendment writes the durable truths
down and leaves the operational detail in the design docs where it belongs.

## What it deliberately does NOT change

- §6.1 stays: **Vai** remains the apprentice identity. VAI IDE is the product Vai lives in,
  not a rename of Vai.
- §12.5 stays whole: deterministic core first, generation as a gated tool, local
  open-weight first.
- The council / review-every-diff model from `docs/vai-ide-vision.md` is not weakened —
  §12.6.2 promotes its core rule to constitutional status.

## Open questions for Vegga (answer before or at authorization)

1. Confirm the name **Thorsen Computer Intelligence (TCI)** for the intelligence layer.
2. Confirm **VAI IDE** as the product name of the desktop workspace (vs. "Vai IDE" as
   currently styled in `docs/vai-ide-vision.md` — one spelling must win; the amendment
   below uses "VAI IDE").
3. Confirm the reference-priority order in §12.6.6, which resolves design conflicts.

---

## Proposed text (verbatim, to be appended to Master.md)

> ## 12.6 Product Direction — VAI IDE And Thorsen Computer Intelligence
>
> *Added 2026-07-10, authorized by Vegga Thorsen. Additive direction; it does not override
> any rule above. It names the product the orchestrator/bridge of §12.5 lives in, and
> promotes the trust mechanics of the approved IDE design to durable doctrine.*
>
> ### 12.6.1 Names, Once And Well
>
> - **VAI IDE** is the product: the workspace where humans and agents build together.
> - **Thorsen Computer Intelligence (TCI)** is the intelligence layer: unified,
>   local-first memory and understanding over (a) browsing captures, (b) the codebase
>   index, (c) agent session history, and (d) user-defined skills.
> - The **VAI engine** (`packages/core`) remains the deterministic heart (§12.5.2).
> - **Vai** remains the apprentice (§2.3). **VeggaAI** remains the system (§2.2).
> - No new brand names without amendment to this document.
>
> ### 12.6.2 Agents Are Occupants, Not Features
>
> Agents are first-class occupants of the workspace, with visible sessions: goal, plan,
> current step, sandbox, diff, cost, and state. Agents propose; the human (or a supervisor
> Vegga configures) approves. Nothing writes to the user's disk without approval by
> default. A chat box bolted onto an editor does not satisfy this section.
>
> ### 12.6.3 Demonstration Is The Signature Surface
>
> Every agent-facing feature must emit a demonstration record: the plan formed, each tool
> call, each file edit as a diff, each command with its output, each retrieval with cited
> sources, each test run with results — replayable and inspectable. This extends visual
> proof (§11) and epistemic transparency (§6.4) to agents. If TCI cannot show how it
> happened, the work is not done.
>
> ### 12.6.4 TCI Grounds Answers In Evidence
>
> Grounded answers cite their evidence. Per-domain and per-source privacy controls stay
> explicit and local. Local-first is sacred: no feature may require an external API;
> external models remain optional adapters (§12.5.4); user data stays on the machine
> unless the user explicitly exports it.
>
> ### 12.6.5 Measured, Not Claimed
>
> Retrieval recall, grounded-answer pass rate, agent task success, and latency budgets are
> tracked by evals and enforced by CI gates. Performance budgets are requirements, not
> aspirations, and regress-tested like correctness. A claim without a benchmark is
> unfinished work. Public benchmark documents never overstate.
>
> ### 12.6.6 Reference Priority
>
> VAI IDE studies four references and absorbs mechanics, never code or assets: VS Code
> (platform depth and spatial grammar), the task-delegation agent model (isolated sandbox,
> reviewable result), T3-class speed and restraint, and the Odysseus spirit of a
> persistent local daemon under the user's control. Where they conflict, resolve in this
> order: **user trust and local-first → agent workflow clarity → platform depth →
> speed and polish.**

---

*If authorized: append the quoted text to `Master.md`, update its "Last validated" date,
and update `docs/INDEX.md`. If amended: edit the quoted text here first, then apply.*
