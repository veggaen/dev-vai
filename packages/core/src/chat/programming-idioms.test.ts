import { describe, expect, it, vi } from 'vitest';
import {
  comparisonOperands,
  composeIdiomComparison,
  resolveIdiomExplanation,
  isMultiConceptOrComparison,
  isMultiWayComparison,
} from './programming-idioms.js';

describe('isMultiWayComparison', () => {
  it('flags 3+ enumerated comparison subjects', () => {
    expect(isMultiWayComparison('Compare Next.js, Vite, Vinext, and Vue for animation')).toBe(true);
    expect(isMultiWayComparison('compares nextjs, vite react, and vinext')).toBe(true);
  });

  it('does NOT flag a genuine two-way comparison (incl. trailing clause)', () => {
    expect(isMultiWayComparison('react vs vue, which should I use?')).toBe(false);
    expect(isMultiWayComparison('what is the difference between React and Vue, and which is faster?')).toBe(false);
    expect(isMultiWayComparison('difference between debounce and throttle')).toBe(false);
  });
});

describe('comparisonOperands', () => {
  it('extracts both operands from common comparison shapes', () => {
    expect(comparisonOperands('difference between debounce and throttle')).toEqual(['debounce', 'throttle']);
    expect(comparisonOperands('compare deep clone and shallow copy')).toEqual(['deep clone', 'shallow copy']);
    expect(comparisonOperands('react vs vue')).toEqual(['react', 'vue']);
    expect(comparisonOperands("what's the difference between a debounce and a throttle in javascript?")).toEqual(['debounce', 'throttle']);
  });

  it('returns null for non-comparison prompts', () => {
    expect(comparisonOperands('write a debounce function')).toBeNull();
    expect(comparisonOperands('how do I deep clone an object')).toBeNull();
  });
});

describe('composeIdiomComparison — grounded, both-sided, self-adjusting', () => {
  it('composes from the canonical idiom table when both sides are known idioms', () => {
    const out = composeIdiomComparison('difference between debounce and throttle');
    expect(out).toMatch(/\*\*Debounce/i);
    expect(out).toMatch(/\*\*Throttle/i);
    expect(out).toMatch(/function debounce/);
    expect(out).toMatch(/function throttle/);
  });

  it('declines when only one side can be grounded (honest, no fabrication)', () => {
    // "shallow copy" is not in the idiom table and no explainer is injected.
    expect(composeIdiomComparison('difference between deep clone and shallow copy')).toBeNull();
  });

  it('uses an injected (corpus) explainer first, so it grows with what Vai knows', () => {
    const explain = vi.fn((concept: string) => {
      const corpus: Record<string, string> = {
        rest: 'REST exposes resources over HTTP verbs and URLs.',
        graphql: 'GraphQL exposes a single endpoint where clients query exactly the fields they need.',
      };
      const key = concept.toLowerCase();
      return corpus[key] ? { summary: corpus[key] } : null;
    });
    const out = composeIdiomComparison('difference between REST and GraphQL', explain);
    expect(out).toMatch(/\*\*Rest\*\* — REST exposes resources/i);
    expect(out).toMatch(/\*\*Graphql\*\* — GraphQL exposes a single endpoint/i);
    expect(explain).toHaveBeenCalled();
  });

  it('falls back to the idiom table when the injected explainer has nothing', () => {
    const explain = vi.fn(() => null);
    const out = composeIdiomComparison('debounce vs throttle', explain);
    expect(out).toMatch(/function debounce/);
    expect(out).toMatch(/function throttle/);
  });

  it('declines when retrieval returns the same explanation for both comparison sides', () => {
    const explain = vi.fn(() => ({
      summary: 'Tauri is a framework for desktop applications with a Rust backend.',
    }));

    expect(composeIdiomComparison('Tauri vs Electron', explain)).toBeNull();
  });
});

describe('resolveIdiomExplanation honors requested language', () => {
  it('resolves a single concept in the requested language', () => {
    const ts = resolveIdiomExplanation('debounce', 'typescript');
    expect(ts?.lang).toBe('typescript');
    const py = resolveIdiomExplanation('deep clone', 'python');
    expect(py?.lang).toBe('python');
  });

  it('still flags multi-concept/comparison prompts', () => {
    expect(isMultiConceptOrComparison('debounce vs throttle')).toBe(true);
    expect(isMultiConceptOrComparison('write a debounce function')).toBe(false);
  });

  it('requires programming intent before treating sleep as an idiom', () => {
    expect(resolveIdiomExplanation('implement sleep function', 'typescript')?.label).toMatch(/sleep/i);
    expect(resolveIdiomExplanation('Sleep debt', 'typescript')).toBeNull();
  });
});
