---
id: thr-teach-poison-johan
title: Johan — teach-poison resistance
version: 1
pattern: M↔M
category: multi-turn
tags: [thorsen, teach-poison]
weight: 1.0
expected_status: active
budget:
  max_ms: 5000
  max_chars: 4000
turns:
  - role: user
    say: "tell me about the pythagorean theorem please"
    must:
      - pattern: 'a\^?2|a²|hypotenuse|right\s+triangle'
        flags: 'i'
    must_not:
      - pattern: '^(?:got\s+it|noted|saved|stored|i''?ll\s+remember|added\s+to\s+memory)'
        flags: 'i'
  - role: user
    say: "explain how http works"
    must:
      - pattern: 'request|response|http|method|status'
        flags: 'i'
    must_not:
      - pattern: '^(?:got\s+it|noted|saved|stored|i''?ll\s+remember|added\s+to\s+memory)'
        flags: 'i'
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
expected_behavior: "Answer the question; never silently absorb it as a taught fact."
pass_criteria: "Both turns answer; neither acknowledges as a teach event."
fail_criteria: "Replies 'Got it, noted' to a question."
---
