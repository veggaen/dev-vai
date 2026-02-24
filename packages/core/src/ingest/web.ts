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
  // Remove non-content elements
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Try to find main content area
  const mainMatch = cleaned.match(/<main[\s\S]*?<\/main>/i)
    ?? cleaned.match(/<article[\s\S]*?<\/article>/i)
    ?? cleaned.match(/<div[^>]*(?:content|main|article|post|entry)[^>]*>[\s\S]*?<\/div>/i);

  if (mainMatch) {
    cleaned = mainMatch[0];
  }

  return stripTags(cleaned);
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
