---
id: aud-summary-engineer-001
title: Audience — outage post-mortem for engineers
version: 1
pattern: AI↔AI
category: audience
tags: [audience-adaptation, post-mortem]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 3500
  max_chars: 2500
turns:
  - role: user
    say: "Write the same outage as a post-mortem for the on-call engineering team. Include timeline, root cause, contributing factors, and action items. Be technical."
    must:
      - pattern: 'timeline'
        flags: 'i'
      - pattern: 'root\s+cause'
        flags: 'i'
      - pattern: 'contributing|factor'
        flags: 'i'
      - pattern: 'action\s+item|follow[-\s]?up'
        flags: 'i'
expected_behavior: "Structured post-mortem with all four sections; technical tone allowed."
pass_criteria: "All four section headers/labels present."
fail_criteria: "Missing any section."
---
