---
id: edge-cons-bullet-vs-prose-001
title: Constrained output — format-as-output-shape (bullets only, no prose)
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, constrained-output, format-shape]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 1000
turns:
  - role: user
    say: "Explain TCP in three bullet points. No prose, no headers, no preamble."
    must:
      - pattern: '^\s*[-*•]\s+\S[\s\S]*?\n\s*[-*•]\s+\S[\s\S]*?\n\s*[-*•]\s+\S'
        flags: ''
      - pattern: 'tcp|connection|handshake|reliable|packet|stream'
        flags: 'i'
    must_not:
      - pattern: '^\s*(?:tcp\s*\(|the\s+transmission|here\s+(?:is|are)|let\s+me|##?|\*\*[a-z])'
        flags: 'i'
    max_len: 1500
expected_behavior: "Output is exactly three bullets, no preamble, no header, no trailing prose."
pass_criteria: "Three bullet markers at line starts, on-topic, no preamble lines."
fail_criteria: "Adds a header, opens with prose, returns more or fewer bullets."
---
