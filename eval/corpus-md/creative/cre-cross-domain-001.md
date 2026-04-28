---
id: cre-cross-domain-001
title: Cross-domain analogy — git rebase as kitchen
version: 1
pattern: H↔M
category: creative
tags: [analogy, teaching]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 1500
turns:
  - role: user
    say: "Explain git rebase by analogy to a busy restaurant kitchen. Keep it under 150 words. Don't mention the words branch, commit, or HEAD."
    must:
      - pattern: 'kitchen|cook|chef|line|station|order|plate|prep'
        flags: 'i'
    must_not:
      - pattern: '\b(?:branch|commit|HEAD)\b'
        flags: 'i'
expected_behavior: "Concrete kitchen analogy explaining rebase semantics without the forbidden vocabulary."
pass_criteria: "Uses kitchen vocabulary, avoids branch/commit/HEAD."
fail_criteria: "Uses any forbidden word, or no kitchen vocabulary."
---
