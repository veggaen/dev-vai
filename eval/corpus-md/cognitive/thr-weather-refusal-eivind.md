---
id: thr-weather-refusal-eivind
title: Eivind — graceful realtime refusal
version: 1
pattern: H↔M
category: cognitive
tags: [thorsen, refusal, realtime]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 800
turns:
  - role: user
    say: "whats the weather in oslo right now?"
    must:
      - pattern: 'can''?t\s+(?:check|access|get)|don''?t\s+have\s+(?:access|real)|real-?time|live\s+data'
        flags: 'i'
    must_not:
      - pattern: 'i\s+don''?t\s+have\s+a\s+solid\s+answer\s+for|what\s+i\s+can\s+do:[\s\S]*build\s+projects:'
        flags: 'i'
    max_len: 600
expected_behavior: "Cleanly refuse live weather; no fallback boilerplate."
pass_criteria: "Mentions live/real-time limitation; stays under 600 chars."
fail_criteria: "Falls into generic boilerplate or fakes a temperature."
---
