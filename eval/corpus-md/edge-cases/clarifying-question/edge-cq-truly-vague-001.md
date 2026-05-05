---
id: edge-cq-truly-vague-001
title: Clarifying question — truly under-specified ask
version: 1
pattern: M↔M
category: multi-turn
tags: [edge-case, clarifying-question, vague-ask]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 1500
turns:
  - role: user
    say: "Help me."
    must:
      - pattern: '\?'
        flags: ''
      - pattern: 'with\s+what|what\s+(?:do|kind|are\s+you|would|can\s+i)|tell\s+me\s+(?:more|what)|specifically|details|context'
        flags: 'i'
    max_len: 800
expected_behavior: "An almost-empty ask should trigger a clarifying question, not a generic primer or boilerplate menu."
pass_criteria: "Response contains a question mark and a clarifying-question phrasing."
fail_criteria: "Dumps a primer (Angular, JSON, Python, etc.), or returns the templated 'what I can do' menu without asking anything."
---
