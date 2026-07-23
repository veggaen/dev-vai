# Vai adoption architecture

Status: approved implementation brief, 2026-07-22.

This index turns the T3 Code, Odysseus, and Obsidian Publish study into Vai-owned
designs. The source projects are references only: T3 Code patterns may be studied
under MIT; Odysseus is pattern-only because it is AGPL-3.0; Obsidian contributes
UX inspiration only because it is proprietary. No source code is copied.

Implementation order is binding:

1. [Schema-only contracts](01-schema-only-contracts.md)
2. [Constants and literal policy](02-platform-constants.md)
3. [Untrusted-content boundary](03-untrusted-content.md)
4. [Capability scopes](04-capability-scopes.md)
5. [Agent process adapters](05-agent-process-adapters.md)
6. [Worktree sessions](06-worktree-sessions.md)
7. [Disconnect resilience](07-disconnect-resilience.md)
8. [Inspectable memory and skills](08-inspectable-memory-skills.md)
9. [Personas and blind comparison](09-personas-and-compare.md)
10. [Context budgeting](10-context-budgeting.md)
11. [Environment abstraction and pairing](11-environments-and-pairing.md)
12. [SSH launch](12-ssh-launch.md)
13. [File ownership and export](13-file-ownership-export.md)
14. [Instant preview and stable publishing](14-instant-preview-publishing.md)
15. [Linked navigation](15-linked-navigation.md)
16. [Selective sharing](16-selective-sharing.md)
17. [Session UX](17-session-ux.md)
18. [Hardware-aware models](18-hardware-aware-models.md)
19. [Health and degraded state](19-health-degraded-state.md)

Global invariants: untrusted workspace on open; no repo-config capability
escalation; auth and loopback by default; no secret query parameters; per-
integration tokens; incremental ignore-aware indexing; no shell-specific
assumptions; visible failures; plain-file ownership; documented backup/restore.
Reliability ranks first, performance second, convenience third.
