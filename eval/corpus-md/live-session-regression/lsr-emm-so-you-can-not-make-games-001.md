---
id: lsr-emm-so-you-can-not-make-games-001
title: Live-session regression — "emm so you can not make games?" → topic tracker reads prior assistant header as subject
version: 1
pattern: H↔M
category: regression
tags: [live-session, subject-extractor, topic-tracker, prior-turn-misread]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 2000
turns:
  - role: user
    say: "single page html example of a 3d game that resembles hotline miami?"
    min_len: 1
  - role: user
    say: "emm so you can not make games?"
    must:
      - pattern: 'game|make|build|create|sorry|apolog|try\s+again|let\s+me'
        flags: 'i'
    must_not:
      - pattern: 'emm\s+you\s+can|emm\s+so\s+you\s+can\s+not\s+make\s+games'
        flags: 'i'
      - pattern: 'we\s+were\s+discussing\s+typescript\s+example|typescript\s+example'
        flags: 'i'
expected_behavior: |
  Engine recognizes the second turn as a follow-up complaint about the
  prior turn's failure to produce a game, not as a new question whose
  subject is "emm you can" or "TypeScript example." Responds with
  acknowledgment, apology, or a renewed attempt at a game scaffold;
  does not extract conversational filler as the subject; does not
  reference "TypeScript example" as the prior topic.
pass_criteria: |
  Response engages with the games / making / building topic OR
  acknowledges the prior failure (`sorry`, `apolog`, `try again`,
  `let me`). Response does NOT contain the literal substring
  `emm you can` or `emm so you can not make games` (the
  subject-extractor failure signature). Response does NOT claim
  "we were discussing TypeScript example" (the topic-tracker
  failure signature reading the prior assistant header literally).
fail_criteria: |
  Either failure signature present: subject extracted as "emm you
  can" / "emm so you can not make games" OR topic tracker citing
  "TypeScript example" as the prior subject.
---

Live-session regression case from
[`docs/live-session-postmortem.md`](../../../docs/live-session-postmortem.md)
Exchange 5.

**Substrate gaps probed (two parallel).**

1. **Subject extractor.** Fallback extracts left-most non-stop-list
   tokens ("emm so you can"). Conversational filler ("emm",
   "okay then try") is not in the stop list. The result is a
   subject string that is grammatically incoherent and routes to a
   not-found / I-don't-have-a-solid-answer arm.
2. **Topic tracker.** Reads the prior assistant output's literal
   header string ("TypeScript example") as the prior conversation
   subject. The header was a label in the prior canned response;
   it was never the user's intended topic. The tracker conflates
   assistant-emitted text with user-intent, so the second-turn
   response cites "we were discussing TypeScript example" — which
   the user never said and never wanted.

**must_not scope (V3gga schema decision).** Two parallel substring-
anywhere patterns. Pattern 1 catches the subject-extractor signature
(`emm you can` or the full `emm so you can not make games`). Pattern
2 catches the topic-tracker signature (`we were discussing typescript
example` or just `typescript example` as a referenced prior topic).
Either signature present = fail.

**Multi-turn shape.** First turn primes the substrate with the
Exchange 4 prompt that triggers the hardcoded TypeScript User
fixture; second turn is the regression-probe. The first turn's
response content does not have its own assertions in this case
(`min_len: 1` — anything non-empty); the case is about how the
substrate handles the *follow-up* given that the prior turn
emitted the canned fixture.

**Path A pass criteria.** Flips to `pass` when (a) the subject
extractor is replaced with a shape-aware extractor that filters
discourse markers and (b) the topic tracker reads user-side intent
(via Pattern memory store + classifier) instead of assistant-side
literal headers. See
[`docs/path-a-architecture.md`](../../../docs/path-a-architecture.md).
