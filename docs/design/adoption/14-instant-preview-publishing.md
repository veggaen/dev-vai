# Instant preview, publishing, and stable permalinks

## Decision

The default share path serves plain/markdown files directly from an incremental
manifest; no build step. Local edits enqueue a delta and observable propagation
target under seconds. Optional themes/CSS and custom domains layer on top.

Shared objects get immutable IDs and stable slugs. Renaming changes the preferred
slug while old slugs resolve through redirects. Custom domains require true DNS
record verification and TLS state, not URL masking.

## Security and acceptance

Only manifest-selected content is readable. Path traversal, symlinks outside the
root, ignored/private files, secrets, and stale manifests are denied. Tests cover
rename/permalink, rapid edits, offline queue, DNS states, CSS isolation, and
platform path/case differences.
