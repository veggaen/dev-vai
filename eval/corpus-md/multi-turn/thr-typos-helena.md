---
id: thr-typos-helena
title: Helena — voice-to-text typos
version: 1
pattern: M↔M
category: multi-turn
tags: [thorsen, typos, normalization]
weight: 1.0
expected_status: active
budget:
  max_ms: 5000
  max_chars: 4000
turns:
  - role: user
    say: "how do i set up a raect app with tialwind?"
    must:
      - pattern: 'react'
        flags: 'i'
      - pattern: 'tailwind'
        flags: 'i'
    must_not:
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
  - role: user
    say: "what about a fasapi backend with svetle frontend?"
    must:
      - pattern: 'fastapi'
        flags: 'i'
      - pattern: 'svelte'
        flags: 'i'
    must_not:
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
expected_behavior: "Normalize common typos; resolve to known frameworks."
pass_criteria: "Both turns mention the corrected stack."
fail_criteria: "Falls into the 'I don't have a solid answer' boilerplate."
---
