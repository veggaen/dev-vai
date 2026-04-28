---
id: cre-constrained-writing-002
title: Haiku — autumn server room
version: 1
pattern: H↔M
category: creative
tags: [constrained-writing, haiku]
weight: 1.0
expected_status: active
budget:
  max_ms: 2500
  max_chars: 400
turns:
  - role: user
    say: "Write a haiku about a server room in autumn. Three lines only. No title, no commentary."
    must:
      - pattern: '^\s*\S[^\n]*\n\s*\S[^\n]*\n\s*\S[^\n]*\s*$'
        flags: ''
expected_behavior: "Exactly three lines, no surrounding commentary."
pass_criteria: "Three non-empty lines, no extra prose."
fail_criteria: "More or fewer lines, or includes commentary/title."
---
