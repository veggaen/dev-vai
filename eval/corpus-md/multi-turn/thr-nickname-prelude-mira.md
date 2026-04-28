---
id: thr-nickname-prelude-mira
title: Mira — nickname + future-ask prelude
version: 1
pattern: M↔M
category: multi-turn
tags: [thorsen, nickname, prelude]
weight: 1.0
expected_status: active
budget:
  max_ms: 5000
  max_chars: 4000
turns:
  - role: user
    say: "hey so quick test, my nickname is mira and im going to ask you something tricky right after, can you handle it?"
    must:
      - pattern: 'mira|go\s+ahead|ask|sure|of\s+course'
        flags: 'i'
    must_not:
      - pattern: '^yes[.!]?$'
        flags: 'i'
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
    min_len: 12
  - role: user
    say: "okay then — what is 144 divided by 12 and which planet is closest to the sun?"
    must:
      - pattern: '\b12\b'
        flags: ''
      - pattern: 'mercury'
        flags: 'i'
    must_not:
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
expected_behavior: "Acknowledge nickname; on compound math+fact answer both."
pass_criteria: "Turn 1 mentions Mira / acknowledges; turn 2 has 12 and Mercury."
fail_criteria: "Turn 1 is 'Yes.'; turn 2 misses either part."
---
