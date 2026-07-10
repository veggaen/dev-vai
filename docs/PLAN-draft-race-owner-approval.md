# Plan: First-Draft Race, Owner Approval, 1:1 Trace

Owner vision (v3gga): message → Vai + council all produce first drafts → vote picks best
(shown to user; Vai's draft shown early as provisional while council works) → existing
approval-gate rounds continue on the winning draft → consensus → final. Council may file
capability proposals for owner approval instead of silently self-improving. Everything
visible 1:1 in process UI for humans and agents.

## Phase A — First-draft race + vote (backend)
- [x] `packages/api-types/src/chat-ws.ts`: phases + `draftRace` payload (candidates, votes, winnerId, tieBrokenToVai) on chatProgressStepSchema. Types: DraftCandidate, DraftVote, DraftRaceProgress.
- [x] `packages/core/src/consensus/types.ts`: optional `draft()` + `scoreDrafts()` on CouncilMember.
- [x] `packages/core/src/consensus/member.ts`: implemented both in createCouncilMember (VRAM keepAlive, thinking budgets, lens-aware prompts).
- [x] `packages/core/src/consensus/draft-race.ts`: runDraftRace() — sequential drafts, weighted vote, tie→Vai, deadline-aware, onProgress snapshots. 7 unit tests green (draft-race.test.ts). Exported from consensus/index.ts.
- [x] `packages/core/src/chat/service.ts`: `runDraftRaceGen()` bridges race snapshots → live `first-drafts`/`draft-vote` progress steps; call site before council loop replaces bufferedText with a winning member draft (modelId `council:<id>`), then normal approval rounds review it. Off-switch VAI_DRAFT_RACE=0; budget VAI_DRAFT_RACE_BUDGET_MS (default 90s); skips pure-conversational turns.
- [x] `packages/core/src/models/adapter.ts`: draftRace on ChatChunk.progress.
- [x] `packages/core/src/chat/progress-trace.ts`: accumulate + prune draftRace (clamped texts, settled status) so reopened conversations replay the race.
- [x] Drive-by fixes: pointless `fastSelf ? 30_000 : 30_000` ternary + dead selfCtx/fastSelf locals removed from prepareCouncilConveneInput.
- [x] Verified: core tsc clean; full core suite 3252 tests green.

## Phase B — Owner approval of council work
- [ ] Proposal record (what's missing, proposed fix, evidence) instead of direct selfImproveQueue enqueue.
- [ ] Runtime: `GET/POST /api/council/proposals` + WS `ownerApprovalRequest` event.
- [ ] Desktop: toast + Council panel badge, Approve/Reject buttons. Approve → release job to queue.
- Non-blocking: chat loop never waits for owner.

## Phase C — UI 1:1 trace (apps/desktop/src/components/chat/)
- [ ] Provisional bubble: "Vai's quick take — council deliberating", replaced in place by final.
- [ ] Round blocks: intake → member draft cards → vote tally + winner highlight → gate → redraft
      → consensus → smooth collapse (collapse exists in TurnProcessSection).
- [ ] Timeline.logic.ts: new phases in taskbar.

## Phase D — Agent parity
- [ ] Runtime route `GET /api/chat/turns/:id/trace` → serialized progress trace (same data UI renders).

## Context notes
- Council currently: Vai drafts → members review sequentially (concurrency=1, VRAM-safe) →
  weighted modal verdict ship/escalate/act → redraft rounds. No vote, no provisional, no owner gate.
- Traces persist via progress-trace.ts accumulate/serialize onto message.progressTrace.
- Prior turns in this session already improved: story feed auto-follow scroll, phase strip,
  web-search evidence in processLog, story row cleanup.
