---
id: cog-self-contradiction-001
title: Self-contradiction trap — sentence count
version: 1
pattern: H↔M
category: cognitive
tags: [self-contradiction, instruction-following]
weight: 1.0
expected_status: active
budget:
  max_ms: 2500
  max_chars: 800
turns:
  - role: user
    say: "Reply with exactly two sentences. The first sentence must say you will use three sentences. The second must say you actually used two."
    must:
      - pattern: 'cannot|can\s*not|impossible|contradict|inconsistent|won''t\s+do|refuse'
        flags: 'i'
    must_not:
      - pattern: '\bthree\s+sentences\b[\s\S]+\btwo\s+sentences\b'
        flags: 'i'
expected_behavior: "Spots the contradiction and refuses or names it instead of producing nonsense."
pass_criteria: "Names the contradiction or declines."
fail_criteria: "Outputs the literal contradictory two sentences as if valid."
---
