import { describe, expect, it } from 'vitest';
import type { SearchSnippet } from './types.js';
import {
  buildSearchPlan,
  filterRelevantSnippetsForQuery,
  scoreSnippetRelevanceForQuery,
} from './pipeline.js';

function snippet(title: string, text: string, domain = 'example.com', rank = 1): SearchSnippet {
  return {
    title,
    text,
    domain,
    url: `https://${domain}/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}`,
    favicon: '',
    trust: { tier: domain.includes('wikipedia') ? 'high' : 'medium', score: domain.includes('wikipedia') ? 0.9 : 0.6, reason: 'test' },
    rank,
  };
}

describe('buildSearchPlan normalization', () => {
  it('strips web-search study preambles and trailing build instructions', () => {
    const plan = buildSearchPlan(
      'Use web search to study Base44 and Perplexity, then build the first grounded slice of a hybrid product I can preview.',
    );

    const entities = plan.entities.map((entity) => entity.toLowerCase());
    const fanOut = plan.fanOutQueries.join(' ').toLowerCase();

    expect(entities).toContain('base44');
    expect(entities).toContain('perplexity');
    expect(entities).not.toContain('study');
    expect(fanOut).not.toContain('to study');
    expect(fanOut).not.toContain('grounded slice');
  });
});

describe('search relevance gate', () => {
  it('rejects same-entity snippets that do not match a population question shape', () => {
    const query = 'how many people live in Oslo?';
    const shooting = snippet(
      'Oslo shooting latest updates',
      'A shooting in central Oslo killed two people and injured several others, police said.',
      'bbc.com',
      2,
    );
    const population = snippet(
      'Oslo population',
      'Oslo municipality had a population of 717,710 residents in 2024, with more people in the urban area.',
      'en.wikipedia.org',
      1,
    );

    expect(scoreSnippetRelevanceForQuery(query, shooting).matched).toBe(false);
    expect(scoreSnippetRelevanceForQuery(query, population).matched).toBe(true);
    expect(filterRelevantSnippetsForQuery(query, [shooting, population])).toEqual([population]);
  });

  it('requires recommendation-shaped evidence for recommendation follow-ups', () => {
    const query = 'would you recommend using a VPN?';
    const genericForum = snippet(
      'Weekly r/VPN discussion thread',
      'This thread is for general VPN chat, provider memes, subreddit rules, and off-topic comments.',
      'reddit.com',
      2,
    );
    const usefulAdvice = snippet(
      'When a VPN is worth using',
      'A VPN can be useful on public Wi-Fi and for some privacy needs, but you have to trust the provider and weigh the trade-offs.',
      'consumerreports.org',
      1,
    );

    expect(scoreSnippetRelevanceForQuery(query, genericForum).matched).toBe(false);
    expect(scoreSnippetRelevanceForQuery(query, usefulAdvice).matched).toBe(true);
    expect(filterRelevantSnippetsForQuery(query, [genericForum, usefulAdvice])).toEqual([usefulAdvice]);
  });

  it('keeps direct definition snippets', () => {
    const query = 'what is SearXNG?';
    const definition = snippet(
      'SearXNG documentation',
      'SearXNG is a free internet metasearch engine that aggregates results from multiple search services.',
      'docs.searxng.org',
      1,
    );

    expect(scoreSnippetRelevanceForQuery(query, definition).matched).toBe(true);
    expect(filterRelevantSnippetsForQuery(query, [definition])).toEqual([definition]);
  });

  it('keeps comparison evidence when each source explains one side of the trade-off', () => {
    const query = 'What is SearXNG and why would I use it over DuckDuckGo Instant Answer API?';
    const searxng = snippet(
      'SearXNG',
      'SearXNG is a free and privacy-respecting metasearch engine that aggregates results from multiple search services.',
      'en.wikipedia.org',
      1,
    );
    const duckduckgo = snippet(
      'DuckDuckGo Instant Answer API',
      'DuckDuckGo Instant Answer API returns zero-click answers and related topics, but it is not a general metasearch engine.',
      'duckduckgo.com',
      1,
    );

    expect(scoreSnippetRelevanceForQuery(query, searxng).matched).toBe(true);
    expect(scoreSnippetRelevanceForQuery(query, duckduckgo).matched).toBe(true);
    expect(filterRelevantSnippetsForQuery(query, [searxng, duckduckgo])).toHaveLength(2);
  });
});
