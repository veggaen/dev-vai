---
id: thr-compound-multi-intent-ragna
title: Ragna — compound multi-intent
version: 1
pattern: H↔M
category: cognitive
tags: [thorsen, compound]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 1500
turns:
  - role: user
    say: "what is 25 squared and what day is it tomorrow?"
    must:
      - pattern: '\b625\b'
        flags: ''
      - pattern: 'tomorrow'
        flags: 'i'
    must_not:
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
expected_behavior: "Address both math and date in a single response."
pass_criteria: "Contains 625 and 'tomorrow' / a date."
fail_criteria: "Answers only one part."
---
