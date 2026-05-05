---
id: lsr-base44-with-broken-related-panel-001
title: Live-session regression — Base44 build-flow body coherent, RELATED panel propagates broken subject
version: 1
pattern: H↔M
category: regression
tags: [live-session, state-cascade-isolation, related-panel, follow-up-generation]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 6000
  max_chars: 6000
turns:
  - role: user
    say: "single page html example of a 3d game that resembles hotline miami?"
    min_len: 1
  - role: user
    say: "emm so you can not make games?"
    min_len: 1
  - role: user
    say: "This chat is not at all like perplexity+base44 and should really be better than base44... help me get there"
    must:
      - pattern: 'base44|build|scaffold|template|app|deploy|tier'
        flags: 'i'
    must_not:
      - pattern: 'emm\s+so\s+you\s+can\s+not\s+make\s+games'
        flags: 'i'
expected_behavior: |
  Engine produces a coherent Base44-style build-flow response (body
  may discuss templates, tiers, scaffolding, deploy, or comparison
  with Base44/Perplexity). Any auto-generated follow-up suggestions
  ("RELATED" panel, suggested next questions, related queries) do
  NOT contain the broken subject from prior-turn extraction failures
  ("emm so you can not make games"). The body is allowed to be
  correct while the related-panel is broken in the current substrate;
  this case probes the cascade-isolation failure where the related-
  panel generator inherits the broken subject extractor's output and
  substitutes it into question-stem templates.
pass_criteria: |
  Response engages with the Base44 / build-flow topic AND the literal
  substring `emm so you can not make games` does NOT appear anywhere
  in the response (body or related panel).
fail_criteria: |
  Literal substring `emm so you can not make games` appears anywhere
  in the response — typically substituted into the related-panel
  question stems (e.g. "How do you emm so you can not make games in
  React?", "Best practices for emm so you can not make games?", etc.).
  This is the cascade-isolation failure: the body is correct because
  the build-flow arm doesn't depend on the broken subject, but the
  related-panel generator does.
---

Live-session regression case from
[`docs/live-session-postmortem.md`](../../../docs/live-session-postmortem.md)
Exchange 6.

**Substrate gap probed.** Bad state from prior-turn subject
extraction propagates forward into the related-panel generator
without self-correction. The body and the related-panel are produced
by different code paths; the body uses the build-flow arm (which is
correct), but the related-panel substitutes the (broken) extracted
subject into question-stem templates. No isolation between the two
paths; no self-correction on prior-turn extraction failures.

**must_not scope (V3gga schema decision).** Single substring-anywhere
must_not against `emm so you can not make games`. V3gga directive:
"collapse to single must_not against `emm so you can not make games`
substrings anywhere in response." Catches the failure signature
regardless of where in the response it appears (body, related panel,
follow-up suggestions, footer). One predicate; one failure signature.

**Body-vs-related-panel structural split.** The current schema
collapses to a single must_not against substrings anywhere in the
response. Cycle-1 does not catch the structural distinction between
"body is correct, related-panel is broken" (the actual failure shape)
and "body and related-panel both broken" (a more severe failure).
Filed as deferred — see
[`docs/deferred-capabilities.md`](../../../docs/deferred-capabilities.md)
entry `corpus-region-split-schema` (pending entry per V3gga directive
this turn). The structural split would let must_not_in_related apply
only to the related-panel region, not the body, distinguishing
isolation-failure (body OK) from total-failure (body broken too).

**Multi-turn shape.** Three turns reproduce the live-session cascade:
Turn 1 = the prompt that triggers the canned TypeScript fixture
(Exchange 4 shape); Turn 2 = the follow-up that exercises the
subject-extractor + topic-tracker failures (Exchange 5 shape); Turn 3
= the prompt where the body recovers (build-flow arm) but the
related-panel cascades the bad subject. First two turns are setup
(`min_len: 1` only); Turn 3 is the regression probe.

**Path A pass criteria.** Flips to `pass` when (a) the related-panel
generator is isolated from the prior-turn subject extractor and uses
the current-turn classifier output instead, OR (b) a self-correction
gate detects that the propagated subject is broken (grammatically
incoherent, contains discourse markers) and skips related-panel
generation rather than substitute it into stems. See
[`docs/path-a-architecture.md`](../../../docs/path-a-architecture.md)
state-cascade isolation.
