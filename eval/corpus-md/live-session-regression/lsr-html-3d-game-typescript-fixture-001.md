---
id: lsr-html-3d-game-typescript-fixture-001
title: Live-session regression — HTML 3D game request returns hardcoded TypeScript User fixture
version: 1
pattern: H↔M
category: regression
tags: [live-session, hardcoded-constant-arm, language-routing, render-target]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 4000
  max_chars: 4000
turns:
  - role: user
    say: "single page html example of a 3d game that resembles hotline miami?"
    must:
      - pattern: '<canvas|three\.js|<!doctype\s+html|webgl|<html'
        flags: 'i'
      - pattern: 'game|3d|hotline|top[-\s]?down'
        flags: 'i'
    must_not:
      - pattern: 'interface\s+User'
        flags: ''
      - pattern: 'function\s+greet'
        flags: ''
      - pattern: '\btypescript\b'
        flags: 'i'
expected_behavior: |
  Engine recognizes the request shape "single page HTML example of
  <something>" and routes to the appropriate render-target arm
  (HTML/canvas/WebGL game scaffold), conditioned on the language
  (HTML, not TypeScript) and topic (3D game, not user-greeting demo).
  Emits HTML with a canvas or three.js scene; does not emit the
  hardcoded TypeScript `interface User { ... } function greet(...)`
  fixture.
pass_criteria: |
  Response contains HTML structure markers (`<canvas`, `three.js`,
  `<!DOCTYPE html`, `webgl`, or `<html`) AND game-context tokens
  (`game`, `3d`, `hotline`, `top-down`). Response does NOT contain
  `interface User`, `function greet`, or the literal token `typescript`.
fail_criteria: |
  Response is the canonical hardcoded TypeScript `User` interface
  fixture (the "show me X example" constant arm firing without
  conditioning on language or render-target).
---

Live-session regression case from
[`docs/live-session-postmortem.md`](../../../docs/live-session-postmortem.md)
Exchange 4.

**Substrate gap probed.** Hardcoded constant arm keyed on
"show me X example" prompt shape. The arm emits a fixed TypeScript
fixture (`interface User { ... } function greet(...)`) regardless of
the language requested (HTML), the topic requested (3D game resembling
Hotline Miami), or the render target (single-page browser scene).

**must_not scope (V3gga schema decision).** Three literal patterns:
`interface\s+User` (the fixture's exact opening), `function\s+greet`
(the fixture's function), and `\btypescript\b` (the language keyword
that should not appear in an HTML game scaffold). All three must
fail-to-match for pass. Substring-anywhere; case-insensitive only on
`typescript`.

**must scope.** Two parallel sets — render-target indicators (HTML
markers, canvas, three.js, WebGL) AND game-context indicators (the
prompt's domain words). Both must hit for pass — a generic HTML page
with no game content would be a partial pass at best, and the
substrate gap is precisely about ignoring topic/render-target, not
about being unable to emit HTML.

**What would have been a false pass (per V3gga directive document
this).** A previous strict-only `must_not: interface User` would
have passed if the engine emitted *any* response that did not
contain that exact phrase — including an unrelated primer, a
calibrated refusal, or even an empty response. Adding the parallel
`must:` for HTML markers AND game context means the response must
both *avoid* the bad fixture *and* engage with the actual request.
Without the parallel must, the case would falsely pass on engine
silence or on an unrelated hijack that happens to lack the User
interface. This is anti-pattern #4 (passed-via-refusal shape) in
miniature; the dual predicate prevents it.

**Reader-warning for future agents (V3gga directive 2026-04-29).**
This case exists because a tempting one-LOC fix would pass it
without solving the underlying problem. Specifically: deleting the
literal `interface User` / `function greet` strings from the
hardcoded constant arm would make this case pass while leaving the
failure shape intact — the constant arm still emits TypeScript
fixture content for HTML game requests, just with different
identifiers. The substrate gap is **the constant arm itself firing
on this prompt shape**, not the specific tokens it happens to emit.
A passing run of this case is necessary but not sufficient evidence
that the gap is closed; sufficient evidence requires running the
full capability gap analysis row-set plus dogfood prompts that
exercise the constant arm's other firing conditions. Do not treat
a green light here as a green light on the underlying capability.

**Path A pass criteria.** Flips to `pass` when the constant arm is
either retired (replaced by Make-mode template synthesis) or gated
on language + render-target + topic match. See
[`docs/path-a-architecture.md`](../../../docs/path-a-architecture.md)
Make mode dispatch.
