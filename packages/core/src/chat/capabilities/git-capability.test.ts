import { describe, it, expect } from 'vitest';
import { gitCapability, classifyGitQuery } from './git-capability.js';
import type { TurnContext } from '../turn-pipeline.js';
import type { GitEvidence } from '../../tools/git-evidence.js';

/** Minimal TurnContext for capability tests — only the fields the capability reads. */
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

/** A populated, ok git evidence object. */
function evidence(partial: Partial<GitEvidence> = {}): GitEvidence {
  return {
    ok: true,
    workspaceRoot: '/repo',
    changedFiles: [
      { id: 'git:file:src/foo.ts', path: 'src/foo.ts', status: 'modified', additions: 12, deletions: 3, staged: false },
    ],
    hunks: [{ id: 'git:hunk:src/foo.ts:42', path: 'src/foo.ts', newStart: 42, newLines: 3, header: '@@ -41,0 +42,3 @@' }],
    blame: [{ id: 'git:blame:src/foo.ts:42', path: 'src/foo.ts', line: 42, sha: 'a1b2c3d4e5f6', author: 'Alice', authoredAt: null, content: 'const x = 1;' }],
    log: [{ id: 'git:commit:abc1234', sha: 'abc1234', author: 'Alice', authoredAt: null, subject: 'feat: thing' }],
    branch: { id: 'git:branch:main', current: 'main', ahead: 2, behind: 0, upstream: 'origin/main' },
    gatheredAt: '2026-06-14T00:00:00Z',
    durationMs: 30,
    ...partial,
  };
}

describe('classifyGitQuery', () => {
  it('detects each git facet from natural phrasing', () => {
    expect(classifyGitQuery('what changed in my repo?')).toMatchObject({ wantsDiff: true });
    expect(classifyGitQuery('who wrote this line?')).toMatchObject({ wantsBlame: true });
    expect(classifyGitQuery('show me recent commits')).toMatchObject({ wantsLog: true });
    expect(classifyGitQuery('how far ahead is my branch?')).toMatchObject({ wantsBranch: true });
  });

  it('returns any:false for non-git turns', () => {
    expect(classifyGitQuery('what is the capital of France?').any).toBe(false);
    expect(classifyGitQuery('write me a poem').any).toBe(false);
  });
});

describe('gitCapability.estimate', () => {
  it('is inapplicable (null) for non-git turns', () => {
    expect(gitCapability.estimate(ctx('tell me a joke'))).toBeNull();
  });

  it('scores higher when matching evidence is attached than when none is', () => {
    const withEv = gitCapability.estimate(ctx('what changed in my repo?', evidence()));
    const without = gitCapability.estimate(ctx('what changed in my repo?'));
    expect(withEv).not.toBeNull();
    expect(without).not.toBeNull();
    expect(withEv!.evidence).toBeGreaterThan(without!.evidence);
    expect(withEv!.intentFit).toBeGreaterThan(0.8);
    expect(withEv!.risk).toBeLessThan(0.1); // read-only
  });
});

describe('gitCapability.resolve', () => {
  it('composes a grounded answer from attached diff/log/branch evidence', () => {
    const r = gitCapability.resolve(ctx('what changed in my repo?', evidence()));
    expect(r).not.toBeNull();
    expect(r!.text).toContain('Git evidence');
    expect(r!.text).toContain('`src/foo.ts`');
    expect(r!.text).toMatch(/\+12\/-3/);
    expect(r!.confidence).toBeGreaterThan(0.9);
  });

  it('includes blame attribution only when blame was asked', () => {
    const r = gitCapability.resolve(ctx('who wrote line 42 of foo?', evidence()));
    expect(r!.text).toContain('Blame');
    expect(r!.text).toContain('`a1b2c3d4e5f6`');
    expect(r!.text).toContain('Alice');
  });

  it('honestly declines (no fabrication) when no evidence is attached', () => {
    const r = gitCapability.resolve(ctx('what changed in my repo?'));
    expect(r).not.toBeNull();
    expect(r!.text).toContain('no git evidence was gathered');
  });

  it('surfaces the gather error in the honest decline', () => {
    const failed: GitEvidence = { ...evidence(), ok: false, error: 'not a git repository', changedFiles: [], hunks: [], blame: [], log: [], branch: null };
    const r = gitCapability.resolve(ctx('what changed?', failed));
    expect(r!.text).toContain('not a git repository');
  });
});

describe('gitCapability.verify — evidence-binding discipline', () => {
  it('passes a grounded answer and reports the bound ids', () => {
    const c = ctx('what changed in my repo?', evidence());
    const r = gitCapability.resolve(c)!;
    const v = gitCapability.verify(r, c);
    expect(v.ok).toBe(true);
    expect(v.boundEvidence && v.boundEvidence.length).toBeGreaterThan(0);
  });

  it('REFUSES an answer citing a SHA not present in the evidence (the core guard)', () => {
    const c = ctx('show me recent commits', evidence());
    const grounded = gitCapability.resolve(c)!;
    // Tamper: inject a fabricated commit SHA into an otherwise-grounded answer.
    const tampered = { ...grounded, text: grounded.text + '\n  - `deadbeef1` fabricated commit — Nobody' };
    const v = gitCapability.verify(tampered, c);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/deadbeef1/);
  });

  it('REFUSES a git-authoritative answer when no evidence is attached', () => {
    const c = ctx('what changed?');
    const fakeGrounded = { text: '**Git evidence (captured now, 1ms):**\n- `src/x.ts` modified', confidence: 0.9 } as never;
    const v = gitCapability.verify(fakeGrounded, c);
    expect(v.ok).toBe(false);
  });

  it('always releases the honest no-evidence decline', () => {
    const c = ctx('what changed?');
    const r = gitCapability.resolve(c)!;
    const v = gitCapability.verify(r, c);
    expect(v.ok).toBe(true);
  });

  it('refuses a non-grounded text that claims git authority without the evidence header', () => {
    const c = ctx('what changed?', evidence());
    const v = gitCapability.verify({ text: 'Your repo changed a lot, trust me.', confidence: 0.9 } as never, c);
    expect(v.ok).toBe(false);
  });
});
