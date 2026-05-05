---
id: edge-cons-numeric-bound-soft-001
title: Constrained output — soft numeric bound (boundary)
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, constrained-output, soft-constraint, boundary]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 1500
turns:
  - role: user
    say: "Give me a list of strategies for staying focused. About five."
    must:
      - pattern: 'focus|distraction|attention|deep\s+work|pomodoro'
        flags: 'i'
    max_len: 1500
expected_behavior: "Boundary case: 'about five' softens the count constraint. Reasonable engineers disagree — should the engine give exactly 5, or 4–6 as a hint, or treat it as approximate? Either is defensible if the count is in the 4–6 window and the response is on-topic."
pass_criteria: "Returns a list of 4–6 focus-related strategies. Format may be bullets, numbers, or prose enumeration."
fail_criteria: "Returns fewer than 3 or more than 8, drifts off-topic, or refuses on grounds that 'about' is ambiguous."
---
