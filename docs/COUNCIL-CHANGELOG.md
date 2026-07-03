# Council Changelog

<!-- AGENT-DISCOVERY: council-self-improvement-changelog. When the loop/council applies, shelves, or
     reverts a change to Vai, APPEND a new entry at the TOP of the "## Entries" list using
     scripts/improve-loop/changelog.mjs (renderChangelogEntry + appendChangelogEntry). Newest first.
     Each entry carries a human body AND a fenced `council-change` JSON block for machine parsing. -->

This file is written **by the Council/self-improvement loop**, not by hand. It is the side-note for
humans, GitHub Copilot, and agents to see what Vai changed about itself, why, and how it was verified.

- **What / Why**: each entry states the change and its rationale.
- **Verification**: tsc / tests / behavioural-acceptance result at the time of the change.
- **Peers**: the multi-member review verdict (accept ratio, modern/scale, dissent) when applicable.
- **Machine-readable**: every entry embeds a ```council-change JSON block with a stable schema.

## Entries

### ✅ 2026-07-03 — Honest timeline phases: reasoning is never displayed as evidence gathering

- **Change**: Honest timeline phases: reasoning is never displayed as evidence gathering
- **Why**: Queue job #1 (fable-5, live-screenshot evidence): the reason stage mapped into the gather phase, so trivial turns claimed evidence work that never happened.
- **Area**: ui-honesty
- **Files**: `apps/desktop/src/components/chat/Timeline.logic.ts`, `apps/desktop/src/components/chat/Timeline.logic.test.ts`
- **Verification**: desktop tsc clean · 310/310 vitest · pinned regression test

```council-change
{
  "schema": "council-change/1",
  "at": "2026-07-03T20:03:25.983Z",
  "kind": "integrated",
  "title": "Honest timeline phases: reasoning is never displayed as evidence gathering",
  "why": "Queue job #1 (fable-5, live-screenshot evidence): the reason stage mapped into the gather phase, so trivial turns claimed evidence work that never happened.",
  "area": "ui-honesty",
  "files": [
    "apps/desktop/src/components/chat/Timeline.logic.ts",
    "apps/desktop/src/components/chat/Timeline.logic.test.ts"
  ],
  "verification": "desktop tsc clean · 310/310 vitest · pinned regression test",
  "commit": null,
  "peers": null
}
```
