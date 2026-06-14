/**
 * Tests for the council "web witness" / RAG evidence step.
 *
 * gatherWebEvidence is exercised with the SearchPipeline mocked so the suite is fast,
 * deterministic, and never drives a real browser or network. We verify the policy
 * (pipeline-first, Chrome-fallback when thin, AI-Overview bonus) and the hard guarantee
 * that it NEVER throws — a failed gather must leave the council to convene unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the search pipeline + browser search the module depends on.
const searchMock = vi.fn();
vi.mock('../src/search/pipeline.js', () => ({
  SearchPipeline: class {
    search = searchMock;
  },
}));

const browserPageMock = vi.fn();
const browserEnabledMock = vi.fn();
vi.mock('../src/search/browser-search.js', () => ({
  fetchGooglePageViaBrowser: (...args: unknown[]) => browserPageMock(...args),
  isBrowserSearchEnabled: () => browserEnabledMock(),
}));

const readUrlMock = vi.fn();
vi.mock('../src/tools/read-url.js', () => ({
  readUrl: (url: string) => readUrlMock(url),
}));

import { gatherWebEvidence, extractUrls } from '../src/consensus/web-evidence.js';

function pipelineResult(sources: Array<{ title: string; url: string; text: string }>) {
  return { sources, answer: '', confidence: 0.5, plan: {}, rawResultCount: sources.length, durationMs: 1, sync: {}, audit: [] };
}

beforeEach(() => {
  searchMock.mockReset();
  browserPageMock.mockReset();
  browserEnabledMock.mockReset();
  readUrlMock.mockReset();
  browserEnabledMock.mockReturnValue(false); // default: no browser → pipeline only
});

describe('gatherWebEvidence — policy', () => {
  it('returns empty for a blank query without touching the network', async () => {
    const ev = await gatherWebEvidence('   ');
    expect(ev.sources).toHaveLength(0);
    expect(ev.aiOverview).toBeNull();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('uses the pipeline (SearXNG chain) as the default source path', async () => {
    searchMock.mockResolvedValue(pipelineResult([
      { title: 'A', url: 'https://a.com', text: 'alpha snippet' },
      { title: 'B', url: 'https://b.com', text: 'beta snippet' },
      { title: 'C', url: 'https://c.com', text: 'gamma snippet' },
    ]));
    const ev = await gatherWebEvidence('what is rust ownership', { skipAiOverview: true });
    expect(ev.via).toBe('pipeline');
    expect(ev.sources.map((s) => s.url)).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    expect(ev.gatheredAt).not.toBe('');
  });

  it('caps sources at maxSources', async () => {
    searchMock.mockResolvedValue(pipelineResult(
      Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, url: `https://x${i}.com`, text: `s${i}` })),
    ));
    const ev = await gatherWebEvidence('q', { maxSources: 4, skipAiOverview: true });
    expect(ev.sources).toHaveLength(4);
  });

  it('falls back to Chrome organic results when the pipeline is thin', async () => {
    searchMock.mockResolvedValue(pipelineResult([{ title: 'only', url: 'https://only.com', text: 'one' }]));
    browserEnabledMock.mockReturnValue(true);
    browserPageMock.mockResolvedValue({
      aiOverview: null,
      results: [
        { title: 'G1', url: 'https://g1.com', snippet: 'g one' },
        { title: 'G2', url: 'https://g2.com', snippet: 'g two' },
      ],
    });
    const ev = await gatherWebEvidence('thin query', { minSources: 3 });
    expect(ev.sources.map((s) => s.url)).toEqual(['https://only.com', 'https://g1.com', 'https://g2.com']);
  });

  it('does NOT add browser results when the pipeline is already thick', async () => {
    searchMock.mockResolvedValue(pipelineResult([
      { title: 'A', url: 'https://a.com', text: 'a' },
      { title: 'B', url: 'https://b.com', text: 'b' },
      { title: 'C', url: 'https://c.com', text: 'c' },
    ]));
    browserEnabledMock.mockReturnValue(true);
    browserPageMock.mockResolvedValue({ aiOverview: 'A synthesized overview that is plenty long to count as real.', results: [{ title: 'X', url: 'https://x.com', snippet: 'x' }] });
    const ev = await gatherWebEvidence('thick query', { minSources: 3 });
    // AI Overview still captured, but the extra browser source is NOT merged.
    expect(ev.aiOverview).toMatch(/synthesized overview/);
    expect(ev.sources.map((s) => s.url)).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('captures the AI Overview bonus alongside pipeline sources', async () => {
    searchMock.mockResolvedValue(pipelineResult([{ title: 'A', url: 'https://a.com', text: 'a' }]));
    browserEnabledMock.mockReturnValue(true);
    browserPageMock.mockResolvedValue({ aiOverview: 'Rust ownership is a memory-safety model enforced at compile time without a GC.', results: [] });
    const ev = await gatherWebEvidence('rust ownership');
    expect(ev.aiOverview).toMatch(/memory-safety/);
  });
});

describe('gatherWebEvidence — never throws (council must convene regardless)', () => {
  it('returns empty when the pipeline rejects', async () => {
    searchMock.mockRejectedValue(new Error('searxng down'));
    const ev = await gatherWebEvidence('q', { skipAiOverview: true });
    expect(ev.sources).toHaveLength(0);
    expect(ev.aiOverview).toBeNull();
  });

  it('returns pipeline sources even when the browser fetch rejects', async () => {
    searchMock.mockResolvedValue(pipelineResult([{ title: 'A', url: 'https://a.com', text: 'a' }]));
    browserEnabledMock.mockReturnValue(true);
    browserPageMock.mockRejectedValue(new Error('captcha cooldown'));
    const ev = await gatherWebEvidence('q', { minSources: 3 });
    expect(ev.sources.map((s) => s.url)).toEqual(['https://a.com']);
    expect(ev.aiOverview).toBeNull();
  });

  it('never throws when readUrl rejects on a pasted URL', async () => {
    searchMock.mockResolvedValue(pipelineResult([]));
    readUrlMock.mockRejectedValue(new Error('boom'));
    const ev = await gatherWebEvidence('https://example.com', { skipAiOverview: true });
    expect(ev.via).toBe('none');
    expect(ev.sources).toEqual([]);
  });
});

describe('extractUrls', () => {
  it('pulls http(s) URLs in order, de-duped', () => {
    const text = 'see https://github.com/a/b and http://example.com plus https://github.com/a/b again';
    expect(extractUrls(text)).toEqual(['https://github.com/a/b', 'http://example.com']);
  });

  it('strips trailing sentence punctuation and wrapping parens', () => {
    expect(extractUrls('look at https://codeberg.org/ziglang/zig.')).toEqual(['https://codeberg.org/ziglang/zig']);
    expect(extractUrls('(https://example.com/x)')).toEqual(['https://example.com/x']);
  });

  it('caps the number of fetched URLs at 3', () => {
    expect(extractUrls('https://a.com https://b.com https://c.com https://d.com')).toHaveLength(3);
  });

  it('returns nothing for plain text', () => {
    expect(extractUrls('what is the capital of france')).toEqual([]);
    expect(extractUrls('')).toEqual([]);
  });
});

describe('gatherWebEvidence — pasted-URL reading (read-url path)', () => {
  it('reads a pasted URL and lists it first as read-url evidence', async () => {
    searchMock.mockResolvedValue(pipelineResult([]));
    readUrlMock.mockResolvedValue({
      ok: true,
      url: 'https://github.com/pewdiepie-archdaemon/odysseus',
      title: 'odysseus',
      markdown: '# Odysseus\nA project readme.',
    });
    const ev = await gatherWebEvidence('inspect https://github.com/pewdiepie-archdaemon/odysseus', { skipAiOverview: true });
    expect(ev.via).toBe('read-url');
    expect(ev.sources[0]?.url).toBe('https://github.com/pewdiepie-archdaemon/odysseus');
    expect(ev.sources[0]?.snippet).toContain('Odysseus');
    expect(readUrlMock).toHaveBeenCalledWith('https://github.com/pewdiepie-archdaemon/odysseus');
  });

  it('falls back to search when the page is unreadable (SPA share-link)', async () => {
    readUrlMock.mockResolvedValue({ ok: false, url: 'https://chatgpt.com/share/abc', error: 'renders via JavaScript' });
    searchMock.mockResolvedValue(pipelineResult([{ title: 'result', url: 'https://elsewhere.com', text: 'snippet' }]));
    const ev = await gatherWebEvidence('read https://chatgpt.com/share/abc', { skipAiOverview: true });
    expect(ev.via).toBe('pipeline');
    expect(ev.sources.map((s) => s.url)).toContain('https://elsewhere.com');
  });

  it('does not list a pasted URL twice when search also returns it', async () => {
    readUrlMock.mockResolvedValue({ ok: true, url: 'https://example.com/post', title: 'Post', markdown: 'body' });
    searchMock.mockResolvedValue(pipelineResult([{ title: 'Post', url: 'https://example.com/post', text: 'snippet' }]));
    const ev = await gatherWebEvidence('https://example.com/post', { skipAiOverview: true });
    expect(ev.sources.filter((s) => s.url === 'https://example.com/post')).toHaveLength(1);
    expect(ev.via).toBe('read-url');
  });
});
