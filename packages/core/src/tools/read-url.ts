/**
 * read-url — turn any web page into clean, token-efficient Markdown for an LLM.
 *
 * Local models (qwen via Ollama) have NO internet: when a user pastes a URL and asks Vai
 * to "inspect this page", the model can't fetch it. This tool is how Vai fetches the page
 * itself, strips the boilerplate (nav / ads / footers) with Mozilla Readability (the engine
 * behind Firefox Reader View), and converts the core content to Markdown with Turndown —
 * which preserves headings, lists, tables and links that an LLM reads perfectly, at far fewer
 * tokens than raw HTML. The result feeds straight into chat context and the council.
 *
 * Safety: reuses {@link safeFetch} (SSRF / private-network guard, DNS check) and
 * {@link scanContentSafety}. SPA pages that render text via JS yield little here — the search
 * pipeline's real-browser path is the escalation for those; this tool stays fast and keyless.
 *
 * Best-effort: any failure returns a structured `{ ok: false, error }` rather than throwing,
 * so callers (chat tool, council) degrade gracefully.
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { safeFetch } from '../network/safe-fetch.js';
import { scanContentSafety } from '../search/safety.js';
import { fetchRenderedHtml, isBrowserSearchEnabled } from '../search/browser-search.js';

export interface ReadUrlOptions {
  /** Hard wall-clock cap for the fetch (ms). Default 12_000. */
  readonly timeoutMs?: number;
  /** Max characters of Markdown to return (token guard). Default 12_000. */
  readonly maxChars?: number;
  /**
   * Re-render JS-heavy pages in a real browser when static extraction is thin.
   * Default true (only fires when a browser is installed and browser search is on).
   * Set false to force the fast, keyless static-only path (tests, batch jobs).
   */
  readonly useBrowserFallback?: boolean;
}

export interface ReadUrlResult {
  readonly ok: boolean;
  readonly url: string;
  /** Clean Markdown of the page's main content (present when ok). */
  readonly markdown?: string;
  /** Extracted page title, when available. */
  readonly title?: string;
  /** Author/byline, when available. */
  readonly byline?: string;
  /** How the content was extracted — Readability is best; regex is the fallback. */
  readonly extractedVia?: 'readability' | 'fallback';
  /** True when the page was rendered in a real browser (JS-heavy SPA fallback). */
  readonly rendered?: boolean;
  /** Truncated to maxChars? */
  readonly truncated?: boolean;
  /** Why the read failed (present when !ok). */
  readonly error?: string;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_CHARS = 12_000;

let turndown: TurndownService | null = null;
function getTurndown(): TurndownService {
  if (turndown) return turndown;
  turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  // Drop noise Turndown would otherwise carry over verbatim.
  turndown.remove(['script', 'style', 'noscript', 'iframe', 'form']);
  return turndown;
}

/** Collapse 3+ blank lines and trim — saves tokens without losing structure. */
function tidyMarkdown(md: string): string {
  return md.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
}

/** Result of pulling content out of one HTML string. */
interface Extraction {
  markdown: string;
  title?: string;
  byline?: string;
  via: 'readability' | 'fallback';
}

/**
 * Extract clean Markdown from an HTML string: Readability first (best — strips
 * boilerplate), regex fallback when there's no article. Pure: no network.
 */
function extractFromHtml(html: string, url: string): Extraction {
  let markdown = '';
  let title: string | undefined;
  let byline: string | undefined;
  let via: 'readability' | 'fallback' = 'readability';

  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (article?.content && article.content.length > 0) {
      title = article.title ?? undefined;
      byline = article.byline ?? undefined;
      markdown = tidyMarkdown(getTurndown().turndown(article.content));
    }
  } catch {
    markdown = '';
  }

  if (markdown.length < 40) {
    via = 'fallback';
    markdown = fallbackExtract(html);
    if (!title) {
      const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) title = m[1].replace(/\s+/g, ' ').trim();
    }
  }

  return { markdown, title, byline, via };
}

/** Last-resort extractor when Readability finds no article (e.g. listing pages). */
function fallbackExtract(html: string): string {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const main = cleaned.match(/<main[^>]*>([\s\S]+)<\/main>/i);
  const article = cleaned.match(/<article[^>]*>([\s\S]+)<\/article>/i);
  if (main && main[1].length > 200) cleaned = main[1];
  else if (article && article[1].length > 200) cleaned = article[1];
  // Convert the reduced HTML to Markdown so links/headings survive.
  try {
    return tidyMarkdown(getTurndown().turndown(cleaned));
  } catch {
    return cleaned.replace(/<\/?[^>]+(>|$)/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
}

/**
 * Fetch a URL and return its main content as clean Markdown.
 * Never throws — failures come back as `{ ok: false, error }`.
 */
export async function readUrl(url: string, options: ReadUrlOptions = {}): Promise<ReadUrlResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  const trimmed = (url ?? '').trim();
  if (!trimmed) return { ok: false, url: trimmed, error: 'empty url' };

  let res: Awaited<ReturnType<typeof safeFetch>>;
  try {
    res = await safeFetch(trimmed, {
      headers: {
        // Identify honestly but look enough like a browser that servers return real HTML.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VeggaAI-Reader/1.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
    }, { checkDns: process.env.NODE_ENV !== 'test' });
  } catch (err) {
    return { ok: false, url: trimmed, error: `fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) return { ok: false, url: trimmed, error: `http ${res.status}` };
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
    return { ok: false, url: trimmed, error: `unsupported content-type: ${contentType || 'unknown'}` };
  }

  let html: string;
  try {
    html = await res.text();
  } catch (err) {
    return { ok: false, url: trimmed, error: `read body failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  let { markdown, title, byline, via: extractedVia } = extractFromHtml(html, trimmed);
  let rendered = false;

  // SPA fallback: a plain fetch of a client-rendered page (ChatGPT share links,
  // JS-only docs) yields an empty app shell. When static extraction comes up thin
  // and a real browser is available, re-render the SAME (already SSRF-validated by
  // safeFetch above) URL and extract from the hydrated DOM. Best-effort — if the
  // browser is unavailable or still yields nothing, we return the helpful
  // "renders via JavaScript" error below.
  if (markdown.length < 40 && options.useBrowserFallback !== false && isBrowserSearchEnabled()) {
    const renderedHtml = await fetchRenderedHtml(trimmed, timeoutMs);
    if (renderedHtml) {
      const reExtract = extractFromHtml(renderedHtml, trimmed);
      if (reExtract.markdown.length >= 40) {
        markdown = reExtract.markdown;
        title = reExtract.title ?? title;
        byline = reExtract.byline ?? byline;
        extractedVia = reExtract.via;
        rendered = true;
      }
    }
  }

  if (markdown.length < 40) {
    return { ok: false, url: trimmed, error: 'no extractable content (page may render via JavaScript)' };
  }

  // Content safety scan on the opening of the extracted text.
  const safety = scanContentSafety(markdown.slice(0, 1000));
  if (!safety.safe) return { ok: false, url: trimmed, error: `content blocked: ${safety.reason ?? 'unsafe'}` };

  const truncated = markdown.length > maxChars;
  return {
    ok: true,
    url: trimmed,
    title,
    byline,
    extractedVia,
    rendered,
    truncated,
    markdown: truncated ? markdown.slice(0, maxChars) : markdown,
  };
}

/** Format a {@link ReadUrlResult} as a single LLM-context block (header + markdown). */
export function formatReadUrlForContext(result: ReadUrlResult): string {
  if (!result.ok) return `Could not read ${result.url}: ${result.error}`;
  const header = [
    '---',
    `SOURCE URL: ${result.url}`,
    result.title ? `TITLE: ${result.title}` : '',
    result.byline ? `BYLINE: ${result.byline}` : '',
    result.rendered ? '(rendered in a browser — JavaScript page)' : '',
    result.truncated ? '(content truncated for length)' : '',
    '---',
  ].filter(Boolean).join('\n');
  return `${header}\n\n${result.markdown ?? ''}`;
}
