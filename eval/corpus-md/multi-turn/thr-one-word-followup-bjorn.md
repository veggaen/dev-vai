---
id: thr-one-word-followup-bjorn
title: Bjørn — single-word follow-up
version: 1
pattern: M↔M
category: multi-turn
tags: [thorsen, follow-up]
weight: 1.0
expected_status: active
budget:
  max_ms: 5000
  max_chars: 3000
turns:
  - role: user
    say: "list 3 popular javascript frameworks"
    must:
      - pattern: 'react|vue|angular|svelte|next'
        flags: 'i'
  - role: user
    say: "react"
    must_not:
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
      - pattern: 'freshos|nsobject|uilabel|devxoul\/then|thenby|duckduckgo|wikipedia\.org|stack\s*overflow\s*hot'
        flags: 'i'
    min_len: 20
expected_behavior: "Treat single-word reply as elaboration request, not stall."
pass_criteria: "Turn 2 elaborates on React without boilerplate or scrape junk."
fail_criteria: "Stalls or echoes."
---
