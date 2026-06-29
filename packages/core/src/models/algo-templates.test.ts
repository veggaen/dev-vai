import { describe, it, expect } from 'vitest';
import { ALGO_TEMPLATES } from './algo-templates.js';
import { VaiEngine } from './vai-engine.js';

/**
 * Locks in the vai-engine.ts → algo-templates.ts extraction (Slice 2 of breaking up
 * the VaiEngine god-class). The 224-entry algorithm code-sample table was moved out
 * of the 9,279-line algoTemplate method verbatim; the method now reads ALGO_TEMPLATES.
 *
 * Contract protected:
 *  1. The data table is fully populated (224 algos, each with code-sample shape).
 *  2. algoTemplate still produces a correct, non-empty answer for known algos and the
 *     language-fallback branches (typescript fence-rewrite; unknown lang → fallback).
 */

describe('algo-templates extraction', () => {
  it('exposes the full algorithm table', () => {
    const algos = Object.keys(ALGO_TEMPLATES);
    expect(algos.length).toBe(224);
    for (const algo of algos) {
      const byLang = ALGO_TEMPLATES[algo];
      expect(Object.keys(byLang).length, algo).toBeGreaterThan(0);
      for (const lang of Object.keys(byLang)) {
        const impl = byLang[lang];
        expect(typeof impl.title, `${algo}.${lang}.title`).toBe('string');
        expect(impl.code.length, `${algo}.${lang}.code`).toBeGreaterThan(0);
        expect(impl.desc.length, `${algo}.${lang}.desc`).toBeGreaterThan(0);
      }
    }
  });

  it('algoTemplate resolves known algos and fallback branches against the imported table', () => {
    const engine = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });
    const algoTemplate = (engine as unknown as { algoTemplate(a: string, l: string): string }).algoTemplate.bind(engine);

    // direct hit
    const py = algoTemplate('binary_search', 'python');
    expect(py).toContain('Binary Search');
    expect(py).toContain('```python');

    // typescript fence-rewrite fallback when no typed variant exists
    const tsOut = algoTemplate('binary_search', 'typescript');
    expect(tsOut).toContain('```typescript');

    // unknown lang → falls back through the chain, still returns content
    const fallback = algoTemplate('binary_search', 'rust');
    expect(typeof fallback).toBe('string');
    expect(fallback.length).toBeGreaterThan(0);

    // unknown algo → null (cast to string by the method)
    expect(algoTemplate('does_not_exist_xyz', 'python')).toBeNull();
  });
});
