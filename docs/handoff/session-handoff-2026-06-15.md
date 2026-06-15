# Session Handoff — 2026-06-15

> For the next agent continuing V3gga's work. Working material, subordinate to `Master.md`.
> Everything below is committed to `main` (pushed) unless noted. Branch work was merged.

---

## TL;DR

This session did two big things:
1. **Shipped the "evidence-bound capabilities" + fair-judge + learning-loop** body of work (merged to `main`).
2. **Root-caused and fixed V3gga's live failure**: "what is the price of btc?" ran 260s and produced "Updated the current project in sandbox" (a factual question got hijacked into a code build, and the web search couldn't extract a price).

**3 open problems remain** (see bottom): (A) CI is red on **Ollama-dependent tests that time out** in the GitHub runner; (B) **multi-entity fresh-data ("price of eth AND btc") is only best-effort** — BTC reliable, ETH flaky; (C) the **AI-Overview path isn't rendering** for the headless browser.

---

## What works now (verified)

- **BTC price answering works end-to-end.** Ran the real `SearchPipeline.search('price of eth and btc...')` against the live web: intent → `fresh-data`, fan-out → real-time queries, **reads 3–4 pages** (was 0), returns **"$66,213"** — matches Google. (Backend-confirmed; not yet visually confirmed in the desktop app.)
- **Factual questions can't be hijacked into a code build** (`looksLikeFactualQuestion` guard in `build-execution-intent.ts`, gating `isBuilderMode` in `service.ts`). This was the catastrophic symptom.
- **The council can ACT** on its web-search recommendation (broadened trigger in `fetchCouncilDirectedEvidence`), and a **failed Grok leader no longer pollutes the consensus** (`error`-marked note in `build-roster.ts`).
- **Member-availability state** (`consensus/member-availability.ts`): when a member fails, the reason is classified (no-credits/auth/timeout/…), it's **skipped until a cooldown elapses**, and a **fix hint** ("add credits / switch account") is surfaced. Wired into `build-roster.ts` via `wrapWithAvailability` + a process-lifetime `councilAvailability` store.
- **The fair judge** (`eval/answer-judge.ts`) is deterministic/blind/evidence-grounded and **wired into the live fallback** (`service.ts`) so Vai's grounded draft can beat a model answer on its own terms. **Parity bench** (`eval/parity-bench.ts`) measures "is Vai at par?" and gates the self-improvement loop safely.
- **Capability-outcome learning loop** (`learning/capability-ledger.ts`): the kernel's `history` term is alive — capabilities that reliably verify-pass gain rank.
- **Evidence-bound capabilities**: git / fs-edit / exec / page + cross-source synthesis (the `feat/evidence-bound-capabilities` slices), all merged.
- **CI lint (64→0 errors) and typecheck are GREEN.** Node CI pinned to 22 (`node:sqlite`).

## Test status
- `core/src`: **670/670 pass**. New suites all green (judge, parity, learning, capabilities, search, fresh-fact, member-availability, factual-guard).
- `chat-service.test.ts`: **57/57 pass** (fixed the agent-mode-default failures — see below).
- **CI is RED only** on Ollama-dependent acceptance tests (problem A).

---

## Commits this session (newest first, all on `main`)

```
0764e21 test(chat): fix pre-existing chat-service failures after agent-mode default (unblocks CI)
abdca33 fix(search): bounded extra page reads for multi-entity fresh-data (crash-safe)
b3c3f42 fix(search): multi-entity fresh facts + reject market-cap figures as prices
5798f02 feat(council): member-availability state — know why a member is down, stop retrying, fix-hint
84723ff feat(search): AI-Overview-first answering for fresh-fact queries
6c43fff feat(search): teach Vai to read+extract a fresh fact from pages (scalable web→answer)
00322e5 ci: pin to Node 22 (project requires the node:sqlite builtin)
b634e1b Merge evidence-bound capabilities + fair judge + BTC spaghetti fixes
f199f36 chore: V3gga's in-progress UI upgrade + session changes (tree green for merge)
1d9283c fix(council): the council can ACT on its own recommendation, not just log it
60a72d1 fix(search): fresh-data intent for price/score/weather — real-time queries + read pages
d3c71a3 fix(chat): factual questions must never become a code build (anti-hijack guard)
60a8387 feat(chat): wire the fair judge into the live fallback decision
7cdb71f feat(eval): fair blind evidence-grounded judge + parity benchmark
d669b14 feat(learning): close the kernel's learning loop — capabilities learn from outcomes
cfc2228 feat(synthesis): cross-source synthesis — "what I know about X / contradictions / decision record"
6c5418b feat(capabilities): page — real browser/page interaction as verifiable evidence
56a6b57 feat(capabilities): exec — fast, observable, verifiable command runs as evidence
0bc6523 feat(tools): fs-edit — safe file modification with a propose/apply/verify contract
d4b5ecb feat(capabilities): deterministic, evidence-bound git + synthesis (wormhole tools)
13fd69e feat(tools): read-url page-reader + SPA browser-render fallback
```

Research memo written: `docs/research/independence-research-2026-06-15.md` (neural-caching / SICs / memory tiers prior art; the recommended next big move is the pattern-internalization cache so Vai needs the model less over time).

---

## OPEN PROBLEM A — CI red: Ollama-dependent tests time out (DO NOT just skip — V3gga wants a real fix)

**Symptom:** On GitHub CI (Node 22), after lint+typecheck pass, the Test step fails. The failing files are model/conversation acceptance tests: `council-redraft-loop.test.ts` (8 fail), `ola-conversation.test.ts`, `vetle-conversation.test.ts`. Each failing case takes **~5000ms** (the vitest default test timeout) — they're **timing out, not assertion-failing**.

**Why:** These pass LOCALLY (council-redraft 22/22 in ~21s) because the dev machine has **Ollama** running. CI runners have **no Ollama**. The tests construct a `ChatService` with an empty `ModelRegistry` (council itself is a scripted stub roster), but `sendMessage` still drives the primary model path, which appears to attempt Ollama model discovery / a model call to `localhost:11434` that hangs ~5s in CI. (`ollama-discovery.ts` has a 3s timeout, but the 5s test-timeout is being hit — so the slow path is NOT only discovery; investigate where `sendMessage` waits when no model is registered.)

This was ALWAYS broken — it was masked because lint failed first, so the Test step never ran in CI before this session.

**The right fix (V3gga: "make the tests not need Ollama; no skipping"):**
- Make these acceptance tests fully deterministic by **injecting a stub model adapter** for the primary path (the council is already stubbed). Register a `StubStreamAdapter` (see how `chat-service.test.ts` does it, e.g. around line 526) so `sendMessage` never reaches Ollama. Then they run anywhere.
- Concretely: find every `new ChatService(createDb(':memory:'), new ModelRegistry(), …)` in the failing files and give the registry a stub adapter matching the conversation's modelId, OR add a test-only option so the primary path is a stub.
- First, INSTRUMENT: add a quick `VAI_SEARCH_DEBUG`-style log or run one failing test with a 1s Ollama-unreachable env to see exactly which call blocks for 5s. Likely candidates: `discoverOllamaModels`, `resolveEffectiveLocalChain`, or a fallback retry in `decideVaiFallback`/`sendMessage`. Make THAT path fail fast when no model is reachable (short timeout) — that's the scalable fix that also helps real users with no model installed.

**Files:** `packages/core/__tests__/council-redraft-loop.test.ts`, `ola-conversation.test.ts`, `vetle-conversation.test.ts`; `packages/core/src/models/ollama-discovery.ts`; `packages/core/src/chat/service.ts` (sendMessage primary path).

---

## OPEN PROBLEM B — multi-entity fresh-data is best-effort (BTC reliable, ETH flaky)

**Symptom:** "price of eth and btc" reliably returns BTC ($66k, correct) but ETH is inconsistent — when ETH's clean price page isn't among the read pages, ETH is OMITTED (a wrong market-cap figure like `$1,318,970,239,036` is hard-rejected, so it's never shown wrong — honest, but incomplete).

**Why:** Scraping is non-deterministic — the ETH price page isn't always read. The general read+extract works (`fresh-fact-extract.ts` is tested 13/13), but it can only extract from pages that got read.

**The recommended fix (V3gga signed off on "Both C and A+B"; this is the remaining piece):**
- **Per-entity targeted re-search**: when `extractFreshFactSubjects` finds N subjects but per-subject extraction fills < N, run a focused single-entity search ("eth price") for each missing entity and extract from that. A single-entity query reliably reads that entity's price page. Scalable (any entity class), no per-domain API. Wire it in `SearchPipeline.search()` after the first `synthesizeAnswer`/extraction pass, gated on multi-entity fresh-data.

**Files:** `packages/core/src/search/pipeline.ts` (the fresh-fact branch in `synthesizeAnswer` ~line 3320, and `search()` conclude step), `packages/core/src/search/fresh-fact-extract.ts`.

---

## OPEN PROBLEM C — AI-Overview path not rendering (the deterministic multi-entity fix)

**Symptom:** `fetchGooglePageViaBrowser('price of btc and eth', …)` returns `aiOverview: (none)` and only 1 organic result on this machine, even though Chrome is installed and `isBrowserSearchEnabled()` is true. So the AI-Overview-first path (commit 84723ff) is correctly wired but doesn't fire — Google isn't serving the AI Overview to the headless browser (anti-bot, or the DOM selector missed it).

**Why it matters:** Google's AI Overview gives BOTH prices in one clean synthesized block (V3gga's screenshot) — it's the deterministic answer that would solve problem B outright.

**Leads:** `packages/core/src/search/browser-search.ts` — the AI Overview extraction (selectors `[aria-label*="AI Overview"]`, the heading fallback, ~lines 306–325) and the anti-bot setup (`navigator.webdriver`, user-agent, viewport). Google likely needs: a logged-in-looking profile, a longer hydration wait, scrolling to trigger lazy AI-Overview render, or it's gated by region/CAPTCHA. May not be reliably solvable via headless scraping — if so, problem B's per-entity re-search is the pragmatic path.

---

## Decisions V3gga made this session (honor these)
- **Default conversation mode stays `'agent'`** (set in bf618a9 for workspace/agent builds). Tests that need chat behavior opt into `'chat'` explicitly. The anti-hijack guard keeps factual questions out of the builder regardless of mode.
- **No hardcoded per-question solutions** (rejected a CoinGecko crypto-price capability as too narrow). Fixes must be scalable to the whole question class.
- **Confirm backend + visually before demoing.** A demo was NOT given this session because ETH (problem B) isn't 100%.
- **Crash-safe**: PC BSODs under combined GPU+disk load — one heavy task at a time, keep reads/builds bounded.

## Environment notes
- Desktop app: the running binary is `Documents/veggaAi/veggaai.exe` (NOT dev-vai source). `pnpm app:update` rebuilds+syncs it (full, ~minutes); it **completed exit 0 this session**, so the desktop has the latest. `localhost:5173` dev server hot-reloads source.
- Node 22 required (`node:sqlite`). `pnpm -r --parallel typecheck`, `npx eslint .`, `npx vitest run <path>`.
- Search debug: `VAI_SEARCH_DEBUG=1`. Council knobs: `VAI_COUNCIL_TIMEOUT_MS`, `VAI_COUNCIL_PREWARM=0`. Fair judge: `VAI_FAIR_JUDGE_FALLBACK=0` to disable.
