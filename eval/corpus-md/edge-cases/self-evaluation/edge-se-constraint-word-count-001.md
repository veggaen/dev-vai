---
id: edge-se-constraint-word-count-001
title: Self-evaluation — catch and fix word-count miss before emit
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, self-evaluation, constraint-checking, sub-capability-1]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 8000
  max_chars: 1000
turns:
  - role: user
    say: "Reply with exactly 7 words about the ocean. No more, no fewer."
    must:
      - pattern: '^\s*(?:\S+\s+){6}\S+\s*[.!?]?\s*$'
        flags: ''
      - pattern: 'ocean|sea|wave|tide|water|salt|deep|blue'
        flags: 'i'
    max_len: 200
expected_behavior: "First-pass generation likely produces 6, 8, or 10 words. A real self-eval pass counts words against the constraint and revises. Distinguishing test from a constrained-output pass: this case probes whether revision happens, not whether constraint-satisfaction was lucky on first draft."
pass_criteria: "Exactly 7 words, on-topic."
fail_criteria: "Wrong count. Failure here vs. constrained-output pass tells us self-eval isn't gating emission."
---
