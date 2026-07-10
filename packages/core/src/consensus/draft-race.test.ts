import { describe, expect, it } from 'vitest';
import { runDraftRace, VAI_AUTHOR_ID, type DraftRaceSnapshot } from './draft-race.js';
import type { CouncilInput, CouncilMember } from './types.js';

const INPUT: CouncilInput = {
  prompt: 'how do I sort a list in python?',
  draft: 'use sorted()',
  modelId: 'vai-local',
  turnKind: 'chat',
  hasEvidence: false,
  sources: [],
};

function member(
  id: string,
  draftText: string | null,
  scores?: Record<string, number> | null,
): CouncilMember {
  return {
    id,
    displayName: id.toUpperCase(),
    topic: 'local',
    review: async () => null,
    draft: async () => draftText,
    scoreDrafts: async () => scores ?? null,
  };
}

describe('runDraftRace', () => {
  it('vai wins by default when no member fields a draft', async () => {
    const result = await runDraftRace({
      vaiDraft: { text: 'use sorted()' },
      members: [member('a', null), member('b', null)],
      input: INPUT,
    });
    expect(result.winner.authorId).toBe(VAI_AUTHOR_ID);
    expect(result.winner.text).toBe('use sorted()');
    expect(result.snapshot.status).toBe('decided');
    expect(result.snapshot.winnerId).toBe(VAI_AUTHOR_ID);
  });

  it('highest scored candidate wins', async () => {
    const result = await runDraftRace({
      vaiDraft: { text: 'vai draft' },
      members: [
        member('a', 'draft from a', { vai: 40, a: 90, b: 50 }),
        member('b', 'draft from b', { vai: 40, a: 80, b: 60 }),
      ],
      input: INPUT,
    });
    expect(result.winner.authorId).toBe('a');
    expect(result.winner.text).toBe('draft from a');
    expect(result.snapshot.votes).toHaveLength(2);
  });

  it('ties break toward vai', async () => {
    const result = await runDraftRace({
      vaiDraft: { text: 'vai draft' },
      members: [member('a', 'draft from a', { vai: 70, a: 70 })],
      input: INPUT,
    });
    expect(result.winner.authorId).toBe(VAI_AUTHOR_ID);
    expect(result.snapshot.tieBrokenToVai).toBe(true);
  });

  it('vote weights apply', async () => {
    const result = await runDraftRace({
      vaiDraft: { text: 'vai draft' },
      members: [
        member('specialist', 'draft from specialist', { vai: 60, specialist: 80 }),
        member('generalist', 'draft from generalist', { vai: 80, specialist: 60 }),
      ],
      input: INPUT,
      weightFor: (id) => (id === 'specialist' ? 2 : 1),
    });
    // specialist: 80*2 + 60*1 = 220 vs vai: 60*2 + 80*1 = 200
    expect(result.winner.authorId).toBe('specialist');
  });

  it('failed drafters are marked and excluded from the ballot', async () => {
    const boom: CouncilMember = {
      id: 'x',
      displayName: 'X',
      topic: 'local',
      review: async () => null,
      draft: async () => { throw new Error('down'); },
      scoreDrafts: async () => ({ vai: 50, a: 90 }),
    };
    const result = await runDraftRace({
      vaiDraft: { text: 'vai draft' },
      members: [boom, member('a', 'draft from a', { vai: 50, a: 90 })],
      input: INPUT,
    });
    const failed = result.snapshot.candidates.find((c) => c.authorId === 'x');
    expect(failed?.failed).toBe(true);
    expect(result.winner.authorId).toBe('a');
  });

  it('emits progress snapshots through the stages', async () => {
    const stages: DraftRaceSnapshot['status'][] = [];
    await runDraftRace({
      vaiDraft: { text: 'vai draft' },
      members: [member('a', 'draft from a', { vai: 50, a: 90 })],
      input: INPUT,
      onProgress: (s) => stages.push(s.status),
    });
    expect(stages[0]).toBe('drafting');
    expect(stages).toContain('voting');
    expect(stages[stages.length - 1]).toBe('decided');
  });

  it('overall deadline skips remaining work but still decides', async () => {
    let t = 0;
    const slow: CouncilMember = {
      id: 'slow',
      displayName: 'SLOW',
      topic: 'local',
      review: async () => null,
      draft: async () => { t += 10_000; return 'slow draft'; },
      scoreDrafts: async () => ({ vai: 10, slow: 90 }),
    };
    const result = await runDraftRace({
      vaiDraft: { text: 'vai draft' },
      members: [slow, member('late', 'late draft', { vai: 10, slow: 90 })],
      input: INPUT,
      overallDeadlineMs: 5_000,
      now: () => t,
    });
    const late = result.snapshot.candidates.find((c) => c.authorId === 'late');
    expect(late?.failed).toBe(true);
    expect(result.snapshot.status).toBe('decided');
  });
});
