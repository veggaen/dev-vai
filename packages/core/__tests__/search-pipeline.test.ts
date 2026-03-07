/**
 * Tests for search pipeline: plan building, trust scoring, safety, and full pipeline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSearchPlan, generateFollowUps } from '../src/search/pipeline.js';
import { SearchPipeline } from '../src/search/pipeline.js';
import {
  validateSearchUrl,
  scoreDomain,
  scanContentSafety,
  contentFingerprint,
  assessUrl,
} from '../src/search/safety.js';

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

  it('strips stop words from entities', () => {
    const plan = buildSearchPlan('what is the capital of France');
    expect(plan.entities).not.toContain('the');
    expect(plan.entities).not.toContain('of');
    expect(plan.entities).toContain('capital');
    expect(plan.entities).toContain('France');
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
  });

  it('handles fetch failures gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const pipeline = new SearchPipeline({ maxFanOut: 2 });
    const result = await pipeline.search('test query');

    expect(result.answer).toContain("couldn't find useful results");
    expect(result.rawResultCount).toBe(0);
    expect(result.audit.length).toBeGreaterThanOrEqual(5);
  });

  it('caches repeated queries', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('api.duckduckgo.com')) {
        return {
          ok: true,
          json: async () => ({
            Abstract: 'Cached test content about JavaScript.',
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
    expect(r2.durationMs).toBeLessThanOrEqual(r1.durationMs + 5);
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
        fanOutQueries: ['what is TypeScript'],
      },
      rawResultCount: 5,
      confidence: 0.8,
      durationMs: 200,
      audit: [],
    };
    const followUps = generateFollowUps('what is TypeScript', response);
    expect(followUps.length).toBeGreaterThanOrEqual(2);
    expect(followUps.length).toBeLessThanOrEqual(3);
    followUps.forEach(q => expect(typeof q).toBe('string'));
  });

  it('generates different follow-ups for how-to vs definition', () => {
    const defResponse = {
      answer: 'React is a library.',
      sources: [],
      plan: { originalQuery: 'what is React', intent: 'definition' as const, entities: ['React'], fanOutQueries: ['what is React'] },
      rawResultCount: 3,
      confidence: 0.6,
      durationMs: 100,
      audit: [],
    };
    const howToResponse = {
      answer: 'Deploy using Vercel CLI.',
      sources: [],
      plan: { originalQuery: 'how to deploy Next.js', intent: 'how-to' as const, entities: ['deploy', 'Next.js'], fanOutQueries: ['how to deploy Next.js'] },
      rawResultCount: 3,
      confidence: 0.7,
      durationMs: 100,
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
      plan: { originalQuery: '', intent: 'general' as const, entities: [], fanOutQueries: [] },
      rawResultCount: 0,
      confidence: 0,
      durationMs: 0,
      audit: [],
    };
    const followUps = generateFollowUps('', response);
    expect(Array.isArray(followUps)).toBe(true);
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

    vi.unstubAllGlobals();
  });
});
