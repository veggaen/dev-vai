# Capability scopes and threat model

## Boundary

The runtime/tool host is trusted; an opened repository, its configuration, its
scripts, and model-generated tool calls are not. UI controls express intent but
cannot grant authority. Only the tool dispatcher enforces authority.

## Matrix

Scopes are `read-only`, `no-shell`, `no-network`, and `full`. Workspace policy
sets the ceiling; a session may only reduce it. Tool metadata declares required
capabilities (`read`, `write`, `shell`, `network`, `git`, `process`). Dispatch
denies missing requirements before argument parsing or tool execution and emits
a structured, visible denial.

Repo-provided config can request less authority, never more. Defaults are
read-only for untrusted workspaces and no-network/no-shell for new automation.
Full remains an explicit local user grant.

## Known gaps

OS ACLs, compromised provider binaries, kernel-level attacks, and data inferred
from already-authorized reads remain outside this layer. Multi-user machines
need OS-account separation; Vai credentials alone are not a sandbox.

## Acceptance

Matrix tests cover every scope/tool class, workspace/session intersection,
repo-config escalation attempts, unknown tools, and UI claims that disagree with
dispatcher authority.
