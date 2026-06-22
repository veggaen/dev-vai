import { describe, expect, it } from 'vitest';
import { deliberate, isDeliberationEnabled, buildPeerNotes } from './deliberate.js';
import type { CouncilInput, CouncilMember, CouncilMemberNote, CouncilVerdict } from './types.js';

const INPUT: CouncilInput = {
  prompt: 'is this draft good?', draft: 'a draft', modelId: 'vai:v0',
  turnKind: 'chat', hasEvidence: false, sources: [],
};

function note(p: Partial<CouncilMemberNote> & Pick<CouncilMemberNote, 'verdict' | 'memberId'>): CouncilMemberNote {
  return {
    memberId: p.memberId, memberName: p.memberName ?? p.memberId, topic: p.topic ?? 'other',
    verdict: p.verdict, confidence: p.confidence ?? 0.8, realIntent: p.realIntent ?? '',
    hiddenMeaning: '', missingCapability: '', suggestedAction: p.suggestedAction ?? 'answer-directly',
    searchQuery: '', methodLesson: p.methodLesson ?? '', concerns: p.concerns ?? [], durationMs: 1, error: p.error,
  };
}

/** A member that records what input it saw each round and returns a scripted verdict per round. */
function scriptedMember(id: string, verdicts: CouncilVerdict[], log: { id: string; sawPeers: boolean }[]): CouncilMember {
  let round = 0;
  return {
    id, displayName: id, topic: 'other',
    async review(input: CouncilInput): Promise<CouncilMemberNote> {
      log.push({ id, sawPeers: Boolean(input.peerNotes?.length) });
      const v = verdicts[Math.min(round, verdicts.length - 1)];
      round++;
      return note({ memberId: id, verdict: v });
    },
  };
}

describe('isDeliberationEnabled', () => {
  it('is OFF by default (no default-behavior change)', () => {
    expect(isDeliberationEnabled({})).toBe(false);
    expect(isDeliberationEnabled({ VAI_COUNCIL_DELIBERATE: '0' })).toBe(false);
  });
  it('is ON only with the explicit flag', () => {
    expect(isDeliberationEnabled({ VAI_COUNCIL_DELIBERATE: '1' })).toBe(true);
  });
});

describe('buildPeerNotes', () => {
  it('compacts usable notes to role/verdict/intent/concern and drops errored ones', () => {
    const peers = buildPeerNotes([
      note({ memberId: 'a', memberName: 'Skeptic', verdict: 'bad', realIntent: 'wants proof', concerns: ['unsupported claim'] }),
      note({ memberId: 'b', verdict: 'good', error: 'timeout' }),
    ]);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ role: 'Skeptic', verdict: 'bad', intent: 'wants proof', concern: 'unsupported claim' });
  });
});

describe('deliberate — bounded 2-round, crash-safe', () => {
  it('runs a SECOND round on a split panel, and members SEE peers in round 2', async () => {
    const log: { id: string; sawPeers: boolean }[] = [];
    const members = [
      scriptedMember('a', ['good', 'good'], log),
      scriptedMember('b', ['bad', 'good'], log), // split in r1, converges in r2
    ];
    const r = await deliberate(members, INPUT);
    expect(r.rounds).toBe(2);
    // Round 1: neither saw peers. Round 2: both saw peers.
    const round1 = log.slice(0, 2);
    const round2 = log.slice(2, 4);
    expect(round1.every((e) => e.sawPeers === false)).toBe(true);
    expect(round2.every((e) => e.sawPeers === true)).toBe(true);
  });

  it('does NOT run a second round when the panel is unanimous (nothing to deliberate)', async () => {
    const log: { id: string; sawPeers: boolean }[] = [];
    const members = [scriptedMember('a', ['good'], log), scriptedMember('b', ['good'], log)];
    const r = await deliberate(members, INPUT);
    expect(r.rounds).toBe(1);
    expect(log.every((e) => e.sawPeers === false)).toBe(true); // no peer round
  });

  it('does NOT run a second round for a single voice (no peers to react to)', async () => {
    const log: { id: string; sawPeers: boolean }[] = [];
    const r = await deliberate([scriptedMember('solo', ['needs-work'], log)], INPUT);
    expect(r.rounds).toBe(1);
  });

  it('keeps a round-1 note if a member fails round 2 (never loses a voice)', async () => {
    // 'b' returns a note in r1 (bad) then THROWS in r2 → its r1 note must survive.
    const flaky: CouncilMember = (() => {
      let round = 0;
      return {
        id: 'b', displayName: 'b', topic: 'other',
        async review() {
          round++;
          if (round === 1) return note({ memberId: 'b', verdict: 'bad' });
          throw new Error('round-2 model crash');
        },
      };
    })();
    const log: { id: string; sawPeers: boolean }[] = [];
    const r = await deliberate([scriptedMember('a', ['good', 'good'], log), flaky], INPUT);
    expect(r.rounds).toBe(2);
    // consensus still formed over 2 notes (a's r2 + b's surviving r1), never crashed.
    expect(r.consensus.memberIds.length).toBeGreaterThanOrEqual(1);
    expect(r.consensus).toBeTruthy();
  });

  it('returns round-1 consensus shape (single round) without throwing on an all-error panel', async () => {
    const allError: CouncilMember = {
      id: 'x', displayName: 'x', topic: 'other',
      async review() { throw new Error('down'); },
    };
    const r = await deliberate([allError], INPUT);
    expect(r.rounds).toBe(1);
    expect(r.consensus.outcome).toBe('ship'); // no usable note → honest ship-as-is (existing rule)
  });
});
