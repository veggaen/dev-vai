/**
 * Unit tests for the trick-question detector.
 *
 * Each detector is verified in isolation, then the public dispatcher
 * `detectTrickQuestion()` is verified end-to-end against the famous
 * viral prompts.
 */
import { describe, expect, it } from 'vitest';
import {
  detectTrickQuestion,
  detectLetterCount,
  detectEqualWeight,
  detectSisterBrother,
  detectMaryDaughters,
  detectCrossingBridge,
} from '../src/trick-questions/index.js';

describe('detectLetterCount', () => {
  it('counts R in strawberry → 3', () => {
    const r = detectLetterCount("how many R's in strawberry?");
    expect(r).not.toBeNull();
    expect(r!.answer).toMatch(/3.*"R".*"strawberry"/i);
  });

  it('handles "how many S in Mississippi" → 4', () => {
    const r = detectLetterCount('how many letters s in Mississippi');
    expect(r).not.toBeNull();
    expect(r!.answer).toMatch(/\b4\b/);
  });

  it('correctly returns 1 M for Mississippi (not the popular wrong answer)', () => {
    const r = detectLetterCount('how many letters m in Mississippi');
    expect(r).not.toBeNull();
    expect(r!.answer).toMatch(/\b1\b/);
  });

  it('returns null for unrelated input', () => {
    expect(detectLetterCount('what is the capital of france')).toBeNull();
  });
});

describe('detectEqualWeight', () => {
  it('catches pound-of-feathers vs pound-of-bricks', () => {
    const r = detectEqualWeight('what weighs more, a pound of feathers or a pound of bricks?');
    expect(r).not.toBeNull();
    expect(r!.answer).toMatch(/(?:same|equal)/i);
  });

  it('catches kg of steel vs kg of feathers', () => {
    const r = detectEqualWeight('what is heavier, a kilogram of steel or a kilogram of feathers');
    expect(r).not.toBeNull();
    expect(r!.answer).toMatch(/(?:same|equal)/i);
  });

  it('returns null when units differ', () => {
    expect(detectEqualWeight('what weighs more, a pound of feathers or a kilogram of bricks')).toBeNull();
  });
});

describe('detectSisterBrother', () => {
  it('classic "Mary has 4 brothers and 1 sister, how many sisters does her brother have?" → 2', () => {
    // From a brother's view: Mary's siblings = 4 brothers + 1 sister + Mary herself.
    // Brother's sisters = 1 (the original sister) + 1 (Mary, female) = 2.
    const r = detectSisterBrother('Mary has 4 brothers and 1 sister. How many sisters does her brother have?');
    expect(r).not.toBeNull();
    expect(r!.answer.trim()).toMatch(/^2\.?$/);
  });

  it('returns null for unrelated input', () => {
    expect(detectSisterBrother('Tell me about hammers')).toBeNull();
  });
});

describe('detectMaryDaughters', () => {
  it("identifies Mary as the missing daughter", () => {
    const r = detectMaryDaughters(
      "Mary's father has 5 daughters: Nana, Nene, Nini, Nono, and ___. What is the name of the fifth daughter?",
    );
    expect(r).not.toBeNull();
    expect(r!.answer.toLowerCase()).toMatch(/mary/);
  });
});

describe('detectCrossingBridge', () => {
  it('flags goat/wolf/cabbage as a known riddle (signal only)', () => {
    const r = detectCrossingBridge('A farmer must cross a river with a wolf, a goat and a cabbage.');
    expect(r).not.toBeNull();
    expect(r!.confidence).toBeLessThan(0.85);
  });
});

describe('detectTrickQuestion (dispatcher)', () => {
  it('picks letter-count for strawberry', () => {
    const r = detectTrickQuestion("how many R's in strawberry");
    expect(r?.kind).toBe('letter-count');
  });

  it('picks equal-weight for feathers/bricks', () => {
    const r = detectTrickQuestion('what weighs more a pound of feathers or a pound of bricks?');
    expect(r?.kind).toBe('equal-weight');
  });

  it('returns null for empty input', () => {
    expect(detectTrickQuestion('')).toBeNull();
  });

  it('returns null for plain factual input', () => {
    expect(detectTrickQuestion('what is the capital of norway')).toBeNull();
  });
});
