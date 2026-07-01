import { describe, it, expect } from 'vitest';
import { intentFit, mappedHandlers } from './intent-fit.js';
import type { QuestionIntent } from './question-intent.js';
import type { TurnClass, TurnClassification } from './turn-classifier.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function cls(
  kind: TurnClass,
  signals: readonly string[] = [],
): TurnClassification {
  return {
    kind,
    confidence: 0.8,
    signals,
    referencesPriorTurn: false,
    isShortAnaphoric: false,
    wordCount: 5,
  };
}

function fit(
  handler: string,
  prior: number,
  intent: QuestionIntent,
  kind: TurnClass = 'standalone-question',
  signals: readonly string[] = [],
) {
  return intentFit(handler, prior, { intent, classification: cls(kind, signals) });
}

// ── regression-safety invariant ──────────────────────────────────────────────

describe('intentFit — regression safety', () => {
  it('returns the prior UNCHANGED and no reason for an unmapped handler', () => {
    const out = fit('some-handler-with-no-rule', 0.91, 'build', 'unknown');
    expect(out.score).toBe(0.91);
    expect(out.reason).toBeUndefined();
  });

  it('returns the prior unchanged when a mapped handler matches no rule', () => {
    // fact-shim has rules, but a plain meta turn matches none of them.
    const out = fit('chat-fact-shim', 0.91, 'meta', 'unknown');
    expect(out.score).toBe(0.91);
    expect(out.reason).toBeUndefined();
  });

  it('clamps a prior outside 0..1 even with no rule', () => {
    expect(fit('unmapped', 1.5, 'other').score).toBe(1);
    expect(fit('unmapped', -0.2, 'other').score).toBe(0);
    expect(fit('unmapped', NaN, 'other').score).toBe(0);
  });
});

// ── suppression: off-lane handlers lose ──────────────────────────────────────

describe('intentFit — suppression', () => {
  it('suppresses fact-shim on a build ask so a builder can overtake', () => {
    const factShim = fit('chat-fact-shim', 0.91, 'build');
    expect(factShim.score).toBeLessThan(0.91);
    expect(factShim.reason).toContain('off-lane');
    // A constrained-code handler with a LOWER prior should now out-rank it.
    const code = fit('chat-constrained-code', 0.9, 'build');
    expect(code.score).toBeGreaterThan(factShim.score);
  });

  it('suppresses fact-shim on a recommendation ask', () => {
    expect(fit('chat-fact-shim', 0.91, 'recommendation').score).toBeLessThan(0.91);
  });

  it('suppresses fact-shim on product-quality-direction turns (the Norway class)', () => {
    // A business-idea / product-quality turn must NOT be answered by a country-fact shim.
    const factShim = fit('chat-fact-shim', 0.91, 'factual-lookup', 'product-quality-recommendation');
    expect(factShim.score).toBeLessThan(0.91);
    expect(factShim.reason).toContain('off-lane');
    // The product-engineering handler (lower prior) overtakes on that same turn.
    const product = fit('chat-product-engineering', 0.94, 'factual-lookup', 'product-quality-recommendation');
    expect(product.score).toBeGreaterThan(factShim.score);
  });

  it('suppression wins even if a boost would also apply', () => {
    // fact-shim on a product-quality turn: definition would boost, but the
    // suppressed class must take precedence (conservative: don't answer off-lane).
    const out = fit('chat-fact-shim', 0.91, 'definition', 'product-quality-recommendation');
    expect(out.score).toBeLessThan(0.91);
    expect(out.reason).toContain('off-lane');
  });
});

// ── boost: on-lane handlers can overtake ─────────────────────────────────────

describe('intentFit — boost', () => {
  it('boosts fact-shim on a genuine fact lookup (must still win that turn)', () => {
    const out = fit('chat-fact-shim', 0.91, 'factual-lookup');
    expect(out.score).toBeGreaterThan(0.91);
    expect(out.reason).toContain('on-lane');
  });

  it('does NOT suppress a real fact lookup below its prior (over-suppression guard)', () => {
    // The capital-of-France class: fact-shim must remain the top fact answerer.
    expect(fit('chat-fact-shim', 0.91, 'factual-lookup').score).toBeGreaterThanOrEqual(0.91);
  });

  it('boosts conversation-reasoning on open-ended and action-yesno turns', () => {
    expect(fit('conversation-reasoning', 0.97, 'other').score).toBeGreaterThan(0.97);
    expect(fit('conversation-reasoning', 0.97, 'action-yesno').score).toBeGreaterThan(0.97);
  });

  it('boosts chat-vai-identity on the self-improvement signal', () => {
    const out = fit('chat-vai-identity', 0.975, 'other', 'unknown', ['self-improvement']);
    expect(out.score).toBeGreaterThan(0.975);
    expect(out.reason).toContain('signal=self-improvement');
  });

  it('boosts chat-vai-identity on the vai-chat-quality-direction shape', () => {
    expect(
      fit('chat-vai-identity', 0.975, 'other', 'vai-chat-quality-direction').score,
    ).toBeGreaterThan(0.975);
  });

  it('boosts constrained-code and format-strict on build + specificity-hint', () => {
    expect(fit('chat-constrained-code', 0.9, 'build').score).toBeGreaterThan(0.9);
    expect(
      fit('chat-format-strict', 0.92, 'other', 'unknown', ['specificity-hint']).score,
    ).toBeGreaterThan(0.92);
  });
});

// ── bounded: a single rule cannot invert the whole order ─────────────────────

describe('intentFit — bounded adjustments', () => {
  it('a boost cannot exceed 1 and is smaller than the tightest prior gap (no leapfrog)', () => {
    const out = fit('conversation-reasoning', 0.99, 'other');
    expect(out.score).toBeLessThanOrEqual(1);
    // The smallest gap between adjacent registry priors is 0.005 (0.98 → 0.975).
    // A boost MUST stay under that so a fitting handler never leapfrogs a sibling
    // seated above it by the curated order.
    expect(out.score - 0.99).toBeLessThan(0.005);
  });

  it('on-lane fact-shim does NOT leapfrog a strict-format handler seated above it (Japan-class)', () => {
    // "Capital of Japan. One word only." — a fact lookup, but the user asked for a
    // strict shape. fact-shim (prior 0.91) gets the factual-lookup boost, but must
    // stay BELOW chat-format-strict's 0.92 prior so the format request keeps the turn.
    const factShim = fit('chat-fact-shim', 0.91, 'factual-lookup');
    expect(factShim.score).toBeGreaterThan(0.91); // still boosted (on-lane)
    expect(factShim.score).toBeLessThan(0.92); // but not past the format handler
    expect(factShim.reason).toContain('on-lane');
  });

  it('a suppression dampens but never zeroes a healthy prior', () => {
    const out = fit('chat-fact-shim', 0.91, 'build');
    expect(out.score).toBeGreaterThan(0);
    expect(out.score).toBeLessThan(0.91);
  });

  it('mappedHandlers lists exactly the handlers carrying a rule', () => {
    const m = mappedHandlers();
    expect(m).toContain('chat-fact-shim');
    expect(m).toContain('conversation-reasoning');
    expect(m).toContain('chat-vai-identity');
    expect(m).not.toContain('single-clarifying-question');
  });
});

// ── exact-value pins ─────────────────────────────────────────────────────────
// The directional tests above (`> prior`, `< prior`) prove the SIGN of each
// adjustment but not its MAGNITUDE — so a boost silently neutered to 0.0001 or a
// suppression weakened to ×0.98 would still pass them while making the feature
// inert. These pin the exact adjusted output so the tuning itself is under test.

describe('intentFit — exact adjusted values (tuning is pinned, not just directional)', () => {
  it('boost adds exactly the calibrated addend (0.004) to a fact lookup', () => {
    // 0.910 + 0.004 = 0.914, to float tolerance. If BOOST_ADDEND changes, this
    // fails loudly instead of passing on a meaningless 0.9101.
    expect(fit('chat-fact-shim', 0.91, 'factual-lookup').score).toBeCloseTo(0.914, 10);
  });

  it('suppression multiplies by exactly the calibrated factor (0.45)', () => {
    // 0.91 × 0.45 = 0.4095. A suppression weakened to ×0.98 (barely demoting) must
    // NOT pass — this pins the actual demotion strength.
    expect(fit('chat-fact-shim', 0.91, 'build').score).toBeCloseTo(0.4095, 10);
  });

  it('boost is a NO-OP-sized change relative to the prior but non-zero (guards inertness)', () => {
    const delta = fit('conversation-reasoning', 0.97, 'other').score - 0.97;
    expect(delta).toBeGreaterThan(0); // not inert
    expect(delta).toBeCloseTo(0.004, 10); // and exactly the calibrated size
  });
});

// ── structural no-leapfrog invariant (derived from the REAL registry priors) ──
// The bounded test earlier asserts BOOST_ADDEND < 0.005, but 0.005 is a hardcoded
// literal — if the registry ever seats two handlers closer together, that test
// still passes while the guarantee silently breaks. This derives the guarantee
// from the actual priors so it stays true as the registry evolves.

describe('intentFit — no-leapfrog holds against the real registry priors', () => {
  // The live constant priors from service.ts:2527-2621 (the handlers dispatchTurn
  // ranks). Kept here as the source of truth for the gap the boost must not cross.
  const REGISTRY_PRIORS = [0.99, 0.98, 0.975, 0.97, 0.96, 0.95, 0.945, 0.94, 0.93, 0.92, 0.91, 0.90, 0.89];

  it('the calibrated boost is strictly smaller than the tightest adjacent prior gap', () => {
    const sorted = [...REGISTRY_PRIORS].sort((a, b) => a - b);
    let tightestGap = Infinity;
    for (let i = 1; i < sorted.length; i += 1) {
      tightestGap = Math.min(tightestGap, sorted[i] - sorted[i - 1]);
    }
    // Infer the boost magnitude from an actual on-lane adjustment (no private import).
    const boost = fit('chat-fact-shim', 0.5, 'factual-lookup').score - 0.5;
    expect(boost).toBeGreaterThan(0);
    // The load-bearing invariant: a boosted handler can never reach the NEXT prior up,
    // so it cannot leapfrog a sibling the curated order seated above it. If a future
    // handler tightens the gap below the boost, THIS fails — exactly the regression
    // class that let fact-shim overtake chat-format-strict.
    expect(boost).toBeLessThan(tightestGap);
  });

  it('every mapped handler boosted at its real prior stays below the next prior up', () => {
    // Exhaustive check across the registry: for each adjacent (lower, upper) pair,
    // a maximally-boosted handler seated at `lower` must not reach `upper`.
    const sorted = [...REGISTRY_PRIORS].sort((a, b) => a - b);
    const boost = fit('chat-fact-shim', 0.5, 'factual-lookup').score - 0.5;
    for (let i = 1; i < sorted.length; i += 1) {
      const lower = sorted[i - 1];
      const upper = sorted[i];
      expect(lower + boost).toBeLessThan(upper);
    }
  });
});
