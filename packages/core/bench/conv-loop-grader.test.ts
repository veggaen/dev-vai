import { describe, expect, it } from 'vitest';
import { gradeConvTurn, type ConvTurnRecord } from './conv-loop-grader.js';

function buildRecord(response: string): ConvTurnRecord {
  return {
    bench: 'conv-loop',
    convId: 'grader-test',
    turnIdx: 0,
    roundIdx: 0,
    category: 'tech',
    style: 'plain',
    ms: 20,
    prompt: 'help me choose API rate limiting for a side project',
    response,
    history: [
      { role: 'user', content: 'help me choose API rate limiting for a side project' },
      { role: 'assistant', content: response },
    ],
    sources: 1,
    strategy: 'web-search',
    error: null,
  };
}

describe('gradeConvTurn sourced answer quality', () => {
  it('rejects sourced promotional copy as a grounded pass', () => {
    const result = gradeConvTurn(buildRecord(
      'API monetization is self-serve. Start for free with the fastest path to production-ready APIs without the complexity.',
    ));

    expect(result.pass).toBe(false);
    expect(result.tags).toContain('sourced_promotional');
  });

  it('rejects a clipped connective fragment as a grounded pass', () => {
    const result = gradeConvTurn(buildRecord(
      'However, those attempts were hindered by API rate limiting for a side project. [1]',
    ));

    expect(result.pass).toBe(false);
    expect(result.tags).toContain('sourced_weak_lead');
  });

  it('rejects a clipped leading preposition fragment as a grounded pass', () => {
    const result = gradeConvTurn(buildRecord(
      'Of long-standing API rate limiting frustrations, including quota errors and retries. [1]',
    ));

    expect(result.pass).toBe(false);
    expect(result.tags).toContain('sourced_weak_lead');
  });

  it('rejects a sourced refusal as a grounded pass', () => {
    const result = gradeConvTurn(buildRecord(
      'I searched for "API rate limiting" but the sources did not contain a direct, useful answer. I am not going to present it as a conclusion.',
    ));

    expect(result.pass).toBe(false);
    expect(result.tags).toContain('sourced_insufficient_answer');
  });

  it('keeps a direct sourced answer eligible for a grounded pass', () => {
    const result = gradeConvTurn(buildRecord(
      'API rate limiting protects a side project by capping request volume per client and time window. [1]',
    ));

    expect(result.pass).toBe(true);
    expect(result.tags).toEqual(['ok', 'web_grounded']);
  });
});
