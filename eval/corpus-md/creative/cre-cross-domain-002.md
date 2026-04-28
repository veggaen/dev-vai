---
id: cre-cross-domain-002
title: Cross-domain — TCP handshake as introduction
version: 1
pattern: H↔M
category: creative
tags: [analogy, teaching, networking]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 1200
turns:
  - role: user
    say: "Explain the TCP three-way handshake as if it were two strangers being formally introduced at a party. Keep it under 120 words."
    must:
      - pattern: 'introduce|introduction|stranger|party|nice\s+to\s+meet|hello|hi\b'
        flags: 'i'
      - pattern: 'syn|hand[\s-]?shake|three[\s-]?way'
        flags: 'i'
expected_behavior: "Maps SYN/SYN-ACK/ACK onto a 3-step social greeting."
pass_criteria: "Mentions the three-step structure with the social mapping."
fail_criteria: "Plain technical answer with no social analogy."
---
