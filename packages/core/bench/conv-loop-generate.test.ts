import { describe, expect, it } from 'vitest';
import {
  buildFollowUpMessage,
  hasSingleGroundedNumber,
  type ConvSeed,
} from './conv-loop-generate.js';

function seed(followUpPlan: string[]): ConvSeed {
  return {
    id: 'loop-test',
    category: 'facts',
    style: 'plain',
    topic: 'speed of light fact check',
    keywords: ['speed', 'light'],
    opener: 'verify: speed of light',
    followUpPlan,
  };
}

describe('conv-loop follow-up generation', () => {
  it('uses a number-only follow-up after one grounded numeric fact', () => {
    const message = buildFollowUpMessage(
      seed(['format-only', 'why']),
      1,
      'The speed of light in a vacuum is 299,792,458 meters per second.',
    );

    expect(message).toBe('what was the number again? only the number');
  });

  it('skips a number-only follow-up when the prior answer has no numeric fact', () => {
    const message = buildFollowUpMessage(
      seed(['format-only', 'why']),
      1,
      'ZORBAX refers to an Agilent chromatography column family.',
    );

    expect(message).toBe('why though?');
  });

  it('does not treat a numeric fallback message as grounded', () => {
    expect(hasSingleGroundedNumber("I couldn't find useful results after 4 queries.")).toBe(false);
  });

  it('skips number-only phrasing when the prior answer contains multiple numbers', () => {
    expect(hasSingleGroundedNumber('The estimates range from 250 to 400 miles.')).toBe(false);
  });
});
