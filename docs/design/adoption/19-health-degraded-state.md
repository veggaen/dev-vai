# Health and degraded-state panel

## Decision

Each optional subsystem reports `healthy`, `degraded`, `offline`, `starting`, or
`unknown`, plus last check, latency, concise cause, evidence reference, impact,
and next action. Initial providers: runtime, database, LSP, indexer, model
providers, agent adapters, remote environments, preview/publish, and voice.

The aggregate never collapses optional failure into whole-app failure. Features
declare dependencies and disable only affected actions. Health updates are
bounded, cached, and push-capable; the UI remains usable offline.

## Acceptance

Contract/aggregation/staleness tests and rendered panel checks for mixed health,
long diagnostics, copy action, recovery, narrow/touch layouts, and zero console
errors. The panel must say what still works.
