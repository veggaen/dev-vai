import { describe, it, expect } from 'vitest';
import { rewriteFollowupQuery } from './followup-rewrite.js';
import { VaiEngine } from './vai-engine.js';
import type { Message } from './adapter.js';

/**
 * Regression lock for decomposition phase 2, slice 4: `rewriteFollowupQuery` (a PURE, 0-dependency
 * method — no this/super) was moved out of the VaiEngine god-class by the auto-extractor
 * (extract-pure-methods.mjs, which auto-carries file-local helper imports). VaiEngine delegates via
 * a thin wrapper. Contract: wrapper == free function, byte-for-byte.
 */

const H = (u: string, a: string): Message[] => [{ role: 'user', content: u }, { role: 'assistant', content: a }] as Message[];

// Probes that actually FIRE a rewrite (geographic/currency/moon follow-ups + disambiguation) plus
// null cases — so the byte-identity assertion is meaningful (not all-null).
const PROBES: [string, Message[]][] = [
  ['what about France?', H('what is the capital of Japan', 'Tokyo')],
  ['and Germany?', H('what is the capital of France', 'Paris')],
  ['in Norway?', H('what is the population of Sweden', 'about 10 million')],
  ['the currency?', H('tell me about Japan', 'Japan is an island nation')],
  ['how many moons?', H('tell me about Mars', 'Mars is the red planet')],
  ['what about mercury the planet', H('tell me about mercury', 'mercury is a metal')],
  ['make it simpler', H('explain closures', 'a closure is...')],
  ['tell me more', H('what is docker', 'docker is...')],
  ['what is a closure', []],
  ['hello there', []],
];

describe('followup-rewrite extraction', () => {
  it('exports the extracted rewriter', () => {
    expect(typeof rewriteFollowupQuery).toBe('function');
  });

  it('the VaiEngine wrapper and the free function return identical output byte-for-byte', () => {
    const engine = new VaiEngine({ testMode: true } as unknown as ConstructorParameters<typeof VaiEngine>[0]);
    const asAny = engine as unknown as { rewriteFollowupQuery: (input: string, history: readonly Message[]) => string | null };
    for (const [input, history] of PROBES) {
      const viaWrapper = asAny.rewriteFollowupQuery(input, history);
      const viaFree = rewriteFollowupQuery(input, history);
      expect(viaFree, `free(${JSON.stringify(input)})`).toBe(viaWrapper);
    }
  });

  it('at least one probe actually fires a rewrite (the golden is not all-null)', () => {
    const anyNonNull = PROBES.some(([input, history]) => rewriteFollowupQuery(input, history) !== null);
    expect(anyNonNull).toBe(true);
  });
});
