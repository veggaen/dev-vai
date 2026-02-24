/**
 * Google Search Content Script
 *
 * Captures your search queries and the results Google shows you.
 * VAI learns what you're interested in and what information you find.
 */

export default defineContentScript({
  matches: ['https://www.google.com/search*', 'https://www.google.co.*/search*'],
  runAt: 'document_idle',

  main() {
    captureSearchResults();
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
}
