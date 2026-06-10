import { describe, expect, it, vi } from 'vitest';
import {
  expandQueryWithHistory,
  shouldAttemptWebConclusion,
  tryWebConcludeTurn,
} from './web-conclude-turn.js';

describe('web-conclude-turn', () => {
  it('detects substantive questions for web conclusion', () => {
    expect(shouldAttemptWebConclusion('what caused the 2008 financial crisis')).toBe(true);
    expect(shouldAttemptWebConclusion('hi')).toBe(false);
  });

  it('expands short follow-ups with prior user context', () => {
    const q = expandQueryWithHistory('ok but go deeper on that', [
      { role: 'user', content: 'tell me about photosynthesis in plants' },
      { role: 'assistant', content: 'Photosynthesis converts light to chemical energy.' },
      { role: 'user', content: 'ok but go deeper on that' },
    ]);
    expect(q.toLowerCase()).toContain('photosynthesis');
  });

  it('expands decorated conversational cues instead of searching filler words', () => {
    const q = expandQueryWithHistory('ok wait how so? idk if that makes sense', [
      { role: 'user', content: 'does spotify have podcasts' },
      { role: 'assistant', content: 'Spotify includes podcasts.' },
      { role: 'user', content: 'ok wait how so? idk if that makes sense' },
    ]);
    expect(q.toLowerCase()).toContain('spotify');
    expect(q.toLowerCase()).not.toContain('how so');
    expect(shouldAttemptWebConclusion(q)).toBe(true);
  });

  it('walks past terse formatting turns when expanding a later contextual cue', () => {
    const q = expandQueryWithHistory('how so?', [
      { role: 'user', content: 'electric vs hybrid cars for a daily commute' },
      { role: 'assistant', content: 'A hybrid is usually the simpler fit without home charging.' },
      { role: 'user', content: 'nah - only the name if there is one' },
      { role: 'assistant', content: 'Hybrid' },
      { role: 'user', content: 'how so?' },
    ]);
    expect(q.toLowerCase()).toContain('electric');
    expect(q.toLowerCase()).not.toContain('only the name');
  });

  it('returns synthesized text when search returns sources', async () => {
    const result = await tryWebConcludeTurn(
      'search the web for the capital of Norway',
      [],
      {
        testMode: false,
        searchBudgetMs: 5000,
        search: async () => ({
          answer: 'Oslo',
          confidence: 0.8,
          plan: {
            originalQuery: 'capital of Norway',
            intent: 'capital city',
            entities: ['Norway'],
            constraints: {},
            fanOutQueries: ['capital of Norway'],
          },
          rawResultCount: 1,
          durationMs: 10,
          sync: {
            state: 'linear',
            latencyMs: 10,
            recommendedConcurrency: 1,
            medianLatencyMs: 10,
            p95LatencyMs: 10,
            observations: 1,
          },
          sources: [{
            text: 'Oslo is the capital',
            url: 'https://example.com',
            title: 'Norway',
            domain: 'example.com',
            favicon: '',
            trust: { score: 0.9, tier: 'high', reason: 'test' },
            rank: 0,
          }],
          audit: [],
        }),
        synthesize: async () => 'The capital of Norway is **Oslo**.',
      },
    );
    expect(result?.text).toMatch(/Oslo/i);
    expect(result?.sources).toBe(1);
  });

  it('skips when testMode is on', async () => {
    const result = await tryWebConcludeTurn('what is docker', [], {
      testMode: true,
      searchBudgetMs: 1000,
      search: vi.fn(),
      synthesize: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it('skips web search when the system prompt requires learned browsing memory only', async () => {
    const search = vi.fn();
    const result = await tryWebConcludeTurn(
      'What invalidates cached data in the React server components notes?',
      [{ role: 'system', content: 'Answer using only your learned browsing memory.' }],
      {
        testMode: false,
        searchBudgetMs: 1000,
        search,
        synthesize: vi.fn(),
      },
    );

    expect(result).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it('gives stable how-to questions to local routes before attempting web search', async () => {
    const search = vi.fn();
    const result = await tryWebConcludeTurn(
      'How do I set up TypeScript in a new project?',
      [],
      {
        testMode: false,
        searchBudgetMs: 1000,
        search,
        synthesize: vi.fn(),
      },
    );

    expect(result).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it('gives contextual follow-ups to local routes before attempting web search', async () => {
    const search = vi.fn();
    const result = await tryWebConcludeTurn(
      'Can you show me an example?',
      [
        { role: 'user', content: 'What is Docker?' },
        { role: 'assistant', content: 'Docker packages applications into containers.' },
      ],
      {
        testMode: false,
        searchBudgetMs: 1000,
        search,
        synthesize: vi.fn(),
      },
    );

    expect(result).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it('does not search context-free rewrite fragments', async () => {
    const search = vi.fn();
    const result = await tryWebConcludeTurn(
      'Can you explain that more simply?',
      [],
      {
        testMode: false,
        searchBudgetMs: 1000,
        search,
        synthesize: vi.fn(),
      },
    );

    expect(result).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it('gives local architecture planning routes the first chance to answer', async () => {
    const search = vi.fn();
    const result = await tryWebConcludeTurn(
      'I am building a React app and want to deploy it with Docker. Can you help me plan the architecture and deployment pipeline?',
      [],
      {
        testMode: false,
        searchBudgetMs: 1000,
        search,
        synthesize: vi.fn(),
      },
    );

    expect(result).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it('still searches recency-sensitive how-to questions', async () => {
    const search = vi.fn(async () => ({
      answer: 'Use the current installer.',
      confidence: 0.8,
      plan: {
        originalQuery: 'How do I install the latest Node version?',
        intent: 'current installer',
        entities: ['Node'],
        constraints: {},
        fanOutQueries: ['latest Node version install'],
      },
      rawResultCount: 1,
      durationMs: 10,
      sync: {
        state: 'linear' as const,
        latencyMs: 10,
        recommendedConcurrency: 1,
        medianLatencyMs: 10,
        p95LatencyMs: 10,
        observations: 1,
      },
      sources: [{
        text: 'Download the latest Node installer.',
        url: 'https://nodejs.org',
        title: 'Node.js',
        domain: 'nodejs.org',
        favicon: '',
        trust: { score: 0.9, tier: 'high' as const, reason: 'test' },
        rank: 0,
      }],
      audit: [],
    }));
    const result = await tryWebConcludeTurn(
      'How do I install the latest Node version?',
      [],
      {
        testMode: false,
        searchBudgetMs: 1000,
        search,
        synthesize: async () => 'Use the current Node.js installer.',
      },
    );

    expect(result?.text).toContain('current Node.js installer');
    expect(search).toHaveBeenCalledOnce();
  });
});
