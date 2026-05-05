---
id: edge-cq-spec-feels-vague-but-isnt-001
title: Clarifying question — "build me a todo app" (boundary)
version: 1
pattern: H↔M
category: multi-turn
tags: [edge-case, clarifying-question, boundary, fully-specified-product-class]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 6000
  max_chars: 4000
turns:
  - role: user
    say: "Build me a todo app."
    must:
      - pattern: 'todo|task|add\s+(?:item|task)|usestate|html|react|vue|svelte|component|input|list|which\s+(?:framework|stack)|what\s+(?:stack|framework)|\?'
        flags: 'i'
    max_len: 4000
expected_behavior: "Boundary: sounds vague (what framework? what features?) but is actually a fully-specified product class with strong defaults (React or vanilla, basic CRUD list). Engineers disagree — ask for stack and feature-set, or proceed with a sane default. Either is acceptable; producing scaffolded code in a named stack is also acceptable."
pass_criteria: "Either asks a clarifying question OR proceeds to scaffold something todo-shaped in a named stack."
fail_criteria: "Refuses on grounds of vagueness, or hijacks to a Trello-management primer."
---
