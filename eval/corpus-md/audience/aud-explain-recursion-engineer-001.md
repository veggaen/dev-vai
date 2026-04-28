---
id: aud-explain-recursion-engineer-001
title: Audience — recursion to a senior engineer
version: 1
pattern: AI↔AI
category: audience
tags: [audience-adaptation, peer-mode]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 3000
  max_chars: 1800
turns:
  - role: user
    say: "I'm a senior backend engineer. Give me a tight technical refresher on recursion: when to prefer it, the cost, and the pitfalls."
    must:
      - pattern: 'stack|tail[-\s]?call|base\s+case|memoization|cost'
        flags: 'i'
    must_not:
      - pattern: 'imagine\s+you\s+are\s+(?:a\s+)?(?:kid|child)|like\s+a\s+russian\s+doll'
        flags: 'i'
expected_behavior: "Peer-level technical answer; covers stack cost, tail-call, base case, memoization."
pass_criteria: "Uses peer technical vocabulary; no childish analogies."
fail_criteria: "Reverts to kid-level analogy."
---
