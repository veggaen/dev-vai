---
id: edge-cq-intent-carryover-001
title: Clarifying question — intent carries over the just-clarified task
version: 1
pattern: M↔M
category: multi-turn
tags: [edge-case, clarifying-question, intent-carryover]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 8000
  max_chars: 4000
turns:
  - role: user
    say: "Help me with my Python script."
    must:
      - pattern: '\?'
        flags: ''
    max_len: 800
  - role: user
    say: "It's a CSV reader, getting encoding errors on UTF-16 files."
    must:
      - pattern: 'utf-?16|encoding|decode|bom|chardet|errors=|open\(.*encoding'
        flags: 'i'
    must_not:
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
    max_len: 3000
expected_behavior: "Turn 1 asks a clarifying question on the under-specified ask. Turn 2 routes on the just-clarified task ('UTF-16 CSV in Python'), not on the most recent surface keyword ('CSV' → JSON primer)."
pass_criteria: "Turn 1 contains a question. Turn 2 mentions UTF-16 / encoding / decoding."
fail_criteria: "Turn 2 dumps a generic CSV or JSON primer, or fallback boilerplate."
---
