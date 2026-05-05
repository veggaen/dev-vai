---
id: edge-mtm-correction-implicit-001
title: Multi-turn memory — implicit temporal correction (boundary)
version: 1
pattern: M↔M
category: multi-turn
tags: [edge-case, multi-turn-memory, correction, boundary]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 12000
  max_chars: 8000
turns:
  - role: user
    say: "I work as a backend dev."
    min_len: 1
  - role: user
    say: "what is dependency injection?"
    min_len: 20
  - role: user
    say: "what's the difference between SQL and NoSQL?"
    min_len: 20
  - role: user
    say: "is gRPC worth learning?"
    min_len: 20
  - role: user
    say: "I'm switching, I do frontend now."
    min_len: 1
  - role: user
    say: "what kind of dev am I?"
    must:
      - pattern: '\bfrontend\b'
        flags: 'i'
expected_behavior: "Treat 'I'm switching, I do X now' as an implicit overwrite of an earlier role fact, even without an explicit 'actually' / 'scratch that' marker. Boundary because reasonable engineers disagree whether old facts should be overwritten or stored as a history (was-backend, now-frontend)."
pass_criteria: "Final turn says 'frontend'. Mentioning the previous role as history (e.g. 'you said you're now frontend; you were backend before') is acceptable."
fail_criteria: "Returns 'backend' as the current answer, or refuses on grounds of contradiction."
---
