# Inspectable memory and agent-authored skills

## Decision

Memory creation may be automatic, but every record has origin, scope, confidence,
timestamps, evidence references, and revision history. A dedicated UI lists,
edits, deletes, filters, and exports memories. Deletion is real and propagates to
the active index; tombstones handle sync without resurrecting records.

Agent-authored skills are suggestions until observed executions establish a
success history. Confidence is a calibrated score from verified outcomes, sample
count, recency, and failure severity. Low-confidence skills are flagged and never
silently injected or granted capabilities.

Memory/skill text is untrusted when supplied to a model. Repo-provided memories or
skills cannot raise their scope or authority.

## Acceptance

CRUD/export/index tests, tombstone reconciliation, confidence movement after
success/failure, low-sample flags, and prompt-injection memory/skill tests pass.
