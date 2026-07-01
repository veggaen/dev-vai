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

### ⏸ 2026-07-01 — held for review: In the below-floor capability gap message, make the honesty more actionable: after saying

- **Change**: held for review: In the below-floor capability gap message, make the honesty more actionable: after saying
- **Why**: rejected but a peer still champions it — left for a human rather than shelved or force-integrated.
- **Area**: capability-gap

```council-change
{
  "schema": "council-change/1",
  "at": "2026-07-01T22:27:35.035Z",
  "kind": "held",
  "title": "held for review: In the below-floor capability gap message, make the honesty more actionable: after saying ",
  "why": "rejected but a peer still champions it — left for a human rather than shelved or force-integrated.",
  "area": "capability-gap",
  "files": [],
  "verification": null,
  "commit": null,
  "peers": null
}
```

### ✅ 2026-07-01 — Connect the Council self-trigger loop end-to-end (enqueue + inbox bridge + drain)

- **Change**: Connect the Council self-trigger loop end-to-end (enqueue + inbox bridge + drain)
- **Why**: V3gga asked why the queue was not connected. Wired the full chain: a live-turn council consensus naming a missingCapability now enqueues a job (ChatService.triggerSelfImprovement -> file-backed inbox), the background loop ingests + drains it (supervisor -> ingestInbox -> drainSelfImproveQueue -> runSelfImproveJob -> feature-build -> feature-review), all gated + branch-guarded.
- **Area**: self-improvement / council
- **Files**: `packages/core/src/chat/self-improve-queue-port.ts`, `packages/core/src/chat/service.ts`, `packages/runtime/src/steering/self-improve-queue.ts`, `scripts/improve-loop/self-improve-inbox.mjs`, `scripts/improve-loop/feature-review-job.mjs`, `scripts/improve-loop/supervisor.mjs`
- **Verification**: 105 tests green (inbox 9, queue-port 8, job 4, +existing feature suites); ChatService+council 95/95 unbroken; @vai/core + @vai/runtime typecheck clean (exit 0).

```council-change
{
  "schema": "council-change/1",
  "at": "2026-07-01T21:52:08.014Z",
  "kind": "integrated",
  "title": "Connect the Council self-trigger loop end-to-end (enqueue + inbox bridge + drain)",
  "why": "V3gga asked why the queue was not connected. Wired the full chain: a live-turn council consensus naming a missingCapability now enqueues a job (ChatService.triggerSelfImprovement -> file-backed inbox), the background loop ingests + drains it (supervisor -> ingestInbox -> drainSelfImproveQueue -> runSelfImproveJob -> feature-build -> feature-review), all gated + branch-guarded.",
  "area": "self-improvement / council",
  "files": [
    "packages/core/src/chat/self-improve-queue-port.ts",
    "packages/core/src/chat/service.ts",
    "packages/runtime/src/steering/self-improve-queue.ts",
    "scripts/improve-loop/self-improve-inbox.mjs",
    "scripts/improve-loop/feature-review-job.mjs",
    "scripts/improve-loop/supervisor.mjs"
  ],
  "verification": "105 tests green (inbox 9, queue-port 8, job 4, +existing feature suites); ChatService+council 95/95 unbroken; @vai/core + @vai/runtime typecheck clean (exit 0).",
  "commit": null,
  "peers": null
}
```

### ✅ 2026-07-01 — Council self-improvement queue (Level 1) + instruction-driven codegen build effect + CodeRabbit peer augmentation with cooldown

- **Change**: Council self-improvement queue (Level 1) + instruction-driven codegen build effect + CodeRabbit peer augmentation with cooldown
- **Why**: V3gga: let council members trigger their own improvement loops (missingCapability -> queued job -> gated feature-review pipeline); give the review protocol a real codegen build; let peers run CodeRabbit on their suggestions with a free-tier cooldown workaround. Verified the fixed-sequence loop produces (observe-only) before extending it.
- **Area**: self-improvement / council
- **Files**: `scripts/improve-loop/self-improve-queue.mjs`, `scripts/improve-loop/feature-build.mjs`, `scripts/improve-loop/coderabbit.mjs`, `scripts/improve-loop/feature-review-run.mjs`
- **Verification**: 84 tests green (self-improve-queue 13, feature-build 17, coderabbit 16, +feature-review 28 +changelog 10); supervisor fixed-sequence run verified producing (class 100%, VRAM-safe); end-to-end preview run of feature-review against live qwen2.5-coder:7b fired every branch (build/self-match/peer/rebuild/keep-chasing/held), preview-safe.

```council-change
{
  "schema": "council-change/1",
  "at": "2026-07-01T21:16:09.129Z",
  "kind": "integrated",
  "title": "Council self-improvement queue (Level 1) + instruction-driven codegen build effect + CodeRabbit peer augmentation with cooldown",
  "why": "V3gga: let council members trigger their own improvement loops (missingCapability -> queued job -> gated feature-review pipeline); give the review protocol a real codegen build; let peers run CodeRabbit on their suggestions with a free-tier cooldown workaround. Verified the fixed-sequence loop produces (observe-only) before extending it.",
  "area": "self-improvement / council",
  "files": [
    "scripts/improve-loop/self-improve-queue.mjs",
    "scripts/improve-loop/feature-build.mjs",
    "scripts/improve-loop/coderabbit.mjs",
    "scripts/improve-loop/feature-review-run.mjs"
  ],
  "verification": "84 tests green (self-improve-queue 13, feature-build 17, coderabbit 16, +feature-review 28 +changelog 10); supervisor fixed-sequence run verified producing (class 100%, VRAM-safe); end-to-end preview run of feature-review against live qwen2.5-coder:7b fired every branch (build/self-match/peer/rebuild/keep-chasing/held), preview-safe.",
  "commit": null,
  "peers": null
}
```

### ⏸ 2026-07-01 — held for review: Make greet() return an enthusiastic greeting by appending an exclamation mark to the messa

- **Change**: held for review: Make greet() return an enthusiastic greeting by appending an exclamation mark to the messa
- **Why**: rejected but a peer still champions it — left for a human rather than shelved or force-integrated.
- **Area**: feature

```council-change
{
  "schema": "council-change/1",
  "at": "2026-07-01T20:46:23.435Z",
  "kind": "held",
  "title": "held for review: Make greet() return an enthusiastic greeting by appending an exclamation mark to the messa",
  "why": "rejected but a peer still champions it — left for a human rather than shelved or force-integrated.",
  "area": "feature",
  "files": [],
  "verification": null,
  "commit": null,
  "peers": null
}
```

### ✅ 2026-07-01 — Add Council feature-review protocol + self-improvement changelog

- **Change**: Add Council feature-review protocol + self-improvement changelog
- **Why**: V3gga: let the Council build features, re-read its own creation against the original instruction, gather multi-member peer advice (reasons + change-tips), rebuild once on rejection, and shelve dead ideas with a tokenized fingerprint. This changelog is the side-note for humans/Copilot/agents to see what changed and why.
- **Area**: self-improvement / council
- **Files**: `scripts/improve-loop/feature-review.mjs`, `scripts/improve-loop/changelog.mjs`, `docs/agent-tooling-guide.json`
- **Verification**: node --test feature-review.test.mjs 28/28 green; changelog.test.mjs (pending run)

```council-change
{
  "schema": "council-change/1",
  "at": "2026-07-01T19:51:46.653Z",
  "kind": "integrated",
  "title": "Add Council feature-review protocol + self-improvement changelog",
  "why": "V3gga: let the Council build features, re-read its own creation against the original instruction, gather multi-member peer advice (reasons + change-tips), rebuild once on rejection, and shelve dead ideas with a tokenized fingerprint. This changelog is the side-note for humans/Copilot/agents to see what changed and why.",
  "area": "self-improvement / council",
  "files": [
    "scripts/improve-loop/feature-review.mjs",
    "scripts/improve-loop/changelog.mjs",
    "docs/agent-tooling-guide.json"
  ],
  "verification": "node --test feature-review.test.mjs 28/28 green; changelog.test.mjs (pending run)",
  "commit": null,
  "peers": null
}
```
