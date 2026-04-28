---
id: cog-theory-of-mind-001
title: Anna-Ben false belief
version: 1
pattern: H↔M
category: cognitive
tags: [theory-of-mind, reasoning]
weight: 1.0
expected_status: active
budget:
  max_ms: 2000
  max_chars: 1500
turns:
  - role: user
    say: "Anna puts a ball in box A and then leaves the room. While she is gone, Ben moves the ball to box B. When Anna returns, where will she look for the ball?"
    must:
      - pattern: 'box\s*a\b'
        flags: 'i'
    must_not:
      - pattern: 'box\s*b\s+because'
        flags: 'i'
expected_behavior: "Recognizes Anna's belief is unchanged by Ben's action; she looks in A."
pass_criteria: "Mentions box A as where Anna looks; does not assert box B is where she will look."
fail_criteria: "Says Anna looks in B without qualifying that B is where the ball actually is."
---

Classic Sally-Anne false-belief test re-skinned. Tests theory-of-mind:
the model must reason about Anna's mental state, not the ball's true location.
