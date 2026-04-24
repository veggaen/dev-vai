import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '../search/types.js';
import { buildGroundedBuildBrief } from './grounded-build-brief.js';

function makeSearchResponse(overrides?: Partial<SearchResponse>): SearchResponse {
  return {
    answer: 'Grounded answer',
    sources: [
      {
        text: 'Source one',
        url: 'https://base44.com/docs',
        domain: 'base44.com',
        title: 'Base44 docs',
        favicon: '',
        trust: { tier: 'high', score: 0.92, reason: 'official docs' },
        rank: 1,
      },
      {
        text: 'Source two',
        url: 'https://perplexity.ai/product',
        domain: 'perplexity.ai',
        title: 'Perplexity product',
        favicon: '',
        trust: { tier: 'high', score: 0.88, reason: 'official product page' },
        rank: 2,
      },
    ],
    plan: {
      originalQuery: 'build a base44 and perplexity style product',
      intent: 'comparison',
      entities: ['base44', 'perplexity', 'product'],
      constraints: {},
      fanOutQueries: ['base44 product', 'perplexity product'],
    },
    rawResultCount: 8,
    confidence: 0.79,
    durationMs: 420,
    sync: {
      state: 'parallel',
      latencyMs: 420,
      recommendedConcurrency: 4,
      medianLatencyMs: 350,
      p95LatencyMs: 700,
      observations: 12,
    },
    audit: [],
    ...overrides,
  };
}

describe('buildGroundedBuildBrief', () => {
  it('creates a brief for build-oriented grounded prompts', () => {
    const brief = buildGroundedBuildBrief(
      'Build me a base44 style app builder mixed with perplexity style research',
      'builder',
      makeSearchResponse(),
    );

    expect(brief).not.toBeNull();
    expect(brief?.intent).toBe('build');
    expect(brief?.focusLabel).toContain('base44');
    expect(brief?.sourceDomains).toEqual(['base44.com', 'perplexity.ai']);
  });

  it('marks diff-style update requests as edit intent', () => {
    const brief = buildGroundedBuildBrief(
      'Improve the current dashboard search flow using the latest docs',
      'builder',
      makeSearchResponse({
        plan: {
          originalQuery: 'improve dashboard search flow',
          intent: 'how-to',
          entities: ['dashboard', 'search flow'],
          constraints: {},
          fanOutQueries: ['dashboard search flow docs'],
        },
      }),
    );

    expect(brief).not.toBeNull();
    expect(brief?.intent).toBe('edit');
    expect(brief?.nextStep).toContain('current sandbox');
  });

  it('treats current-project implementation prompts as build intent outside builder mode', () => {
    const brief = buildGroundedBuildBrief(
      'Use web search to compare Base44 and Perplexity, then tell me the best first product loop to implement in this current project.',
      'plan',
      makeSearchResponse({
        plan: {
          originalQuery: 'compare base44 and perplexity product loops for current project',
          intent: 'comparison',
          entities: ['base44', 'perplexity', 'product loops', 'current project'],
          constraints: {},
          fanOutQueries: ['base44 product loop', 'perplexity product loop'],
        },
      }),
    );

    expect(brief).not.toBeNull();
    expect(brief?.intent).toBe('build');
    expect(brief?.nextStep).toContain('execution turn');
  });

  it('cleans noisy comparison entities into stable focus labels', () => {
    const brief = buildGroundedBuildBrief(
      'Google compare Base44\'s strongest chat-to-build loop and Perplexity\'s strongest grounded research loop, then tell me the best first product loop to implement in this current VeggaAI project.',
      'plan',
      makeSearchResponse({
        plan: {
          originalQuery: 'compare base44 and perplexity product loops for current project',
          intent: 'comparison',
          entities: [
            'compare',
            "base44's strongest chat-to-build loop",
            "perplexity's strongest grounded research loop",
            'current project',
          ],
          constraints: {},
          fanOutQueries: ['base44 product loop', 'perplexity product loop'],
        },
      }),
    );

    expect(brief).not.toBeNull();
    expect(brief?.focusLabel).toBe('base44 + perplexity');
    expect(brief?.summary).toContain('base44 + perplexity');
  });

  it('skips non-build research questions in chat mode', () => {
    const brief = buildGroundedBuildBrief(
      'What is Next.js App Router?',
      'chat',
      makeSearchResponse({
        plan: {
          originalQuery: 'what is nextjs app router',
          intent: 'definition',
          entities: ['nextjs', 'app router'],
          constraints: {},
          fanOutQueries: ['nextjs app router'],
        },
      }),
    );

    expect(brief).toBeNull();
  });
});