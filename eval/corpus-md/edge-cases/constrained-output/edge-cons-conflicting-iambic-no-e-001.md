---
id: edge-cons-conflicting-iambic-no-e-001
title: Constrained output — three pulling constraints (adversarial)
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, constrained-output, conflicting-constraints, adversarial]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 8000
  max_chars: 1500
turns:
  - role: user
    say: "Write a 50-word product blurb for a hammer. The blurb must contain no letter E and must scan as iambic pentameter throughout. No headings, no list, just the blurb."
    must:
      - pattern: 'hammer'
        flags: 'i'
    must_not:
      - pattern: '[Ee]'
        flags: ''
    max_len: 1000
expected_behavior: "Three constraints (50 words, no E, iambic pentameter) plus topic. The intersection may be impossible. A correct response either attempts the impossible task honestly OR refuses with calibrated uncertainty ('these constraints likely cannot all be satisfied because…'). What it must NOT do is silently drop a constraint, ignore the topic, or hijack to an unrelated primer."
pass_criteria: "Either the engine produces a hammer-themed attempt with no E (other constraints partial), or it refuses/clarifies while naming the conflict. Topic word 'hammer' must appear; no letter E may leak."
fail_criteria: "Drops to a primer on hammers in general, leaks any E, or fails to mention the topic word."
---
