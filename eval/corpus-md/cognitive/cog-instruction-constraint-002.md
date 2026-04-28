---
id: cog-instruction-constraint-002
title: Instruction-following — exactly five words
version: 1
pattern: H↔M
category: cognitive
tags: [instruction-following, constraint]
weight: 1.0
expected_status: active
budget:
  max_ms: 2000
  max_chars: 200
turns:
  - role: user
    say: "Reply with exactly five words. No more, no less. Describe the color blue."
    must:
      - pattern: '^\s*(?:\S+\s+){4}\S+\s*[.!?]?\s*$'
        flags: ''
expected_behavior: "Produces a single five-word reply."
pass_criteria: "Reply is exactly five whitespace-separated tokens."
fail_criteria: "Any other word count."
---
