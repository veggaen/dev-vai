import { describe, it, expect } from 'vitest';
import { gitCapability, classifyGitQuery } from './git-capability.js';
import { gitEvidenceToItems } from '../../synthesis/git-adapter.js';
import { synthesizeFromEvidence } from '../../synthesis/synthesize.js';
import type { TurnContext } from '../turn-pipeline.js';
import type { GitEvidence } from '../../tools/git-evidence.js';

/**
 * WORMHOLE-RATE BENCH — the measurable benchmark the project demands before
 * claiming anything works. It quantifies the whole point of this slice: how many
 * common power-user git turns Vai now answers DETERMINISTICALLY (no model call),
 * grounded in real evidence, fast enough to count as "wormhole" resolution
 * (<100ms once the read-only evidence is in hand), and passing the verify gate.
 *
 * Run: npx vitest run packages/core/src/chat/capabilities/git-capability.bench.test.ts
 *
 * It uses a fixed, realistic GitEvidence so the measurement is reproducible and
 * has no dependency on the machine's actual repo state — what we're measuring is
 * the capability's resolution behavior, not git's speed.
 */

const EVIDENCE: GitEvidence = {
  ok: true,
  workspaceRoot: '/repo',
  changedFiles: [
    { id: 'git:file:src/foo.ts', path: 'src/foo.ts', status: 'modified', additions: 12, deletions: 3, staged: false },
    { id: 'git:file:src/added.ts', path: 'src/added.ts', status: 'added', additions: 40, deletions: 0, staged: true },
  ],
  hunks: [{ id: 'git:hunk:src/foo.ts:42', path: 'src/foo.ts', newStart: 42, newLines: 3, header: '@@ -41,0 +42,3 @@' }],
  blame: [
    { id: 'git:blame:src/foo.ts:1', path: 'src/foo.ts', line: 1, sha: 'a1b2c3d4e5f6', author: 'Alice', authoredAt: null, content: 'export const x = 1;' },
  ],
  log: [
    { id: 'git:commit:abc1234', sha: 'abc1234', author: 'Alice', authoredAt: null, subject: 'feat: add thing' },
    { id: 'git:commit:def5678', sha: 'def5678', author: 'Bob', authoredAt: null, subject: 'fix: a bug' },
  ],
  branch: { id: 'git:branch:main', current: 'main', ahead: 2, behind: 0, upstream: 'origin/main' },
  gatheredAt: '2026-06-14T00:00:00Z',
  durationMs: 28,
};

/** Representative power-user git turns. */
const TURNS = [
  'what changed in my repo?',
  "what's different right now?",
  'show me my uncommitted changes',
  'which files are staged?',
  'who wrote line 1 of src/foo.ts?',
  'blame src/foo.ts',
  'show me recent commits',
  'what have I committed lately?',
  'what is the commit history?',
  'which branch am I on?',
  'how far ahead is my branch?',
  'git status',
];

function ctx(text: string, git?: GitEvidence): TurnContext {
  return {
    content: text,
    understood: text,
    history: [],
    classification: {
      kind: 'standalone-question',
      confidence: 1,
      signals: [],
      referencesPriorTurn: false,
      isShortAnaphoric: false,
      wordCount: text.split(/\s+/).length,
    },
    intent: 'action-yesno',
    guidance: [],
    evidence: git ? { git } : undefined,
  };
}

describe('wormhole-rate bench — deterministic git resolution', () => {
  it('reports the no-model resolution rate over realistic git turns', () => {
    let matched = 0;
    let resolvedNoModel = 0;
    let verified = 0;
    let totalResolveMs = 0;
    let maxResolveMs = 0;

    for (const turn of TURNS) {
      if (!classifyGitQuery(turn).any) continue;
      matched += 1;
      const c = ctx(turn, EVIDENCE);
      const t0 = performance.now();
      const r = gitCapability.resolve(c); // NO model call — pure composition
      const dt = performance.now() - t0;
      totalResolveMs += dt;
      maxResolveMs = Math.max(maxResolveMs, dt);
      if (!r) continue;
      resolvedNoModel += 1;
      if (gitCapability.verify(r, c).ok) verified += 1;
    }

    const matchRate = matched / TURNS.length;
    const resolveRate = resolvedNoModel / TURNS.length;
    const verifyRate = verified / TURNS.length;
    const avgResolveMs = totalResolveMs / Math.max(1, matched);

    // Surface the numbers (the "measurable benchmark before claiming it works").
    // eslint-disable-next-line no-console
    console.log(
      `\n  [wormhole-rate bench]\n` +
      `    turns:                 ${TURNS.length}\n` +
      `    matched (git-shaped):  ${matched} (${(matchRate * 100).toFixed(0)}%)\n` +
      `    resolved w/o model:    ${resolvedNoModel} (${(resolveRate * 100).toFixed(0)}%)\n` +
      `    verified (bound):      ${verified} (${(verifyRate * 100).toFixed(0)}%)\n` +
      `    avg resolve time:      ${avgResolveMs.toFixed(3)}ms (max ${maxResolveMs.toFixed(3)}ms)\n` +
      `    evidence gather cost:  ${EVIDENCE.durationMs}ms (read-only git, one-time)\n`,
    );

    // Assertions — the bench is also a regression guard on the headline claim.
    expect(matchRate).toBeGreaterThanOrEqual(0.9);   // ≥90% of these turns are recognized
    expect(resolveRate).toBeGreaterThanOrEqual(0.9); // ≥90% answered with no model call
    expect(verifyRate).toBe(resolveRate);            // every deterministic answer is evidence-bound
    expect(maxResolveMs).toBeLessThan(100);          // resolution itself is wormhole-fast
  });

  it('the same evidence also powers no-model synthesis (claims are 100% source-bound)', () => {
    const items = gitEvidenceToItems(EVIDENCE);
    const res = synthesizeFromEvidence(items, 'what do I know about my repo', { filterByQuery: false });
    expect(res.claims.length).toBeGreaterThan(0);
    const boundFraction = res.claims.filter((c) => c.sources.length >= 1).length / res.claims.length;
    expect(boundFraction).toBe(1); // no unbound claim can appear by construction
    expect(res.droppedUnbound).toBe(0);
  });
});
