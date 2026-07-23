# Linked navigation

## Decision

A typed link index relates files, headings, sessions, runs, docs, memories, and
share objects. Stable object IDs survive renames. Incremental parsers update only
changed files and honor gitignore/Vai ignores; no whole-tree rescan per edit.

The desktop offers cross-reference links, hover previews, backlinks, and an
optional graph/spatial view. Hover data is bounded and sanitized. Missing targets
remain visible as unresolved links rather than disappearing.

## Acceptance

Incremental add/edit/rename/delete tests, cycles, duplicate headings, case-sensitive
and insensitive filesystems, ignored folders, large synthetic monorepo budget,
keyboard previews, and graph opt-out.
