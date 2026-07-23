# Selective sharing and exposure review

## Decision

Sharing starts from an explicit manifest, never implicit workspace visibility.
Items can be included/excluded individually or by reviewed rules. Per-item access
is public, authenticated, token-protected, or private. Tokens are integration-
scoped and revocable.

Bulk selection shows a compact exposure review grouped by path/type/protection,
with counts, newly exposed items, removals, unresolved links, secret warnings,
and a final diff. The publish action uses the reviewed manifest revision.

## Acceptance

Tests cover select-all/partial states, renamed/deleted items, inherited rules,
mixed protection, stale review revisions, secret/path blocks, keyboard and screen
reader flow, and revocation.
