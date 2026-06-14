# Vai Launch Master Plan (2026-06-14)

Unified roadmap from the pre-launch audit, sidebar cleanup, phantom-browser investigation, and Dev Logs gap analysis.

## What is logged to Dev Logs today

| Source | Captured? | How |
|--------|-----------|-----|
| **Vai desktop chat** (composer in app) | Yes | `chatStore` → `sessionCapture` → `/api/sessions` (`auto-capture` tag) |
| **VS Code / Copilot agents** | Yes | `session-bridge.mjs` + VS Code extension (`vscode-agent` tag) |
| **Cursor Composer / Agent chats** | **Now: via bridge** | `pnpm devlogs:cursor:sync` → `cursor-session-bridge.mjs` (`cursor-agent` tag) |
| **Composer internal thinking** | Partial | Cursor JSONL transcripts include assistant text; tool calls map to `tool-call` events. Raw hidden reasoning is **not** exported by Cursor. |
| **Playwright / audit scripts** | Optional | `vai-live-audit.mjs` with `VAI_AUDIT_PUSH_LOGS=1` (`playwright-audit` tag) |

This Cursor chat is **not** auto-ingested until you run `pnpm devlogs:cursor:sync` or `pnpm devlogs:cursor:watch`.

## Phantom `about:blank` Chrome on the taskbar

**Most likely cause:** Cursor IDE’s **Browser MCP** (agent automation Chromium). It registers a Windows window titled `about:blank - Google Chrome` that often cannot be focused or moved with Win+Arrow — it is owned by Cursor, not Vai.

**Secondary causes:** Headed Playwright/Puppeteer scripts (`headless: false`) left running after a killed terminal; orphaned Chromium from interrupted audits.

**Not Vai Preview:** `PreviewPanel` uses an in-app iframe (`about:blank` when no sandbox port) — that does not spawn a separate Chrome taskbar icon.

**Mitigations (this PR):**
- Audit scripts default `headless: true`; use `VAI_AUDIT_HEADED=1` only when you want a visible window.
- SIGINT/SIGTERM handlers always close Playwright browser/context.
- Control panel documents the Cursor MCP window and how to close it.
- Scope `x-vai-dev-auth-bypass` to `/api/*` only (fixes font CORS noise in automated browsers).

**Future (post-launch):** In-app “Automation viewer” dock that replays audit screenshots/video inside Dev Logs — no extra OS window.

## Launch readiness gates

### P0 — Ship blockers
- [x] Council sidebar wired to live `thinking.council` (was `council={null}`)
- [x] Dev Logs source filters (Vai / Cursor / VS Code / Audit)
- [x] Cursor transcript bridge
- [x] Account popover: product menu, debug auth → Settings
- [x] Rail IA: builder role sees Chats + Council + Settings; owner user-view collapses to builder; Docker removed from default rail
- [x] Handoff poll backoff (8s → 60s idle, AbortSignal cancels overlap)
- [x] Knowledge panel: user-facing sources/search; metrics → Settings → Engine
- [x] Council panel auto-opens during live `council-*` stream stages

### P1 — Quality bar
- [ ] `vai-live-audit.mjs`: rail panel screenshots + settlement fixes
- [ ] Council Progress auto-opens when builder turn streams council stages
- [ ] Theme/settings polish (done in prior session)
- [ ] E2E: dev auth bypass does not break Google Fonts

### P2 — Owner lab (hidden by default)
- Vai Gym, Thorsen, Docker clone UI — keep behind owner + “user view” toggle
- Scale eval artifacts in Control (already present)

## Execution order (one cohesive pass)

1. **Visibility & trust** — Dev Logs sources, Cursor bridge, council wiring, phantom browser docs
2. **Product shell** — Account popover, rail IA for builder/admin
3. **Engine honesty** — Knowledge UX, handoff poll, audit harness
4. **Verify** — `pnpm --filter @vai/desktop test`, live audit, manual rail walkthrough

## Commands

```bash
# Sync this Cursor chat into Dev Logs
pnpm devlogs:cursor:sync

# Watch for new Cursor transcript lines (background)
pnpm devlogs:cursor:watch

# Live audit (headless, safe)
pnpm audit:live

# Visible audit window (your screen — close when done)
VAI_AUDIT_HEADED=1 pnpm audit:live

# Push audit summary into Dev Logs
VAI_AUDIT_PUSH_LOGS=1 pnpm audit:live
```
