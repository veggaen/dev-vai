# Vai IDE — Design Document

**Status:** Approved direction — ready to build  
**Author:** Grok (for V3gga)  
**Date:** 2026-07-07  
**Related:** `docs/council-ide-roadmap.md`, `AGENTS.md`, `docs/path-a-architecture.md`

---

## Executive summary

Vai becomes a **great IDE** by unifying what already exists — not by cloning Odysseus or T3 Code.

The product thesis:

> **Chat with a workspace attached → council proposes changes → user reviews every diff → deterministic gates run → preview proves it → approved writes land once.**

Vai’s wedge vs [Odysseus](https://github.com/pewdiepie-archdaemon/odysseus) and [T3 Code](https://github.com/pingdotgg/t3code):

| Reference | Their bet | Vai’s bet |
|-----------|-----------|-----------|
| Odysseus | Self-hosted AI *workspace* (chat, docs, email, calendar, research…) | **Code workspace** with council + verification — not life-OS scope |
| T3 Code | Thin GUI wrapping external agent CLIs (Codex, Claude Code, Cursor CLI) | **Vai is the institution** — models are staff; gates and routers are code |
| Both | Ship fast, session-centric UX | **Trust through visibility** — ThinkingPanel, activity strip, visual PASS gates |

Today Vai has **two parallel IDE tracks** that feel like different apps:

1. **Sandbox builder** — `App.tsx` builder panel, `PreviewPanel`, `FileExplorer`, `useAutoSandbox`
2. **Council-IDE** — `WorkspaceLauncher` modal (`Ctrl+Shift+O`), local disk, `DiffReview`

This design merges them into **one Odyssey-layout shell** with a single workspace model per conversation.

---

## Design principles (non-negotiable)

1. **Vai is not an LLM wrapper.** Routing, gates, and approval are deterministic code (`packages/core`).
2. **Review every diff.** Nothing writes to disk without explicit approval (default). Auto-apply is opt-in per turn.
3. **Visibility is the feature.** Users see council stages, diffs, build logs, and preview proof — not black-box magic.
4. **One workspace per conversation.** Either a **local folder** or a **sandbox project** — never both active silently.
5. **Reuse before rebuild.** Promote existing components into the shell; don’t fork VS Code or wrap Cursor CLI.
6. **Windows-first, Node 22 + TypeScript.** No Python in Vai’s stack.
7. **PASS means looked.** A build is not done until the rendered page proves it (existing quality bar).

---

## Current inventory (what we ship from)

### Shell & layout — **ready**

| Asset | Path | Notes |
|-------|------|-------|
| Main shell | `apps/desktop/src/App.tsx` | `react-resizable-panels`: chat \| builder |
| Layout store | `apps/desktop/src/stores/layoutStore.ts` | `compact` / `open` / **`odyssey`** |
| Odyssey theme | `apps/desktop/src/lib/odysseus-theme.js`, `styles/index.css` | Bubble panels, atmosphere |
| Activity rail | `apps/desktop/src/components/ActivityRail.tsx` | Icon nav |
| Workspace controls | `apps/desktop/src/components/workspace/WorkspaceLayoutControls.tsx` | Focus, fullscreen, council |
| Shortcuts | `apps/desktop/src/lib/keyboard-shortcuts.ts` | `Ctrl+B/E/J`, `Ctrl+3` builder |

### Sandbox builder — **functional, needs diff gate**

| Asset | Path | Notes |
|-------|------|-------|
| Preview | `apps/desktop/src/components/PreviewPanel.tsx` | iframe + code textarea |
| File tree | `apps/desktop/src/components/FileExplorer.tsx` | Read-only viewer today |
| Console | `apps/desktop/src/components/DebugConsole.tsx` | Logs only — not a PTY |
| Sandbox store | `apps/desktop/src/stores/sandboxStore.ts` | Deploy, files, revisions |
| Auto-apply | `apps/desktop/src/hooks/useAutoSandbox.ts` | Chat → extract → deploy (bypasses diff review) |

### Council-IDE — **L1 shipped, trapped in modal**

| Asset | Path | Notes |
|-------|------|-------|
| Launcher | `apps/desktop/src/components/ide/WorkspaceLauncher.tsx` | `Ctrl+Shift+O` modal |
| Diff UI | `apps/desktop/src/components/ide/DiffReview.tsx` | Approve / reject per file |
| Pure model | `packages/core/src/ide/workspace-edit.ts` | `WorkspaceRef`, `FileEditProposal` |
| Desktop client | `apps/desktop/src/lib/ide/workspace-client.ts` | Tauri FS + `/api/ide/*` |
| Runtime API | `packages/runtime/src/routes/ide.ts` | `propose`, `council` |
| Tauri FS | `apps/desktop/src-tauri/src/main.rs` | `ide_list_dir`, `ide_read_file`, `ide_write_file` |

### Orchestration — **exists, needs IDE event channel**

| Asset | Path | Notes |
|-------|------|-------|
| Chat + council | `packages/core/src/chat/service.ts` | `convene()`, builder routing |
| Council codegen | `packages/core/src/models/builder/council-codegen/` | Sandbox app pipeline |
| WS contract | `packages/api-types/src/chat-ws.ts` | Extend with `ide.*` |
| Process UI | `ThinkingPanel`, `CouncilProgressPanel`, activity strip | Real findings only |
| VS Code companion | `apps/vscode-extension/` | `editorContext` on WS inbound |

### Roadmap already written

`docs/council-ide-roadmap.md` defines L1–L5. This document **operationalizes** L1–L2 inside the main shell and connects them to the sandbox builder.

---

## Target experience

### Primary user stories

**US-1 — Attach a repo and edit with council**

1. User starts a chat, clicks **Attach folder** (or `Ctrl+Shift+O`).
2. Composer shows chip: `📁 dev-vai`.
3. Layout auto-switches to **Odyssey IDE** (file tree + editor + optional preview).
4. User asks: “Add a dark-mode toggle to Settings.”
5. Council returns `FileEditProposal[]` → **Diff review panel** opens.
6. User approves 2/3 files, rejects 1.
7. Approved files write via guarded Tauri command.
8. Optional: `pnpm test` output streams to console; gate surfaces failures before next turn.

**US-2 — Build an app in sandbox (existing flow, gated)**

1. User switches to **builder mode** (`Ctrl+3`).
2. Chip shows: `🏗️ sandbox: spotify-clone`.
3. Council codegen runs → proposals appear as diffs (not silent `useAutoSandbox` write).
4. User approves → sandbox deploys → preview iframe updates.
5. Visual gate runs → PASS/FAIL shown in ThinkingPanel with screenshot evidence.

**US-3 — External IDE companion**

1. User codes in VS Code with Vai extension.
2. Desktop chat receives `editorContext` (open file, selection, terminal).
3. Chip shows: `🔗 VS Code — App.tsx` (companion context, not full workspace).
4. Council proposals target the companion file paths when workspace matches.

---

## Architecture

### High-level diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Vai Desktop (Tauri) — Odyssey layout                                    │
│  ┌────┐ ┌──────────┐ ┌─────────────────────┐ ┌────────────────────────┐ │
│  │Rail│ │ Sidebar  │ │ ChatWindow          │ │ IDE Workspace          │ │
│  │    │ │ (chats)  │ │ + folder chip       │ │ ├─ FileTreePanel       │ │
│  │    │ │          │ │ + council strip     │ │ ├─ EditorTabs          │ │
│  │    │ │          │ │                     │ │ ├─ PreviewPanel        │ │
│  │    │ │          │ │                     │ │ ├─ DiffReview (dock)   │ │
│  │    │ │          │ │                     │ │ └─ DebugConsole / Term │ │
│  └────┘ └──────────┘ └─────────────────────┘ └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
         │                              │
         │  WS /api/chat               │  REST + Tauri invoke
         ▼                              ▼
┌─────────────────────┐       ┌──────────────────────┐
│  ChatService        │       │  IDE routes          │
│  convene()          │       │  /api/ide/propose    │
│  council-codegen    │       │  /api/ide/council    │
│  gates + satisfaction│       │  sandbox manager     │
└─────────────────────┘       └──────────────────────┘
         │                              │
         └──────────┬───────────────────┘
                    ▼
         packages/core/src/ide/workspace-edit.ts
         (WorkspaceRef, FileEditProposal, diff helpers)
```

### Orchestration model (T3-inspired, Vai-native)

T3 Code uses a typed push bus + receipts. Vai should adopt the **pattern** without copying their provider layer:

```
User action
  → ChatService / IDE service (orchestration)
  → Domain events (ide.proposal, ide.checkpoint, build.stage, preview.pass)
  → UI stores hydrate from events
  → Receipts when async work completes (diff ready, tests done, turn quiescent)
```

**Rule:** The desktop UI subscribes to **one ordered event stream per conversation**, not ad-hoc cross-store patches.

### Workspace kinds

```typescript
type WorkspaceKind = 'none' | 'local' | 'sandbox' | 'companion';

interface ActiveWorkspace {
  kind: WorkspaceKind;
  ref: WorkspaceRef | SandboxRef | CompanionRef | null;
  conversationId: string;
}
```

| Kind | Source | Writes | Preview |
|------|--------|--------|---------|
| `local` | Tauri folder attach | Approved diffs → disk | Optional dev server user starts |
| `sandbox` | Council codegen / chat extract | Approved diffs → sandbox API | `PreviewPanel` iframe (required for PASS) |
| `companion` | VS Code extension context | Proposals target companion paths | N/A (user previews in VS Code) |
| `none` | — | Chat only | Hidden builder panel |

---

## UI specification

### Layout modes

| Mode | When | Layout |
|------|------|--------|
| `compact` | Default chat | Chat-focused; builder collapsed |
| `open` | Builder turn | Chat + builder side-by-side, edge panels |
| **`odyssey`** | Folder attached or builder mode | Floating bubbles; IDE workspace dominant |

**Auto-switch rules:**

- Attach folder OR `mode === 'builder'` → set `layoutMode: 'odyssey'`, `showBuilderPanel: true`
- Detach workspace AND `mode === 'chat'` → restore previous layout preference
- `focusMode` (`Ctrl+0`) overrides — chat only, workspace hidden until exit

### Odyssey IDE panel layout (`vai-builder-layout`)

```
┌─ FileTree (20%) ─┬─ Editor (45%) ─────────────┬─ Preview (35%) ─┐
│  src/            │  [App.tsx] [index.css] ×   │  [iframe]        │
│  components/     │  ┌──────────────────────┐  │  deploy toolbar │
│  packages/       │  │  textarea → Monaco   │  │                  │
│                  │  │  (phase 1: textarea) │  │                  │
│                  │  └──────────────────────┘  │                  │
├──────────────────┴──────────────────────────┴──────────────────┤
│  DebugConsole / Terminal (25% height, collapsible)  [Ctrl+J]    │
└─────────────────────────────────────────────────────────────────┘
```

**Diff review** docks as a **right sheet** (400px) over editor+preview, not a separate modal.

### Composer chrome

```
┌──────────────────────────────────────────────────────────────┐
│ [📁 dev-vai ×]  [⚙ local · 12 proposals pending]             │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Ask Vai to refactor the voice settings panel…            │ │
│ └──────────────────────────────────────────────────────────┘ │
│ [mic] [depth] [send]                                          │
└──────────────────────────────────────────────────────────────┘
```

- **Folder chip** — click opens tree; `×` detaches (with confirm if pending proposals).
- **Pending badge** — count of `status: 'pending'` proposals.
- Attach via: chip click → native folder picker (Tauri `dialog`) OR path paste fallback.

### Keyboard shortcuts (additions)

| Shortcut | Action | Phase |
|----------|--------|-------|
| `Ctrl+Shift+O` | Attach / focus workspace (promote from modal toggle) | P1 |
| `Ctrl+Shift+D` | Toggle diff review panel | P1 |
| `Ctrl+Shift+W` | Detach workspace | P1 |
| `Ctrl+J` | Toggle console (existing) | — |
| `Ctrl+E` | Toggle file tree (existing) | — |
| `Ctrl+3` | Builder mode (existing) | — |
| `Ctrl+Shift+M` | Cycle layout (existing) | — |

Register new ids in `keyboard-shortcuts.ts`: `attachWorkspace`, `toggleDiff`, `detachWorkspace`.

---

## Data model

### Conversation ↔ workspace binding

Extend conversation metadata (DB schema or chat store):

```typescript
interface ConversationWorkspace {
  conversationId: string;
  workspace: WorkspaceRef | null;      // local folder
  sandboxId: string | null;            // active sandbox project
  autoApply: boolean;                  // default false — diff review required
}
```

`WorkspaceRef` already defined in `packages/core/src/ide/workspace-edit.ts`.

### Proposal lifecycle

```
pending → approved → applied
        ↘ rejected
```

- **pending** — shown in DiffReview; blocks nothing else.
- **approved** — queued for write; checkpoint taken first (P2).
- **applied** — written; `appliedAt` timestamp; reversible via git/sandbox revision.
- **rejected** — archived for council learning signal; never written.

### Checkpoint (P2)

Before `applyApprovedProposals`:

- **Local:** `git stash push -m "vai-pre-apply-{proposalId}"` if repo is git; else copy to `%LOCALAPPDATA%/vai/checkpoints/`.
- **Sandbox:** use existing `sandboxStore` revision snapshot.

---

## Event contract (new)

Add `packages/api-types/src/ide-ws.ts` and extend chat outbound chunks.

### IDE domain events (server → client)

```typescript
type IdeEvent =
  | { type: 'ide.workspace.attached'; workspace: WorkspaceRef }
  | { type: 'ide.workspace.detached' }
  | { type: 'ide.proposal.created'; proposals: FileEditProposal[] }
  | { type: 'ide.proposal.updated'; id: string; status: ReviewStatus }
  | { type: 'ide.checkpoint.created'; id: string; label: string }
  | { type: 'ide.apply.started'; proposalIds: string[] }
  | { type: 'ide.apply.done'; applied: string[]; failed: { id: string; error: string }[] }
  | { type: 'ide.gate.result'; gate: 'tsc' | 'visual' | 'test'; pass: boolean; detail: string }
  | { type: 'ide.turn.quiescent' };  // all async IDE work finished — T3-style receipt
```

### Chat WS inbound extension

```typescript
// Add to chatWebSocketInboundSchema (optional fields):
workspaceRoot: z.string().optional(),     // absolute path, server validates
sandboxId: z.string().optional(),
requireDiffApproval: z.boolean().optional(), // default true
```

### Client store

New `apps/desktop/src/stores/workspaceStore.ts`:

```typescript
interface WorkspaceStore {
  active: ActiveWorkspace | null;
  proposals: FileEditProposal[];
  openTabs: { path: string; content: string; dirty: boolean }[];
  activeTab: string | null;
  showDiffPanel: boolean;

  attachLocal: (path: string) => Promise<void>;
  detach: () => void;
  setProposalStatus: (id: string, status: ReviewStatus) => void;
  applyApproved: () => Promise<void>;
}
```

---

## Component plan (reuse map)

| New / changed | Built from |
|---------------|------------|
| `IdeWorkspacePanel` | `App.tsx` builder `Group` — extract from inline JSX |
| `FileTreePanel` | `FileExplorer.tsx` + `WorkspaceLauncher` tree logic |
| `EditorTabs` | `PreviewPanel` code mode textarea → Monaco in P3 |
| `DiffReviewPanel` | `DiffReview.tsx` — remove modal wrapper |
| `WorkspaceChip` | new — composer in `ChatWindow.tsx` |
| `workspaceStore` | new — bridges `sandboxStore` + `workspace-client` |
| `useAutoSandbox` | **gate** — emit proposals instead of direct `writeFiles` when `requireDiffApproval` |

**Delete / demote after P1:**

- `WorkspaceLauncher` full-screen modal → inline panel (keep `Ctrl+Shift+O` as attach shortcut).
- Dual file-tree implementations → single `FileTreePanel` with `source: 'local' | 'sandbox'`.

---

## Phased delivery

### Phase 1 — Unified shell (MVP IDE feel)

**Goal:** One workspace UX in the main builder panel; folder chip; diff review in-shell.

| PR | Title | Scope |
|----|-------|-------|
| P1-1 | `workspaceStore` + types | Store, `ActiveWorkspace`, conversation binding in `chatStore` |
| P1-2 | `WorkspaceChip` in composer | Attach/detach UI, pending count badge |
| P1-3 | `FileTreePanel` unification | Local + sandbox tree behind one component |
| P1-4 | Promote `DiffReview` to docked panel | Right sheet in builder; wire approve → `applyApprovedProposals` |
| P1-5 | Demote `WorkspaceLauncher` modal | Inline attach flow; Tauri native folder picker |
| P1-6 | Auto Odyssey layout | On attach/builder → `layoutMode: 'odyssey'`, show panels |
| P1-7 | Gate `useAutoSandbox` | Proposals first when `autoApply: false` (default) |

**Exit criteria (P1):**

- [ ] Attach `dev-vai` folder from composer; chip visible
- [ ] File tree shows real disk files in builder panel (not modal)
- [ ] Manual edit → propose → diff → approve → file on disk
- [ ] Sandbox builder still works; diffs shown before deploy
- [ ] `Ctrl+Shift+O` opens attach, not a disconnected modal

### Phase 2 — Orchestration + checkpoints

| PR | Title | Scope |
|----|-------|-------|
| P2-1 | `ide-ws.ts` event types | `packages/api-types` |
| P2-2 | Emit IDE events from ChatService / sandbox | Proposal created, gate results |
| P2-3 | `workspaceStore` subscribes to WS | Replace polling ad-hoc updates |
| P2-4 | Checkpoint before apply | Git stash or sandbox revision |
| P2-5 | `ide.turn.quiescent` receipt | UI knows when turn is fully done |
| P2-6 | New keyboard shortcuts | `toggleDiff`, `detachWorkspace` |

**Exit criteria (P2):**

- [ ] Approve writes only after checkpoint id returned
- [ ] Activity strip shows IDE events alongside council stages
- [ ] No duplicate proposal application on reconnect

### Phase 3 — Editor upgrade

| PR | Title | Scope |
|----|-------|-------|
| P3-1 | Monaco in `EditorTabs` | Syntax highlight, basic TS |
| P3-2 | Multi-tab open/close/dirty | Tab bar above editor |
| P3-3 | Find in file | Monaco built-in |

### Phase 4 — Terminal

| PR | Title | Scope |
|----|-------|-------|
| P4-1 | PTY in runtime sidecar | `node-pty` or Tauri equivalent |
| P4-2 | `TerminalPanel` | Replaces/extends `DebugConsole` with input |
| P4-3 | Run configs | `pnpm dev`, `vitest` buttons per workspace |

### Phase 5 — Council-IDE L3–L5 (differentiator)

Per `docs/council-ide-roadmap.md`:

| Layer | Deliverable |
|-------|-------------|
| L3 | Topic-router assigns roles; judge integrates proposals |
| L4 | One bounded `deliberate.js` round |
| L5 | Pre-surface test/typecheck; git-backed revert; review-every-diff stays default |

Wire `/api/ide/council` into `convene()` for folder-attached chats — not a separate modal flow.

---

## Integration with existing Vai systems

### Builder / council-codegen

When `workspace.kind === 'sandbox'`:

1. Council codegen output becomes `FileEditProposal[]` (App.tsx, index.css, etc.).
2. Existing validate-app / visual gates run **after** approve, before `sandboxStore.deploy`.
3. `useAutoSandbox` becomes a **proposal emitter** — not a silent writer.

### Chat modes

| `ChatMode` | Workspace behavior |
|------------|-------------------|
| `chat` | Optional folder attach; no auto-deploy |
| `builder` | Sandbox workspace; preview required |
| `agent` | Folder attach; council proposes diffs |
| `plan` | Read-only tree; proposals disabled until user confirms plan |
| `debate` | Multi-model review of proposals before diff panel |

### VS Code companion

- `editorContext` on WS inbound already exists.
- Show companion chip when fresh context present.
- Proposals include `author: { memberId, role }` + companion file path validation.

### Quality gates (unchanged bar)

1. App.tsx passes tsc syntax + semantic checks.
2. CSS covers class list + richness bar.
3. Rendered preview PASS with screenshot evidence.
4. Council refusal > fallback junk.

IDE layer adds: **no apply without approval** as gate 0.

---

## Non-goals (this quarter)

- Email, calendar, notes (Odysseus scope)
- Wrapping Cursor CLI / Codex CLI as primary agent (T3 scope)
- Full VS Code fork or LSP for all languages
- Git GUI (beyond stash checkpoint) — later
- Multi-root workspaces — one folder per conversation for now
- Cloud sync of workspace state

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Two stores (sandbox + local) diverge | Single `workspaceStore` facade |
| `useAutoSandbox` bypasses review | Default `autoApply: false`; builder turns emit proposals |
| Modal `WorkspaceLauncher` stays orphaned | P1-5 removes modal; shortcut opens attach flow |
| PTY complexity on Windows | Phase 4 — logs-only console sufficient until P3 done |
| Council cost on every keystroke | Proposals on turn complete only, not per partial |
| Path escape / security | Keep Tauri path guards; relative paths in proposals only |

---

## Success metrics

**Feel:**

- User can attach a folder and approve a council diff without opening a modal.
- Builder turn shows diffs before preview changes.
- Odyssey layout feels like a cohesive IDE, not chat with a popup.

**Measure:**

- P1 manual script: attach → propose → approve → disk write < 60s
- Zero silent `writeFiles` on builder turns with default settings
- Visual gate PASS rate unchanged or improved (no junk deploys)

---

## Build order for V3gga (suggested)

When you sit down to build the desktop app, follow this order:

1. **P1-1** `workspaceStore` — foundation everything else hangs on
2. **P1-2** `WorkspaceChip` — makes workspace visible immediately
3. **P1-4** Docked `DiffReview` — the core IDE trust loop
4. **P1-3** Unified file tree — browse attached folder in builder
5. **P1-6** Auto Odyssey layout — the “great IDE” first impression
6. **P1-7** Gate `useAutoSandbox` — stops silent overwrites
7. **P1-5** Remove modal launcher — cleanup

Then P2 events/checkpoints when P1 feels solid.

---

## Appendix A — File touch list (P1)

```
apps/desktop/src/stores/workspaceStore.ts          (new)
apps/desktop/src/components/ide/WorkspaceChip.tsx  (new)
apps/desktop/src/components/ide/FileTreePanel.tsx  (new)
apps/desktop/src/components/ide/IdeWorkspacePanel.tsx (new)
apps/desktop/src/components/ide/DiffReviewPanel.tsx   (wrap DiffReview)
apps/desktop/src/components/ChatWindow.tsx         (chip, WS workspace)
apps/desktop/src/components/ide/WorkspaceLauncher.tsx (demote/remove)
apps/desktop/src/App.tsx                           (builder panel compose)
apps/desktop/src/hooks/useAutoSandbox.ts           (proposal gate)
apps/desktop/src/stores/chatStore.ts               (conversation workspace)
apps/desktop/src/lib/keyboard-shortcuts.ts         (new shortcut ids)
packages/core/src/ide/workspace-edit.ts            (minor helpers if needed)
```

---

## Appendix B — Reference links

- Odysseus: https://github.com/pewdiepie-archdaemon/odysseus — workspace breadth, document editor, self-hosted hub
- T3 Code architecture: https://github.com/pingdotgg/t3code/blob/main/docs/architecture/overview.md — orchestration engine, typed pushes, receipts
- Vai council-IDE roadmap: `docs/council-ide-roadmap.md`
- Vai agent guide: `AGENTS.md`

---

*Review this doc, then start with P1-1 (`workspaceStore`). The existing components do the heavy lifting — the work is wiring them into one Odyssey shell.*