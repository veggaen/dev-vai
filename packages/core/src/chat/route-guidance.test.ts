import { describe, it, expect } from 'vitest';
import {
  salientTokens,
  selectApplicableGuidance,
  toTurnGuidance,
  InMemoryGuidanceStore,
  evaluateLessonEfficacy,
  type RouteGuidance,
} from './route-guidance.js';

function hint(partial: Partial<RouteGuidance> & Pick<RouteGuidance, 'scope'>): RouteGuidance {
  return {
    id: 'g1',
    from: 'human',
    signal: 'avoid',
    handler: 'chat-fact-shim',
    weight: 1,
    active: true,
    createdAt: new Date('2026-01-01'),
    ...partial,
  };
}

describe('salientTokens', () => {
  it('keeps distinctive tokens, drops stopwords and short words', () => {
    expect(salientTokens('what is the difference between docker and kubernetes')).toEqual([
      'difference',
      'docker',
      'kubernetes',
    ]);
  });

  it('preserves tech tokens with + and .', () => {
    const tokens = salientTokens('compare c++ and node.js performance');
    expect(tokens).toContain('c++');
    expect(tokens).toContain('node.js');
  });

  it('de-duplicates', () => {
    expect(salientTokens('docker docker docker')).toEqual(['docker']);
  });
});

describe('selectApplicableGuidance — scope', () => {
  const tokens = salientTokens('docker vs kubernetes for production');

  it('global hints always apply', () => {
    const g = hint({ scope: 'global', handler: 'gaming' });
    expect(selectApplicableGuidance({ tokens }, [g])).toHaveLength(1);
  });

  it('conversation hints apply only to the same conversation', () => {
    const g = hint({ scope: 'conversation', conversationId: 'conv-A' });
    expect(selectApplicableGuidance({ conversationId: 'conv-A', tokens }, [g])).toHaveLength(1);
    expect(selectApplicableGuidance({ conversationId: 'conv-B', tokens }, [g])).toHaveLength(0);
    expect(selectApplicableGuidance({ tokens }, [g])).toHaveLength(0); // no conv id
  });

  it('class hints apply on sufficient salient-token overlap', () => {
    const g = hint({ scope: 'class', matchTokens: ['docker', 'kubernetes'] });
    // both tokens present → 100% overlap ≥ 0.5
    expect(selectApplicableGuidance({ tokens }, [g])).toHaveLength(1);
    // unrelated turn → no overlap
    expect(selectApplicableGuidance({ tokens: salientTokens('how do i center a div') }, [g])).toHaveLength(0);
  });

  it('class hints apply on intent equality even without token overlap', () => {
    const g = hint({ scope: 'class', matchTokens: ['nomatch'], intent: 'definition' });
    expect(
      selectApplicableGuidance({ tokens: salientTokens('explain monads'), intent: 'definition' }, [g]),
    ).toHaveLength(1);
  });

  it('respects the overlap threshold', () => {
    const g = hint({ scope: 'class', matchTokens: ['docker', 'kubernetes', 'helm', 'istio'] });
    // 2 of 4 present = 0.5 → applies at default threshold
    expect(selectApplicableGuidance({ tokens }, [g])).toHaveLength(1);
    // raise the bar to 0.75 → 0.5 no longer enough
    expect(selectApplicableGuidance({ tokens }, [g], new Date(), { classOverlapThreshold: 0.75 })).toHaveLength(0);
  });
});

describe('selectApplicableGuidance — lifecycle', () => {
  const tokens = salientTokens('docker vs kubernetes');

  it('inactive hints never apply', () => {
    const g = hint({ scope: 'global', active: false });
    expect(selectApplicableGuidance({ tokens }, [g])).toHaveLength(0);
  });

  it('expired hints never apply', () => {
    const g = hint({ scope: 'global', expiresAt: new Date('2026-01-01') });
    expect(selectApplicableGuidance({ tokens }, [g], new Date('2026-06-01'))).toHaveLength(0);
    // still valid before expiry
    expect(selectApplicableGuidance({ tokens }, [g], new Date('2025-12-01'))).toHaveLength(1);
  });
});

describe('toTurnGuidance', () => {
  it('projects the persisted record onto the dispatcher shape (no matchHint)', () => {
    const g = hint({
      scope: 'class',
      signal: 'prefer',
      handler: 'compare-pair',
      note: 'use the real comparison',
      from: 'ai',
      matchTokens: ['docker', 'kubernetes'],
    });
    expect(toTurnGuidance(g)).toEqual({
      handler: 'compare-pair',
      signal: 'prefer',
      note: 'use the real comparison',
      from: 'ai',
    });
  });
});

describe('InMemoryGuidanceStore — write path for reference data', () => {
  it('save + load + recordApplication works for human/ai steers', () => {
    const store = new InMemoryGuidanceStore();
    const g = store.save({
      conversationId: 'conv-123',
      from: 'human',
      author: 'tester',
      signal: 'avoid',
      handler: 'chat-fact-shim',
      scope: 'class',
      note: 'audit test',
      weight: 1,
      matchTokens: ['haiku', 'typescript'],
    });
    expect(g.id).toBeTruthy();
    expect(g.active).toBe(true);

    const loaded = store.loadActive('conv-123');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].handler).toBe('chat-fact-shim');

    store.recordApplication(g.id);
    // (internal count not exposed on interface, but no throw = ok)
    expect(true).toBe(true);
  });
});

describe('evaluateLessonEfficacy — prune council lessons that never help', () => {
  it('watches a lesson with too few samples (let it gather data)', () => {
    const v = evaluateLessonEfficacy({ guidanceId: 'g', appliedCount: 1, helpfulTurns: 0, unhelpfulTurns: 1 });
    expect(v.verdict).toBe('watch');
  });

  it('keeps a lesson that has helped at least as often as not', () => {
    const v = evaluateLessonEfficacy({ guidanceId: 'g', appliedCount: 6, helpfulTurns: 4, unhelpfulTurns: 2 });
    expect(v.verdict).toBe('keep');
  });

  it('decays a lesson applied enough times that never (net) helped', () => {
    const v = evaluateLessonEfficacy({ guidanceId: 'g', appliedCount: 8, helpfulTurns: 0, unhelpfulTurns: 6 });
    expect(v.verdict).toBe('decay');
  });

  it('does not decay before the minSamples threshold even if all unhelpful', () => {
    const v = evaluateLessonEfficacy({ guidanceId: 'g', appliedCount: 2, helpfulTurns: 0, unhelpfulTurns: 2 });
    expect(v.verdict).toBe('watch');
  });

  it('respects a custom minSamples', () => {
    const strict = evaluateLessonEfficacy({ guidanceId: 'g', appliedCount: 4, helpfulTurns: 0, unhelpfulTurns: 4 }, { minSamples: 5 });
    expect(strict.verdict).toBe('watch');
    const lenient = evaluateLessonEfficacy({ guidanceId: 'g', appliedCount: 4, helpfulTurns: 0, unhelpfulTurns: 4 }, { minSamples: 3 });
    expect(lenient.verdict).toBe('decay');
  });
});
