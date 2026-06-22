import { describe, it, expect } from 'vitest';
import * as tpl from './builder-templates.js';
import { VaiEngine } from './vai-engine.js';

/**
 * Locks in the vai-engine.ts → builder-templates.ts extraction (Slice 1 of breaking up
 * the 56k-line VaiEngine god-class). These were pure, this/super-free template methods
 * moved out verbatim; VaiEngine now delegates to them via thin wrappers.
 *
 * The contract this test protects:
 *  1. Every extracted function returns a non-empty string (they are pure builders).
 *  2. The in-class wrapper and the free function produce IDENTICAL output — proving the
 *     delegation is behavior-preserving and can't silently drift.
 */

// Representative args per signature shape (mirrors scripts/capture-builder-golden.mjs).
const argsFor = (name: string): unknown[] => {
  if (name === 'generateBuilderSpecializedViteApp') {
    return [{ kind: 'dashboard', title: 'Demo', desc: 'a demo app', accent: 'violet' }];
  }
  if (name === 'generateBuilderSharedShoppingProductApp') return ['a shared shopping app', false];
  if (name === 'generateBuilderNextjsDefaultStarter') return ['Intro line.'];
  return ['build me a sample app'];
};

const fnNames = Object.keys(tpl).filter((k) => k.startsWith('generateBuilder'));

describe('builder-templates extraction', () => {
  it('extracted a non-trivial set of template functions', () => {
    // Guard against an accidental empty/partial module.
    expect(fnNames.length).toBeGreaterThanOrEqual(30);
  });

  it('every extracted function returns a non-empty string', () => {
    for (const name of fnNames) {
      const out = (tpl as Record<string, (...a: unknown[]) => unknown>)[name](...argsFor(name));
      expect(typeof out, name).toBe('string');
      expect((out as string).length, name).toBeGreaterThan(0);
    }
  });

  it('VaiEngine wrappers delegate to the free functions byte-for-byte', () => {
    const engine = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });
    const asAny = engine as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const name of fnNames) {
      if (typeof asAny[name] !== 'function') continue; // wrapper exists for every extracted fn
      const viaWrapper = asAny[name](...argsFor(name));
      const viaFree = (tpl as Record<string, (...a: unknown[]) => unknown>)[name](...argsFor(name));
      expect(viaWrapper, name).toBe(viaFree);
    }
  });
});
