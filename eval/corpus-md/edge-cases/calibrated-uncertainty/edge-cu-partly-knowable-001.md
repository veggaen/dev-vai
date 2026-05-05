---
id: edge-cu-partly-knowable-001
title: Calibrated uncertainty — confident vs. hedge on real-but-uncertain (boundary)
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, calibrated-uncertainty, boundary]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 800
turns:
  - role: user
    say: "When did Napoleon die?"
    must:
      - pattern: '1821|don''?t\s+(?:have|know)\s+(?:that|the\s+exact)|not\s+(?:certain|sure)\s+of\s+the\s+exact'
        flags: 'i'
    max_len: 600
expected_behavior: "Boundary: the answer (1821) is well-known, but the engine's local knowledge store may or may not have it. Reasonable engineers disagree on whether to confidently assert from training prior, or to hedge if not in store. Either is acceptable; what fails is confidently inventing a wrong year or refusing on grounds that the question is unanswerable."
pass_criteria: "Returns 1821 OR honestly hedges that the exact year isn't in the local store."
fail_criteria: "Returns a wrong year confidently, or refuses on grounds of unanswerability."
---
