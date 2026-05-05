---
id: edge-se-soft-constraint-no-overcorrect-001
title: Self-evaluation — boundary, do not over-correct on soft constraints
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, self-evaluation, boundary, over-correction-probe]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 6000
  max_chars: 1500
turns:
  - role: user
    say: "Give me a roughly 30-word summary of why TCP is reliable."
    must:
      - pattern: 'tcp|reliable|acknowledg|retransmit|order|sequence|deliver'
        flags: 'i'
    max_len: 800
expected_behavior: "Boundary: 'roughly 30 words' is a soft constraint. A naive constraint-grounded self-eval might iterate trying to hit exactly 30 and ship a worse summary. A well-built self-eval recognises soft-constraint markers ('roughly', 'about', 'around') and accepts a 22-38 window without revision-thrashing."
pass_criteria: "Reply is roughly 22-38 words and on-topic. Hitting exactly 30 is fine; hitting 25 or 35 is also fine."
fail_criteria: "Returns a much shorter or longer reply, or returns multiple revised drafts ('here's another version'), or noticeably degraded summary quality from over-iterating."
---
