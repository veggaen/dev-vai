---
id: edge-mtm-retention-im-mira-001
title: Multi-turn memory — retention via "I'm X" phrasing
version: 1
pattern: M↔M
category: multi-turn
tags: [edge-case, multi-turn-memory, retention, detector-probe]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 5000
  max_chars: 4000
turns:
  - role: user
    say: "I'm Mira."
    min_len: 1
  - role: user
    say: "what's my name?"
    must:
      - pattern: '\bmira\b'
        flags: 'i'
    must_not:
      - pattern: 'i\s+don''?t\s+(?:know|have)|no\s+way|not\s+sure'
        flags: 'i'
expected_behavior: "Treat 'I'm X' as a self-identification fact and store it for recall."
pass_criteria: "Turn 2 contains 'Mira' without hedging."
fail_criteria: "Engine refuses, ignores, or hijacks to a Mira-related factoid (e.g. an artist named Mira)."
---
