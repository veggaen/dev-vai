---
id: edge-mtm-contested-correction-001
title: Multi-turn memory — contested self-contradicting correction
version: 1
pattern: M↔M
category: multi-turn
tags: [edge-case, multi-turn-memory, contested-correction, contradiction-detection, adversarial]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 8000
  max_chars: 6000
turns:
  - role: user
    say: "my favorite color is blue."
    min_len: 1
  - role: user
    say: "no wait it's actually green."
    min_len: 1
  - role: user
    say: "no, blue, sorry."
    min_len: 1
  - role: user
    say: "what's my favorite color?"
    must:
      - pattern: '\b(?:blue|green)\b'
        flags: 'i'
      - pattern: 'mentioned\s+both|said\s+both|last\s+(?:you|time)\s+(?:said|told)|earlier\s+you|first\s+you|then\s+you|flip(?:ped|-?flop)|undecided|which\s+(?:do\s+you\s+want|one)|aren''?t\s+sure'
        flags: 'i'
expected_behavior: "When the user contradicts themselves twice in opposite directions, the engine should pick a coherent strategy (last-wins, ask-which, or refuse-with-history) AND demonstrate awareness that the user has flipped. Tagged for both multi-turn-memory and contradiction-detection buckets so it surfaces in both views."
pass_criteria: "Final turn names a color (the last one said is preferred but not required) AND signals awareness of the contradiction."
fail_criteria: "Silently picks one without acknowledging the flip, or returns boilerplate fallback, or names a third color."
---
