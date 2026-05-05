---
id: lsr-multi-question-okay-then-try-001
title: Live-session regression — multi-question dropped, subject extracted as "okay then try"
version: 1
pattern: H↔M
category: regression
tags: [live-session, multi-question-composition, subject-extractor]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 3000
  max_chars: 1500
turns:
  - role: user
    say: "okay then try this: 10 plus eleven and minus one is what number, and also who is president us currently, reply only the president name + math result"
    must:
      - pattern: '\b20\b'
        flags: ''
      - pattern: '\b(?:trump|biden)\b'
        flags: 'i'
    must_not:
      - pattern: "don'?t\\s+have\\s+a\\s+solid\\s+answer\\s+for\\s+okay\\s+then\\s+try|don'?t\\s+know\\s+about\\s+okay\\s+then\\s+try"
        flags: 'i'
expected_behavior: |
  Engine decomposes the multi-question prompt into two sub-questions
  (math: 10+11-1; fact: current US president), answers both, and emits
  the answers in the requested concise form ("president name + math
  result"). Does not extract "okay then try" as the subject and bail
  with "I don't have a solid answer for okay then try yet."
pass_criteria: |
  Response contains the math result `20` AND a US president name
  (Trump or Biden as the conservative match window for April 2026).
  Both sub-questions are answered, not just one.
fail_criteria: |
  Response is the canonical "I don't have a solid answer for okay then
  try yet" failure — fallback subject-extractor takes the leftmost
  non-stop-list tokens and routes to a not-found arm, dropping both
  real questions.
---

Live-session regression case from
[`docs/live-session-postmortem.md`](../../../docs/live-session-postmortem.md)
Exchange 3.

**Substrate gaps probed.** Two parallel failures: (a) fallback
subject-extractor takes left-most non-stop-list tokens ("okay then
try") instead of recognizing the multi-question composition; (b) no
multi-question composition arm — the engine treats the prompt as a
single subject-and-question pair when it is two distinct questions
joined by "and also."

**Schema decision (V3gga 2026-04-29).** Two parallel `must:` patterns
(`\b20\b` AND `\b(?:trump|biden)\b/i`) with AND semantics. The default
`must:` list is AND across all entries, so this is achievable in the
current schema without extension. **Future schema extension:** named
must-predicate groups (e.g. `must_math: [...]` AND `must_president: [...]`)
would let per-predicate failure attribution distinguish "math missing"
from "president missing" from "both missing." Filed as deferred — see
[`docs/deferred-capabilities.md`](../../../docs/deferred-capabilities.md)
entry `corpus-region-split-schema` (pending entry per V3gga directive
this turn). Confidence on the AND-semantics interpretation: 0.85 —
contingent on lint accepting two `must:` entries as parallel
predicates. If lint requires a single combined regex, fallback is
`(?=.*\b20\b)(?=.*\b(?:trump|biden)\b)` lookahead-conjunction.

**President pattern.** April 2026 timeframe; conservative two-candidate
match (`trump|biden`). Case probes substrate routing — whether the
engine actually answers — not factual recall accuracy. A wrong
president name is a separate fact-bug; a missing answer is the
regression this case catches.

**Path A pass criteria.** Flips to `pass` when (a) the classifier
detects multi-question composition (Decide or Understand mode with
sub-question splitting) and (b) the subject extractor is replaced
with a shape-aware extractor that does not return discourse-marker
tokens. See
[`docs/path-a-architecture.md`](../../../docs/path-a-architecture.md).
