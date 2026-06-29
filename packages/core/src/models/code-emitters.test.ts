import { describe, it, expect } from 'vitest';
import * as emit from './code-emitters.js';
import { VaiEngine } from './vai-engine.js';

/**
 * Locks in the vai-engine.ts → code-emitters.ts extraction (Slice 4 of breaking up
 * the VaiEngine god-class). 21 pure (no this/super) code-snippet generators were moved
 * out verbatim; VaiEngine delegates via thin wrappers.
 *
 * Contract: the in-class wrapper and the free function return identical output for the
 * same args, across each method's signature shape.
 */

const LANGS = ['python', 'javascript', 'typescript', 'rust', 'go'];

// name -> arg vectors to exercise (each vector is one call)
const CASES: Record<string, unknown[][]> = {
  generateLinkedList: LANGS.map((l) => [l]),
  generateTodoList: LANGS.map((l) => [l]),
  generateCalculator: LANGS.map((l) => [l]),
  generateHttpServer: LANGS.map((l) => [l]),
  generateFizzBuzz: LANGS.map((l) => [l]),
  generateCounter: LANGS.map((l) => [l]),
  generateGuessingGame: LANGS.map((l) => [l]),
  generateHelloWorld: LANGS.map((l) => [l]),
  generateSumFunction: LANGS.map((l) => [l]),
  generateAdvancedCalculatorUI: [[]],
  generateStructCode: LANGS.map((l) => [l, 'User', 'a user struct']),
  generateInterfaceCode: LANGS.map((l) => [l, 'User', 'a user interface']),
  generateGenericFunction: LANGS.map((l) => [l, 'process the data', false]),
  generateCProgram: [['a hello program']],
  generateRestApi: LANGS.map((l) => ['an inventory api', l]),
  generateWebsite: [['a portfolio site']],
  generateChatApp: [['a chat app']],
  generateLoginPage: [['a login page']],
  generateBlog: [['a blog']],
  generateDashboard: [['a dark dashboard']],
  generateUtilitySnippet: LANGS.map((l) => ['debounce helper', l]),
};

describe('code-emitters extraction', () => {
  it('exports every extracted emitter', () => {
    for (const name of Object.keys(CASES)) {
      expect(typeof (emit as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('VaiEngine wrappers delegate to the free functions byte-for-byte', () => {
    const engine = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });
    const asAny = engine as unknown as Record<string, (...a: unknown[]) => unknown>;
    const free = emit as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const [name, vectors] of Object.entries(CASES)) {
      for (const args of vectors) {
        expect(asAny[name](...args), `${name}(${JSON.stringify(args)})`).toBe(free[name](...args));
      }
    }
  });
});
