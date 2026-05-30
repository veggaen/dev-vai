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

  it('answers throttle and slugify utility requests', () => {
    expect(tryEmitFactShim({ content: 'show me throttle in ts' })?.reply).toMatch(/function throttle/i);
    expect(tryEmitFactShim({ content: 'slugify helper in typescript' })?.reply).toMatch(/function slugify/i);
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
