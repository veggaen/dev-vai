/**
 * Unit tests for the CognitiveFoundationReasoner.
 *
 * The reasoner is purely deterministic — every test asserts the exact
 * classification or extraction we expect. If a test fails because we
 * broadened a regex, that broadening must be intentional and noted in
 * the commit.
 */
import { describe, expect, it } from 'vitest';
import {
  analyze,
  classifyQuestion,
  decomposeCompound,
  extractEntities,
} from '../src/cognitive/index.js';

describe('classifyQuestion', () => {
  it('detects conversational greetings', () => {
    expect(classifyQuestion('hi').kind).toBe('conversational');
    expect(classifyQuestion('thanks!').kind).toBe('conversational');
    expect(classifyQuestion('lol').kind).toBe('conversational');
  });

  it('detects meta self-questions', () => {
    expect(classifyQuestion('what model are you using?').kind).toBe('meta');
    expect(classifyQuestion('who built you?').kind).toBe('meta');
  });

  it('detects hypotheticals', () => {
    expect(classifyQuestion('what would happen if the sun went out?').kind).toBe('hypothetical');
    expect(classifyQuestion('imagine that gravity reversed').kind).toBe('hypothetical');
  });

  it('detects opinion prompts', () => {
    expect(classifyQuestion("what's your favorite framework?").kind).toBe('opinion');
    expect(classifyQuestion('do you think rust is better than go?').kind).toBe('opinion');
  });

  it('detects comparative prompts', () => {
    expect(classifyQuestion('react vs vue').kind).toBe('comparative');
    expect(classifyQuestion('what is the difference between TCP and UDP?').kind).toBe('comparative');
  });

  it('detects causal prompts', () => {
    expect(classifyQuestion('why does my docker build fail?').kind).toBe('causal');
    expect(classifyQuestion('what causes memory fragmentation?').kind).toBe('causal');
  });

  it('detects procedural prompts', () => {
    expect(classifyQuestion('how do I install node on windows?').kind).toBe('procedural');
    expect(classifyQuestion('walk me through setting up vitest').kind).toBe('procedural');
  });

  it('detects imperative prompts', () => {
    expect(classifyQuestion('build me a typescript function that sums an array').kind).toBe('imperative');
    expect(classifyQuestion('write a regex for email').kind).toBe('imperative');
  });

  it('detects definitional prompts', () => {
    expect(classifyQuestion('what is docker').kind).toBe('definitional');
    expect(classifyQuestion('define recursion').kind).toBe('definitional');
  });

  it('falls back to factual for generic questions', () => {
    expect(classifyQuestion('who wrote 1984?').kind).toBe('factual');
  });

  it('returns unknown for empty input', () => {
    expect(classifyQuestion('').kind).toBe('unknown');
    expect(classifyQuestion('').confidence).toBe(0);
  });
});

describe('decomposeCompound', () => {
  it('returns single-element array for simple input', () => {
    expect(decomposeCompound('what is docker?')).toEqual(['what is docker?']);
  });

  it('splits on multiple question marks', () => {
    const out = decomposeCompound('what is docker? how do I install it?');
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('what is docker?');
    expect(out[1]).toBe('how do I install it?');
  });

  it('splits on "and also"', () => {
    const out = decomposeCompound('explain promises and also tell me about async/await');
    expect(out).toHaveLength(2);
  });

  it('does not split on bare "and"', () => {
    expect(decomposeCompound('docker and kubernetes')).toEqual(['docker and kubernetes']);
  });

  it('returns empty array for empty input', () => {
    expect(decomposeCompound('')).toEqual([]);
  });
});

describe('extractEntities', () => {
  it('extracts quoted phrases', () => {
    expect(extractEntities('what is "the great gatsby" about?')).toContain('the great gatsby');
  });

  it('extracts backtick code identifiers', () => {
    expect(extractEntities('how do I use `useState` in react?')).toContain('useState');
  });

  it('extracts capitalized multi-word phrases mid-sentence', () => {
    expect(extractEntities('please tell me about Visual Studio Code')).toContain('Visual Studio Code');
  });

  it('falls back to significant lowercase tokens', () => {
    const out = extractEntities('docker compose configuration');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('analyze (full frame)', () => {
  it('produces a complete frame for a procedural prompt', () => {
    const f = analyze('How do I install node on Windows?');
    expect(f.kind).toBe('procedural');
    expect(f.kindConfidence).toBeGreaterThan(0.5);
    expect(f.isCompound).toBe(false);
    expect(f.subQuestions).toEqual(['How do I install node on Windows?']);
    expect(f.signals.endsWithQuestionMark).toBe(true);
    expect(f.tokenCount).toBe(7);
    expect(f.interrogative).toBe('how');
  });

  it('flags compound prompts', () => {
    const f = analyze('What is docker? How do I install it?');
    expect(f.isCompound).toBe(true);
    expect(f.subQuestions).toHaveLength(2);
  });

  it('detects format constraints', () => {
    const f = analyze('reply only with the answer in 3 words');
    expect(f.hasConstraints).toBe(true);
  });

  it('detects code fences', () => {
    const f = analyze('explain this:\n```js\nconst x = 1;\n```');
    expect(f.signals.hasCodeFence).toBe(true);
  });

  it('handles non-string defensively', () => {
    // @ts-expect-error — exercising the runtime guard
    const f = analyze(undefined);
    expect(f.kind).toBe('unknown');
    expect(f.subQuestions).toEqual([]);
  });
});
