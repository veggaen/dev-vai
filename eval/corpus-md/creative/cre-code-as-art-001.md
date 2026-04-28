---
id: cre-code-as-art-001
title: Python sine wave one-liner
version: 1
pattern: H↔M
category: creative
tags: [code-art, python]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 1200
turns:
  - role: user
    say: "Write a single Python expression (one line, no semicolons, no newlines) that prints an ASCII sine wave 60 columns wide and 20 rows tall."
    must:
      - pattern: 'sin\s*\('
        flags: 'i'
      - pattern: 'print\s*\('
        flags: ''
    must_not:
      - pattern: ';'
        flags: ''
      - pattern: '\n'
        flags: ''
expected_behavior: "One-liner Python that calls sin and prints; no semicolons, no embedded newlines in the code."
pass_criteria: "Single-line expression using sin and print, no `;` or literal newline characters."
fail_criteria: "Multi-line code, missing sin, or contains semicolons."
---
