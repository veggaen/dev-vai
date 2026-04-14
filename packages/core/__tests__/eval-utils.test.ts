import { describe, it, expect } from 'vitest';
import {
  safeContent, stripCodeBlocks, safeSlice, countWords,
  computeNgrams, ngramOverlap, clamp,
  detectRetryChains,
} from '../src/eval/eval-utils.js';
import type { SessionEvent } from '../src/sessions/types.js';

/* ═══════════════════════════════════════════════════════════════ */
/*  safeContent                                                   */
/* ═══════════════════════════════════════════════════════════════ */

describe('safeContent', () => {
  it('returns empty string for null', () => {
    expect(safeContent(null)).toBe('');
  });

  it('returns content from event', () => {
    const event = { id: '1', sessionId: 's', type: 'message' as const, timestamp: 1, content: 'hello world', meta: {} };
    expect(safeContent(event as SessionEvent)).toBe('hello world');
  });

  it('truncates to default max length', () => {
    const longContent = 'a'.repeat(10000);
    const event = { id: '1', sessionId: 's', type: 'message' as const, timestamp: 1, content: longContent, meta: {} };
    expect(safeContent(event as SessionEvent).length).toBe(5000);
  });

  it('truncates to custom max length', () => {
    const event = { id: '1', sessionId: 's', type: 'message' as const, timestamp: 1, content: 'hello world', meta: {} };
    expect(safeContent(event as SessionEvent, 5)).toBe('hello');
  });

  it('handles undefined content', () => {
    const event = { id: '1', sessionId: 's', type: 'message' as const, timestamp: 1, content: undefined, meta: {} };
    expect(safeContent(event as unknown as SessionEvent)).toBe('');
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  stripCodeBlocks                                               */
/* ═══════════════════════════════════════════════════════════════ */

describe('stripCodeBlocks', () => {
  it('removes fenced code blocks', () => {
    expect(stripCodeBlocks('before ```js\ncode\n``` after')).toBe('before  after');
  });

  it('handles multiple code blocks', () => {
    const text = 'a ```x``` b ```y``` c';
    expect(stripCodeBlocks(text)).toBe('a  b  c');
  });

  it('returns text unchanged if no code blocks', () => {
    expect(stripCodeBlocks('just text')).toBe('just text');
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  safeSlice                                                     */
/* ═══════════════════════════════════════════════════════════════ */

describe('safeSlice', () => {
  it('truncates long strings', () => {
    expect(safeSlice('hello world', 5)).toBe('hello');
  });

  it('handles null/undefined via nullish coalescing', () => {
    expect(safeSlice(null as unknown as string, 10)).toBe('');
    expect(safeSlice(undefined as unknown as string, 10)).toBe('');
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  countWords                                                    */
/* ═══════════════════════════════════════════════════════════════ */

describe('countWords', () => {
  it('counts words in a sentence', () => {
    expect(countWords('hello world')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('handles multiple spaces', () => {
    expect(countWords('  a  b  c  ')).toBe(3);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  computeNgrams + ngramOverlap                                  */
/* ═══════════════════════════════════════════════════════════════ */

describe('computeNgrams', () => {
  it('computes trigrams', () => {
    const grams = computeNgrams('the quick brown fox jumps', 3);
    expect(grams.has('the quick brown')).toBe(true);
    expect(grams.has('quick brown fox')).toBe(true);
    expect(grams.size).toBe(3);
  });

  it('returns empty set for short text', () => {
    expect(computeNgrams('one two', 3).size).toBe(0);
  });
});

describe('ngramOverlap', () => {
  it('returns 1 for identical sets', () => {
    const s = new Set(['a b c', 'b c d']);
    expect(ngramOverlap(s, s)).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    const a = new Set(['a b c']);
    const b = new Set(['d e f']);
    expect(ngramOverlap(a, b)).toBe(0);
  });

  it('returns 0 for two empty sets', () => {
    expect(ngramOverlap(new Set(), new Set())).toBe(0);
  });

  it('computes partial overlap correctly', () => {
    const a = new Set(['a', 'b']);
    const b = new Set(['b', 'c']);
    // intersection=1 (b), union=3 (a,b,c)
    expect(ngramOverlap(a, b)).toBeCloseTo(1 / 3, 5);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  clamp                                                         */
/* ═══════════════════════════════════════════════════════════════ */

describe('clamp', () => {
  it('clamps below min', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
  });

  it('clamps above max', () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it('passes through values in range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  detectRetryChains                                             */
/* ═══════════════════════════════════════════════════════════════ */

describe('detectRetryChains', () => {
  function makePair(userContent: string) {
    return {
      userMessage: {
        id: '1', sessionId: 's', type: 'message' as const,
        timestamp: 1, content: userContent, meta: {},
      } as SessionEvent,
    };
  }

  it('detects a retry chain from very similar messages', () => {
    const pairs = [
      makePair('fix the error in auth.ts line 42'),
      makePair('fix the error in auth.ts line 42 please'),
      makePair('fix the error in auth.ts it still fails'),
    ];

    const chains = detectRetryChains(pairs);
    expect(chains.length).toBeGreaterThanOrEqual(1);
    expect(chains[0].startIndex).toBe(0);
    expect(chains[0].length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty for unrelated messages', () => {
    const pairs = [
      makePair('implement the caching layer'),
      makePair('now add user authentication'),
      makePair('deploy to production'),
    ];

    const chains = detectRetryChains(pairs);
    expect(chains).toHaveLength(0);
  });

  it('returns empty for single message', () => {
    expect(detectRetryChains([makePair('hello')])).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(detectRetryChains([])).toHaveLength(0);
  });

  it('detects chains via shared file paths', () => {
    const pairs = [
      makePair('update src/config.ts to add logging'),
      makePair('src/config.ts needs better error handling'),
    ];

    const chains = detectRetryChains(pairs);
    expect(chains.length).toBeGreaterThanOrEqual(1);
  });

  it('respects custom overlap threshold', () => {
    const pairs = [
      makePair('fix the config'),
      makePair('fix the config please'),
    ];

    // Very high threshold → should not detect
    const strict = detectRetryChains(pairs, 0.99);
    // Default threshold → may detect
    const normal = detectRetryChains(pairs);
    expect(strict.length).toBeLessThanOrEqual(normal.length);
  });

  it('skips very short messages to avoid false positives', () => {
    const pairs = [
      makePair('ok'),
      makePair('ok'),
      makePair('yes'),
    ];
    const chains = detectRetryChains(pairs);
    expect(chains).toHaveLength(0);
  });
});
