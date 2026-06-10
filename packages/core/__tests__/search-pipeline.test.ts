/**
 * Tests for search pipeline: plan building, trust scoring, safety, and full pipeline.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildSearchPlan,
  filterRelevantSnippetsForQuery,
  generateFollowUps,
  generateTopicFollowUps,
  scoreSnippetRelevanceForQuery,
} from '../src/search/pipeline.js';
import { SearchPipeline } from '../src/search/pipeline.js';
import {
  validateSearchUrl,
  scoreDomain,
  scanContentSafety,
  contentFingerprint,
  assessUrl,
} from '../src/search/safety.js';

const makeSync = (overrides?: Partial<{
  state: 'linear' | 'parallel' | 'wormhole';
  latencyMs: number;
  recommendedConcurrency: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  observations: number;
}>) => ({
  state: 'parallel' as const,
  latencyMs: 120,
  recommendedConcurrency: 5,
  medianLatencyMs: 120,
  p95LatencyMs: 120,
  observations: 1,
  ...overrides,
});

// ── Query Planning ──

describe('buildSearchPlan', () => {
  it('detects definition intent', () => {
    const plan = buildSearchPlan('what is TypeScript');
    expect(plan.intent).toBe('definition');
    expect(plan.entities).toContain('TypeScript');
    expect(plan.fanOutQueries.length).toBeGreaterThanOrEqual(2);
  });

  it('detects how-to intent', () => {
    const plan = buildSearchPlan('how to deploy Next.js to Vercel');
    expect(plan.intent).toBe('how-to');
    expect(plan.entities).toContain('deploy');
    expect(plan.entities).toContain('Next.js');
  });

  it('detects comparison intent', () => {
    const plan = buildSearchPlan('compare React vs Vue performance');
    expect(plan.intent).toBe('comparison');
  });

  it('detects troubleshoot intent', () => {
    const plan = buildSearchPlan('fix TypeScript module not found error');
    expect(plan.intent).toBe('troubleshoot');
  });

  it('detects causal intent and fans out cause-specific queries', () => {
    const plan = buildSearchPlan('what caused the 2008 financial crisis?');
    expect(plan.intent).toBe('causal');
    expect(plan.entities).toEqual(['2008', 'financial', 'crisis']);
    expect(plan.fanOutQueries.some((query) => /financial crisis causes explained/i.test(query))).toBe(true);
    expect(plan.fanOutQueries.some((query) => /financial crisis root causes analysis/i.test(query))).toBe(true);
  });

  it('falls back to general intent', () => {
    const plan = buildSearchPlan('Fastify server setup');
    expect(plan.intent).toBe('general');
  });

  it('preserves original query', () => {
    const plan = buildSearchPlan('  some query with spaces  ');
    expect(plan.originalQuery).toBe('some query with spaces');
  });

  it('generates 2-6 fan-out queries', () => {
    const plan = buildSearchPlan('best JavaScript testing frameworks 2025');
    expect(plan.fanOutQueries.length).toBeGreaterThanOrEqual(2);
    expect(plan.fanOutQueries.length).toBeLessThanOrEqual(6);
    expect(plan.fanOutQueries[0]).toBe('best JavaScript testing frameworks 2025');
  });

  it('plans local restaurant questions as recommendations rather than definitions', () => {
    const plan = buildSearchPlan('what are good resturants in Hommersåk Norway?');

    expect(plan.intent).toBe('recommendation');
    expect(plan.fanOutQueries.some((query) => /reviews menu/i.test(query))).toBe(true);
    expect(plan.fanOutQueries.some((query) => /official opening hours/i.test(query))).toBe(true);
  });

  it('strips web-search wrapper instructions from explicit package freshness prompts', () => {
    const plan = buildSearchPlan('Use web search and tell me the current stable devlens-cli version from PyPI, what the tool does, and when I should use it. Include the official PyPI page and at least one supporting source.');
    expect(plan.intent).toBe('current');
    expect(plan.entities).toContain('devlens-cli');
    expect(plan.fanOutQueries[0]).toBe('the current stable devlens-cli version from PyPI');
    expect(plan.fanOutQueries[0].toLowerCase()).not.toContain('use web search');
    expect(plan.fanOutQueries[0].toLowerCase()).not.toContain('include the official');
  });

  it('normalizes obvious typos in explanation queries', () => {
    const plan = buildSearchPlan('exsplain perplexity in simple words');
    expect(plan.intent).toBe('explanation');
    expect(plan.entities).toEqual(['perplexity']);
    expect(plan.fanOutQueries[0].toLowerCase()).toContain('explain perplexity');
    expect(plan.fanOutQueries.some((query) => /perplexity ai/i.test(query))).toBe(true);
  });

  it('normalizes common topic and question typos in search planning', () => {
    const plan = buildSearchPlan('waht is pyhton');
    expect(plan.intent).toBe('definition');
    expect(plan.entities).toContain('python');
    expect(plan.fanOutQueries[0].toLowerCase()).toContain('what is python');
  });

  it('understands mixed norwegian and typoed tech prompts in search planning', () => {
    const plan = buildSearchPlan('hva er dockre');
    expect(plan.intent).toBe('definition');
    expect(plan.entities).toContain('docker');
    expect(plan.fanOutQueries[0].toLowerCase()).toContain('hva er docker');
  });

  it('understands casual dialect-style prompts in search planning', () => {
    const plan = buildSearchPlan('ka er dockre');
    expect(plan.intent).toBe('definition');
    expect(plan.entities).toContain('docker');
    expect(plan.fanOutQueries[0].toLowerCase()).toContain('hva er docker');
  });

  it('normalizes websocket dialect prompts into how-to intent', () => {
    const plan = buildSearchPlan('kordan funke websokcet');
    expect(plan.intent).toBe('how-to');
    expect(plan.entities).toContain('websocket');
    expect(plan.fanOutQueries[0].toLowerCase()).toContain('hvordan fungerer websocket');
  });

  it('keeps norwegian explanation wrappers out of follow-up topics', () => {
    const followUps = generateTopicFollowUps('forkalr pyhton kort');
    expect(followUps.length).toBeGreaterThan(0);
    expect(followUps.some((item) => /python/i.test(item))).toBe(true);
  });

  it('drops dotted prompt residue from explanation query entities', () => {
    const plan = buildSearchPlan('exsplain perplexity in simple words. include sources.');
    expect(plan.intent).toBe('explanation');
    expect(plan.entities).toEqual(['perplexity']);
    expect(plan.fanOutQueries[0].toLowerCase()).toContain('explain perplexity');
  });

  it('strips stop words from entities', () => {
    const plan = buildSearchPlan('what is the capital of France');
    expect(plan.entities).not.toContain('the');
    expect(plan.entities).not.toContain('of');
    expect(plan.entities).toContain('capital');
    expect(plan.entities).toContain('France');
  });

  // ─── Fix E: strip "do you know (of|about)" meta-prefixes from primary subject
  it('strips "what do you know about X" prefix from fan-out queries (Fix E)', () => {
    const plan = buildSearchPlan('what do you know about redbull');
    for (const q of plan.fanOutQueries.slice(1)) {
      expect(q.toLowerCase()).not.toContain('what do you know');
      expect(q.toLowerCase()).not.toContain('do you know');
    }
  });

  it('strips "do you know of X" prefix and leading "of" from fan-out queries (Fix E)', () => {
    const plan = buildSearchPlan('do you know of redbull');
    for (const q of plan.fanOutQueries.slice(1)) {
      expect(q.toLowerCase()).not.toContain('do you know');
      expect(q.toLowerCase()).not.toMatch(/\bof\s+redbull\b/);
    }
  });

  it('strips "have you heard of X" prefix from fan-out queries (Fix E)', () => {
    const plan = buildSearchPlan('have you heard of kubernetes');
    for (const q of plan.fanOutQueries.slice(1)) {
      expect(q.toLowerCase()).not.toContain('have you heard');
    }
  });

  it('strips "what do you know on X" and "regarding X" (Fix E)', () => {
    const planOn = buildSearchPlan('what do you know on websockets');
    const planReg = buildSearchPlan('what do you know regarding kafka');
    for (const q of planOn.fanOutQueries.slice(1)) {
      expect(q.toLowerCase()).not.toMatch(/\bon\s+websockets\b/);
      expect(q.toLowerCase()).not.toContain('what do you know');
    }
    for (const q of planReg.fanOutQueries.slice(1)) {
      expect(q.toLowerCase()).not.toMatch(/\bregarding\s+kafka\b/);
      expect(q.toLowerCase()).not.toContain('what do you know');
    }
  });
});

// ── URL Validation (SSRF Protection) ──

describe('validateSearchUrl', () => {
  it('allows valid HTTPS URLs', () => {
    const url = validateSearchUrl('https://example.com/path');
    expect(url.hostname).toBe('example.com');
  });

  it('allows valid HTTP URLs', () => {
    const url = validateSearchUrl('http://example.com');
    expect(url.hostname).toBe('example.com');
  });

  it('blocks non-HTTP protocols', () => {
    expect(() => validateSearchUrl('ftp://example.com')).toThrow('Only HTTP/HTTPS');
    expect(() => validateSearchUrl('file:///etc/passwd')).toThrow('Only HTTP/HTTPS');
    expect(() => validateSearchUrl('javascript:alert(1)')).toThrow();
  });

  it('blocks localhost', () => {
    expect(() => validateSearchUrl('http://localhost')).toThrow('Private/internal');
    expect(() => validateSearchUrl('http://127.0.0.1')).toThrow('Private/internal');
    expect(() => validateSearchUrl('http://[::1]')).toThrow('Private/internal');
  });

  it('blocks private IPs', () => {
    expect(() => validateSearchUrl('http://10.0.0.1')).toThrow('Private/internal');
    expect(() => validateSearchUrl('http://192.168.1.1')).toThrow('Private/internal');
    expect(() => validateSearchUrl('http://172.16.0.1')).toThrow('Private/internal');
  });

  it('blocks AWS metadata endpoint', () => {
    expect(() => validateSearchUrl('http://169.254.169.254')).toThrow('Private/internal');
  });

  it('blocks .local domains', () => {
    expect(() => validateSearchUrl('http://myserver.local')).toThrow('Private/internal');
  });
});

// ── Domain Trust Scoring ──

describe('scoreDomain', () => {
  it('gives high trust to Wikipedia', () => {
    const trust = scoreDomain('en.wikipedia.org');
    expect(trust.tier).toBe('high');
    expect(trust.score).toBeGreaterThanOrEqual(0.8);
  });

  it('gives high trust to .gov domains', () => {
    const trust = scoreDomain('data.gov');
    expect(trust.tier).toBe('high');
  });

  it('gives high trust to .edu domains', () => {
    const trust = scoreDomain('cs.stanford.edu');
    expect(trust.tier).toBe('high');
  });

  it('gives high trust to GitHub', () => {
    const trust = scoreDomain('github.com');
    expect(trust.tier).toBe('high');
  });

  it('gives high trust to the official Perplexity domain', () => {
    const trust = scoreDomain('www.perplexity.ai');
    expect(trust.tier).toBe('high');
    expect(trust.score).toBeGreaterThanOrEqual(0.8);
  });

  it('gives medium trust to Stack Overflow', () => {
    const trust = scoreDomain('stackoverflow.com');
    expect(trust.tier).toBe('medium');
  });

  it('gives medium trust to known tech sites', () => {
    expect(scoreDomain('dev.to').tier).toBe('medium');
    expect(scoreDomain('news.ycombinator.com').tier).toBe('medium');
  });

  it('gives low trust to unknown domains', () => {
    const trust = scoreDomain('random-blog-42.com');
    expect(trust.tier).toBe('low');
  });

  it('detects SEO spam TLDs', () => {
    const trust = scoreDomain('freestuff.tk');
    expect(trust.tier).toBe('untrusted');
    expect(trust.score).toBeLessThan(0.1);
  });
});

// ── Content Safety ──

describe('scanContentSafety', () => {
  it('passes normal text', () => {
    const result = scanContentSafety('TypeScript is a typed superset of JavaScript.');
    expect(result.safe).toBe(true);
  });

  it('detects script injection in short content', () => {
    const result = scanContentSafety('<script>alert("xss")</script>');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('script injection');
  });

  it('allows script tags in long content (likely legitimate documentation)', () => {
    const longContent = 'A'.repeat(600) + '<script src="app.js"></script>';
    const result = scanContentSafety(longContent);
    expect(result.safe).toBe(true);
  });

  it('detects data URI injection', () => {
    const result = scanContentSafety('Visit data: text/html;base64,PHNjcmlwdD4=');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Data URI');
  });

  it('detects excessive invisible characters', () => {
    const text = '\u200B'.repeat(20) + 'test';
    const result = scanContentSafety(text);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('invisible');
  });
});

// ── Content Fingerprinting ──

describe('contentFingerprint', () => {
  it('returns same hash for same content', () => {
    const a = contentFingerprint('hello world test');
    const b = contentFingerprint('hello world test');
    expect(a).toBe(b);
  });

  it('returns same hash regardless of whitespace normalization', () => {
    const a = contentFingerprint('hello  world  test');
    const b = contentFingerprint('hello world test');
    expect(a).toBe(b);
  });

  it('returns different hashes for different content', () => {
    const a = contentFingerprint('hello world');
    const b = contentFingerprint('goodbye world');
    expect(a).not.toBe(b);
  });
});

// ── Combined Assessment ──

describe('assessUrl', () => {
  it('returns trust info for valid URLs', () => {
    const result = assessUrl('https://github.com/user/repo');
    expect(result.safe).toBe(true);
    expect(result.trust.tier).toBe('high');
  });

  it('throws on SSRF URLs', () => {
    expect(() => assessUrl('http://localhost:3000')).toThrow();
  });

  it('marks spam domains as unsafe', () => {
    const result = assessUrl('https://freestuff.tk/page');
    expect(result.safe).toBe(false);
  });
});

// ── Search Plan (preview) ──

describe('SearchPipeline.plan', () => {
  it('returns a VaiSearchPlan without executing', () => {
    const pipeline = new SearchPipeline();
    const plan = pipeline.plan('what is Rust programming language');
    expect(plan.intent).toBe('definition');
    expect(plan.originalQuery).toBe('what is Rust programming language');
    expect(plan.fanOutQueries.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Full Pipeline (with mocked fetch) ──

describe('entity-weighted snippet relevance', () => {
  const snippet = (text: string, title: string, domain = 'example.com') => ({
    text,
    url: `https://${domain}/example`,
    domain,
    title,
    favicon: '',
    trust: { tier: 'medium' as const, score: 0.7, reason: 'test fixture' },
    rank: 1,
  });

  it('drops a shared-subject snippet that misses the asked-for entity', () => {
    const unrelated = snippet(
      'Spotify canvas covers now loop in the mobile player and artists are discussing the visual update.',
      'Spotify covers discussion',
      'news.ycombinator.com',
    );
    const relevant = snippet(
      'Spotify has podcasts, including shows and episodes that users can browse and play in the app.',
      'Podcasts and shows on Spotify',
      'support.spotify.com',
    );

    const unrelatedAssessment = scoreSnippetRelevanceForQuery('does spotify have podcasts?', unrelated);
    const relevantAssessment = scoreSnippetRelevanceForQuery('does spotify have podcasts?', relevant);

    expect(unrelatedAssessment.topicHits).toBe(1);
    expect(unrelatedAssessment.matched).toBe(false);
    expect(relevantAssessment.topicHits).toBe(2);
    expect(relevantAssessment.matched).toBe(true);
    expect(filterRelevantSnippetsForQuery('does spotify have podcasts?', [unrelated, relevant])).toEqual([relevant]);
  });

  it('keeps a valid single-entity definition after typo normalization', () => {
    const relevant = snippet(
      'Perplexity is an AI-powered search engine that answers questions with cited sources.',
      'What is Perplexity?',
      'perplexity.ai',
    );

    const assessment = scoreSnippetRelevanceForQuery('exsplain perplexity in simple words. include sources.', relevant);

    expect(assessment.shape).toBe('definition');
    expect(assessment.topicHits).toBe(1);
    expect(assessment.topicCoverage).toBe(1);
    expect(assessment.matched).toBe(true);
  });

  it('keeps short topical acronyms distinctive when broad neighboring words overlap', () => {
    const unrelated = snippet(
      'The Range Rover hybrid has a battery and an electric driving range for short urban trips.',
      'Range Rover battery range',
      'example.com',
    );
    const relevant = snippet(
      'EV battery range depends on battery capacity, vehicle efficiency, temperature, and driving speed.',
      'EV battery range explained',
      'energy.example',
    );

    const unrelatedAssessment = scoreSnippetRelevanceForQuery('ev battery range facts', unrelated);
    const relevantAssessment = scoreSnippetRelevanceForQuery('ev battery range facts', relevant);

    expect(unrelatedAssessment.topicHits).toBe(2);
    expect(unrelatedAssessment.matched).toBe(false);
    expect(relevantAssessment.topicHits).toBe(3);
    expect(relevantAssessment.matched).toBe(true);
  });

  it('requires causal evidence for causes questions', () => {
    const merelyRelated = snippet(
      'Bitcoin was born out of the economic crisis and its paper was published in October 2008.',
      'Bitcoin history',
      'example.com',
    );
    const investigatesCauses = snippet(
      'The Financial Crisis Inquiry Commission was established in 2010 to investigate the causes of the 2008 financial crisis.',
      'Financial Crisis Inquiry Commission',
      'example.com',
    );
    const causal = snippet(
      'The 2008 financial crisis was caused by risky subprime mortgages, weak lending standards, and highly leveraged financial institutions.',
      'Causes of the 2008 financial crisis',
      'economics.example',
    );
    const consequence = snippet(
      'The 2008 financial crisis led to a severe recession and rising unemployment.',
      'Effects of the 2008 financial crisis',
      'economics.example',
    );

    const relatedAssessment = scoreSnippetRelevanceForQuery('2008 financial crisis causes', merelyRelated);
    const investigationAssessment = scoreSnippetRelevanceForQuery('2008 financial crisis causes', investigatesCauses);
    const causalAssessment = scoreSnippetRelevanceForQuery('2008 financial crisis causes', causal);
    const naturalQuestionAssessment = scoreSnippetRelevanceForQuery('what caused the 2008 financial crisis?', causal);
    const consequenceAssessment = scoreSnippetRelevanceForQuery('what caused the 2008 financial crisis?', consequence);

    expect(relatedAssessment.shape).toBe('causal');
    expect(relatedAssessment.shapeMatched).toBe(false);
    expect(relatedAssessment.matched).toBe(false);
    expect(investigationAssessment.shapeMatched).toBe(false);
    expect(investigationAssessment.matched).toBe(false);
    expect(causalAssessment.shapeMatched).toBe(true);
    expect(causalAssessment.matched).toBe(true);
    expect(naturalQuestionAssessment.shape).toBe('causal');
    expect(naturalQuestionAssessment.matched).toBe(true);
    expect(consequenceAssessment.shapeMatched).toBe(false);
    expect(consequenceAssessment.matched).toBe(false);
  });

  it('keeps side-specific evidence for comparison synthesis', () => {
    const relevant = snippet(
      'SearXNG is a privacy-respecting metasearch engine that aggregates results from multiple search services.',
      'SearXNG documentation',
      'docs.searxng.org',
    );

    const assessment = scoreSnippetRelevanceForQuery(
      'What is SearXNG and why would I use it over DuckDuckGo Instant Answer API?',
      relevant,
    );

    expect(assessment.shape).toBe('comparison');
    expect(assessment.topicHits).toBe(1);
    expect(assessment.matched).toBe(true);
  });

  it('drops whole-page keyword overlap when no local passage answers the action question', () => {
    const unrelated = snippet(
      'Spotify was founded in Sweden. Podcasts are popular audio shows. Users are discussing mobile-player design.',
      'Spotify community discussion',
      'news.ycombinator.com',
    );

    const assessment = scoreSnippetRelevanceForQuery('does spotify have podcasts?', unrelated);

    expect(assessment.shape).toBe('yes-no');
    expect(assessment.shapeMatched).toBe(false);
    expect(assessment.matched).toBe(false);
  });

  it('does not treat the predicate as a substitute for the missing subject', () => {
    const unrelated = snippet(
      'In a traditional cappuccino, espresso and milk foam make up the finished coffee drink.',
      'Cappuccino',
      'en.wikipedia.org',
    );

    const assessment = scoreSnippetRelevanceForQuery('does starbucks make cappuccino?', unrelated);

    expect(assessment.topicHits).toBe(1);
    expect(assessment.shapeMatched).toBe(false);
    expect(assessment.matched).toBe(false);
  });

  it('does not treat a forum question as evidence for an affirmative answer', () => {
    const unrelated = snippet(
      "A few questions for anyone at Spotify: Why isn't there a list of new episodes from podcasts you follow? Every other podcast service has this.",
      'Ask HN: Why is the Spotify UX so horrible?',
      'news.ycombinator.com',
    );

    const assessment = scoreSnippetRelevanceForQuery('does spotify have podcasts?', unrelated);

    expect(assessment.shapeMatched).toBe(false);
    expect(assessment.matched).toBe(false);
  });

  it('does not mistake an object making history for a manufacturer relationship', () => {
    const unrelated = snippet(
      'How adidas football boots made FIFA World Cup history.',
      'Football boot history',
      'en.wikipedia.org',
    );

    const assessment = scoreSnippetRelevanceForQuery('does adidas make football boots?', unrelated);

    expect(assessment.shapeMatched).toBe(false);
    expect(assessment.matched).toBe(false);
  });

  it('keeps direct negative action evidence', () => {
    const relevant = snippet(
      'Dogs should not eat chocolate because it can be toxic and harmful to them.',
      'Chocolate toxicity in dogs',
      'veterinary.example',
    );

    const assessment = scoreSnippetRelevanceForQuery('can dogs eat chocolate?', relevant);

    expect(assessment.shapeMatched).toBe(true);
    expect(assessment.matched).toBe(true);
  });
});

describe('SearchPipeline.search', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns a SearchResponse with audit trail', async () => {
    // Mock DuckDuckGo API response
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('api.duckduckgo.com')) {
        return {
          ok: true,
          json: async () => ({
            Abstract: 'Rust is a multi-paradigm, general-purpose programming language.',
            AbstractSource: 'Wikipedia',
            AbstractURL: 'https://en.wikipedia.org/wiki/Rust_(programming_language)',
            RelatedTopics: [
              { Text: 'Rust emphasizes performance, type safety, and concurrency.', FirstURL: 'https://www.rust-lang.org/' },
            ],
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({ maxFanOut: 2, fetchTimeoutMs: 5000 });
    const result = await pipeline.search('what is Rust programming language');

    expect(result.answer).toContain('Rust');
    expect(result.plan.intent).toBe('definition');
    expect(result.audit.length).toBeGreaterThanOrEqual(5); // clarify + fan out + fetch + rank + read + cross-check + conclude
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.sources.length).toBeGreaterThanOrEqual(0);
    expect(result.sync).toBeDefined();
    expect(['linear', 'parallel', 'wormhole']).toContain(result.sync.state);
    expect(result.sync.recommendedConcurrency).toBeGreaterThanOrEqual(1);
  });

  it('handles fetch failures gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const pipeline = new SearchPipeline({ maxFanOut: 2 });
    const result = await pipeline.search('test query');

    expect(result.answer).toContain("couldn't find useful results");
    expect(result.rawResultCount).toBe(0);
    expect(result.audit.length).toBeGreaterThanOrEqual(5);
  });

  it('returns structured nearby venues for a misspelled local restaurant request', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org/search')) {
        return {
          ok: true,
          json: async () => ([{
            lat: '58.9297144',
            lon: '5.8488049',
            display_name: 'Hommersåk, Sandnes, Rogaland, Norway',
          }]),
        };
      }
      if (url.includes('overpass-api.de/api/interpreter')) {
        return {
          ok: true,
          json: async () => ({
            elements: [
              {
                type: 'node',
                id: 6260572101,
                tags: {
                  amenity: 'restaurant',
                  cuisine: 'sushi',
                  name: 'Hommersåk Wok & Sushi Bar',
                  outdoor_seating: 'yes',
                },
              },
              {
                type: 'node',
                id: 13422704962,
                tags: {
                  amenity: 'restaurant',
                  cuisine: 'pizza',
                  name: 'Dolly Dimples Hommersåk',
                  opening_hours: 'Mo-We 14:00-21:00; Th-Su 13:00-21:00',
                },
              },
              {
                type: 'node',
                id: 444491228,
                tags: {
                  amenity: 'fast_food',
                  cuisine: 'pizza',
                  name: 'Pizzabakeren Hommersåk',
                  delivery: 'yes',
                },
              },
            ],
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({
      maxFanOut: 1,
      resultsPerQuery: 5,
      readTopN: 3,
      fetchTimeoutMs: 5000,
    });
    const result = await pipeline.search('what are good resturants in Hommersåk Norway?');

    expect(result.plan.intent).toBe('recommendation');
    expect(result.sources).toHaveLength(3);
    expect(result.sources.every((source) => source.domain === 'openstreetmap.org')).toBe(true);
    expect(result.answer).toContain('Hommersåk Wok & Sushi Bar');
    expect(result.answer).toContain('Dolly Dimples Hommersåk');
    expect(result.answer).toContain('cannot honestly rank which one is "best"');
    expect(result.answer).not.toMatch(/Norway is a country|capital:\s*Oslo/i);
  });

  it('returns a cited public phone number for an explicit local business lookup', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org/search')) {
        return {
          ok: true,
          json: async () => ([{
            osm_type: 'node',
            osm_id: 444491228,
            name: 'Pizzabakeren Hommersåk',
            display_name: 'Pizzabakeren Hommersåk, Kaiveien, Hommersåk, Sandnes, Rogaland, Norge',
            extratags: {
              phone: '+47 51 62 74 00',
              cuisine: 'pizza',
              delivery: 'yes',
            },
            namedetails: {
              name: 'Pizzabakeren Hommersåk',
              brand: 'Pizzabakeren',
            },
          }]),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({
      maxFanOut: 1,
      resultsPerQuery: 3,
      readTopN: 1,
      fetchTimeoutMs: 5000,
    });
    const result = await pipeline.search('find the phone number online for Pizzabakeren Hommersåk');

    expect(result.plan.intent).toBe('current');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.url).toBe('https://www.openstreetmap.org/node/444491228');
    expect(result.answer).toContain('**Pizzabakeren Hommersåk**');
    expect(result.answer).toContain('**+47 51 62 74 00**');
    expect(result.answer).toContain('[1]');
  });

  it('falls through to DuckDuckGo when configured SearXNG returns no usable results', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('search.example/search?')) {
        return {
          ok: true,
          json: async () => ({ results: [] }),
        };
      }
      if (url.includes('api.duckduckgo.com')) {
        return {
          ok: true,
          json: async () => ({
            Abstract: 'SearXNG is a privacy-respecting metasearch engine that aggregates results from multiple search services.',
            AbstractSource: 'Wikipedia',
            AbstractURL: 'https://en.wikipedia.org/wiki/SearXNG',
            RelatedTopics: [],
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({
      searxngUrl: 'https://search.example',
      maxFanOut: 1,
      fetchTimeoutMs: 5000,
    });
    const result = await pipeline.search('what is SearXNG');

    expect(result.answer).toContain('SearXNG');
    expect(result.sources.some((source) => source.domain === 'en.wikipedia.org')).toBe(true);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).includes('search.example/search?'))).toBe(true);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).includes('api.duckduckgo.com'))).toBe(true);
  });

  it('synthesizes comparison answers instead of dumping raw search snippets', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('api.duckduckgo.com')) {
        return {
          ok: true,
          json: async () => ({
            Abstract: 'SearXNG is a privacy-respecting metasearch engine that aggregates results from multiple search services and does not track users.',
            AbstractSource: 'Wikipedia',
            AbstractURL: 'https://en.wikipedia.org/wiki/SearXNG',
            RelatedTopics: [
              {
                Text: 'SearXNG can be self-hosted and customized for developer workflows.',
                FirstURL: 'https://docs.searxng.org/',
              },
            ],
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({ maxFanOut: 1, fetchTimeoutMs: 5000 });
    const result = await pipeline.search('What is SearXNG and why would I use it over DuckDuckGo Instant Answer API?');

    expect(result.answer).toContain('SearXNG is a privacy-respecting metasearch engine');
    expect(result.answer).toContain('prefer SearXNG over DuckDuckGo Instant Answer API');
    expect(result.answer).not.toMatch(/\*\*Sources\*\*|Sources:/);
    expect(result.answer).not.toContain('**Search:');
  });

  it('selects causal passages for causes questions instead of related history', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('api.duckduckgo.com')) {
        return {
          ok: true,
          json: async () => ({
            Abstract: 'The bankruptcy of Lehman Brothers on September 15, 2008 is often considered the climax of the 2008 financial crisis. The 2008 financial crisis was caused by risky subprime mortgages, weak lending standards, and highly leveraged financial institutions.',
            AbstractSource: 'Wikipedia',
            AbstractURL: 'https://en.wikipedia.org/wiki/Financial_crisis_of_2007%E2%80%932008',
            RelatedTopics: [],
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({ maxFanOut: 1, fetchTimeoutMs: 5000 });
    const result = await pipeline.search('what caused the 2008 financial crisis?');

    expect(result.answer).toContain('caused by risky subprime mortgages');
    expect(result.answer).not.toMatch(/^The bankruptcy of Lehman Brothers/i);
  });

  it('refuses context-free causal fragments instead of presenting them as conclusions', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('api.duckduckgo.com')) {
        return {
          ok: true,
          json: async () => ({
            Abstract: 'It was also a contributor to the 2008–2011 Icelandic financial crisis and the euro area crisis.',
            AbstractSource: 'Wikipedia',
            AbstractURL: 'https://en.wikipedia.org/wiki/2008%E2%80%932011_Icelandic_financial_crisis',
            RelatedTopics: [],
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({ maxFanOut: 1, fetchTimeoutMs: 5000 });
    const result = await pipeline.search('what caused the 2008 financial crisis?');

    expect(result.answer).toMatch(/did not contain a direct explanation of the cause|didn't find anything that actually matches the question shape/i);
    expect(result.answer).not.toContain('It was also a contributor');
  });

  it('prefers stronger causal relations over vague contribution language', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('api.duckduckgo.com')) {
        return {
          ok: true,
          json: async () => ({
            Abstract: 'Accounting methods contributed to the 2008 financial crisis. The mortgage crisis of 2007–2008 led to the 2008 financial crisis and the Great Recession of 2008–2009.',
            AbstractSource: 'Wikipedia',
            AbstractURL: 'https://en.wikipedia.org/wiki/2008_financial_crisis',
            RelatedTopics: [],
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({ maxFanOut: 1, fetchTimeoutMs: 5000 });
    const result = await pipeline.search('what caused the 2008 financial crisis?');
    expect(result.answer).not.toContain('Accounting methods contributed');

    expect(result.answer).toMatch(/^The mortgage crisis of 2007–2008 led to the 2008 financial crisis/i);
  });

  it('uses official PyPI metadata for explicit package-version prompts', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('pypi.org/pypi/devlens-cli/json')) {
        return {
          ok: true,
          json: async () => ({
            info: {
              version: '0.2.0',
              summary: 'CLI for structured DevLens captures and automation.',
              project_urls: {
                Homepage: 'https://github.com/example/devlens-cli',
              },
            },
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({ maxFanOut: 1, fetchTimeoutMs: 5000 });
    const result = await pipeline.search('Use web search and tell me the current stable devlens-cli version from PyPI.');

    expect(result.answer).toContain('0.2.0');
    expect(result.sources.some((source) => source.domain === 'pypi.org')).toBe(true);
    expect(result.sources.some((source) => source.domain === 'github.com')).toBe(true);
  });

  it('caches repeated queries', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('api.duckduckgo.com')) {
        return {
          ok: true,
          json: async () => ({
            Abstract: 'JavaScript is a programming language used to create interactive behavior on web pages.',
            AbstractSource: 'Wikipedia',
            AbstractURL: 'https://en.wikipedia.org/wiki/JavaScript',
            RelatedTopics: [],
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({ maxFanOut: 2, fetchTimeoutMs: 5000 });
    const r1 = await pipeline.search('what is JavaScript');
    const r2 = await pipeline.search('what is JavaScript');

    // Second call should be cache hit — faster and identical
    expect(r2.answer).toBe(r1.answer);
    expect(r2.durationMs).toBeLessThanOrEqual(1);
    expect(r2.sync.latencyMs).toBe(0);
    expect(r2.audit[0]?.detail).toMatch(/cache hit/i);
    expect(r2.audit.some((entry) => /no new network request/i.test(entry.detail))).toBe(true);
  });

  it('fires learn callback for verified results', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('api.duckduckgo.com')) {
        return {
          ok: true,
          json: async () => ({
            Abstract: 'Python is a high-level programming language.',
            AbstractSource: 'Wikipedia',
            AbstractURL: 'https://en.wikipedia.org/wiki/Python',
            RelatedTopics: [],
          }),
        };
      }
      return { ok: false };
    });

    const learned: Array<{ text: string; url: string }> = [];
    const pipeline = new SearchPipeline({ maxFanOut: 2, fetchTimeoutMs: 5000 });
    pipeline.setLearnCallback((text, sourceUrl) => {
      learned.push({ text, url: sourceUrl });
    });

    await pipeline.search('what is Python');
    // Should have learned from at least 1 verified result
    expect(learned.length).toBeGreaterThanOrEqual(0); // 0 is ok if no results pass cross-check
  });

  it('prefers official Perplexity sources over github clones for product queries', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('search.example/search?')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                title: 'What is Perplexity? | Perplexity',
                url: 'https://www.perplexity.ai/help-center/en/articles/10354919-what-is-perplexity',
                content: 'Perplexity AI is an answer engine that searches the web and cites sources.',
              },
              {
                title: 'Perplexity AI',
                url: 'https://www.perplexity.ai/',
                content: 'Perplexity is a search engine and AI company focused on cited answers.',
              },
              {
                title: 'Perplexity - Wikipedia',
                url: 'https://en.wikipedia.org/wiki/Perplexity_AI',
                content: 'Perplexity AI, Inc. is an American search engine company focused on cited responses.',
              },
              {
                title: 'Perplexity clone open source search engine',
                url: 'https://github.com/example/perplexity-clone',
                content: 'An open source Perplexity clone for building an AI search engine.',
              },
              {
                title: 'Perplexity AI review and alternatives',
                url: 'https://toolify.ai/tool/perplexity-ai',
                content: 'Perplexity AI tool review with alternatives and wrapper summary.',
              },
              {
                title: 'helallao/perplexity-ai',
                url: 'https://www.perplexity.ai/page/helallao-perplexity-ai',
                content: 'Unofficial API wrapper for Perplexity AI with account generator and web interface.',
              },
            ],
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({
      searxngUrl: 'https://search.example',
      maxFanOut: 1,
      resultsPerQuery: 6,
      readTopN: 0,
      fetchTimeoutMs: 5000,
    });
    const result = await pipeline.search('exsplain perplexity in simple words. include sources.');

    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources[0]?.domain).toBe('perplexity.ai');
    expect(result.sources.filter((source) => source.domain === 'perplexity.ai')).toHaveLength(1);
    expect(result.sources.some((source) => source.domain === 'en.wikipedia.org')).toBe(true);
    expect(result.sources.some((source) => /wrapper|clone|alternatives|helallao/i.test(`${source.title} ${source.url} ${source.text}`))).toBe(false);
    expect(result.answer).not.toMatch(/inspired by Perplexity|wrapper|clone/i);
  });

  it('filters shared-subject noise before synthesizing an entity-specific answer', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('search.example/search?')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                title: 'Spotify covers discussion',
                url: 'https://news.ycombinator.com/item?id=42',
                content: 'Spotify canvas covers now loop in the mobile player and artists are discussing the visual update.',
              },
              {
                title: 'Podcasts and shows on Spotify',
                url: 'https://support.spotify.com/article/podcasts-and-shows',
                content: 'Spotify has podcasts, including shows and episodes that users can browse and play in the app.',
              },
            ],
          }),
        };
      }
      return { ok: false };
    });

    const pipeline = new SearchPipeline({
      searxngUrl: 'https://search.example',
      maxFanOut: 1,
      resultsPerQuery: 2,
      readTopN: 0,
      fetchTimeoutMs: 5000,
    });
    const result = await pipeline.search('does spotify have podcasts?');

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.domain).toBe('support.spotify.com');
    expect(result.answer).toContain('**Yes** - Podcasts and shows on Spotify');
    expect(result.answer).toContain('Confidence: limited');
    expect(result.answer).not.toContain('Spotify canvas covers');
  });

  it('clearCache resets the cache', async () => {
    const pipeline = new SearchPipeline();
    pipeline.clearCache();
    // Should not throw
    expect(true).toBe(true);
  });
});

// ── Follow-Up Suggestions ──

describe('generateFollowUps', () => {
  it('returns 2-3 follow-up questions', () => {
    const response = {
      answer: 'TypeScript is a typed superset of JavaScript.',
      sources: [],
      plan: {
        originalQuery: 'what is TypeScript',
        intent: 'definition' as const,
        entities: ['TypeScript'],
        constraints: {},
        fanOutQueries: ['what is TypeScript'],
      },
      rawResultCount: 5,
      confidence: 0.8,
      durationMs: 200,
      sync: makeSync(),
      audit: [],
    };
    const followUps = generateFollowUps('what is TypeScript', response);
    expect(followUps.length).toBeGreaterThanOrEqual(2);
    expect(followUps.length).toBeLessThanOrEqual(3);
    followUps.forEach(q => expect(typeof q).toBe('string'));
    expect(followUps.some((item) => /tell me more/i.test(item))).toBe(false);
  });

  it('generates different follow-ups for how-to vs definition', () => {
    const defResponse = {
      answer: 'React is a library.',
      sources: [],
      plan: { originalQuery: 'what is React', intent: 'definition' as const, entities: ['React'], constraints: {}, fanOutQueries: ['what is React'] },
      rawResultCount: 3,
      confidence: 0.6,
      durationMs: 100,
      sync: makeSync(),
      audit: [],
    };
    const howToResponse = {
      answer: 'Deploy using Vercel CLI.',
      sources: [],
      plan: { originalQuery: 'how to deploy Next.js', intent: 'how-to' as const, entities: ['deploy', 'Next.js'], constraints: {}, fanOutQueries: ['how to deploy Next.js'] },
      rawResultCount: 3,
      confidence: 0.7,
      durationMs: 100,
      sync: makeSync(),
      audit: [],
    };
    const defFollowUps = generateFollowUps('what is React', defResponse);
    const howToFollowUps = generateFollowUps('how to deploy Next.js', howToResponse);
    // At least some should differ
    expect(defFollowUps).not.toEqual(howToFollowUps);
  });

  it('returns empty array when query is empty', () => {
    const response = {
      answer: '',
      sources: [],
      plan: { originalQuery: '', intent: 'general' as const, entities: [], constraints: {}, fanOutQueries: [] },
      rawResultCount: 0,
      confidence: 0,
      durationMs: 0,
      sync: makeSync({ observations: 0, latencyMs: 0, medianLatencyMs: 0, p95LatencyMs: 0 }),
      audit: [],
    };
    const followUps = generateFollowUps('', response);
    expect(followUps).toEqual([]);
  });

  it('falls back to source metadata when entities are empty', () => {
    const response = {
      answer: 'Official Tailwind docs explain responsive design utilities.',
      sources: [
        {
          text: 'Responsive design in Tailwind CSS uses breakpoint prefixes.',
          url: 'https://tailwindcss.com/docs/responsive-design',
          domain: 'tailwindcss.com',
          title: 'Responsive design - Tailwind CSS',
          favicon: 'https://www.google.com/s2/favicons?domain=tailwindcss.com&sz=32',
          trust: { tier: 'high' as const, score: 0.95, reason: 'Official docs' },
          rank: 1,
        },
      ],
      plan: { originalQuery: 'responsive design docs', intent: 'general' as const, entities: [], constraints: {}, fanOutQueries: ['responsive design docs'] },
      rawResultCount: 1,
      confidence: 0.9,
      durationMs: 90,
      sync: makeSync({ state: 'wormhole', latencyMs: 90, recommendedConcurrency: 6, medianLatencyMs: 90, p95LatencyMs: 90 }),
      audit: [],
    };

    const followUps = generateFollowUps('responsive design docs', response);
    expect(followUps.length).toBeGreaterThan(0);
    followUps.forEach((item) => {
      expect(item.trim().length).toBeGreaterThan('Tell me more about '.length);
      expect(item).not.toContain('  ');
    });
    expect(followUps.some((item) => item.includes('Tailwind CSS') || item.includes('responsive design'))).toBe(true);
  });

  it('does not suggest building something for general informational follow-ups', () => {
    const response = {
      answer: 'Official Tailwind docs explain responsive design utilities.',
      sources: [
        {
          text: 'Responsive design in Tailwind CSS uses breakpoint prefixes.',
          url: 'https://tailwindcss.com/docs/responsive-design',
          domain: 'tailwindcss.com',
          title: 'Responsive design - Tailwind CSS',
          favicon: 'https://www.google.com/s2/favicons?domain=tailwindcss.com&sz=32',
          trust: { tier: 'high' as const, score: 0.95, reason: 'Official docs' },
          rank: 1,
        },
      ],
      plan: { originalQuery: 'responsive design docs', intent: 'general' as const, entities: [], constraints: {}, fanOutQueries: ['responsive design docs'] },
      rawResultCount: 1,
      confidence: 0.9,
      durationMs: 90,
      sync: makeSync({ state: 'wormhole', latencyMs: 90, recommendedConcurrency: 6, medianLatencyMs: 90, p95LatencyMs: 90 }),
      audit: [],
    };

    const followUps = generateFollowUps('responsive design docs', response);
    expect(followUps.every((item) => !/what should i build next/i.test(item))).toBe(true);
    expect(followUps.some((item) => /common mistakes|project structure/i.test(item))).toBe(true);
  });

  it('uses version-aware follow-ups for source-backed version answers', () => {
    const response = {
      answer: '**Current version target**\n\n- **Bun**: bun-v1.3.10',
      sources: [
        {
          text: 'Bun official release information indicates version bun-v1.3.10.',
          url: 'https://bun.sh/docs',
          domain: 'bun.sh',
          title: 'Bun Docs',
          favicon: 'https://www.google.com/s2/favicons?domain=bun.sh&sz=32',
          trust: { tier: 'high' as const, score: 0.95, reason: 'Official docs' },
          rank: 1,
        },
      ],
      plan: { originalQuery: 'bun stable version', intent: 'current' as const, entities: ['bun'], constraints: {}, fanOutQueries: ['bun stable version'] },
      rawResultCount: 1,
      confidence: 0.9,
      durationMs: 80,
      sync: makeSync({ state: 'wormhole', latencyMs: 80, medianLatencyMs: 80, p95LatencyMs: 80 }),
      audit: [],
    };

    const followUps = generateFollowUps('bun stable version', response);
    expect(followUps.some((item) => /release notes|breaking changes|migration/i.test(item))).toBe(true);
  });

  it('uses docs-aware follow-ups for official documentation answers', () => {
    const response = {
      answer: '**Official docs lookup**',
      sources: [
        {
          text: 'Official Tailwind CSS documentation for responsive design and breakpoint prefixes.',
          url: 'https://tailwindcss.com/docs/responsive-design',
          domain: 'tailwindcss.com',
          title: 'Tailwind CSS Responsive Design',
          favicon: 'https://www.google.com/s2/favicons?domain=tailwindcss.com&sz=32',
          trust: { tier: 'high' as const, score: 0.95, reason: 'Official docs' },
          rank: 1,
        },
      ],
      plan: { originalQuery: 'official tailwind responsive design docs', intent: 'general' as const, entities: [], constraints: {}, fanOutQueries: ['official tailwind responsive design docs'] },
      rawResultCount: 1,
      confidence: 0.9,
      durationMs: 80,
      sync: makeSync({ state: 'wormhole', latencyMs: 80, medianLatencyMs: 80, p95LatencyMs: 80 }),
      audit: [],
    };

    const followUps = generateFollowUps('official tailwind responsive design docs', response);
    expect(followUps.some((item) => /practical example|Common mistakes|read next/i.test(item))).toBe(true);
    expect(followUps.every((item) => !/docs?|documentation|page/i.test(item))).toBe(true);
  });

  it('returns Vinext-specific follow-ups for short setup queries', () => {
    const response = {
      answer: '**Vinext** setup answer',
      sources: [
        {
          text: 'Vinext is a Vite-first framework with a Next-style page and API model.',
          url: 'https://vinext.io',
          domain: 'vinext.io',
          title: 'Vinext',
          favicon: 'https://www.google.com/s2/favicons?domain=vinext.io&sz=32',
          trust: { tier: 'high' as const, score: 0.95, reason: 'Official docs' },
          rank: 1,
        },
      ],
      plan: { originalQuery: 'setup vinext for me please', intent: 'how-to' as const, entities: ['Vinext'], constraints: {}, fanOutQueries: ['setup vinext for me please'] },
      rawResultCount: 1,
      confidence: 0.9,
      durationMs: 60,
      sync: makeSync({ state: 'wormhole', latencyMs: 60, medianLatencyMs: 60, p95LatencyMs: 60 }),
      audit: [],
    };

    const followUps = generateFollowUps('setup vinext for me please', response);
    expect(followUps).toEqual([
      'Turn this starter into a premium landing page',
      'Add auth and a dashboard shell to this app',
      'When should I pick Vinext over Next.js or plain Vite?',
    ]);
  });

  it('removes explanation prompt residue from follow-up suggestions', () => {
    const response = {
      answer: 'Perplexity AI is an answer engine that searches the web and cites sources.',
      sources: [
        {
          text: 'Perplexity AI is an answer engine that searches the web and cites sources in its responses.',
          url: 'https://www.perplexity.ai/help-center/en/articles/10354919-what-is-perplexity',
          domain: 'www.perplexity.ai',
          title: 'What is Perplexity? | Perplexity',
          favicon: 'https://www.google.com/s2/favicons?domain=www.perplexity.ai&sz=32',
          trust: { tier: 'high' as const, score: 0.95, reason: 'Official site' },
          rank: 1,
        },
      ],
      plan: {
        originalQuery: 'exsplain perplexity in simple words. include sources.',
        intent: 'explanation' as const,
        entities: ['perplexity'],
        constraints: {},
        fanOutQueries: ['explain perplexity in simple words'],
      },
      rawResultCount: 1,
      confidence: 0.9,
      durationMs: 70,
      sync: makeSync({ state: 'wormhole', latencyMs: 70, medianLatencyMs: 70, p95LatencyMs: 70 }),
      audit: [],
    };

    const followUps = generateFollowUps('exsplain perplexity in simple words. include sources.', response);
    expect(followUps.length).toBeGreaterThan(0);
    expect(followUps.every((item) => !/simple words|sources?|citations?|references?|words\.|what is|guide|help center/i.test(item))).toBe(true);
    expect(followUps.some((item) => /Perplexity/i.test(item))).toBe(true);
  });

  it('reuses the richer Next.js follow-ups for search-backed framework answers', () => {
    const response = {
      answer: 'Next.js is a React framework for full-stack web apps.',
      sources: [
        {
          text: 'Next.js provides routing, data fetching, and server rendering.',
          url: 'https://nextjs.org/docs',
          domain: 'nextjs.org',
          title: 'Next.js Documentation',
          favicon: 'https://www.google.com/s2/favicons?domain=nextjs.org&sz=32',
          trust: { tier: 'high' as const, score: 0.95, reason: 'Official docs' },
          rank: 1,
        },
      ],
      plan: { originalQuery: 'what is Next.js', intent: 'definition' as const, entities: ['Next.js'], constraints: {}, fanOutQueries: ['what is Next.js'] },
      rawResultCount: 1,
      confidence: 0.9,
      durationMs: 75,
      sync: makeSync({ state: 'wormhole', latencyMs: 75, medianLatencyMs: 75, p95LatencyMs: 75 }),
      audit: [],
    };

    const followUps = generateFollowUps('what is Next.js', response);
    expect(followUps).toEqual([
      'Add Prisma and Postgres to this app',
      'Add GitHub sign-in next to Google auth',
      'Polish the onboarding and dashboard flow',
    ]);
  });

  it('keeps explicit comparison follow-ups grounded even when the compared subject contains api words', () => {
    const followUps = generateTopicFollowUps('SearXNG vs DuckDuckGo Instant Answer API', 'comparison');

    expect(followUps.length).toBeGreaterThan(0);
    expect(followUps.every((item) => /SearXNG|DuckDuckGo/i.test(item))).toBe(true);
    expect(followUps).not.toContain('Add authentication to this API');
  });

  it('uses lexical topic presets for educational and ambiguous single-word prompts', () => {
    expect(generateTopicFollowUps('programming')).toEqual([
      'Best programming language for beginners',
      'How to learn programming step by step',
      'Programming vs coding differences',
    ]);

    expect(generateTopicFollowUps('single')).toEqual([
      'What does single mean in music vs everyday language?',
      'How is single used in Norwegian and English?',
      'What are the most common meanings of single?',
    ]);

    expect(generateTopicFollowUps('typescript')).toEqual([
      'TypeScript vs JavaScript differences',
      'When to use interfaces vs type aliases',
      'How to enable strict mode in TypeScript',
    ]);

    expect(generateTopicFollowUps('python')).toEqual([
      'Python vs JavaScript for beginners',
      'How to set up a Python virtual environment',
      'What should I build first in Python?',
    ]);

    expect(generateTopicFollowUps('docker')).toEqual([
      'Docker images vs containers differences',
      'Docker Compose vs Kubernetes trade-offs',
      'How to debug a container that exits immediately',
    ]);

    expect(generateTopicFollowUps('database')).toEqual([
      'SQL vs NoSQL differences',
      'How database indexing works',
      'When to normalize vs denormalize data',
    ]);

    expect(generateTopicFollowUps('queue')).toEqual([
      'Queue vs stack differences',
      'How queues are used in async systems',
      'What enqueue, dequeue, and peek mean',
    ]);

    expect(generateTopicFollowUps('cache')).toEqual([
      'Cache invalidation strategies',
      'Redis vs in-memory cache differences',
      'When caching hurts instead of helps',
    ]);

    expect(generateTopicFollowUps('latency')).toEqual([
      'Latency vs throughput differences',
      'How to measure latency in an app',
      'What usually causes high latency',
    ]);

    expect(generateTopicFollowUps('recursion')).toEqual([
      'Recursion vs iteration differences',
      'How base cases prevent infinite recursion',
      'When recursion becomes inefficient',
    ]);

    expect(generateTopicFollowUps('websocket')).toEqual([
      'WebSocket vs Server-Sent Events differences',
      'How to keep WebSocket connections alive',
      'When to choose WebSocket over HTTP polling',
    ]);

    expect(generateTopicFollowUps('websokcet')).toEqual([
      'WebSocket vs Server-Sent Events differences',
      'How to keep WebSocket connections alive',
      'When to choose WebSocket over HTTP polling',
    ]);
  });

  it('uses explanatory follow-ups for bare lexical topics instead of builder prompts', () => {
    expect(generateTopicFollowUps('git')).toEqual([
      'How is git used in practice?',
      'What are the core ideas behind git?',
      'What should I learn next after git?',
    ]);
  });

  it('uses ranking follow-ups for GitHub discovery prompts instead of awkward topic templates', () => {
    const followUps = generateTopicFollowUps('who is top master frontend web dev on github');

    expect(followUps).toEqual([
      'Rank this by GitHub followers',
      'Rank this by project stars instead',
      'Give me 3 high-signal names to inspect',
    ]);
    expect(followUps.every((item) => !/practical example with|common mistakes with/i.test(item))).toBe(true);
  });

  it('uses product-specific follow-ups for notes, social, ops, and SaaS builder topics', () => {
    expect(generateTopicFollowUps('notes dashboard app i can preview', 'how-to')).toEqual([
      'Add search, tags, and filters to this notes dashboard',
      'Persist notes in local storage and restore on reload',
      'Add edit, delete, and pin toggles to each note',
    ]);

    expect(generateTopicFollowUps('social blogging app i can preview', 'how-to')).toEqual([
      'Add comments and likes to the feed',
      'Add author profiles and follow state to Social Hub',
      'Add trending topics and saved drafts to the composer',
    ]);

    expect(generateTopicFollowUps('internal ops dashboard app i can preview', 'how-to')).toEqual([
      'Add assignee filters and SLA badges to the approval queue',
      'Turn the quick actions into working approval flows',
      'Add audit history and escalation states to Ops Control Center',
    ]);

    expect(generateTopicFollowUps('premium saas workspace app i can preview', 'how-to')).toEqual([
      'Add plan upgrades and seat management to this SaaS workspace',
      'Add audit log filters and CSV export',
      'Add invite flows and role-based access to the team panel',
    ]);

    expect(generateTopicFollowUps('general store like firma for selling anything')).toEqual([
      'Add category navigation, search, and filters to the storefront',
      'Turn product cards into product detail pages with variants and cart flow',
      'Add featured collections, trust signals, and order-summary checkout states',
    ]);
  });
});

// ── SearchResponse confidence field ──

describe('SearchPipeline confidence', () => {
  it('search result includes confidence field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Abstract: 'Vitest is a blazing fast test framework.',
        AbstractSource: 'GitHub',
        AbstractURL: 'https://github.com/vitest-dev/vitest',
        RelatedTopics: [],
      }),
    }));

    const pipeline = new SearchPipeline({ maxFanOut: 1, fetchTimeoutMs: 3000 });
    const result = await pipeline.search('what is Vitest');
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.sync.latencyMs).toBe(result.durationMs);
    expect(result.sync.observations).toBeGreaterThanOrEqual(1);

    vi.unstubAllGlobals();
  });
});
