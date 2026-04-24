import { describe, expect, it } from 'vitest';
import { isExplicitWebSearchRequest } from './explicit-web-search.js';

describe('isExplicitWebSearchRequest', () => {
  it('matches google-prefixed prompts', () => {
    expect(isExplicitWebSearchRequest('Google compare Base44 and Perplexity for this project')).toBe(true);
  });

  it('matches use web search prompts that also mention build intent', () => {
    expect(isExplicitWebSearchRequest('Use web search to compare Base44 and Perplexity, then tell me what to implement in this project')).toBe(true);
  });

  it('matches search and look-up phrasing', () => {
    expect(isExplicitWebSearchRequest('search the web for current Next.js App Router guidance')).toBe(true);
    expect(isExplicitWebSearchRequest('look up the latest Perplexity product docs')).toBe(true);
  });

  it('does not match plain planning prompts', () => {
    expect(isExplicitWebSearchRequest('Compare Base44 and Perplexity and tell me what to build')).toBe(false);
    expect(isExplicitWebSearchRequest('Plan the first product loop for VeggaAI')).toBe(false);
  });
});