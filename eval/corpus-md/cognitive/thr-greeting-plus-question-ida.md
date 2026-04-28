---
id: thr-greeting-plus-question-ida
title: Ida — greeting prefix doesn't swallow question
version: 1
pattern: H↔M
category: cognitive
tags: [thorsen, greeting]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 1500
turns:
  - role: user
    say: "hello! quick one — what does CORS stand for?"
    must:
      - pattern: 'cross-?origin\s+resource\s+sharing'
        flags: 'i'
    must_not:
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
expected_behavior: "Greeting must not eat the question."
pass_criteria: "Returns the CORS expansion."
fail_criteria: "Greets back without answering."
---
