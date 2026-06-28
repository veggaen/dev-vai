/**
 * Free web evidence for the fix-proposer — the council/Vai run locally but HAVE web (Vegga's
 * machine has local web access), so a fix should be grounded in CURRENT docs/error-lookups, not
 * the 8B model's stale training. This calls the runtime's FREE search pipeline (POST /api/search,
 * SearXNG-backed) and returns a compact, prompt-ready evidence block.
 *
 * Free-first: uses the local runtime's free search route; no paid API. Best-effort — any
 * failure yields '' so the proposer just runs without web (never blocks a fix). Injectable
 * fetch → unit-testable offline.
 */

/** Build a focused search query from a failure class + symptom. */
export function fixSearchQuery(klass, symptom) {
  // The symptom is the most information-dense; prepend a light "how to" framing for docs.
  const base = String(symptom || klass || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return base ? `how to correctly handle: ${base}` : '';
}

/**
 * Fetch free web evidence for a fix. Returns a prompt-ready block (or '' on any failure).
 * @param opts { baseUrl?, query, fetchImpl?, timeoutMs?, maxSources? }
 */
export async function fetchFixWebEvidence({ baseUrl = 'http://localhost:3006', query, fetchImpl = fetch, timeoutMs = 15_000, maxSources = 3 } = {}) {
  if (!query) return '';
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const sources = Array.isArray(data?.sources) ? data.sources.slice(0, maxSources) : [];
    if (sources.length === 0) return '';
    const lines = sources.map((s, i) => {
      const title = String(s.title || s.domain || s.url || `source ${i + 1}`).slice(0, 100);
      const text = String(s.text || s.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 280);
      return `- ${title}: ${text}`;
    });
    return [
      'FREE WEB EVIDENCE (current docs/discussion retrieved for this bug — ground the fix in how the API/pattern ACTUALLY works today; do NOT copy verbatim, reason from it):',
      ...lines,
    ].join('\n');
  } catch {
    return ''; // best-effort: never block a fix on a search failure
  }
}
