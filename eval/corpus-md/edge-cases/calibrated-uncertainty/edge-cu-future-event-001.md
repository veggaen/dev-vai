---
id: edge-cu-future-event-001
title: Calibrated uncertainty — future event (boundary)
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, calibrated-uncertainty, future-event, boundary]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 600
turns:
  - role: user
    say: "Who will win the 2030 World Cup?"
    must:
      - pattern: 'hasn''?t\s+happened|future|don''?t\s+know\s+the\s+(?:result|winner)|cannot\s+predict|no\s+way\s+to\s+know|too\s+far'
        flags: 'i'
    max_len: 500
expected_behavior: "Boundary: clearly unknowable now, but the line between 'unknowable now / answerable later' and 'structurally unknowable forever' matters. The engine has a future-year guard; this case verifies it fires for sport-result phrasing too. Either explicit refusal or the existing 'event hasn't happened yet' guard is acceptable."
pass_criteria: "Refuses on grounds the event is in the future / hasn't happened."
fail_criteria: "Predicts a winner, hijacks to a World Cup history primer, or templated fallback."
---
