---
id: edge-an-bad-analogy-debugging-001
title: Analogy — critique an existing analogy (boundary)
version: 1
pattern: H↔M
category: creative
tags: [edge-case, analogy, critique, boundary]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 5000
  max_chars: 2000
turns:
  - role: user
    say: "Is 'Git is like a time machine' a good analogy? Why or why not? Argue both sides."
    must:
      - pattern: 'git|version|history|commit|branch|snapshot'
        flags: 'i'
      - pattern: 'good|works|captures|true|accurate|right'
        flags: 'i'
      - pattern: 'breaks?\s+down|misleading|wrong|inaccurate|fails?|limitation|but|however|except'
        flags: 'i'
    max_len: 2000
expected_behavior: "Boundary: this is critique-of-analogy, not generation. Reasonable engineers disagree whether this belongs in the analogy bucket or in a 'reasoning about explanations' bucket. Flagged as boundary."
pass_criteria: "Engages with both 'works' and 'breaks down' aspects of the time-machine analogy."
fail_criteria: "Refuses to evaluate, or only argues one side, or hijacks to a Git tutorial."
---
