---
id: cog-order-of-operations-001
title: Order of operations — 8 + 2 * 3
version: 1
pattern: H↔M
category: cognitive
tags: [math, pemdas]
weight: 1.0
expected_status: active
budget:
  max_ms: 2000
  max_chars: 500
turns:
  - role: user
    say: "What is 8 + 2 * 3?"
    must:
      - pattern: '\b14\b'
        flags: ''
    must_not:
      - pattern: '\b30\b'
        flags: ''
expected_behavior: "Multiplies before adding: 2*3=6, +8=14."
pass_criteria: "Final answer is 14."
fail_criteria: "Final answer is 30 (left-to-right) or anything other than 14."
---
