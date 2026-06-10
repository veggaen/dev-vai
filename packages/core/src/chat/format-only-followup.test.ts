import { describe, expect, it } from 'vitest';
import { tryFormatOnlyFollowUp } from './format-only-followup.js';

describe('tryFormatOnlyFollowUp', () => {
  it('extracts a bold entity from the prior answer', () => {
    const answer = tryFormatOnlyFollowUp('nah — only the name if there is one', [
      { role: 'user', content: 'capital of Norway?' },
      { role: 'assistant', content: 'The capital of Norway is **Oslo**.' },
    ]);
    expect(answer).toBe('Oslo');
  });

  it('stays honest when the prior assistant was a capabilities fallback', () => {
    expect(tryFormatOnlyFollowUp('only the name', [
      { role: 'user', content: 'tell me about dota mmr' },
      { role: 'assistant', content: "I don't have a confident answer for that yet.\n\n**What I can do:**\n- Build projects" },
    ])).toMatch(/do not have a grounded name or number/i);
  });

  it('does not compress a searched-but-empty topic label as though it were an answer', () => {
    expect(tryFormatOnlyFollowUp('nah only the number', [
      { role: 'user', content: 'what is zorbax flux protocol' },
      { role: 'assistant', content: "Searched the open web for **zorbax flux protocol** and didn't get back anything solid I trust." },
    ])).toMatch(/do not have a grounded name or number/i);
  });

  it('does not mistake punctuation for a numeric answer', () => {
    expect(tryFormatOnlyFollowUp('only the number', [
      { role: 'user', content: 'explain the comparison' },
      { role: 'assistant', content: 'The trade-off is nuanced, and there is no single numeric answer.' },
    ])).toMatch(/no single grounded name or number/i);
  });

  it('keeps short prior facts available for format-only follow-ups', () => {
    expect(tryFormatOnlyFollowUp('nah only the number', [
      { role: 'user', content: 'what is 2 plus 2' },
      { role: 'assistant', content: '4' },
    ])).toBe('4');
  });

  it('uses a requested unit to select one grounded number from a multi-number answer', () => {
    expect(tryFormatOnlyFollowUp('the exact value in meters per second only the number', [
      { role: 'user', content: 'what is the speed of light in meters per second?' },
      {
        role: 'assistant',
        content: 'The speed of light is 299792458 metres per second, approximately 1079000000 km/h or 671000000 mph.',
      },
    ])).toBe('299792458');
  });

  it('can recover the sourced answer behind an earlier formatter refusal', () => {
    expect(tryFormatOnlyFollowUp('the exact value in meters per second only the number', [
      { role: 'user', content: 'what is the speed of light in meters per second?' },
      {
        role: 'assistant',
        content: 'The speed of light is 299792458 metres per second, approximately 1079000000 km/h or 671000000 mph.',
      },
      { role: 'user', content: 'what was the number again? only the number' },
      { role: 'assistant', content: 'There is no single grounded name or number in the prior answer to shorten.' },
    ])).toBe('299792458');
  });

  it('does not guess when an unqualified answer contains multiple numbers', () => {
    expect(tryFormatOnlyFollowUp('only the number', [
      { role: 'user', content: 'summarize the range' },
      { role: 'assistant', content: 'The estimates range from 250 to 400 miles.' },
    ])).toMatch(/no single grounded name or number/i);
  });

  it('keeps short yes-no answers available for answer-only follow-ups', () => {
    expect(tryFormatOnlyFollowUp('Repeat only the answer, no explanation.', [
      { role: 'user', content: 'is there sugar inside regular Coca-Cola?' },
      { role: 'assistant', content: 'Yes' },
    ])).toBe('Yes');
  });

  it('compresses a natural shorter-pls follow-up from the prior grounded answer', () => {
    const prior = [
      'Cross-checked across 1 source:',
      '',
      'Mortgage crisis of 2007-2008 that led to the 2008 financial crisis and the Great Recession of 2008-2009.',
      '',
      'Confidence: limited - I found one entity-relevant source.',
    ].join('\n');

    const answer = tryFormatOnlyFollowUp('shorter pls', [
      { role: 'user', content: 'what caused the 2008 financial crisis?' },
      { role: 'assistant', content: prior },
    ]);

    expect(answer).toBe('**Short version**\nMortgage crisis of 2007-2008 that led to the 2008 financial crisis and the Great Recession of 2008-2009.');
    expect(answer!.length).toBeLessThan(prior.length);
  });

  it('does not hijack an instruction that merely contains the word shorter', () => {
    expect(tryFormatOnlyFollowUp('use a shorter timeout in this code', [
      { role: 'user', content: 'the request is timing out' },
      { role: 'assistant', content: 'The current timeout is ten seconds.' },
    ])).toBeNull();
  });

  it('does not hijack a build request that merely has formatting constraints', () => {
    expect(tryFormatOnlyFollowUp('fix the Vite config and return a short implementation plan', [
      { role: 'user', content: 'the dev server is failing to launch' },
      { role: 'assistant', content: 'Use Vite 4.3.1 and inspect the package scripts first.' },
    ])).toBeNull();
  });

  it('does not reuse the prior answer when a terse constraint belongs to a new factual question', () => {
    expect(tryFormatOnlyFollowUp('and what currency code does Norway use? only the code this time', [
      { role: 'user', content: 'what is the capital of Norway?' },
      { role: 'assistant', content: 'Oslo' },
    ])).toBeNull();
  });

  it('does not treat system-only history as a prior answer on a first-turn constrained request', () => {
    expect(tryFormatOnlyFollowUp('i need 2 things, 23 plus 9 minus 1, and the capital city of Denmark. answer only with the result and the city', [
      { role: 'system', content: 'You are a chat assistant.' },
      { role: 'user', content: 'i need 2 things, 23 plus 9 minus 1, and the capital city of Denmark. answer only with the result and the city' },
    ])).toBeNull();
  });
});
