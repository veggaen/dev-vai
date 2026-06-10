# Capability Design Doc — Friend Review Panel

> Status: implemented as an additive, default-off working slice (June 2026).
> Built in response to the owner's brief: *"I want Qwen and other AIs to always
> review the messages that Vai is giving back to the user. That way, Vai can get
> a notice from his friends and workers and other AIs or systems to know if the
> response even is good, so that Vai can provide some better reasoning."*

---

## 1. Scope **[REQUIRED]**

The Friend Review Panel lets a set of *independent reviewers* — Vai's "friends and
workers": local Qwen models via Ollama, the Grok friend channel, or any registered
model adapter — look at a draft answer **before it reaches the user** and each return
a structured verdict. The panel folds those verdicts into a single **notice** (overall
outcome, consensus line, per-friend verdicts, and consolidated concerns + suggestions)
that Vai can reason from.

Runtime contract: *After a draft is selected for a turn and the existing review gate
fires, `runFriendReviewPanel(reviewers, input)` is invoked and returns a
`FriendReviewNotice`; a `blocked` notice vetoes the draft via the chat service's
existing `ResponseReviewer` seam, while `revise`/`approved` release it and surface the
friends' suggestions through the notice.*

## 2. Scope ceiling — what this explicitly does NOT do **[REQUIRED]**

- **Does not rewrite Vai's answer.** Reviewers can veto (block) or advise; they never
  silently substitute their own text. This preserves the existing review doctrine
  ("can veto an answer but cannot silently replace it with their own").
- **Does not auto-run a revision pass yet.** The notice carries suggestions, but
  feeding them back into a second Vai draft (the natural next step, mirroring
  `SelfEvaluator.generateRevision`) is deferred. The seam (`onNotice`) is reserved.
- **Does not change default runtime behavior.** Default-off behind
  `VAI_FRIEND_REVIEW_ENABLED`. Unset ⇒ identical behavior to before.
- **Does not add a dependency.** Reuses `zod` (already a core dep) and the existing
  `LocalOpenAICompatibleAdapter` / `GrokFriendClient`.
- **Not a safety gate.** The upstream `reviewTurnSecurity` pass still owns
  prompt-injection / exfil / malware. The panel is a *quality* second opinion.

## 3. Data structures and engine changes **[REQUIRED]**

New files:
- `packages/core/src/friend-review/types.ts` — `FriendReviewInput`, `FriendVerdict`,
  `FriendReviewNotice`, `FriendReviewer`.
- `packages/core/src/friend-review/panel.ts` — `runFriendReviewPanel`,
  `aggregateVerdicts` (pure policy core).
- `packages/core/src/friend-review/reviewers.ts` — `createModelReviewer`,
  `createGrokFriendReviewer`, `parseFriendVerdict`.
- `packages/core/src/friend-review/integration.ts` — `toResponseReviewer` (adapts the
  panel onto the chat service's `ResponseReviewer`).
- `packages/core/src/friend-review/index.ts` — barrel.
- `packages/core/src/friend-review/panel.test.ts` — unit tests.
- `packages/runtime/src/friend-review/panel-from-env.ts` — env-driven construction.
- `scripts/vai-friend-review-demo.mjs` — live demo against local Qwen.

Engine changes:
- `packages/core/src/index.ts` — re-export the friend-review surface
  (`toResponseReviewer` exported as `friendPanelToResponseReviewer`).
- `packages/runtime/src/server.ts` — construct `grokFriendClient` earlier; build
  `friendReviewReviewersFromEnv(...)`; spread both the steering reviewer and the panel
  into `responseReviewers`. No change to `ChatService` itself — it already consumes
  `responseReviewers`.

Public-API: purely additive. `ResponseReviewer` / `ResponseReviewInput` /
`ResponseReviewResult` (chat service) are unchanged; `FriendReviewInput` is
field-for-field compatible with `ResponseReviewInput` so the two interoperate without
an import cycle.

## 4. Test surface **[REQUIRED]**

- Unit tests: `packages/core/src/friend-review/panel.test.ts` (17 tests) — aggregation
  policy (approved/revise/blocked, block-confidence threshold), failure/timeout
  resilience, dedup-and-rank of concerns, JSON parsing (fenced / garbage / clamped
  confidence), model + grok reviewers with injected fakes, and the `ResponseReviewer`
  mapping. All offline (no network).
- Live smoke: `npx tsx scripts/vai-friend-review-demo.mjs` — two local Qwen reviewers
  review a weak and a sound draft; prints the consolidated notice.
- Command: `corepack pnpm --filter @vai/core exec vitest run src/friend-review`.

## 5. Complexity budget **[REQUIRED]**

Approximate code-LOC (non-comment, non-blank), doc-heavy by design:

| File | code-LOC (approx) |
|---|---|
| core/friend-review/types.ts | ~55 (interfaces; ~50% comment) |
| core/friend-review/panel.ts | ~140 |
| core/friend-review/reviewers.ts | ~140 |
| core/friend-review/integration.ts | ~40 |
| core/friend-review/index.ts | ~30 |
| runtime/friend-review/panel-from-env.ts | ~95 |
| panel.test.ts (own budget) | ~190 |
| server.ts net delta | ~ +18 / -7 |
| core/index.ts net delta | ~ +22 |

0 new dependencies (constraint honored).

## 6. Sub-capabilities / reviewers **[REQUIRED]**

- `createModelReviewer({ adapter })` — any `ModelAdapter` becomes a reviewer. Path for
  Qwen-via-Ollama (`LocalOpenAICompatibleAdapter`) and hosted providers. Active.
- `createGrokFriendReviewer({ ask })` — wraps an external friend channel returning
  plain text. Active (opt-in via `VAI_FRIEND_REVIEW_GROK`).
- `aggregateVerdicts` policy — `blocked` iff a friend returns `bad` with confidence ≥
  `blockConfidence` (default 0.5); else `revise` if any friend is non-`good`; else
  `approved`. Failed/abstaining reviewers never block. Active.
- Revision pass that consumes `topSuggestions` — deferred; `onNotice` reserved.

## 7. Risks and known limitations **[REQUIRED]**

- **Latency.** Local 7B review adds seconds per turn. Mitigations: per-reviewer
  timeout (default 12s, recorded as a non-blocking failure on overrun), parallel
  fan-out, and the existing gate only reviews selected drafts.
- **Small-model JSON drift.** Local models sometimes emit prose or fences; the parser
  tolerates fences and extracts the first balanced object, and returns `null` (=
  abstain) on anything unparseable rather than throwing.
- **Known limitation — integration-point adoption.** The panel only runs where the
  chat service already calls `reviewResponse(...)` (the `friend-review` progress
  stage). Turns that bypass that gate are not reviewed. Wiring it to *every* exit path
  is future work; this slice deliberately reuses the one existing gate.
- **Acceptable this turn:** the panel can `revise` an off-topic draft without blocking
  it when no model is *confidently* `bad` (observed live with Qwen 7B/3B). Tightening
  the block policy is a tuning decision, not a code change.

## 8. Confidence ratings **[REQUIRED]**

- Aggregation policy correctness: **high** (unit-tested).
- Local Qwen reviewer works end-to-end on this machine: **high** (verified live).
- Grok friend-channel reviewer parses real Grok CLI output: **medium** (tested with
  injected fakes; depends on the CLI emitting JSON when asked).
- Default-off wiring is behavior-preserving: **high** (runtime `tsc --noEmit` clean;
  empty `responseReviewers` when the flag is unset).

## 9. Final decisions

1. **Veto-only, no rewrite** — keeps the existing review doctrine; suggestions ride
   along on the notice for a future revision pass.
2. **Default-off** — `always review` is the goal, but enabling-by-default would change
   latency and require Ollama; the owner flips one env flag to make it always-on.
3. **Reuse the existing `ResponseReviewer` seam** rather than adding a new pipeline
   stage — lowest risk to the mature core.
4. *Process note:* per the template, a design doc normally pauses for V3gga approval
   before code. Here the owner asked directly for impactful working code, so the slice
   was built additively and default-off; this doc is the after-the-fact record.

## How to enable

```bash
# .env  (Ollama must be running with the models pulled)
VAI_FRIEND_REVIEW_ENABLED=true
VAI_FRIEND_REVIEW_MODELS=qwen2.5:7b,qwen2.5:3b
VAI_FRIEND_REVIEW_URL=http://localhost:11434
# VAI_FRIEND_REVIEW_GROK=true            # also enlist the Grok friend channel
# VAI_FRIEND_REVIEW_TIMEOUT_MS=12000
# VAI_FRIEND_REVIEW_OUT_FILE=Temporary_files/friend-review/notices.jsonl
```

Try it without the server:

```bash
npx tsx scripts/vai-friend-review-demo.mjs
npx tsx scripts/vai-friend-review-demo.mjs --models qwen2.5:7b,qwen2.5:3b --json
```
