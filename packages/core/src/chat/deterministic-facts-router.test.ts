import { describe, expect, it } from 'vitest';
import { tryEmitFactShim } from './deterministic-facts-router.js';

describe('deterministic code snippets', () => {
  it('answers debounce utility requests with runnable TypeScript instead of falling back', () => {
    const result = tryEmitFactShim({ content: 'write a debounce function in typescript' });

    expect(result?.kind).toBe('code-snippet');
    expect(result?.reply).toMatch(/function debounce/i);
    expect(result?.reply).toMatch(/```typescript/);
    expect(result?.reply).toMatch(/clearTimeout/);
  });

  it('recognizes a janky search-input handler as a debounce request', () => {
    const result = tryEmitFactShim({ content: 'how do i make my search input handler less janky?' });

    expect(result?.kind).toBe('code-snippet');
    expect(result?.reply).toMatch(/function debounce/i);
    expect(result?.reply).toMatch(/clearTimeout/);
  });

  it('answers throttle and slugify utility requests', () => {
    expect(tryEmitFactShim({ content: 'show me throttle in ts' })?.reply).toMatch(/function throttle/i);
    expect(tryEmitFactShim({ content: 'slugify helper in typescript' })?.reply).toMatch(/function slugify/i);
  });
});

describe('single-concept snippets do not hijack comparison / multi-concept questions', () => {
  it('answers "difference between debounce and throttle" with a both-sided comparison', () => {
    const result = tryEmitFactShim({
      content: "What's the difference between a debounce and a throttle in JavaScript? Give a one-line use case for each.",
    });
    // Must not short-circuit to a one-concept snippet; it composes a grounded
    // comparison that actually covers BOTH sides.
    expect(result?.kind).toBe('compare-pair');
    expect(result?.reply).toMatch(/function debounce/i);
    expect(result?.reply).toMatch(/function throttle/i);
  });

  it('still answers a genuine single-concept request', () => {
    expect(tryEmitFactShim({ content: 'write a debounce function in typescript' })?.kind).toBe('code-snippet');
    expect(tryEmitFactShim({ content: 'how do I deep clone an object in javascript' })?.kind).toBe('code-snippet');
  });

  it('routes "X vs Y" / "difference between X and Y" to the curated comparison, not a snippet', () => {
    expect(tryEmitFactShim({ content: 'react vs vue, which should I use?' })?.kind).toBe('compare-pair');
    expect(tryEmitFactShim({ content: 'what is the difference between postgres and mysql?' })?.kind).toBe('compare-pair');
  });
});

describe('brand facts do not hijack action yes/no questions', () => {
  it('defers "does X make/sell Y?" instead of dumping a brand definition', () => {
    expect(tryEmitFactShim({ content: 'does starbucks make cappuccino?' })?.kind).not.toBe('fact-brand');
    expect(tryEmitFactShim({ content: 'does mcdonalds sell salads?' })?.kind).not.toBe('fact-brand');
    expect(tryEmitFactShim({ content: 'do they serve oat milk at starbucks?' })?.kind).not.toBe('fact-brand');
  });

  it('still answers a definitional brand question with the brand one-liner', () => {
    const result = tryEmitFactShim({ content: 'what is starbucks?' });
    expect(result?.kind).toBe('fact-brand');
    expect(result?.reply).toMatch(/coffeehouse/i);
  });
});

describe('conceptual primers', () => {
  it('answers a conversational CAP-theorem tradeoff prompt directly', () => {
    const result = tryEmitFactShim({ content: "i'm fuzzy on CAP theorem tradeoffs for a chat app. honest read?" });

    expect(result?.kind).toBe('concept-primer');
    expect(result?.reply).toMatch(/network partition/i);
    expect(result?.reply).toMatch(/chat app/i);
  });
});
