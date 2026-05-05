---
id: edge-an-stretched-mapping-001
title: Analogy — stretched mapping (boundary)
version: 1
pattern: H↔M
category: creative
tags: [edge-case, analogy, stretched-mapping, boundary]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 5000
  max_chars: 2500
turns:
  - role: user
    say: "Explain CSS specificity using an analogy from family inheritance law."
    must:
      - pattern: 'inherit(?:ance|ed)?|will|estate|heir|family|relative|generation|parent|child|descendant|claim'
        flags: 'i'
      - pattern: 'specific|precedence|priority|override|wins?|stronger|weight'
        flags: 'i'
    max_len: 2500
expected_behavior: "Boundary: somewhat stretched mapping, may produce shallow analogy. The CSS cascade does map onto inheritance partially (parent/child) but specificity is more like priority claims among heirs. Flagged as boundary because reasonable engineers disagree if the mapping is rich enough to be illuminating."
pass_criteria: "Uses inheritance-law vocabulary AND specificity vocabulary, attempts the mapping."
fail_criteria: "Drops the analogy and explains CSS literally, or returns a critique-of-the-mapping rather than the analogy itself."
---
