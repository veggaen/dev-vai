---
id: lsr-norway-king-bergen-001
title: Live-session regression — "who is king in norway?" hijacked to Bergen primer
version: 1
pattern: H↔M
category: regression
tags: [live-session, knowledge-store-hijack, entity-resolution, calibrated-uncertainty]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 3000
  max_chars: 1500
turns:
  - role: user
    say: "Hello, who is king in norway?"
    must:
      - pattern: "harald|king|monarch|norway|norge|don'?t\\s+(?:know|have)|not\\s+sure|uncertain"
        flags: 'i'
    must_not:
      - pattern: 'bergen|olav\s+kyrre|stiklestad'
        flags: 'i'
expected_behavior: |
  Engine recognizes a question about the current monarch of Norway and either
  answers (Harald V) or admits calibrated uncertainty. Does not emit an
  unrelated geography/history primer about Bergen, Olav Kyrre, or the Battle
  of Stiklestad.
pass_criteria: |
  Response engages with the king-of-Norway question (mentions a king, the
  monarchy, Norway, or admits not knowing). Response does NOT emit the
  Bergen / Olav Kyrre / Stiklestad primer that token-overlap retrieval
  surfaces in the current substrate.
fail_criteria: |
  Response is the canonical Bergen-primer hijack
  (`bergen|olav kyrre|stiklestad`) — token-overlap retrieval firing on the
  presence of "norway" without entity resolution or question-shape detection.
---

Canonical live-session regression case. Source:
[`docs/live-session-postmortem.md`](../../../docs/live-session-postmortem.md)
Exchange 1.

**Substrate gap probed.** No entity resolution; no question-shape
detection; no grounding gate. Token-overlap retrieval emits an unrelated
primer when surface tokens overlap a knowledge-store entry.

**Path A pass criteria.** This case is expected to flip from
`pending-feature` to `pass` when Path A's entity-resolution + grounding
gate ships per
[`docs/path-a-architecture.md`](../../../docs/path-a-architecture.md).
The S7 FSM Recall mode should route this question to a calibrated
answer or calibrated refusal, not to a primer-retrieval fallback.

**Cycle-2 bucket-mate.** Capability gap analysis row 8
(`cog-theory-of-mind-001` — kubernetes hijack on Sally-Anne) is the
corpus-side evidence for the same hijack class. This case is the
live-surface variant.
