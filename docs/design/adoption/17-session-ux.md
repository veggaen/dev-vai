# Session UX

## Decision

Each agent session exposes: a changed-files card sourced from its isolated
worktree; a timeline minimap for long streams; file drag/drop into the composer;
complete approval details (actor, operation, arguments, paths/hosts, capability,
scope, duration, consequences); and an environment chip whenever context is not
the local default.

Dropped files become explicit attachments, not hidden prompt text. Directories
require an ignore-aware selection step. Approval summaries never omit destructive
or external effects.

## Acceptance

Rendered desktop tests cover empty/large changes, rename/delete, long timeline,
mixed drag types, offline attachment retention, narrow/touch layouts, approval
keyboard focus, and remote environment visibility.
