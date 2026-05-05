---
id: edge-cons-exact-13-words-001
title: Constrained output — exact word count + topic adherence
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, constrained-output, word-count]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 500
turns:
  - role: user
    say: "Reply with exactly 13 words about the moon. No more, no fewer. No bullet points, no header."
    must:
      - pattern: '^\s*(?:\S+\s+){12}\S+\s*[.!?]?\s*$'
        flags: ''
      - pattern: 'moon|lunar|crater|tide|orbit|silver|night'
        flags: 'i'
    max_len: 300
expected_behavior: "Generate-and-check loop on word count; stay on the requested topic."
pass_criteria: "Exactly 13 words, on-topic."
fail_criteria: "Wrong word count, off-topic, or adds a header/list."
---
