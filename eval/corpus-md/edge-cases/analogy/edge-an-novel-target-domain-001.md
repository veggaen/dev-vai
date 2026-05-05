---
id: edge-an-novel-target-domain-001
title: Analogy — TCP retransmission via competitive figure skating
version: 1
pattern: H↔M
category: creative
tags: [edge-case, analogy, novel-mapping]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 5000
  max_chars: 2500
turns:
  - role: user
    say: "Explain TCP retransmission using only metaphors from competitive figure skating. No networking jargon."
    must:
      - pattern: 'skater|skating|jump|landing|fall|judge|score|routine|spin|axel|lutz|rink|ice'
        flags: 'i'
      - pattern: 'try\s+again|retry|redo|second\s+(?:attempt|chance)|repeat|do\s+over'
        flags: 'i'
    must_not:
      - pattern: '\b(?:tcp|packet|ack(?:nowledg)?|sequence\s+number|window|rtt|timeout|retransmit|sender|receiver)\b'
        flags: 'i'
    max_len: 2500
expected_behavior: "Force a novel domain mapping the engine is unlikely to have memorised. The structural mapping (lost packet → fallen jump → retry the element) should come through without networking vocabulary."
pass_criteria: "Skating vocabulary present, retry/repeat concept present, no networking terms."
fail_criteria: "Falls back to literal TCP explanation, or uses any forbidden networking term."
---
