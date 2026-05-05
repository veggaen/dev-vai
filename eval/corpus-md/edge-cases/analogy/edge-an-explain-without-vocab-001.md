---
id: edge-an-explain-without-vocab-001
title: Analogy — explain X without X's technical vocabulary
version: 1
pattern: H↔M
category: creative
tags: [edge-case, analogy, negative-vocab-constraint]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 5000
  max_chars: 2000
turns:
  - role: user
    say: "Explain recursion to a 5-year-old. Use no programming vocabulary. Do not use the words function, call, stack, return, base case, or recursion itself."
    must:
      - pattern: 'mirror|doll|nest(?:ed|ing)|inside|smaller|same\s+(?:thing|way)|like\s+a|imagine'
        flags: 'i'
    must_not:
      - pattern: '\b(?:function|call|stack|return|base\s+case|recursion|recursive)\b'
        flags: 'i'
    max_len: 1500
expected_behavior: "Produce an analogy (e.g. nesting dolls, mirrors) using everyday vocabulary; never use the listed technical terms."
pass_criteria: "Contains analogical language, none of the forbidden terms."
fail_criteria: "Uses any forbidden term, or returns a generic recursion definition."
---
