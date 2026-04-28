---
id: cog-theory-of-mind-002
title: Mistaken note — Carlos thinks meeting moved
version: 1
pattern: H↔M
category: cognitive
tags: [theory-of-mind]
weight: 1.0
expected_status: active
budget:
  max_ms: 2000
  max_chars: 1200
turns:
  - role: user
    say: "Carlos read a note saying the meeting moved to 4pm, but the note was wrong — the meeting is still at 3pm. What time will Carlos arrive?"
    must:
      - pattern: '\b4\s*(?:pm|p\.m\.?|o''clock)?\b'
        flags: 'i'
    must_not:
      - pattern: '\bcarlos\s+(?:will\s+)?arrives?\s+at\s+3\b'
        flags: 'i'
expected_behavior: "Carlos acts on his belief; arrives at 4pm despite reality being 3pm."
pass_criteria: "Says Carlos arrives at 4pm."
fail_criteria: "Says Carlos arrives at 3pm based on the actual time."
---
