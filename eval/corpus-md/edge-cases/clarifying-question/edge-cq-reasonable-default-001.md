---
id: edge-cq-reasonable-default-001
title: Clarifying question — clarify or use a sane default? (boundary)
version: 1
pattern: H↔M
category: multi-turn
tags: [edge-case, clarifying-question, boundary, sane-default]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 2000
turns:
  - role: user
    say: "Show me how to do hello world."
    must:
      - pattern: 'print|console\.log|System\.out|puts|echo|hello,?\s+world|what\s+language|which\s+language|\?'
        flags: 'i'
    max_len: 1500
expected_behavior: "Boundary: vague (which language?) but a reasonable default exists (Python or JavaScript). Engineers disagree — clarify, or pick a default? Either is defensible: asking 'which language?' OR demonstrating in a default language while naming the default."
pass_criteria: "Either asks the language clarification, OR demonstrates hello-world in a named language."
fail_criteria: "Returns a primer on the phrase 'Hello World' or refuses on grounds of ambiguity."
---
