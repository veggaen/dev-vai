import { describe, it, expect } from 'vitest';
import { handleConversational } from './conversational-handler.js';
import { VaiEngine } from './vai-engine.js';
import type { Message } from './adapter.js';

/**
 * Regression lock for decomposition phase 2, slice 3: `handleConversational` (1233-line body) was
 * moved out of the VaiEngine god-class, with its 13 real (AST-confirmed, read-only) deps injected as
 * a `deps` object. Contract: the in-class wrapper and the free function return IDENTICAL output.
 *
 * Note: `this.items` in the body is inside a knowledge-string TypeScript example (Stack<T>) — display
 * content, correctly NOT rewritten. Only the 13 genuine deps were.
 */

const PROBES: [string, Message[]][] = [
  ['hello', []], ['how are you', []], ['what can you do', []], ['thanks', []],
  ['tell me about yourself', []], ['what is a closure in javascript', []],
  ['explain recursion', []], ['what is big o notation', []], ['what is a hash table', []],
  ['my name is Vetle', []], ['I am a teacher', []],
  ['what do you know', []], ['what have you learned', []],
  ['make it shorter', [{ role: 'user', content: 'write a counter in js' }, { role: 'assistant', content: 'const c=0;' }] as Message[]],
  ['add a reset button', [{ role: 'user', content: 'write a counter' }, { role: 'assistant', content: 'let count=0;' }] as Message[]],
  ['what is the weather', []], ['random gibberish xyz', []],
];

describe('conversational-handler extraction', () => {
  it('exports the extracted handler', () => {
    expect(typeof handleConversational).toBe('function');
  });

  it('the VaiEngine wrapper and the free function return identical output byte-for-byte', () => {
    const engine = new VaiEngine({ testMode: true } as unknown as ConstructorParameters<typeof VaiEngine>[0]);
    const e = engine as unknown as Record<string, unknown> & {
      handleConversational: (input: string, history: readonly Message[]) => string | null;
    };
    // Bind the 13 deps from the same engine instance the wrapper uses.
    const call = (name: string) => (...a: unknown[]) => (e[name] as (...x: unknown[]) => unknown)(...a);
    const deps = {
      _activeMode: e._activeMode as string,
      _hasActiveSandboxContext: e._hasActiveSandboxContext as boolean,
      _rng: e._rng as () => number,
      knowledge: e.knowledge as never,
      tokenizer: e.tokenizer as never,
      cachedFindBestMatch: call('cachedFindBestMatch') as never,
      cachedRetrieveRelevant: call('cachedRetrieveRelevant') as never,
      getStats: call('getStats') as never,
      generateIterationCode: call('generateIterationCode') as never,
      isCredibleNameIntroduction: call('isCredibleNameIntroduction') as never,
      buildKnowledgeGapReport: call('buildKnowledgeGapReport') as never,
      tryCSFundamentals: call('tryCSFundamentals') as never,
      tryGeneralKnowledge: call('tryGeneralKnowledge') as never,
    };
    for (const [input, history] of PROBES) {
      const viaWrapper = e.handleConversational(input, history);
      const viaFree = handleConversational(input, history, deps);
      expect(viaFree, `free(${JSON.stringify(input)})`).toBe(viaWrapper);
    }
  });

  it('the extracted function has no REAL `this.` dependency (only the string-embedded Stack example)', () => {
    const src = handleConversational.toString();
    // None of the 13 real deps may appear as `this.<dep>` (they are all deps.* now).
    const realDep = /this\.(_activeMode|_hasActiveSandboxContext|_rng|knowledge|tokenizer|cachedFindBestMatch|cachedRetrieveRelevant|getStats|generateIterationCode|isCredibleNameIntroduction|buildKnowledgeGapReport|tryCSFundamentals|tryGeneralKnowledge)\b/;
    expect(realDep.test(src)).toBe(false);
  });
});
