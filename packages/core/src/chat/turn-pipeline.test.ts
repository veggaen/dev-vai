import { describe, it, expect } from 'vitest';
import {
  dispatchTurn,
  describePlan,
  type TurnHandler,
  type TurnContext,
  type TurnGuidance,
} from './turn-pipeline.js';
import type { TurnClassification } from './turn-classifier.js';

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

/** A handler that scores by whether the understood text includes any keyword,
 * with a fixed fit, and answers with a canned string (or declines). */
function keywordHandler(
  name: string,
  fit: number,
  keywords: string[],
  opts: { decline?: boolean; confidence?: number } = {},
): TurnHandler {
  return {
    name,
    score: (c) =>
      keywords.some((k) => c.understood.toLowerCase().includes(k)) ? fit : null,
    resolve: (c) =>
      opts.decline
        ? null
        : {
            text: `${name}: ${c.understood}`,
            turnKind: 'answer',
            confidence: opts.confidence ?? fit,
          },
  };
}

// ── scored routing beats greedy "first match wins" ─────────────────────────

describe('dispatchTurn — scored routing', () => {
  it('picks the highest-scoring applicable handler, not registration order', () => {
    // The bare-keyword handler is registered FIRST (greedy would let it win),
    // but the comparison handler fits better and must win on score.
    const bareDocker = keywordHandler('gaming-docker-blurb', 0.4, ['docker']);
    const comparison = keywordHandler('compare-pair', 0.9, ['vs', 'versus']);

    const out = dispatchTurn(
      ctx({ understood: 'docker vs kubernetes' }),
      [bareDocker, comparison],
    );

    expect(out.plan.chosen).toBe('compare-pair');
    expect(out.resolution?.text).toContain('compare-pair');
    // The plan is the visible record: both candidates appear, ranked.
    expect(out.plan.candidates.map((c) => c.name)).toEqual([
      'compare-pair',
      'gaming-docker-blurb',
    ]);
  });

  it('skips handlers that report null (not applicable)', () => {
    const a = keywordHandler('a', 0.8, ['nomatch']);
    const b = keywordHandler('b', 0.6, ['cappuccino']);
    const out = dispatchTurn(ctx({ understood: 'does starbucks make cappuccino' }), [a, b]);
    expect(out.plan.candidates.map((c) => c.name)).toEqual(['b']);
    expect(out.plan.chosen).toBe('b');
  });

  it('captures a per-option rationale from the { score, reason } form, keeping the number form working', () => {
    const withReason: TurnHandler = {
      name: 'fact-recall',
      score: () => ({ score: 0.9, reason: 'stored fact for a who/what/when lookup' }),
      resolve: (c) => ({ text: `fact: ${c.understood}`, turnKind: 'answer', confidence: 0.9 }),
    };
    const bareNumber = keywordHandler('bare', 0.7, ['x']);
    const out = dispatchTurn(ctx({ understood: 'x' }), [withReason, bareNumber]);

    const winner = out.plan.candidates.find((c) => c.name === 'fact-recall');
    expect(winner?.reason).toBe('stored fact for a who/what/when lookup');
    expect(winner?.baseScore).toBeCloseTo(0.9);
    // The bare-number handler still scores normally and carries no reason.
    const bare = out.plan.candidates.find((c) => c.name === 'bare');
    expect(bare?.score).toBeCloseTo(0.7);
    expect(bare?.reason).toBeUndefined();
  });
});

// ── confidence floor → honest miss ─────────────────────────────────────────

describe('dispatchTurn — confidence floor', () => {
  it('returns a miss (null resolution) when nothing clears the floor', () => {
    const weak = keywordHandler('weak', 0.3, ['locking']);
    const out = dispatchTurn(
      ctx({ understood: 'optimistic vs pessimistic locking' }),
      [weak],
      { confidenceFloor: 0.5 },
    );
    expect(out.resolution).toBeNull();
    expect(out.plan.chosen).toBeNull();
    expect(out.plan.belowFloor).toBe(true);
    // Even on a miss the plan exists so the panel can explain the "I don't know".
    expect(out.plan.candidates).toHaveLength(1);
    expect(out.plan.confidence).toBeCloseTo(0.3);
  });

  it('answers when a candidate meets the floor exactly', () => {
    const ok = keywordHandler('ok', 0.5, ['x']);
    const out = dispatchTurn(ctx({ understood: 'what is x' }), [ok], { confidenceFloor: 0.5 });
    expect(out.resolution).not.toBeNull();
    expect(out.plan.chosen).toBe('ok');
  });
});

// ── decline → fall through ─────────────────────────────────────────────────

describe('dispatchTurn — decline fall-through', () => {
  it('falls through to the next candidate when the top one declines', () => {
    // Top scorer can't actually ground the answer → returns null from resolve.
    const topButEmpty = keywordHandler('curated', 0.9, ['shallow'], { decline: true });
    const backup = keywordHandler('idiom', 0.7, ['copy']);

    const out = dispatchTurn(
      ctx({ understood: 'deep vs shallow copy in js' }),
      [topButEmpty, backup],
    );

    expect(out.plan.declined).toContain('curated');
    expect(out.plan.chosen).toBe('idiom');
    expect(out.resolution?.text).toContain('idiom');
  });

  it('records a miss when every above-floor candidate declines', () => {
    const a = keywordHandler('a', 0.9, ['z'], { decline: true });
    const b = keywordHandler('b', 0.8, ['z'], { decline: true });
    const out = dispatchTurn(ctx({ understood: 'z z z' }), [a, b]);
    expect(out.resolution).toBeNull();
    expect(out.plan.chosen).toBeNull();
    expect(out.plan.belowFloor).toBe(false); // they cleared the floor, just declined
    expect(out.plan.declined).toEqual(['a', 'b']);
  });
});

// ── friend guidance re-routes (the "that process wasn't good" channel) ──────

describe('dispatchTurn — friend guidance', () => {
  it('an `avoid` hint demotes a handler so a rival wins', () => {
    const flagged = keywordHandler('gaming-snippet', 0.9, ['docker']);
    const rival = keywordHandler('grounded-explainer', 0.6, ['docker']);
    const guidance: TurnGuidance[] = [
      { handler: 'gaming-snippet', signal: 'avoid', note: 'that process was not good', from: 'human' },
    ];

    const out = dispatchTurn(ctx({ understood: 'what is docker', guidance }), [flagged, rival]);

    expect(out.plan.chosen).toBe('grounded-explainer');
    const flaggedCand = out.plan.candidates.find((c) => c.name === 'gaming-snippet');
    expect(flaggedCand?.score).toBeLessThan(flaggedCand!.baseScore);
    expect(flaggedCand?.guidanceApplied).toContain('avoid');
  });

  it('a `prefer` hint boosts a handler past a higher-scoring default', () => {
    const def = keywordHandler('default', 0.7, ['plan']);
    const preferred = keywordHandler('visible-plan', 0.55, ['plan']);
    const guidance: TurnGuidance[] = [{ handler: 'visible-plan', signal: 'prefer', from: 'ai' }];
    const out = dispatchTurn(ctx({ understood: 'show me the plan', guidance }), [def, preferred]);
    expect(out.plan.chosen).toBe('visible-plan');
  });

  it('matchHint scopes a hint to a class of turns only', () => {
    const h = keywordHandler('snippet', 0.9, ['docker']);
    const rival = keywordHandler('explainer', 0.6, ['docker']);
    const guidance: TurnGuidance[] = [
      { handler: 'snippet', signal: 'avoid', matchHint: 'docker vs' },
    ];
    // Hint does NOT apply (no "docker vs" in text) → snippet still wins.
    const a = dispatchTurn(ctx({ understood: 'what is docker', guidance }), [h, rival]);
    expect(a.plan.chosen).toBe('snippet');
    // Hint DOES apply → snippet demoted, explainer wins.
    const b = dispatchTurn(ctx({ understood: 'docker vs podman', guidance }), [h, rival]);
    expect(b.plan.chosen).toBe('explainer');
  });
});

// ── robustness + plan rendering ────────────────────────────────────────────

describe('dispatchTurn — robustness', () => {
  it('a throwing scorer or resolver never takes down the turn', () => {
    const bombScore: TurnHandler = {
      name: 'bomb-score',
      score: () => {
        throw new Error('boom');
      },
      resolve: () => ({ text: 'x', turnKind: 'answer', confidence: 1 }),
    };
    const bombResolve: TurnHandler = {
      name: 'bomb-resolve',
      score: () => 0.95,
      resolve: () => {
        throw new Error('boom');
      },
    };
    const safe = keywordHandler('safe', 0.6, ['hi']);
    const out = dispatchTurn(ctx({ understood: 'hi' }), [bombScore, bombResolve, safe]);
    expect(out.plan.chosen).toBe('safe');
    expect(out.plan.declined).toContain('bomb-resolve');
  });

  it('describePlan renders a readable, marked trace', () => {
    const a = keywordHandler('compare-pair', 0.9, ['vs']);
    const b = keywordHandler('gaming', 0.4, ['vs']);
    const out = dispatchTurn(ctx({ understood: 'a vs b' }), [a, b]);
    const lines = describePlan(out.plan);
    expect(lines[0]).toContain('→ compare-pair');
    expect(lines[0]).toContain('90%');
    expect(lines[1]).toContain('gaming');
  });
});
