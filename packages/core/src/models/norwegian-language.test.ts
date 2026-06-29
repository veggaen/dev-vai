import { describe, it, expect } from 'vitest';
import * as no from './norwegian-language.js';
import { VaiEngine } from './vai-engine.js';

/**
 * Locks in the vai-engine.ts → norwegian-language.ts extraction (Slice 5 — the first
 * COUPLED method moved). tryNorwegianLanguage used one this.member (findOptionLetter);
 * both were co-extracted, with this.findOptionLetter rewritten to a bare sibling call.
 *
 * Contract: the in-class wrapper and the free function return identical output, including
 * the verb-conjugation branches that depend on findOptionLetter — proving the helper
 * rewrite is correct, not just the wrapper delegation.
 */

const PROBES = [
  'bøy verbet å gå', 'preteritum av å spise', 'past tense of å være',
  'conjugate å komme', 'bøy også å lese', 'presens av å skrive',
  'er å spise et sterkt eller svakt verb', 'hva er ordstilling på norsk',
  'skriv en formell e-post på norsk', 'hva er modalverb',
  'what is gerund in english', 'hello', // negative controls → null
];

describe('norwegian-language extraction', () => {
  it('exports the extracted functions', () => {
    expect(typeof no.tryNorwegianLanguage).toBe('function');
    expect(typeof no.findOptionLetter).toBe('function');
  });

  it('VaiEngine wrapper delegates byte-for-byte (incl. findOptionLetter-dependent branches)', () => {
    const engine = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });
    const asAny = engine as unknown as { tryNorwegianLanguage(s: string): string | null };
    for (const p of PROBES) {
      expect(asAny.tryNorwegianLanguage(p), p).toBe(no.tryNorwegianLanguage(p));
    }
  });

  it('still answers a real Norwegian grammar question', () => {
    const out = no.tryNorwegianLanguage('bøy verbet å gå');
    expect(out).toContain('gikk'); // past tense of å gå
    expect(out).toContain('Preteritum');
  });
});
