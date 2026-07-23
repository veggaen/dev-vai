# Context budgeting

## Decision

Context assembly receives the active model window and reserves output/system
headroom before selecting context. It assigns tiers: required turn/system policy;
active workspace/session state; high-confidence relevant memory; on-demand tool
schemas/skills; older history and supporting evidence.

The default toolset is minimal. Models see tool names plus compact descriptions;
full schemas load only after routing selects a tool family. Low-confidence skills
and unrelated memory are excluded. Every inclusion records estimated tokens and
reason, producing an inspectable budget receipt.

## Acceptance

Small/medium/large window tests prove deterministic tier dropping, no system-
policy loss, bounded schema loading, injection wrapping, and no quadratic scans.
