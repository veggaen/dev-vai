import { describe, it, expect } from 'vitest';
import * as ka from './knowledge-answers.js';
import { VaiEngine } from './vai-engine.js';

/**
 * Locks in the vai-engine.ts → knowledge-answers.ts extraction (Slice 3 of breaking up
 * the VaiEngine god-class). 10 pure (no this/super) knowledge/fact answerer methods were
 * moved out verbatim; VaiEngine delegates to them via thin wrappers.
 *
 * Contract: the in-class wrapper and the free function return identical output for the
 * same input, across a probe battery — proving the delegation is behavior-preserving.
 */

const METHODS = [
  'tryWebStackKnowledge', 'tryFactualCurated', 'tryAnswerExtendedFact', 'tryCSFundamentals',
  'tryGeneralKnowledge', 'tryEnglishLanguage', 'tryAnswerCanonicalFact', 'tryCuratedListLookup',
  'tryAnswerDisambiguatedTopic', 'tryAnswerNegation',
] as const;

const PROBES = [
  '', 'what is react', 'how do I use prisma with postgres', 'what is the capital of france',
  'tell me about binary search', 'what is a hash map', 'explain rest vs graphql',
  'who invented the telephone', 'what is docker', 'counter-strike overview',
];

describe('knowledge-answers extraction', () => {
  it('exports all extracted answerer functions', () => {
    for (const m of METHODS) {
      expect(typeof (ka as Record<string, unknown>)[m], m).toBe('function');
    }
  });

  it('VaiEngine wrappers delegate to the free functions byte-for-byte', () => {
    const engine = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });
    const asAny = engine as unknown as Record<string, (s: string) => unknown>;
    const free = ka as unknown as Record<string, (s: string) => unknown>;
    for (const m of METHODS) {
      for (const p of PROBES) {
        expect(asAny[m](p), `${m}(${JSON.stringify(p)})`).toBe(free[m](p));
      }
    }
  });
});
