---
id: cog-multi-step-planning-001
title: Multi-step planning — laundry/oven/kids
version: 1
pattern: H↔M
category: cognitive
tags: [planning, scheduling]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 2000
turns:
  - role: user
    say: "I have 90 minutes. Laundry takes 60 mins (passive), oven preheat 15 mins then bake 30 mins, and I need to leave at minute 90 to pick up kids. Can I fit it all? Walk me through the schedule."
    must:
      - pattern: '\bstart\s+laundry\b|laundry\s+at\s+(?:0|t=0|minute\s+0)'
        flags: 'i'
      - pattern: 'preheat'
        flags: 'i'
    must_not:
      - pattern: 'cannot\s+fit|impossible'
        flags: 'i'
expected_behavior: "Recognizes laundry runs in parallel; starts laundry at 0, preheat at 45, bake done at 90."
pass_criteria: "Produces a schedule that fits within 90 minutes by parallelizing laundry."
fail_criteria: "Treats laundry as blocking or claims it doesn't fit."
---
