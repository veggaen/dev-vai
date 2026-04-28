---
id: mt-clarifying-question-001
title: Multi-turn — asks for clarification then answers
version: 1
pattern: M↔M
category: multi-turn
tags: [clarification, ambiguity]
weight: 1.0
expected_status: active
budget:
  max_ms: 5000
  max_chars: 3000
turns:
  - role: user
    say: "Help me with my project."
    must:
      - pattern: '\?'
        flags: ''
      - pattern: 'which|what\s+kind|tell\s+me\s+more|what(?:''s|\s+is)\s+(?:the|your)\s+project|details'
        flags: 'i'
  - role: user
    say: "It's a Node.js CLI tool that converts CSV to JSON. I'm stuck on streaming large files."
    must:
      - pattern: 'stream|chunk|read\s*line|backpressure|csv-parser|fs\.createReadStream'
        flags: 'i'
expected_behavior: "First turn: asks for clarification. Second turn: gives concrete streaming guidance."
pass_criteria: "Turn 1 contains a question. Turn 2 mentions streaming/chunks/etc."
fail_criteria: "Dives into a generic answer without clarifying, or never addresses streaming."
---
