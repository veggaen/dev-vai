import { describe, it, expect, beforeEach } from 'vitest';
import {
  runCouncil,
  memberStatuses,
  resetCouncilAvailability,
  type MemberLiveStatus,
} from './council.js';
import type { CouncilInput, CouncilMember, CouncilMemberNote } from './types.js';

/**
 * member-status — the live "green when active" surface. Status is a by-product of the
 * convene loop: a member that returns a note is `available` (green); a member that throws
 * is `down` (red), and `cooldown` (amber) while the council is intentionally resting it.
 * The council itself flagged the real edge case to lock down: status must reflect the LAST
 * run, not a stale snapshot. These tests pin that.
 */

const INPUT: CouncilInput = {
  prompt: 'is this a serious turn that should convene the council?',
  draft: 'draft',
  modelId: 'test',
  turnKind: 'standalone-question',
  hasEvidence: false,
  sources: [],
  draftConfidence: 0.4,
};

/** A member that always succeeds with a usable note. */
function healthyMember(id: string): CouncilMember {
  return {
    id,
    displayName: id,
    topic: 'other',
    review: async (): Promise<CouncilMemberNote> => ({
      memberId: id,
      memberName: id,
      topic: 'other',
      verdict: 'good',
      confidence: 0.8,
      realIntent: 'help',
      hiddenMeaning: '',
      missingCapability: '',
      suggestedAction: 'answer-directly',
      searchQuery: '',
      methodLesson: '',
      concerns: [],
      durationMs: 1,
    }),
  };
}

/** A member that always fails with a classifiable error. */
function failingMember(id: string, message: string): CouncilMember {
  return {
    id,
    displayName: id,
    topic: 'other',
    review: async (): Promise<CouncilMemberNote> => {
      throw new Error(message);
    },
  };
}

const statusOf = (id: string, now?: number): MemberLiveStatus =>
  memberStatuses([id], now)[0].status;

describe('memberStatuses — live green/amber/red from the convene loop', () => {
  beforeEach(() => resetCouncilAvailability());

  it('a member with no recorded run is available (green) by default', () => {
    expect(statusOf('never-run')).toBe('available');
  });

  it('records the failure reason + fix hint for a member that fails', async () => {
    await runCouncil([failingMember('grok', 'out of credits (402)')], INPUT, { timeoutMs: 50, now: () => 1000 });
    const [status] = memberStatuses(['grok'], 1000);
    expect(status.reason).toBe('no-credits');
    expect(status.fixHint).toMatch(/credits/i);
  });

  it('reads as down (red) only once the retry cooldown has elapsed and it is still failing', async () => {
    const t0 = 1_000;
    await runCouncil([failingMember('grok', 'out of credits (402)')], INPUT, { timeoutMs: 50, now: () => t0 });
    // no-credits cooldown is 30 min; just after failure it is being rested (amber)…
    expect(statusOf('grok', t0 + 60_000)).toBe('cooldown');
    // …well past the cooldown, with no recovery, it surfaces as hard-down (red).
    expect(statusOf('grok', t0 + 40 * 60_000)).toBe('down');
  });

  it('reports cooldown (amber) while a failed member is still within its retry window', async () => {
    const t0 = 10_000;
    await runCouncil([failingMember('grok', 'out of credits')], INPUT, { timeoutMs: 50, now: () => t0 });
    // Immediately after failing, the council is resting it → amber, not red.
    expect(statusOf('grok', t0 + 1000)).toBe('cooldown');
  });

  it('a success clears the down-state back to available (green)', async () => {
    const t0 = 20_000;
    await runCouncil([failingMember('grok', 'timed out')], INPUT, { timeoutMs: 50, now: () => t0 });
    expect(statusOf('grok', t0)).not.toBe('available');
    // Same member id, now healthy.
    await runCouncil([healthyMember('grok')], INPUT, { timeoutMs: 50, now: () => t0 + 1 });
    expect(statusOf('grok', t0 + 1)).toBe('available');
  });

  it('reflects the LAST run, not a stale snapshot (the council-flagged edge case)', async () => {
    const t0 = 30_000;
    await runCouncil([healthyMember('qwen')], INPUT, { timeoutMs: 50, now: () => t0 });
    expect(statusOf('qwen', t0)).toBe('available');
    await runCouncil([failingMember('qwen', '403 forbidden')], INPUT, { timeoutMs: 50, now: () => t0 + 1 });
    expect(statusOf('qwen', t0 + 1)).toBe('cooldown'); // freshly failed → resting
  });
});
