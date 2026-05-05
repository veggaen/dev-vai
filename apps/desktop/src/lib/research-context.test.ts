import { describe, expect, it } from 'vitest';
import type { SearchSourceUI } from '../stores/chatStore.js';
import { resolveLatestResearchContext, summarizeResearchPrompt } from './research-context.js';

const demoSources: SearchSourceUI[] = [
  {
    url: 'https://example.com/article',
    title: 'Example Article',
    domain: 'example.com',
    snippet: 'Example snippet',
    favicon: 'https://example.com/favicon.ico',
    trustTier: 'high',
    trustScore: 0.92,
  },
];

describe('resolveLatestResearchContext', () => {
  it('returns context for the latest assistant answer when it has sources', () => {
    const result = resolveLatestResearchContext([
      { role: 'user', content: 'what is bun?', sources: undefined },
      { role: 'assistant', content: 'Bun is a runtime.', sources: demoSources, sourcePresentation: 'research' },
    ]);

    expect(result).toEqual({
      assistantIndex: 1,
      question: 'what is bun?',
      sources: demoSources,
    });
  });

  it('returns null when a newer user turn exists after the sourced answer', () => {
    const result = resolveLatestResearchContext([
      { role: 'user', content: 'say back to me hello', sources: undefined },
      { role: 'assistant', content: 'hello', sources: demoSources, sourcePresentation: 'research' },
      { role: 'user', content: 'what was the first word I wrote?', sources: undefined },
    ]);

    expect(result).toBeNull();
  });

  it('returns null when the latest assistant answer has no sources even if an older one did', () => {
    const result = resolveLatestResearchContext([
      { role: 'user', content: 'research answer', sources: undefined },
      { role: 'assistant', content: 'Here are sources.', sources: demoSources, sourcePresentation: 'research' },
      { role: 'user', content: 'say back to me hello', sources: undefined },
      { role: 'assistant', content: 'hello', sources: undefined },
    ]);

    expect(result).toBeNull();
  });

  it('returns null for supporting citations so the research rail stays reserved for research answers', () => {
    const result = resolveLatestResearchContext([
      { role: 'user', content: 'what is bun?', sources: undefined },
      { role: 'assistant', content: 'Bun is a runtime.', sources: demoSources, sourcePresentation: 'supporting' },
    ]);

    expect(result).toBeNull();
  });

  it('returns context when the assistant turn is explicitly classified as research even without source presentation metadata', () => {
    const result = resolveLatestResearchContext([
      { role: 'user', content: 'who is top master frontend web dev on github', sources: undefined },
      { role: 'assistant', content: 'Here is a grounded answer.', sources: demoSources, turnKind: 'research' },
    ]);

    expect(result).toEqual({
      assistantIndex: 1,
      question: 'who is top master frontend web dev on github',
      sources: demoSources,
    });
  });

  it('still returns null when supporting presentation is explicit even if the turn was classified as research', () => {
    const result = resolveLatestResearchContext([
      { role: 'user', content: 'who is top master frontend web dev on github', sources: undefined },
      { role: 'assistant', content: 'Here is a sourced answer.', sources: demoSources, sourcePresentation: 'supporting', turnKind: 'research' },
    ]);

    expect(result).toBeNull();
  });
});

describe('summarizeResearchPrompt', () => {
  it('trims and truncates long prompts cleanly', () => {
    const summary = summarizeResearchPrompt('   this is a very long prompt '.repeat(6));
    expect(summary.length).toBeLessThanOrEqual(72);
    expect(summary.endsWith('...')).toBe(true);
  });
});
