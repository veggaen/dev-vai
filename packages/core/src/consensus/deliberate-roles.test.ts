import { describe, expect, it } from 'vitest';
import { deliberateWithRoles, type RoleMemberFactory } from './deliberate-roles.js';
import { LOCAL_COUNCIL_ROLES } from './council-lenses.js';
import type { CouncilInput, CouncilMember, CouncilMemberNote, CouncilVerdict } from './types.js';
import type { DiscoveredOllamaModel } from '../models/ollama-discovery.js';
import type { CouncilLens } from './member.js';

// ── Lightweight mocks: no Ollama, no GPU. Everything runs in-memory. ──

const INPUT: CouncilInput = {
  prompt: 'is this draft good?', draft: 'a draft', modelId: 'vai:v0',
  turnKind: 'chat', hasEvidence: false, sources: [],
};

function note(memberId: string, verdict: CouncilVerdict): CouncilMemberNote {
  return {
    memberId, memberName: memberId, topic: 'other', verdict, confidence: 0.8,
    realIntent: '', hiddenMeaning: '', missingCapability: '', suggestedAction: 'answer-directly',
    searchQuery: '', methodLesson: '', concerns: [], durationMs: 1,
  };
}

function model(name: string, sizeBytes: number): DiscoveredOllamaModel {
  return { name, sizeBytes } as DiscoveredOllamaModel;
}

/**
 * A factory that seats every assigned role on a scripted member. Records the ORDER members were
 * built/run and whether each saw peers (round-2 signal). Verdicts per role drive split/converge.
 */
// `readonly` on both the map and the per-role list so callers can pass `['good'] as const`
// tuples (or Object.fromEntries of them) without a cast — the factory only reads them.
type VerdictScript = Readonly<Record<string, readonly CouncilVerdict[]>>;

function trackingFactory(
  verdictsByRole: VerdictScript,
  runLog: { role: string; sawPeers: boolean }[],
): RoleMemberFactory {
  return (assignment) => {
    if (!assignment.modelName) return null; // unseated role
    const roleId = assignment.role.id;
    let round = 0;
    const member: CouncilMember = {
      id: roleId, displayName: `${roleId}@${assignment.modelName}`, topic: 'other',
      async review(input: CouncilInput): Promise<CouncilMemberNote> {
        runLog.push({ role: roleId, sawPeers: Boolean(input.peerNotes?.length) });
        const vs = verdictsByRole[roleId] ?? ['good'];
        const v = vs[Math.min(round, vs.length - 1)];
        round++;
        return note(roleId, v);
      },
    };
    return member;
  };
}

describe('deliberateWithRoles — roles actively participate in a deliberation sequence', () => {
  it('assigns models to roles and seats a member per role (capability-probe audit trail)', async () => {
    const runLog: { role: string; sawPeers: boolean }[] = [];
    const models = [model('qwen3:8b', 8e9), model('qwen2.5:7b', 7e9)];
    const allGood = Object.fromEntries(LOCAL_COUNCIL_ROLES.map((r) => [r.id, ['good']] as const));

    const res = await deliberateWithRoles(LOCAL_COUNCIL_ROLES, models, INPUT, trackingFactory(allGood, runLog));

    // every role got an auditable assignment with a reason
    expect(res.assignments).toHaveLength(LOCAL_COUNCIL_ROLES.length);
    for (const a of res.assignments) {
      expect(a.modelName).toBeTruthy();
      expect(a.reason.length).toBeGreaterThan(0);
    }
    // all roles seated → all participated at least once (round 1)
    expect(res.seatedRoles.length).toBe(LOCAL_COUNCIL_ROLES.length);
    expect(new Set(runLog.map((r) => r.role)).size).toBe(LOCAL_COUNCIL_ROLES.length);
  });

  it('orders the deliberation sequence by Thorsen tier (senior first → distinguished last)', async () => {
    const runLog: { role: string; sawPeers: boolean }[] = [];
    const allGood = Object.fromEntries(LOCAL_COUNCIL_ROLES.map((r) => [r.id, ['good']] as const));
    const res = await deliberateWithRoles(LOCAL_COUNCIL_ROLES, [model('m', 7e9)], INPUT, trackingFactory(allGood, runLog));

    // seatedRoles is tier-ordered; verify it matches a tier-sorted view of the roles.
    const rank = { senior: 0, staff: 1, principal: 2, distinguished: 3 } as const;
    const expected = [...LOCAL_COUNCIL_ROLES]
      .sort((a, b) => rank[a.tier ?? 'senior'] - rank[b.tier ?? 'senior'])
      .map((r) => r.id);
    expect(res.seatedRoles).toEqual(expected);
    // round-1 run order follows the same sequence
    const round1Order = runLog.filter((r) => !r.sawPeers).map((r) => r.role);
    expect(round1Order).toEqual(expected);
  });

  it('runs a think round THEN a critique round when roles disagree (peer-aware)', async () => {
    const runLog: { role: string; sawPeers: boolean }[] = [];
    // Make the panel split in round 1 so deliberation triggers round 2.
    const verdicts: Record<string, CouncilVerdict[]> = {};
    LOCAL_COUNCIL_ROLES.forEach((r, i) => { verdicts[r.id] = i === 0 ? ['bad', 'good'] : ['good', 'good']; });

    const res = await deliberateWithRoles(LOCAL_COUNCIL_ROLES, [model('m', 7e9)], INPUT, trackingFactory(verdicts, runLog));

    expect(res.rounds).toBe(2);
    // round 2 happened and members SAW peers there
    expect(runLog.some((r) => r.sawPeers)).toBe(true);
    expect(res.round1Notes.length).toBe(LOCAL_COUNCIL_ROLES.length);
  });

  it('stays at ONE round when roles already agree (no pointless critique)', async () => {
    const runLog: { role: string; sawPeers: boolean }[] = [];
    const allGood = Object.fromEntries(LOCAL_COUNCIL_ROLES.map((r) => [r.id, ['good']] as const));
    const res = await deliberateWithRoles(LOCAL_COUNCIL_ROLES, [model('m', 7e9)], INPUT, trackingFactory(allGood, runLog));

    expect(res.rounds).toBe(1);
    expect(runLog.every((r) => !r.sawPeers)).toBe(true); // nobody saw peers — no round 2
  });

  it('degrades gracefully with NO models — no member seated, no throw', async () => {
    const runLog: { role: string; sawPeers: boolean }[] = [];
    const res = await deliberateWithRoles(LOCAL_COUNCIL_ROLES, [], INPUT, trackingFactory({}, runLog));
    expect(res.seatedRoles).toHaveLength(0);
    expect(res.assignments.every((a) => a.modelName === null)).toBe(true);
    expect(runLog).toHaveLength(0);
  });

  it('skips roles the factory cannot seat (partial availability)', async () => {
    const runLog: { role: string; sawPeers: boolean }[] = [];
    const allGood = Object.fromEntries(LOCAL_COUNCIL_ROLES.map((r) => [r.id, ['good']] as const));
    // Factory refuses to seat the senior role (simulating an unavailable model for that chair).
    const baseFactory = trackingFactory(allGood, runLog);
    const partial: RoleMemberFactory = (a) => (a.role.tier === 'senior' ? null : baseFactory(a));

    const res = await deliberateWithRoles(LOCAL_COUNCIL_ROLES, [model('m', 7e9)], INPUT, partial);
    expect(res.seatedRoles).not.toContain(LOCAL_COUNCIL_ROLES.find((r) => r.tier === 'senior')?.id);
    expect(res.seatedRoles.length).toBe(LOCAL_COUNCIL_ROLES.length - 1);
  });
});
