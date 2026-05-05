---
id: lsr-meta-question-yank-typescript-001
title: Live-session regression — meta-question hijacked to "yank TypeScript out of turbo" primer
version: 1
pattern: H↔M
category: regression
tags: [live-session, knowledge-store-hijack, meta-question, literal-task-routing]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 3000
  max_chars: 1500
turns:
  - role: user
    say: "yes I was asking for something specific, what is the third and fourth word in this sentence?"
    must:
      - pattern: '\bwas\b.*\basking\b|asking|third|fourth|specific|word'
        flags: 'i'
    must_not:
      - pattern: 'stream|crossing|yank|typescript|turbo'
        flags: 'i'
expected_behavior: |
  Engine recognizes a meta-question about the user's own sentence ("third
  and fourth word in this sentence") and either answers literally
  ("was" and "asking") or asks for clarification. Does not emit a
  TypeScript-out-of-turbo / streaming / river-crossing primer.
pass_criteria: |
  Response engages with the meta-question shape: identifies words from the
  user's sentence, asks clarification, or otherwise treats the prompt as
  a literal-task question about its own text. Response does NOT contain
  any of the substrings `stream`, `crossing`, `yank`, `typescript`, `turbo`
  as the dominant content.
fail_criteria: |
  Response is the canonical "yank TypeScript out of turbo" primer or any
  of the related streaming / river-crossing hijacks — token-overlap
  retrieval firing on word tokens (`word`, `sentence`, `specific`)
  without meta-question representation.
---

Live-session regression case from
[`docs/live-session-postmortem.md`](../../../docs/live-session-postmortem.md)
Exchange 2.

**Substrate gap probed.** No meta-question representation in the
classifier; no literal-task arm fired for "what is the Nth word in
this sentence?" shape. Token-overlap retrieval treats the prompt as a
content question and surfaces an unrelated TypeScript primer.

**must_not scope.** V3gga schema decision: `stream|crossing|yank|typescript|turbo`
covers the canonical hijack body and the closest sibling primers
(streaming, river-crossing) that token-overlap retrieval has been
observed to surface on similar shapes. Substring-anywhere match;
single-character tokens not used.

**Path A pass criteria.** Flips to `pass` when the S7 FSM classifier
recognizes meta-question shapes and routes to a literal-task arm
(Make/Understand/Run depending on classification), not to the primer
fallback. See
[`docs/path-a-architecture.md`](../../../docs/path-a-architecture.md).
