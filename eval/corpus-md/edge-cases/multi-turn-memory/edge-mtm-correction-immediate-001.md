---
id: edge-mtm-correction-immediate-001
title: Multi-turn memory — explicit immediate correction
version: 1
pattern: M↔M
category: multi-turn
tags: [edge-case, multi-turn-memory, correction]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 5000
  max_chars: 4000
turns:
  - role: user
    say: "my favorite framework is svelte."
    min_len: 1
  - role: user
    say: "actually scratch that, my favorite framework is solid."
    min_len: 1
  - role: user
    say: "what's my favorite framework?"
    must:
      - pattern: '\bsolid\b'
        flags: 'i'
    must_not:
      - pattern: '\bsvelte\b'
        flags: 'i'
expected_behavior: "Replace the previously-stored fact when the user explicitly retracts it ('actually scratch that')."
pass_criteria: "Turn 3 returns 'solid' and does not mention 'svelte'."
fail_criteria: "Engine returns 'svelte', or returns both, or refuses."
---
