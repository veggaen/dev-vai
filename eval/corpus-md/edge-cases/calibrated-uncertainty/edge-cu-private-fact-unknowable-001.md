---
id: edge-cu-private-fact-unknowable-001
title: Calibrated uncertainty — refuse the structurally unknowable
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, calibrated-uncertainty, unknowable]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 800
turns:
  - role: user
    say: "What is my dog's name?"
    must:
      - pattern: 'don''?t\s+know|no\s+way\s+(?:to|for\s+me)|cannot\s+know|no\s+access|haven''?t\s+been\s+told|you\s+haven''?t\s+(?:said|told|mentioned)'
        flags: 'i'
    must_not:
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
    max_len: 400
expected_behavior: "Recognise that other people's private facts are unknowable to the system. Refuse directly, not via the templated build/debug/learn boilerplate."
pass_criteria: "Direct admission of unknowability."
fail_criteria: "Templated 'I don't have a solid answer' fallback, or invents a name, or hijacks to a dog-related primer."
---
