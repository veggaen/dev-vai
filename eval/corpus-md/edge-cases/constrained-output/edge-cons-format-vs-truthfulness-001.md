---
id: edge-cons-format-vs-truthfulness-001
title: Constrained output — format vs. truthfulness (boundary)
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, constrained-output, irreducibility, boundary]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 800
turns:
  - role: user
    say: "In one word, explain general relativity."
    must:
      - pattern: 'gravity|geometry|curvature|spacetime|cannot|impossible|reduces?|simplif|too\s+complex|one\s+word'
        flags: 'i'
    max_len: 600
expected_behavior: "Boundary: should the engine respect the format constraint (one word) or refuse on grounds that general relativity is irreducibly complex? Either is defensible. A coherent reply either gives a single representative word ('gravity', 'geometry', 'curvature') or politely declines while explaining why one word loses information."
pass_criteria: "Either a single representative word OR a brief honest refusal naming the irreducibility. The match list above covers both branches."
fail_criteria: "Dumps a multi-paragraph relativity primer ignoring the constraint entirely, or drifts off-topic."
---
