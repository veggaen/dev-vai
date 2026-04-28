---
id: aud-explain-recursion-child-001
title: Audience — recursion to a 10-year-old
version: 1
pattern: AI↔AI
category: audience
tags: [audience-adaptation, teaching]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 3000
  max_chars: 1500
turns:
  - role: user
    say: "Explain recursion to a curious 10-year-old. No code. Use one concrete everyday example."
    must:
      - pattern: 'mirror|nesting|nested|russian\s+doll|matryoshka|box\s+inside|wrapping|copy\s+of\s+itself'
        flags: 'i'
    must_not:
      - pattern: 'stack\s+frame|base\s+case|tail[-\s]?call|big[-\s]?o|O\(n\)'
        flags: 'i'
expected_behavior: "Concrete tangible analogy a child gets; no programming jargon."
pass_criteria: "Concrete everyday example present, no jargon."
fail_criteria: "Uses programming jargon or no analogy."
---
