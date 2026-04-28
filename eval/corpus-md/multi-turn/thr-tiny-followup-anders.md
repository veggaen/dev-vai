---
id: thr-tiny-followup-anders
title: Anders — terse follow-up cues
version: 1
pattern: M↔M
category: multi-turn
tags: [thorsen, follow-up, web-gate]
weight: 1.0
expected_status: active
budget:
  max_ms: 5000
  max_chars: 4000
turns:
  - role: user
    say: "i want to learn typescript"
    must:
      - pattern: 'typescript|types?|interface|tsc|tsconfig'
        flags: 'i'
    min_len: 40
  - role: user
    say: "go on"
    must_not:
      - pattern: 'freshos|nsobject|uilabel|devxoul\/then|thenby|duckduckgo|wikipedia\.org|stack\s*overflow\s*hot'
        flags: 'i'
    max_len: 1200
  - role: user
    say: "more?"
    must_not:
      - pattern: 'freshos|nsobject|uilabel|devxoul\/then|thenby|duckduckgo|wikipedia\.org|stack\s*overflow\s*hot'
        flags: 'i'
    max_len: 1200
expected_behavior: "Stay on topic across follow-ups; no scrape junk pulled by tiny cues."
pass_criteria: "Turn 1 covers TypeScript; turns 2/3 stay clean and on topic."
fail_criteria: "Web junk leaks on 'go on' or 'more?'."
---
