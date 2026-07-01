import { describe, it, expect } from 'vitest';
import { tryBusinessOpportunityDirection } from './business-opportunity-direction.js';

/**
 * The shared business-opportunity emitter (Slice 4 divergence fix). These pin
 * the answer shape so any future edit is a deliberate, reviewed change — and so
 * the ChatService registry handler (Slice 1) and VaiEngine's cascade, both of
 * which now call THIS function, stay byte-identical by construction.
 */

describe('tryBusinessOpportunityDirection — shared emitter', () => {
  it('returns null when the prompt is not a business-idea ask', () => {
    expect(tryBusinessOpportunityDirection('what is the capital of Japan?')).toBeNull();
    expect(tryBusinessOpportunityDirection('fix this bug for me')).toBeNull();
  });

  it('answers a generic business-idea ask with the candidate + validation shape', () => {
    const out = tryBusinessOpportunityDirection('what is a good software business idea to start?');
    expect(out).not.toBeNull();
    expect(out).toContain('**Candidate idea:**');
    expect(out).toContain('The wedge is not');
    expect(out).toContain('**Validation path:**');
  });

  it('specializes on Norway', () => {
    const out = tryBusinessOpportunityDirection('a good software business idea for Norway?');
    expect(out).toContain('Norwegian operations copilot');
  });

  it('adds the distinctness checklist when uniqueness is asked', () => {
    const out = tryBusinessOpportunityDirection('a unique, defensible software business idea?');
    expect(out).toContain('**How to tell if it is actually distinct:**');
    expect(out).toContain('Specific buyer');
  });

  it('is deterministic (same input → identical output)', () => {
    const p = 'a good software business idea for Norway that is unique?';
    expect(tryBusinessOpportunityDirection(p)).toBe(tryBusinessOpportunityDirection(p));
  });
});
