/**
 * Google Search Content Script
 *
 * Captures your search queries and the results Google shows you.
 * VAI learns what you're interested in and what information you find.
 */

// Suppress expected "Extension context invalidated" errors on extension reload
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason || '');
  if (msg.includes('context invalidated') || msg.includes('Extension context')) {
    e.preventDefault();
  }
});
window.addEventListener('error', (e) => {
  if (e.message?.includes('context invalidated') || e.message?.includes('Extension context')) {
    e.preventDefault();
  }
});

export default defineContentScript({
  matches: [
    'https://www.google.com/search*',
    'https://www.google.co.uk/search*',
    'https://www.google.no/search*',
    'https://www.google.se/search*',
    'https://www.google.de/search*',
    'https://www.google.fr/search*',
    'https://www.google.es/search*',
    'https://www.google.ca/search*',
    'https://www.google.com.au/search*',
    'https://www.google.co.in/search*',
    'https://www.google.co.jp/search*',
  ],
  runAt: 'document_idle',

  main(ctx) {
    // Respond to popup requests for page content
    try {
      if (!browser.runtime?.id || !ctx.isValid) return;
      browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type === 'VAI_GET_CONTENT') {
          sendResponse({
            title: document.title,
            content: document.body.innerText.slice(0, 50000),
            url: window.location.href,
          });
        }
      });
    } catch {
      console.warn('[VAI] Extension context invalidated');
      return;
    }

    if (ctx.isValid) captureSearchResults();
  },
});

function captureSearchResults() {
  // Extract search query
  const searchInput = document.querySelector('input[name="q"], textarea[name="q"]') as HTMLInputElement | null;
  const query = searchInput?.value ?? '';

  if (!query) return;

  // Extract search results
  const resultElements = document.querySelectorAll('#search .g, [data-sokoban-container]');
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  for (const el of resultElements) {
    const titleEl = el.querySelector('h3');
    const linkEl = el.querySelector('a[href]');
    const snippetEl = el.querySelector('[data-sncf], .VwiC3b, .IsZvec');

    if (titleEl && linkEl) {
      results.push({
        title: titleEl.textContent?.trim() ?? '',
        url: linkEl.getAttribute('href') ?? '',
        snippet: snippetEl?.textContent?.trim() ?? '',
      });
    }
  }

  if (results.length === 0) return;

  const content = [
    `Search query: "${query}"`,
    `\nResults (${results.length}):`,
    ...results.slice(0, 10).map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`,
    ),
  ].join('\n');

  try {
    if (!browser.runtime?.id) return;
    browser.runtime.sendMessage({
      type: 'SAVE_SEARCH',
      url: window.location.href,
      title: `Search: ${query}`,
      content,
      meta: {
        query,
        resultCount: results.length,
        topResults: results.slice(0, 5).map((r) => r.url),
      },
    });
    console.log(`[VAI] Captured Google search: "${query}" (${results.length} results)`);
  } catch {
    console.warn('[VAI] Failed to send message (extension may have been reloaded)');
  }
}
