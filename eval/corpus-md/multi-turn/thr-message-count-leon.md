---
id: thr-message-count-leon
title: Leon — accurate message count
version: 1
pattern: M↔M
category: multi-turn
tags: [thorsen, meta, counting]
weight: 1.0
expected_status: active
budget:
  max_ms: 5000
  max_chars: 3000
turns:
  - role: user
    say: "hi"
    min_len: 1
  - role: user
    say: "cool"
    min_len: 1
  - role: user
    say: "right"
    min_len: 1
  - role: user
    say: "how many messages have I sent you so far?"
    must:
      - pattern: '\b4\s+messages?\b'
        flags: 'i'
expected_behavior: "Count user messages including the current ask. 3 prior + this one = 4."
pass_criteria: "Final turn says '4 messages'."
fail_criteria: "Off-by-one (3 or 5) or refuses."
---
