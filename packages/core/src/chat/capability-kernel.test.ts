import { describe, it, expect, vi } from 'vitest';
import {
  asTurnHandler,
  scoreFromBreakdown,
  describeBreakdown,
  shadowScore,
  DEFAULT_SCORE_WEIGHTS,
  type Capability,
  type ScoreBreakdown,
  type VerificationResult,
} from './capability-kernel.js';
import { dispatchTurn, type Resolution, type TurnContext } from './turn-pipeline.js';
import type { TurnClassification } from './turn-classifier.js';
import { liveContextCapability } from './capabilities/live-context-capability.js';

// ── test helpers ──────────────────────────────────────────────────────────

function ctx(partial: Partial<TurnContext> & { understood: string }): TurnContext {
  const classification: TurnClassification = {
    kind: 'standalone-question',
    confidence: 0.8,
    signals: [],
    referencesPriorTurn: false,
    isShortAnaphoric: false,
    wordCount: partial.understood.split(/\s+/).length,
  };
  return {
    content: partial.content ?? partial.understood,
    understood: partial.understood,
    history: partial.history ?? [],
    classification: partial.classification ?? classification,
    intent: partial.intent ?? 'definition',
    guidance: partial.guidance ?? [],
  };
}

/** Build a Capability from parts, defaulting the boring bits. */
function capability(
  name: string,
  estimate: ScoreBreakdown | null,
  resolve: Resolution | null,
  verify: VerificationResult,
): Capability {
  return {
    name,
    score: () => null, // unused — asTurnHandler derives score from estimate
    estimate: () => estimate,
    resolve: () => resolve,
    verify: () => verify,
  };
}

const FULL_FIT: ScoreBreakdown = {
  intentFit: 1, evidence: 1, history: 1, latency: 0, cost: 0, risk: 0,
};

// ── scoreFromBreakdown: the inspectable score math ──────────────────────────

describe('scoreFromBreakdown', () => {
  it('folds positives up and penalties down, clamped to 0..1', () => {
    expect(scoreFromBreakdown(FULL_FIT)).toBeCloseTo(
      DEFAULT_SCORE_WEIGHTS.intentFit + DEFAULT_SCORE_WEIGHTS.evidence + DEFAULT_SCORE_WEIGHTS.history,
      5,
    );
  });

  it('penalizes latency, cost, and risk', () => {
    const risky: ScoreBreakdown = { ...FULL_FIT, risk: 1, latency: 1, cost: 1 };
    expect(scoreFromBreakdown(risky)).toBeLessThan(scoreFromBreakdown(FULL_FIT));
  });

  it('never returns a negative score even when penalties dominate', () => {
    const allPenalty: ScoreBreakdown = {
      intentFit: 0, evidence: 0, history: 0, latency: 1, cost: 1, risk: 1,
    };
    expect(scoreFromBreakdown(allPenalty)).toBe(0);
  });

  it('ranks high-evidence over a guess at equal intent fit', () => {
    const grounded: ScoreBreakdown = { intentFit: 0.8, evidence: 0.9, history: 0.5, latency: 0.1, cost: 0.1, risk: 0.1 };
    const guess: ScoreBreakdown = { intentFit: 0.8, evidence: 0.1, history: 0.5, latency: 0.1, cost: 0.1, risk: 0.5 };
    expect(scoreFromBreakdown(grounded)).toBeGreaterThan(scoreFromBreakdown(guess));
  });
});

// ── describeBreakdown: the human-readable "why this score" line ──────────────

describe('describeBreakdown', () => {
  it('always shows intent and evidence', () => {
    const line = describeBreakdown({ intentFit: 0.95, evidence: 0.4, history: 0.5, latency: 0, cost: 0, risk: 0 });
    expect(line).toContain('intent 0.95');
    expect(line).toContain('evidence 0.40');
  });

  it('shows penalties only when present, as negative terms', () => {
    const line = describeBreakdown({ intentFit: 0.9, evidence: 0.5, history: 0.5, latency: 0.1, cost: 0, risk: 0.2 });
    expect(line).toContain('−risk 0.20');
    expect(line).toContain('−latency 0.10');
    expect(line).not.toContain('cost'); // cost is 0 → omitted
  });

  it('omits neutral history (0.5) to reduce noise', () => {
    expect(describeBreakdown({ intentFit: 0.9, evidence: 0.5, history: 0.5, latency: 0, cost: 0, risk: 0 }))
      .not.toContain('history');
  });
});

// ── shadowScore: observe a capability without it deciding ────────────────────

describe('shadowScore', () => {
  it('returns null when the capability is inapplicable', () => {
    const cap = capability('na', null, { text: 'x', confidence: 0.9 }, { ok: true });
    expect(shadowScore(cap, ctx({ understood: 'q' }))).toBeNull();
  });

  it('reports score, would-resolve, and would-verify for an applicable capability', () => {
    const cap = capability('s', FULL_FIT, { text: 'answer', confidence: 0.9 }, { ok: true, reason: 'grounded' });
    const s = shadowScore(cap, ctx({ understood: 'q' }))!;
    expect(s.name).toBe('s');
    expect(s.score).toBeGreaterThan(0);
    expect(s.wouldResolve).toBe(true);
    expect(s.wouldVerify).toBe(true);
    expect(s.verifyReason).toBe('grounded');
  });

  it('reports wouldVerify=false when the capability would fail its own gate', () => {
    const cap = capability('s', FULL_FIT, { text: 'unbound claim', confidence: 0.9 }, { ok: false, reason: 'no evidence' });
    const s = shadowScore(cap, ctx({ understood: 'q' }))!;
    expect(s.wouldResolve).toBe(true);
    expect(s.wouldVerify).toBe(false);
    expect(s.verifyReason).toBe('no evidence');
  });

  it('never throws — a throwing resolve becomes a non-resolving shadow', () => {
    const cap: Capability = {
      name: 'throws',
      score: () => null,
      estimate: () => FULL_FIT,
      resolve: () => { throw new Error('boom'); },
      verify: () => ({ ok: true }),
    };
    const s = shadowScore(cap, ctx({ understood: 'q' }))!;
    expect(s.wouldResolve).toBe(false);
    expect(s.wouldVerify).toBe(false);
  });
});

// ── asTurnHandler: verify() gates release ───────────────────────────────────

describe('asTurnHandler', () => {
  it('derives score from estimate and resolves a verified answer', () => {
    const cap = capability(
      'ok-cap',
      { ...FULL_FIT, reason: 'fits' },
      { text: 'grounded answer', confidence: 0.9 },
      { ok: true },
    );
    const handler = asTurnHandler(cap);
    const c = ctx({ understood: 'anything' });

    const score = handler.score(c);
    // The reason carries the capability's rationale AND the inspectable
    // component breakdown, so the panel shows WHY the score is what it is.
    expect(score).toMatchObject({ score: expect.any(Number) });
    expect((score as { reason: string }).reason).toContain('fits');
    expect((score as { reason: string }).reason).toMatch(/intent 1\.00 · evidence 1\.00/);
    expect(handler.resolve(c)).toMatchObject({ text: 'grounded answer' });
  });

  it('DECLINES (returns null) when verification fails — the evidence-binding gate', () => {
    const onVerifyFail = vi.fn();
    const cap = capability(
      'unverified-claim',
      FULL_FIT,
      { text: 'Jens Stoltenberg is the current PM of Norway.', confidence: 0.95 },
      { ok: false, reason: 'claim contradicts curated fact / no evidence binding' },
    );
    const handler = asTurnHandler(cap, { onVerifyFail });

    expect(handler.resolve(ctx({ understood: 'who is the PM of Norway' }))).toBeNull();
    expect(onVerifyFail).toHaveBeenCalledOnce();
    expect(onVerifyFail.mock.calls[0][1]).toMatchObject({ ok: false });
  });

  it('treats a throwing verifier as a failed verification, not a crash', () => {
    const cap: Capability = {
      name: 'throws-in-verify',
      score: () => null,
      estimate: () => FULL_FIT,
      resolve: () => ({ text: 'x', confidence: 0.9 }),
      verify: () => { throw new Error('boom'); },
    };
    expect(asTurnHandler(cap).resolve(ctx({ understood: 'q' }))).toBeNull();
  });

  it('skips entirely (score null) when estimate is inapplicable', () => {
    const cap = capability('na', null, { text: 'x', confidence: 0.9 }, { ok: true });
    expect(asTurnHandler(cap).score(ctx({ understood: 'q' }))).toBeNull();
  });

  it('drops into dispatchTurn and a verify-failure falls through to the next capability', () => {
    const unverified = asTurnHandler(capability(
      'high-but-unverified',
      { ...FULL_FIT, reason: 'high fit' },
      { text: 'unbound claim', confidence: 0.99 },
      { ok: false, reason: 'no evidence' },
    ));
    const grounded = asTurnHandler(capability(
      'lower-but-verified',
      { intentFit: 0.7, evidence: 0.6, history: 0.5, latency: 0.1, cost: 0.1, risk: 0.1 },
      { text: 'verified answer', confidence: 0.8 },
      { ok: true },
    ));

    const outcome = dispatchTurn(ctx({ understood: 'a question' }), [unverified, grounded]);
    expect(outcome.resolution?.text).toBe('verified answer');
    expect(outcome.plan.chosen).toBe('lower-but-verified');
    // The higher-scoring capability was tried first, then declined on verify.
    expect(outcome.plan.declined).toContain('high-but-unverified');
  });
});

// ── Capability #1: live-context, real verify discipline ─────────────────────

describe('liveContextCapability', () => {
  it('estimates a high-intent, high-risk breakdown for a workspace-delta question', () => {
    const b = liveContextCapability.estimate(ctx({ understood: 'which files changed in my repo right now?' }));
    expect(b).not.toBeNull();
    expect(b!.intentFit).toBeGreaterThan(0.8);
    expect(b!.risk).toBeGreaterThan(0); // answering live state from memory is risky
  });

  it('is inapplicable to an ordinary knowledge question', () => {
    expect(liveContextCapability.estimate(ctx({ understood: 'what is a closure in javascript' }))).toBeNull();
  });

  it('resolves an HONEST unavailable response when no evidence is attached, and verify passes it', () => {
    const c = ctx({ understood: 'which files changed in my repo right now?' });
    const r = liveContextCapability.resolve(c);
    expect(r).not.toBeNull();
    expect(r!.text.toLowerCase()).toContain('unavailable');
    expect(liveContextCapability.verify(r!, c).ok).toBe(true);
  });

  it('verify REJECTS a confident live-state claim with no evidence binding', () => {
    const c = ctx({ understood: 'which files changed in my repo right now?' });
    const fabricated: Resolution = {
      text: 'You changed src/app.ts and README.md just now.',
      confidence: 0.95,
    };
    const v = liveContextCapability.verify(fabricated, c);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/no evidence binding/i);
  });

  it('verify ACCEPTS a claim that carries an evidence line', () => {
    const c = ctx({ understood: 'what file do i have open right now?' });
    const grounded: Resolution = {
      text: '**Live editor file.**\n\n`src/app.ts`\n\n**Evidence:** `vscode-capture-adapter`, captured `2026-06-13T10:00:00Z`.',
      confidence: 0.99,
    };
    const v = liveContextCapability.verify(grounded, c);
    expect(v.ok).toBe(true);
    expect(v.boundEvidence).toContain('vscode-capture-adapter');
  });

  it('works end-to-end through dispatchTurn as a verified capability', () => {
    const handler = asTurnHandler(liveContextCapability);
    const outcome = dispatchTurn(ctx({ understood: 'which files changed in my repo right now?' }), [handler]);
    // The honest "unavailable" answer passes verify and is released.
    expect(outcome.resolution?.text.toLowerCase()).toContain('unavailable');
    expect(outcome.plan.chosen).toBe('live-context');
  });
});
