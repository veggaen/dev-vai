---
id: edge-se-leave-it-alone-001
title: Self-evaluation — boundary, know when revision makes it worse
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, self-evaluation, boundary, revision-restraint]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 6000
  max_chars: 1500
turns:
  - role: user
    say: "Write a one-sentence definition of empathy."
    must:
      - pattern: 'empathy|empathic|empathetic'
        flags: 'i'
      - pattern: '^[^.!?\n]{20,}[.!?]\s*$'
        flags: ''
    max_len: 400
expected_behavior: "Boundary: there's no checkable failure mode here beyond format (one sentence). A self-eval pass could over-engage, second-guessing word choice and producing a worse, more hedged definition. Well-built self-eval recognises 'no concrete predicate to check beyond format' and ships the first reasonable draft."
pass_criteria: "Exactly one sentence, contains the word empathy, definitionally coherent."
fail_criteria: "Multi-sentence reply, hedged-into-uselessness ('empathy could be defined as... though some say...'), or includes meta-commentary on the difficulty of definition."
---
