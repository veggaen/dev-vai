import { describe, it, expect } from 'vitest';
import { diagnoseCapabilityGap, describeCapabilityGap } from './capability-gap.js';
import type { DispatchOutcome, DispatchPlan } from './turn-pipeline.js';

// Minimal plan builder — only the fields diagnoseCapabilityGap reads.
function plan(over: Partial<DispatchPlan> = {}): DispatchPlan {
  return {
    understood: 'u',
    intent: 'factual' as DispatchPlan['intent'],
    turnClass: 'question' as DispatchPlan['turnClass'],
    candidates: [],
    chosen: null,
    confidence: 0,
    belowFloor: true,
    declined: [],
    ...over,
  };
}
const miss = (p: Partial<DispatchPlan>): DispatchOutcome => ({ resolution: null, plan: plan(p) });

describe('diagnoseCapabilityGap', () => {
  it('returns null when the turn was actually resolved (no gap)', () => {
    const outcome = { resolution: { confidence: 0.9 }, plan: plan({ chosen: 'x' }) } as unknown as DispatchOutcome;
    expect(diagnoseCapabilityGap(outcome)).toBeNull();
  });

  it('no-candidates: nothing applied → escalate, honest message', () => {
    const gap = diagnoseCapabilityGap(miss({ candidates: [], belowFloor: true }));
    expect(gap?.kind).toBe('no-candidates');
    expect(gap?.shouldEscalate).toBe(true);
    expect(gap?.topScore).toBe(0);
    expect(gap?.message).toMatch(/don't have a capability/i);
  });

  it('below-floor: weak matches only → escalate, names the closest', () => {
    const gap = diagnoseCapabilityGap(miss({
      candidates: [
        { name: 'facts', baseScore: 0.3, score: 0.3, guidanceApplied: undefined, reason: 'thin' },
        { name: 'compare', baseScore: 0.2, score: 0.2, guidanceApplied: undefined },
      ],
      belowFloor: true,
      declined: [],
    }));
    expect(gap?.kind).toBe('below-floor');
    expect(gap?.shouldEscalate).toBe(true);
    expect(gap?.nearest[0].name).toBe('facts');
    expect(gap?.message).toContain('facts');
  });

  it('declined: a capability cleared the floor but could not ground → NOT escalated', () => {
    const gap = diagnoseCapabilityGap(miss({
      candidates: [{ name: 'page', baseScore: 0.8, score: 0.8, guidanceApplied: undefined }],
      belowFloor: false,
      declined: ['page'],
    }));
    expect(gap?.kind).toBe('declined');
    expect(gap?.shouldEscalate).toBe(false); // has the route, lacked evidence — retry, don't escalate
    expect(gap?.declined).toContain('page');
    expect(gap?.message).toMatch(/couldn't ground/i);
  });

  it('caps nearest at 3 even with many candidates', () => {
    const candidates = Array.from({ length: 6 }, (_, i) => ({
      name: `c${i}`, baseScore: 0.4 - i * 0.05, score: 0.4 - i * 0.05, guidanceApplied: undefined,
    }));
    const gap = diagnoseCapabilityGap(miss({ candidates, belowFloor: true }));
    expect(gap?.nearest).toHaveLength(3);
    expect(gap?.nearest[0].name).toBe('c0');
  });

  it('describeCapabilityGap renders a compact one-liner', () => {
    const gap = diagnoseCapabilityGap(miss({
      candidates: [{ name: 'facts', baseScore: 0.3, score: 0.3, guidanceApplied: undefined }],
      belowFloor: true,
    }));
    const line = describeCapabilityGap(gap);
    expect(line).toMatch(/capability gap: below-floor/);
    expect(line).toMatch(/nearest facts 30%/);
    expect(line).toMatch(/escalate/);
  });

  it('describeCapabilityGap is safe on null', () => {
    expect(describeCapabilityGap(null)).toBe('');
  });

  it('never throws on a malformed outcome', () => {
    expect(() => diagnoseCapabilityGap({ resolution: null, plan: undefined } as unknown as DispatchOutcome)).not.toThrow();
  });
});
