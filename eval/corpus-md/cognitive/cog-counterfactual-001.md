---
id: cog-counterfactual-001
title: Counterfactual reasoning — broken alarm
version: 1
pattern: H↔M
category: cognitive
tags: [counterfactual, reasoning]
weight: 1.0
expected_status: active
budget:
  max_ms: 2500
  max_chars: 1500
turns:
  - role: user
    say: "If my alarm hadn't gone off this morning, I would have missed my flight. My alarm did go off. Did I miss my flight?"
    must:
      - pattern: '\bno\b|did\s+not\s+miss|caught\s+(?:the\s+)?flight|made\s+(?:the\s+|your\s+)?flight'
        flags: 'i'
    must_not:
      - pattern: '\byou\s+missed\s+(?:the|your)\s+flight\b'
        flags: 'i'
expected_behavior: "Reads the counterfactual structure: alarm fired → flight not missed."
pass_criteria: "Concludes the user did not miss the flight."
fail_criteria: "Says they missed the flight, or refuses to commit."
---
