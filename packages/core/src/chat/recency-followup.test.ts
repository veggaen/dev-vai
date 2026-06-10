import { describe, expect, it } from 'vitest';
import { tryRecencyFollowUp } from './recency-followup.js';

describe('tryRecencyFollowUp', () => {
  it('anchors to the prior substantive assistant answer', () => {
    const answer = tryRecencyFollowUp('lol anyway is that still accurate in 2026?', [
      { role: 'user', content: 'capital of Norway?' },
      { role: 'assistant', content: 'The capital of Norway is **Oslo**.' },
    ]);
    expect(answer).toMatch(/Oslo/i);
    expect(answer).toMatch(/2026/i);
  });
});
