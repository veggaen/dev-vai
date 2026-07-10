# Council IDE — Folder-in-Chat, Diff-Reviewed Editing

Status: draft / build plan. Decisions locked with the user (2026-07):
- **Start with the IDE substrate first** (open-folder + read/edit/diff + approval), plus
  the ability to **attach a folder when starting a chat** so selected members / the whole
  council + Vai decide how to use the coder model and the others.
- **Review every diff**: nothing is written to disk until the user approves. Reversible.
- Inspirations: t3.chat/code, PewDiePie's "Odyssey" IDE, VS Code, the Codex app.

## Grounding in the existing codebase
- Chat orchestrates the council today via `convene()` — `packages/core/src/chat/service.ts:1574`.
- The council already has topic routing (`topic-router.ts`), member selection, sequential
  GPU-aware execution, peer-note deliberation (`deliberate.js`), trust weighting, and
  consensus governance (`council.ts`). The IDE **reuses** all of this — we are pointing the
  council you already built at a code folder, not building a new agent framework.
- Desktop is Tauri; folder access needs the `dialog` + `fs` plugins (or bespoke Rust
  commands) plus capability entries. Diffs and approval live in the React layer.

## Research that shapes the design (why not "everyone debates forever")
- **Supervisor pattern is the 2026 default**: orchestrator → specialists → integrator.
  Prefer this over open-ended debate.
- Multi-agent **debate** adds ~2.5× cost and has real failure modes: sycophantic
  conformity, consensus collapse, and — critically — **a weaker local model drags down a
  stronger one**. Keep rounds **bounded (1–2)**, and don't mix a weak model into a debate
  with a strong one on the same sub-task.
- Isolated self-correction often beats unguided homogeneous debate and is far cheaper.
- Translation for us: keep the **rotating specialist roles** (frontend, backend, animation,
  "human simulator" = QA/UX persona) — that part is well-supported — but structure them as
  orchestrator → role specialists → a single judge, with capped deliberation.

## Data model (slice 1 — shipped as `workspace-edit.ts`, pure + tested)
- `WorkspaceRef` — an attached folder: `{ id, path, name, attachedAt }`.
- `FileEditProposal` — a proposed change to one file: `{ path, before, after, summary,
  author }` where `author` is the member/role that proposed it.
- `EditReview` — the approval decision: `pending | approved | rejected`.
- Pure helpers: build a unified diff, compute a proposal from before/after, and decide
  whether a proposal is safe to auto-surface (no-op detection, binary/large-file guard).
  These are dependency-free so they compile and unit-test in isolation.

## Layered build plan (each layer is independently buildable + reviewable)

**L1 — Substrate (start here)**
1. `workspace-edit.ts` types + diff/approval helpers (pure). ← *this slice*
2. Tauri: `dialog` + `fs` plugins/commands to pick a folder, list a tree (git-ignored
   filtered), read a file, and write a file — writes gated behind an approved proposal.
   Capability entries scoped to the chosen folder only.
3. React: a folder chip on the composer / new-chat screen (attach a folder to the chat);
   a file tree panel; a diff viewer with Approve / Reject per hunk.

**L2 — Single-agent editing**
- Attach folder → pick one member (the coder model by default) → give a task → it returns
  `FileEditProposal[]` → user reviews diffs → approved ones are written. (Your "select one
  member to edit the code.")

**L3 — Role-specialized council**
- On a new folder-chat, detect the topic/niche via the existing `topic-router`, assign role
  prompts (frontend / backend / animation / human-sim), each member proposes independently,
  a **judge** member integrates into one coherent proposal set. Supervisor-style, not a
  free-for-all.

**L4 — Bounded deliberation**
- One round of peer critique via existing `deliberate.js` ("you said X, I'd change Y"),
  then converge. Hard cap on rounds; drop the weak-model-into-strong-debate anti-pattern.

**L5 — Safety rails**
- Optional: run tests/typecheck on the proposed diff before surfacing; always git-backed so
  every applied change is reversible; review-every-diff stays the default.

## Open item: data cleanup
The user asked to "clean up / wipe the data" once this is built. This is **destructive and
not yet scoped** — before doing anything: confirm exactly which data (chat history? the
speech profile? the adaptation corpus? account-level data?), whether it's irreversible, and
whether it should be a one-time action or a user-facing "reset" button. No deletion happens
until that's confirmed in writing.
