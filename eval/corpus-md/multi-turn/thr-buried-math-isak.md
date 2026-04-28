---
id: thr-buried-math-isak
title: Isak — math buried in chatter
version: 1
pattern: M↔M
category: multi-turn
tags: [thorsen, math, buried]
weight: 1.0
expected_status: active
budget:
  max_ms: 4000
  max_chars: 2000
turns:
  - role: user
    say: "just curious, can you tell me what 47 plus 89 is please?"
    must:
      - pattern: '\b136\b'
        flags: ''
  - role: user
    say: "and what would 12 times twelve be?"
    must:
      - pattern: '\b144\b'
        flags: ''
  - role: user
    say: "nice, what about two hundred minus seventy-three?"
    must:
      - pattern: '\b127\b'
        flags: ''
expected_behavior: "Detect math even when wrapped in chatter; handle word numbers."
pass_criteria: "All three turns return the correct numeric answer."
fail_criteria: "Off-by-one on word-number combination, or misses the math entirely."
---
