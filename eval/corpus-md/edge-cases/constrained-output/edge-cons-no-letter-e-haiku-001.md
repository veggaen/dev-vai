---
id: edge-cons-no-letter-e-haiku-001
title: Constrained output — format + character ban combined
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, constrained-output, intersection]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 6000
  max_chars: 1000
turns:
  - role: user
    say: "Write a haiku about a sunrise. Three lines only. No commentary, no title. The haiku must contain no letter E or e anywhere."
    must:
      - pattern: '^\s*\S[^\n]*\n\s*\S[^\n]*\n\s*\S[^\n]*\s*$'
        flags: ''
    must_not:
      - pattern: '[Ee]'
        flags: ''
    max_len: 300
expected_behavior: "Satisfy a format constraint (3 lines, no extras) AND a negative-character constraint simultaneously. Naive implementations satisfy one and fail the other."
pass_criteria: "Output is exactly 3 lines, contains no E/e, no commentary lines."
fail_criteria: "Adds a title, uses any E/e, or runs more or fewer than 3 lines."
---
