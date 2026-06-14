import { describe, it, expect, vi, beforeEach } from 'vitest';

const safeFetchMock = vi.fn();
const fetchRenderedHtmlMock = vi.fn();
const isBrowserSearchEnabledMock = vi.fn();

vi.mock('../network/safe-fetch.js', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

vi.mock('../search/browser-search.js', () => ({
  fetchRenderedHtml: (...args: unknown[]) => fetchRenderedHtmlMock(...args),
  isBrowserSearchEnabled: () => isBrowserSearchEnabledMock(),
}));

import { readUrl } from './read-url.js';

/** Minimal Response-like stub for safeFetch. */
function htmlResponse(html: string, ok = true): unknown {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    text: async () => html,
  };
}

const ARTICLE = `<!doctype html><html><head><title>My Post</title></head><body>
  <article><h1>My Post</h1>${'<p>Real readable body content that is clearly long enough to extract cleanly.</p>'.repeat(3)}</article>
</body></html>`;

const EMPTY_SPA = '<!doctype html><html><head><title>ChatGPT</title></head><body><div id="root"></div></body></html>';

describe('readUrl static extraction', () => {
  beforeEach(() => {
    safeFetchMock.mockReset();
    fetchRenderedHtmlMock.mockReset();
    isBrowserSearchEnabledMock.mockReset();
    isBrowserSearchEnabledMock.mockReturnValue(false);
  });

  it('extracts a server-rendered article without touching the browser', async () => {
    safeFetchMock.mockResolvedValue(htmlResponse(ARTICLE));
    const res = await readUrl('https://example.com/post');
    expect(res.ok).toBe(true);
    expect(res.markdown).toContain('readable body content');
    expect(res.rendered).toBe(false);
    expect(fetchRenderedHtmlMock).not.toHaveBeenCalled();
  });

  it('returns the JS-render error when the page is an empty shell and no browser is available', async () => {
    safeFetchMock.mockResolvedValue(htmlResponse(EMPTY_SPA));
    const res = await readUrl('https://chatgpt.com/share/abc');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/JavaScript/i);
    expect(fetchRenderedHtmlMock).not.toHaveBeenCalled();
  });
});

describe('readUrl browser fallback (SPA)', () => {
  beforeEach(() => {
    safeFetchMock.mockReset();
    fetchRenderedHtmlMock.mockReset();
    isBrowserSearchEnabledMock.mockReset();
    isBrowserSearchEnabledMock.mockReturnValue(true);
  });

  it('re-renders an empty SPA shell in a browser and extracts the hydrated content', async () => {
    safeFetchMock.mockResolvedValue(htmlResponse(EMPTY_SPA));
    fetchRenderedHtmlMock.mockResolvedValue(ARTICLE);

    const res = await readUrl('https://chatgpt.com/share/abc');
    expect(res.ok).toBe(true);
    expect(res.rendered).toBe(true);
    expect(res.markdown).toContain('readable body content');
    expect(fetchRenderedHtmlMock).toHaveBeenCalledWith('https://chatgpt.com/share/abc', expect.any(Number));
  });

  it('does not call the browser when static extraction already succeeded', async () => {
    safeFetchMock.mockResolvedValue(htmlResponse(ARTICLE));
    const res = await readUrl('https://example.com/post');
    expect(res.ok).toBe(true);
    expect(res.rendered).toBe(false);
    expect(fetchRenderedHtmlMock).not.toHaveBeenCalled();
  });

  it('respects useBrowserFallback:false even when a browser is available', async () => {
    safeFetchMock.mockResolvedValue(htmlResponse(EMPTY_SPA));
    const res = await readUrl('https://chatgpt.com/share/abc', { useBrowserFallback: false });
    expect(res.ok).toBe(false);
    expect(fetchRenderedHtmlMock).not.toHaveBeenCalled();
  });

  it('falls back gracefully when the browser also yields nothing', async () => {
    safeFetchMock.mockResolvedValue(htmlResponse(EMPTY_SPA));
    fetchRenderedHtmlMock.mockResolvedValue(EMPTY_SPA);
    const res = await readUrl('https://chatgpt.com/share/abc');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/JavaScript/i);
  });
});
