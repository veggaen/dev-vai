---
id: mt-contradiction-handling-001
title: Multi-turn — user contradicts earlier fact
version: 1
pattern: M↔M
category: multi-turn
tags: [contradiction, memory]
weight: 1.0
expected_status: active
budget:
  max_ms: 5000
  max_chars: 3000
turns:
  - role: user
    say: "My favorite color is blue."
    must: []
  - role: user
    say: "Actually, scratch that — my favorite color is green."
    must: []
  - role: user
    say: "What's my favorite color?"
    must:
      - pattern: '\bgreen\b'
        flags: 'i'
    must_not:
      - pattern: '\bblue\b'
        flags: 'i'
expected_behavior: "Honors the most recent statement; reports green, not blue."
pass_criteria: "Says green, not blue, in the third response."
fail_criteria: "Says blue, or hedges between both."
---
