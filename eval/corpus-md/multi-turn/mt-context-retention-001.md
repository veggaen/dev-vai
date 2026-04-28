---
id: mt-context-retention-001
title: Multi-turn — remembers user's name across turns
version: 1
pattern: M↔M
category: multi-turn
tags: [memory, context-retention]
weight: 1.0
expected_status: active
budget:
  max_ms: 5000
  max_chars: 3000
turns:
  - role: user
    say: "Hey, my name is Mira."
    must:
      - pattern: 'mira'
        flags: 'i'
  - role: user
    say: "What's my name?"
    must:
      - pattern: '\bmira\b'
        flags: 'i'
    must_not:
      - pattern: "don'?t\\s+know\\s+your\\s+name|haven'?t\\s+(?:told|said)"
        flags: 'i'
expected_behavior: "Acknowledges Mira; recalls it on the follow-up."
pass_criteria: "Second-turn response says 'Mira'."
fail_criteria: "Says it doesn't know the user's name."
---
