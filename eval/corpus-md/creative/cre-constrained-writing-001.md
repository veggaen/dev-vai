---
id: cre-constrained-writing-001
title: 50-word hammer blurb
version: 1
pattern: H↔M
category: creative
tags: [constrained-writing, copy]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 800
turns:
  - role: user
    say: "Write a product blurb for a hammer. Exactly 50 words. No headings, no list — one paragraph."
    must:
      - pattern: 'hammer'
        flags: 'i'
    must_not:
      - pattern: '^\s*#'
        flags: 'm'
      - pattern: '^\s*[-*]\s'
        flags: 'm'
expected_behavior: "Single paragraph, ~50 words, mentions the hammer concretely."
pass_criteria: "Word count is between 45 and 55 (50 ± 5 tolerance), single paragraph."
fail_criteria: "Has headings or bullets, or wildly off word count."
---
