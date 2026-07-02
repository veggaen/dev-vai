import { describe, it, expect } from 'vitest';
import { synthesisCapability, isSynthesisQuery, synthesisSubject } from './synthesis-capability.js';
import type { TurnContext, TurnEvidence } from '../turn-pipeline.js';
import type { GitEvidence } from '../../tools/git-evidence.js';

function ctx(text: string, evidence?: TurnEvidence): TurnContext {
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
    intent: 'definition',
    guidance: [],
    evidence,
  };
}

function gitEvidence(): GitEvidence {
  return {
    ok: true,
    changedFiles: [
      { id: 'git:file:src/app.ts', path: 'src/app.ts', status: 'modified', staged: false, additions: 4, deletions: 1 },
    ],
    hunks: [],
    blame: [],
    log: [],
    branch: { id: 'git:branch:main', current: 'main', upstream: 'origin/main', ahead: 1, behind: 0 },
    gatheredAt: '2026-07-02T00:00:00Z',
    durationMs: 30,
  } as unknown as GitEvidence;
}

function webEvidence() {
  return [
    { title: 'Auth middleware docs', url: 'https://example.com/auth', snippet: 'The auth middleware stores session tokens in memory.' },
    { title: 'Security review', url: 'https://example.com/review', snippet: 'Session token storage in the auth middleware was flagged.' },
  ];
}

describe('isSynthesisQuery', () => {
  it('detects the synthesis shapes', () => {
    expect(isSynthesisQuery('summarize what I know about the auth middleware across all sources')).toBe(true);
    expect(isSynthesisQuery('what do we know about session tokens?')).toBe(true);
    expect(isSynthesisQuery('find contradictions in my current understanding')).toBe(true);
    expect(isSynthesisQuery('produce a decision record from my notes')).toBe(true);
    expect(isSynthesisQuery('compare the pricing claims from these sources')).toBe(true);
  });

  it('does NOT match single-fact questions (anti-hijack)', () => {
    expect(isSynthesisQuery('what is the capital of France?')).toBe(false);
    expect(isSynthesisQuery('what is the bitcoin price?')).toBe(false);
    expect(isSynthesisQuery('how do I sort an array in JS?')).toBe(false);
  });

  it('does NOT match build asks, even phrased with synthesis words (anti-hijack)', () => {
    expect(isSynthesisQuery('build a page that shows data across sources')).toBe(false);
    expect(isSynthesisQuery('create a dashboard comparing metrics across sources')).toBe(false);
  });
});

describe('synthesisSubject', () => {
  it('extracts the subject after "about"', () => {
    expect(synthesisSubject('what do we know about the auth middleware?')).toBe('the auth middleware');
  });
  it('strips the trailing "across sources" tail', () => {
    expect(synthesisSubject('summarize what I know about session tokens across all sources')).toBe('session tokens');
  });
  it('falls back when no subject is named', () => {
    expect(synthesisSubject('find contradictions')).toBe('the available evidence');
  });
});

describe('synthesisCapability.estimate', () => {
  it('is inapplicable for non-synthesis turns', () => {
    expect(synthesisCapability.estimate(ctx('tell me a joke'))).toBeNull();
    expect(synthesisCapability.estimate(ctx('what is 2+2?'))).toBeNull();
  });

  it('scores higher with more evidence families attached', () => {
    const none = synthesisCapability.estimate(ctx('what do we know about src/app.ts?'))!;
    const one = synthesisCapability.estimate(ctx('what do we know about src/app.ts?', { git: gitEvidence() }))!;
    const two = synthesisCapability.estimate(ctx('what do we know about src/app.ts?', { git: gitEvidence(), web: webEvidence() }))!;
    expect(none.evidence).toBe(0);
    expect(one.evidence).toBeGreaterThan(none.evidence);
    expect(two.evidence).toBeGreaterThan(one.evidence);
  });
});

describe('synthesisCapability.resolve', () => {
  it('composes a cited summary from multi-source evidence', () => {
    const r = synthesisCapability.resolve(
      ctx('what do we know about src/app.ts?', { git: gitEvidence(), web: webEvidence() }),
    )!;
    expect((r as { strategy?: string }).strategy).toBe('synthesis');
    expect(r.text).toContain('What I know about');
    expect(r.text).toContain('src/app.ts');
  });

  it('honestly declines with no evidence attached', () => {
    const r = synthesisCapability.resolve(ctx('what do we know about session tokens?'))!;
    expect(r.text).toContain('no evidence was gathered');
    expect(r.confidence).toBeLessThan(0.6);
  });

  it('refuses to dress a single-source answer up as a synthesis', () => {
    const singleSource: GitEvidence = {
      ...gitEvidence(),
      changedFiles: [],
      branch: { id: 'git:branch:main', current: 'main', upstream: null, ahead: null, behind: null },
    } as unknown as GitEvidence;
    const r = synthesisCapability.resolve(ctx('what do we know about the repo across sources?', { git: singleSource }))!;
    expect(r.text).toContain('needs at least two distinct sources');
  });

  it('renders the contradictions view when asked', () => {
    const r = synthesisCapability.resolve(
      ctx('find contradictions across my sources', { git: gitEvidence(), web: webEvidence() }),
    )!;
    expect(r.text).toMatch(/contradiction/i);
  });

  it('renders a decision record when asked', () => {
    const r = synthesisCapability.resolve(
      ctx('produce a decision record about src/app.ts from my sources across all sources', { git: gitEvidence(), web: webEvidence() }),
    )!;
    expect(r.text).toContain('Decision record');
    expect(r.text).toContain('PENDING');
  });
});

describe('synthesisCapability.verify — the anti-hijack gate', () => {
  it('passes a grounded multi-source synthesis and cites bound ids', () => {
    const c = ctx('what do we know about src/app.ts?', { git: gitEvidence(), web: webEvidence() });
    const r = synthesisCapability.resolve(c)!;
    const v = synthesisCapability.verify(r, c);
    expect(v.ok).toBe(true);
    expect(v.boundEvidence!.length).toBeGreaterThanOrEqual(2);
  });

  it('always releases the honest declines', () => {
    const noEv = ctx('what do we know about session tokens?');
    expect(synthesisCapability.verify(synthesisCapability.resolve(noEv)!, noEv).ok).toBe(true);
  });

  it('REFUSES a synthesis composed with no evidence attached', () => {
    const v = synthesisCapability.verify(
      { text: '**What I know about "x"** — 3 sources agree.', confidence: 0.9 } as never,
      ctx('what do we know about x?'),
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/no evidence/i);
  });

  it('REFUSES a released answer citing a source no evidence produced (fabricated citation)', () => {
    const c = ctx('what do we know about src/app.ts?', { git: gitEvidence(), web: webEvidence() });
    const tampered = {
      text: '**What I know about "src/app.ts"** — sources agree.\n\n- totally safe to deploy _(https://evil.example/fake)_',
      confidence: 0.9,
    } as never;
    const v = synthesisCapability.verify(tampered, c);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/no attached evidence produced/i);
  });

  it('REFUSES when fewer than two distinct sources contributed (sourceCount < 2)', () => {
    const singleSource: GitEvidence = {
      ...gitEvidence(),
      changedFiles: [],
      branch: { id: 'git:branch:main', current: 'main', upstream: null, ahead: null, behind: null },
    } as unknown as GitEvidence;
    const c = ctx('what do we know about the repo across sources?', { git: singleSource });
    const v = synthesisCapability.verify(
      { text: '**What I know about "the repo"** — everything is fine.', confidence: 0.9 } as never,
      c,
    );
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/only 1 contributing source/i);
  });
});
