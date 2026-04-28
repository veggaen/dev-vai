---
id: cre-app-ideation-001
title: Three fitness app pitches
version: 1
pattern: H↔M
category: creative
tags: [ideation, product]
weight: 1.0
expected_status: active
budget:
  max_ms: 4000
  max_chars: 2500
turns:
  - role: user
    say: "Pitch three distinct fitness app ideas. Each pitch: name, one-line hook, target user, and why it's different from existing apps. Keep each pitch tight."
    must:
      - pattern: '(?:^|\n)\s*(?:1\.|\*\*?1|##?\s*1|name\s*:)'
        flags: 'im'
      - pattern: '(?:^|\n)\s*(?:3\.|\*\*?3|##?\s*3|name\s*:[\s\S]+name\s*:[\s\S]+name\s*:)'
        flags: 'im'
expected_behavior: "Three labeled pitches, each with name + hook + target + differentiator."
pass_criteria: "Three clearly distinct pitches with all four fields each."
fail_criteria: "Fewer than three pitches, or pitches missing the requested fields."
---
