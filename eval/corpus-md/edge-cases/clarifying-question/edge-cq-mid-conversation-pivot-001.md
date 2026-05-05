---
id: edge-cq-mid-conversation-pivot-001
title: Clarifying question — intent revision mid-conversation
version: 1
pattern: M↔M
category: multi-turn
tags: [edge-case, clarifying-question, intent-revision]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 8000
  max_chars: 4000
turns:
  - role: user
    say: "Tell me about Rust."
    must:
      - pattern: 'rust|memory\s+safety|ownership|borrow|cargo|systems\s+(?:programming|language)'
        flags: 'i'
    min_len: 30
  - role: user
    say: "Yeah but I really meant the game."
    must:
      - pattern: 'game|survival|facepunch|multiplayer|raid|base|garry'
        flags: 'i'
    must_not:
      - pattern: 'memory\s+safety|ownership\s+model|borrow\s+checker|cargo|systems\s+programming'
        flags: 'i'
    max_len: 3000
expected_behavior: "Turn 1 answers about the language. Turn 2 must pivot to Rust the videogame, not double down on the language."
pass_criteria: "Turn 2 mentions game-domain vocabulary and avoids language-domain vocabulary."
fail_criteria: "Turn 2 keeps answering about the programming language."
---
