import { describe, it, expect } from 'vitest';
import { tryAlgorithmCodeGen } from './algorithm-codegen.js';
import { VaiEngine } from './vai-engine.js';

/**
 * Regression lock for decomposition phase 2, slice 1: `tryAlgorithmCodeGen` was moved out of the
 * VaiEngine god-class verbatim (589-line body), with its one dependency `this.algoTemplate` injected
 * as a parameter. Contract: the in-class wrapper and the free function must return IDENTICAL output
 * for every input — byte-for-byte. If a future edit drifts them apart, this fails.
 */

// A battery that exercises the router's branches: algorithm hits across languages, default-language,
// and the anti-hijack rejection cases (idea/spec/unique framing → null, no build verb → null).
const PROBES = [
  'write binary search in python', 'implement binary search in javascript', 'binary search tree insert in java',
  'bubble sort in python', 'selection sort in javascript', 'insertion sort in typescript', 'merge sort in cpp',
  'recursive factorial function in python', 'fibonacci function in javascript', 'recursive gcd function in go',
  'power function in python', 'stack class in python', 'queue implementation in java',
  'reverse the words in a sentence in python', 'reverse a string in javascript', 'palindrome check function in python',
  'count vowels in python', 'anagram check function in javascript', 'check if prime in python', 'sieve of eratosthenes in python',
  'lcm function in python', 'flatten a nested array in javascript', 'transpose a matrix in python', 'find the max in an array in python',
  'title case in python', 'slugify in javascript', 'to camel case in typescript', 'to snake case in python',
  'quickselect in python', 'top k frequent in python',
  // default language (no lang specified)
  'write bubble sort', 'implement a stack class', 'palindrome check function',
  // rejection cases — must be null (the anti-hijack gates)
  'is my business idea unique?', 'how do I know if the idea is unique', 'what makes a good product idea',
  'creating a complete spec for the architecture', 'give me advice on strategy', 'what is your opinion',
  'what is binary search', 'explain bubble sort',
];

describe('algorithm-codegen extraction', () => {
  it('exports the extracted router', () => {
    expect(typeof tryAlgorithmCodeGen).toBe('function');
  });

  it('the VaiEngine wrapper and the free function return identical output byte-for-byte', () => {
    const engine = new VaiEngine({ testMode: true } as unknown as ConstructorParameters<typeof VaiEngine>[0]);
    const asAny = engine as unknown as {
      tryAlgorithmCodeGen: (input: string) => string | null;
      algoTemplate: (algo: string, lang: string) => string;
    };
    const algoTemplate = (algo: string, lang: string) => asAny.algoTemplate(algo, lang);
    for (const input of PROBES) {
      const viaWrapper = asAny.tryAlgorithmCodeGen(input);
      const viaFree = tryAlgorithmCodeGen(input, algoTemplate);
      expect(viaFree, `free(${JSON.stringify(input)})`).toBe(viaWrapper);
    }
  });

  it('the free function is pure — no `this` reference in its source', () => {
    // A cheap structural guard: the extracted function body must not reference `this.`
    // (the whole point of injecting algoTemplate). Comments are allowed to mention it.
    const src = tryAlgorithmCodeGen.toString();
    expect(src.includes('this.')).toBe(false);
  });
});
