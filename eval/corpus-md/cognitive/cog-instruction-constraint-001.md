---
id: cog-instruction-constraint-001
title: Instruction-following — no letter E
version: 1
pattern: H↔M
category: cognitive
tags: [instruction-following, constraint]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 600
turns:
  - role: user
    say: "Write a single sentence about a cat. The sentence must not contain the letter E (uppercase or lowercase)."
    must_not:
      - pattern: '[Ee]'
        flags: ''
expected_behavior: "Produces a lipogram sentence about a cat avoiding all E's."
pass_criteria: "Output sentence contains zero E characters."
fail_criteria: "Any E appears in the response."
---
