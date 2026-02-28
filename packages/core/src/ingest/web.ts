/**
 * Web page content extraction.
 * Fetches a URL and extracts the main readable content (strips nav, ads, etc.)
 */

import type { RawCapture } from './pipeline.js';

export async function scrapeWebPage(url: string): Promise<RawCapture> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'VeggaAI/0.1 (Local AI Learning Agent)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const title = extractTitle(html);
  const content = extractMainContent(html);

  return {
    sourceType: 'web',
    url,
    title,
    content,
    meta: {
      fetchedAt: new Date().toISOString(),
      contentLength: content.length,
      domain: new URL(url).hostname,
    },
  };
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) return stripTags(h1Match[1]).trim();

  return 'Untitled Page';
}

function extractMainContent(html: string): string {
  // Remove non-content elements (greedy — these tags can nest)
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '');

  // --- Strategy 1: Try to find a semantic main content area ---
  // Use greedy matching inside known semantic containers
  const mainMatch = cleaned.match(/<main[^>]*>([\s\S]+)<\/main>/i);
  const articleMatch = cleaned.match(/<article[^>]*>([\s\S]+)<\/article>/i);

  if (mainMatch && mainMatch[1].length > 200) {
    cleaned = mainMatch[1];
  } else if (articleMatch && articleMatch[1].length > 200) {
    cleaned = articleMatch[1];
  } else {
    // --- Strategy 2: Collect text from all content-bearing tags ---
    // This is much more robust than trying to match a single div with regex
    const contentParts: string[] = [];

    // Headings
    const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
    let hm;
    while ((hm = headingRegex.exec(cleaned)) !== null) {
      const t = stripTags(hm[1]).trim();
      if (t.length > 2) contentParts.push('\n\n' + t + '\n');
    }

    // Paragraphs — the single most important content tag
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pm;
    while ((pm = pRegex.exec(cleaned)) !== null) {
      const t = stripTags(pm[1]).trim();
      if (t.length > 10) contentParts.push(t);
    }

    // List items
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let lm;
    while ((lm = liRegex.exec(cleaned)) !== null) {
      const t = stripTags(lm[1]).trim();
      if (t.length > 5) contentParts.push('• ' + t);
    }

    // Table cells (sometimes content is in tables — e.g. wikis)
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let tm;
    while ((tm = tdRegex.exec(cleaned)) !== null) {
      const t = stripTags(tm[1]).trim();
      if (t.length > 10) contentParts.push(t);
    }

    // Blockquotes
    const bqRegex = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
    let bm;
    while ((bm = bqRegex.exec(cleaned)) !== null) {
      const t = stripTags(bm[1]).trim();
      if (t.length > 10) contentParts.push('> ' + t);
    }

    // Pre/code blocks (sometimes contain important content like code examples)
    const preRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
    let prm;
    while ((prm = preRegex.exec(cleaned)) !== null) {
      const t = stripTags(prm[1]).trim();
      if (t.length > 10) contentParts.push(t);
    }

    // Figcaption — image/figure descriptions
    const figRegex = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi;
    let fm;
    while ((fm = figRegex.exec(cleaned)) !== null) {
      const t = stripTags(fm[1]).trim();
      if (t.length > 5) contentParts.push(t);
    }

    // If tag-based extraction found substantial content, use it
    const tagContent = contentParts.join('\n').trim();
    if (tagContent.length > 200) {
      return deduplicateLines(normalizeWhitespace(tagContent));
    }

    // --- Strategy 3: Last resort — strip all tags from body ---
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]+)<\/body>/i);
    if (bodyMatch) {
      cleaned = bodyMatch[1];
    }
  }

  return normalizeWhitespace(stripTags(cleaned));
}

/**
 * Remove near-duplicate adjacent lines that occur from overlapping regex extractions.
 */
function deduplicateLines(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let prev = '';
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines that are adjacent to other empty lines
    if (!trimmed && !prev) continue;
    // Skip if identical or substring of previous
    if (trimmed && prev && (trimmed === prev || prev.includes(trimmed))) continue;
    result.push(line);
    prev = trimmed;
  }
  return result.join('\n');
}

/**
 * Normalize whitespace while preserving paragraph structure.
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')       // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')    // max 2 newlines
    .trim();
}

/**
 * Extract links from HTML that point to content pages (not assets, trackers, etc.)
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const base = new URL(baseUrl);

  const linkRegex = /<a[^>]+href=["']([^"'#]+)/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const href = match[1].trim();
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;

      const resolved = new URL(href, baseUrl).toString();
      const url = new URL(resolved);

      // Skip non-http, same-page anchors, assets
      if (!url.protocol.startsWith('http')) continue;
      if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|tar|gz)$/i.test(url.pathname)) continue;

      // Prefer same-domain or well-known content domains
      const sameDomain = url.hostname === base.hostname;
      const knownContent = /wikipedia|medium|dev\.to|github\.com|youtube\.com|stackoverflow/i.test(url.hostname);
      if (!sameDomain && !knownContent) continue;

      const clean = url.origin + url.pathname; // strip query params for dedup
      if (!seen.has(clean)) {
        seen.add(clean);
        links.push(resolved);
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return links.slice(0, 20); // Cap at 20 links per page
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
