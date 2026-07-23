# Parallel worktree sessions

## Decision

Code-changing agent sessions default to a git worktree created from the default
remote branch. Read-only sessions may use the original workspace. Worktree names
are stable session IDs under a Vai-owned cache, never inside the untrusted repo.

## Conflict policy

Unsaved editor buffers win: an agent cannot overwrite them. Agent edits remain in
its worktree until reviewed. Integration is a three-way git operation against the
current workspace; conflicts produce a changed-files card and explicit review.
Git operations pause when the index/worktree has overlapping user changes. Vai
never resets, stashes, commits, rebases, or deletes a worktree implicitly.

Default branch discovery prefers the remote HEAD, then configured upstream, then
current branch with a visible degraded note. Ignore-aware incremental status is
used; no whole-tree content scans.

## Acceptance

Tests cover detached HEAD, no remote, dirty index, unsaved overlap, rename/delete,
Windows path length, case-insensitive collisions, and safe worktree cleanup.
