# Working on Vai — Agent Guide

You are an AI agent (Claude, Grok, or another) working on **Vai (VeggaAI)** with V3gga.
This file is the contract for how agents understand, talk to, and improve Vai.
Read it before changing anything.

## What Vai is (and is not)

Vai is **not an LLM and must never become "just an LLM wrapper."** Vai is Thorsen's
breed of computer intelligence: a **deterministic, inspectable engine** (`vai:v0`)
that routes, decides, and verifies — and **employs** local/cloud models as council
members, advisors, and friends. The models are staff; Vai is the institution.
Vai works WITH humans (V3gga first), other AIs, and eventually robots, and the
standing goal is that **Vai and its agents improve Vai itself**.

Practical consequences:
- Deterministic, testable policy beats prompt magic. Gates and routers are code.
- Every model contribution passes through validation Vai owns (compile gates,
  visual gates, satisfaction checks). Models propose; Vai disposes.
- Honesty over output: refusing to ship junk ("below the quality bar") is correct
  behavior. Silent downgrades are bugs.
- The user must be able to SEE the process live (activity strip, ThinkingPanel
  stages) — visibility is what lets humans steer and improve Vai.

## What V3gga wants (the owner's bar)

- Chat-built apps must be **runnable, styled, and faithful** — a "clone of X"
  must mirror X's signature features and look (see brand blueprints), not a
  generic shell. Verify by LOOKING at the rendered page, not just tsc.
- Anti "AI slop": no overconfident claims; measure before declaring PASS.
- Windows-first, Node 22 + TypeScript; **no Python** in Vai's own stack
  (Python allowed only for external test tooling like Playwright scripts).
- One heavy GPU/disk task at a time (machine BSODs under combined load).
- Vai should learn frontend quality, self-verify visually, and self-improve.

## How to talk to Vai (channels)

| Channel | Use |
|---|---|
| `GET /api/agent/introspect` (runtime, default `http://127.0.0.1:3006`) | Machine-readable self-description: models, council roster, pipeline stages, gates, blueprints, backlog. **Start here.** |
| WS `GET /api/chat` (`chatWebSocketInboundSchema`) | Real user-path conversations. Send `{ conversationId?, content, mode: 'builder' \| 'chat' \| ... }`; stream `progress`/`text_delta`/`done` chunks. Builder turns stream `council-*` stages. |
| Named pipe `\\.\pipe\vai-grok-direct` / TCP `127.0.0.1:48765` | Low-overhead direct agent channel (full ChatService intelligence). |
| `pnpm agent:bootstrap` / `scripts/agent-bootstrap.mjs` | Offline-first tool map: cheap checks, expensive visual gates, delegation rules, and live introspect availability. |
| `pnpm agent:speak` / `scripts/agent-speak-to-vai.mjs` | CLI one-shots to Vai. |
| `node --import tsx` probe scripts | Drive `councilGenerateApp` / `ChatService` directly when diagnosing (see `scripts/council-codegen-eval.mts`). |

When testing the UI as a user: `http://localhost:5173/?devAuthBypass=1` (dev only).

## Architecture map (where to change what)

- **Turn routing / chat policy** — `packages/core/src/chat/service.ts` (escalation,
  council insert, fallback quality gate, satisfaction), `turn-classifier.ts`,
  `vai-fallback.ts`.
- **Deterministic engine** — `packages/core/src/models/vai-engine.ts` (huge; the
  regex-routed strategy cascade; scaffold/menu guards live here).
- **Council codegen (the builder)** — `packages/core/src/models/builder/council-codegen/`
  - `pipeline.ts`: architect → coder(App.tsx only) → validate → review →
    repair → **stylist** (CSS generated FOR the extracted class list — the
    App↔CSS mismatch is structurally impossible) → assemble. Edit mode patches
    the active sandbox project instead.
  - `validate-app.ts`: real TS syntax+semantic checks (resolves hoisted
    @types/react), external-URL ban, CSS coverage/richness gates,
    `extractClassNames`.
  - `brand-blueprints.ts`: per-brand clone specs (Tinder/X/Insta/Spotify/Trello)
    — features + visual identity + reviewer checklist. Extend here for new brands.
  - `prompts.ts`: hard-edged contracts for 7–8B local models. Keep prompts short
    and literal; pin output formats.
- **Sandbox/preview** — `packages/runtime/src/sandbox/` (manager writes files,
  installs, runs vite); desktop applies chat file blocks via
  `apps/desktop/src/hooks/useAutoSandbox.ts`.
- **Process visibility** — `apps/desktop/src/components/ChatWindow.tsx` (live
  activity strip streams progress steps), `chat/ThinkingPanel*` (post-turn
  evidence; advisor copy must reflect REAL findings).
- **Steering/advisor (being evolved)** — `packages/runtime/src/steering/`.
  Today: a shadow model returns a JSON "steering packet" (route hints, risk
  flags); invalid JSON ⇒ ignored, never blocking. Direction: replace passive
  advice with the **improvement loop** below.

## Design language (binding for desktop UI work)

Any change to `apps/desktop` UI must follow `docs/design/vai-design-language.md`
— accent/box/ambient budgets, voice separation (answer > process > notice),
mode grammar (Instrument/Atelier/Stage), and the adaptive rules (ultrawide
letterbox, portrait, touch). Its "Definition of PASS" extends gate 5 below.

## Quality gates (do not bypass)

1. App.tsx must pass tsc syntax + semantic checks (react-typed when resolvable).
2. No imports beyond `react`; no external asset URLs (offline sandbox).
3. Stylesheet must cover the app's class list and meet the richness bar
   (font, background, hover/focus, ≥10 rules).
4. Council refusal > fallback junk: the one-shot arm is gated too; if nothing
   clears the bar, the turn says so and leaves the preview unchanged.
5. A build is not PASS until the **rendered page** proves it (screenshot:
   gradients painted, styled buttons, no broken images, no console errors).

## The improvement loop (how agents make Vai better)

1. Read `GET /api/agent/introspect` + this file.
2. Observe real turns (WS stages, ThinkingPanel, eval scripts) and the
   sandbox artifacts in `%LOCALAPPDATA%\Temp\vai-sandbox\`.
3. Record findings/proposals in `docs/vai-improvement-backlog.md`
   (append, dated, with evidence). That file is the shared queue between
   V3gga, Vai, and agents.
4. Implement behind tests (`packages/core` vitest) + typecheck, then verify
   live (visible run + screenshots) before claiming success.
5. Update memory/backlog with what was proven, including failures.
