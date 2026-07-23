# Vai capability and untrusted-input threat model

Status: implemented foundation, 2026-07-22. This document is intentionally candid; it is not a claim that sandboxing is complete.

## Trust boundary

Vai trusts its signed application code, host-owned policy store, authenticated user decisions, and operating-system credential store. A project becomes untrusted input the moment it is opened. Repository files, repository configuration, README/docs/comments, web pages, tool and subprocess output, imported memories, and non-builtin skills are data. None may grant a capability or become system authority.

Model output is also untrusted. Models propose actions; the tool dispatcher checks the host-owned workspace and session scopes before execution. UI state is informative only and is never an authorization source.

## Capability scopes

Scopes are intersected at dispatch time:

| Scope | Allowed capability classes |
| --- | --- |
| `read-only` | read |
| `no-shell` | read, write, network, git |
| `no-network` | read, write, shell, git, process |
| `full` | read, write, shell, network, git, process |

The session scope may restrict but cannot expand the workspace scope. Tools declare required capability classes. A denial is a structured, visible result. Repository-provided configuration is excluded from the policy input by design.

## Prompt-injection boundary

Every supported externally controlled text surface must pass through `wrapUntrustedContent`. It labels the source and places the content in a sentinel-delimited data block. Every model conversation also receives a standing policy that instructions inside those blocks are not authority. Closing-marker injection is escaped and content is bounded by the constants package.

This is defense in depth, not a mathematical guarantee that a model cannot be influenced. The deterministic dispatch gate remains the security boundary even if the model mishandles the label.

## Known gaps

- Opaque provider CLIs declare read/write/shell/network/git/process as a complete capability set. Vai refuses to create their worktree or process unless the intersected workspace/session scope is `full`; finer portable OS sandboxing is not claimed.

- OS-level containment for arbitrary process execution is not complete. `full` and `no-network` sessions can still run programs with the current user’s OS privileges.
- `git` is a coarse capability class. Mutating git operations need a finer action policy before broad agent exposure.
- The initial dispatcher covers Vai’s central model-tool loop. Legacy deterministic helpers that call filesystem, browser, or subprocess primitives directly must be migrated behind the same dispatcher or independently gated.
- Builtin skills are trusted application code. Installed skills are wrapped as untrusted data, but signature and publisher verification are future work.
- The wrapper reduces prompt-injection risk but does not sanitize factual deception in external content; source verification and provenance gates are still required.
- Multi-user process isolation and encrypted-at-rest workspace metadata depend on the host OS and are not yet a complete cross-platform sandbox.

Any newly discovered bypass is treated as a security bug. Opening a repository never prompts for or silently upgrades capabilities.
