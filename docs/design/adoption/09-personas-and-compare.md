# Personas, group sessions, and blind comparison

## Decision

A persona is a named, versioned system-prompt profile with description, optional
model preference, capability ceiling, and owner. Profiles are saveable,
recallable, editable, deletable, and exportable.

Group sessions fan one user turn to multiple persona/model lanes. Outputs remain
separate until an optional cross-check stage references claims and disagreements.
Blind A/B hides provider/model/persona identity, randomizes left/right per round,
records the choice before revealing identity, and never uses the comparison vote
as factual verification by itself.

## Acceptance

Persona CRUD/version tests, lane isolation, cancellation, partial-lane failure,
blind assignment stability, reveal-after-vote, and accessibility/keyboard tests.
