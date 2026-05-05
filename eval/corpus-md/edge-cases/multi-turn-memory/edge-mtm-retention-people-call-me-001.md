---
id: edge-mtm-retention-people-call-me-001
title: Multi-turn memory — boundary on nickname vs. given name
version: 1
pattern: M↔M
category: multi-turn
tags: [edge-case, multi-turn-memory, retention, boundary, detector-probe]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 5000
  max_chars: 4000
turns:
  - role: user
    say: "people call me Mira."
    min_len: 1
  - role: user
    say: "what name should I expect you to use for me?"
    must:
      - pattern: '\bmira\b'
        flags: 'i'
expected_behavior: "Recognise 'people call me X' as a usage-name signal and store it. Boundary case because 'people call me' may be a nickname distinct from a legal/given name — reasonable engineers disagree on whether to ask for clarification or just use it."
pass_criteria: "Turn 2 returns 'Mira' as the address-name. Either confidently asserting it or hedging with 'I'll call you Mira unless you prefer otherwise' is acceptable."
fail_criteria: "Engine ignores the introduction or returns a knowledge-store factoid about the name 'Mira'."
---
