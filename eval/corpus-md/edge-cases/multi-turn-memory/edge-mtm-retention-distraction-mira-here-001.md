---
id: edge-mtm-retention-distraction-mira-here-001
title: Multi-turn memory — retention under intervening context
version: 1
pattern: M↔M
category: multi-turn
tags: [edge-case, multi-turn-memory, retention-under-distraction, detector-probe]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 8000
  max_chars: 6000
turns:
  - role: user
    say: "Mira here."
    min_len: 1
  - role: user
    say: "what is the capital of France?"
    must:
      - pattern: 'paris'
        flags: 'i'
  - role: user
    say: "explain REST in one sentence."
    min_len: 10
  - role: user
    say: "fix this typo: recieve"
    must:
      - pattern: 'receive'
        flags: 'i'
  - role: user
    say: "what's my name?"
    must:
      - pattern: '\bmira\b'
        flags: 'i'
    must_not:
      - pattern: 'i\s+don''?t\s+(?:know|have)|no\s+way|not\s+sure'
        flags: 'i'
expected_behavior: "Survive three unrelated turns and recall the introduced name. Probes whether the most-recent-turn bias erases earlier facts."
pass_criteria: "Final turn contains 'Mira'."
fail_criteria: "Engine returns the Paris/REST/typo topic, or claims it doesn't know the name."
---
