import type { FastifyInstance } from 'fastify';
import {
  IngestPipeline,
  scrapeWebPage,
  extractLinks,
  fetchYouTubeTranscript,
  fetchGitHubRepo,
  deepFetchGitHubRepo,
  createYouTubeCapture,
  createGitHubCapture,
} from '@vai/core';
import type { RawCapture } from '@vai/core';
import {
  captureExtensionBodySchema,
  discoverBodySchema,
  ingestGitHubDeepBodySchema,
  ingestUrlBodySchema,
} from '@vai/api-types/ingest';
import { invalidRequestBody } from '../validation/http-validation.js';
import { hasTrustedCaptureAccess } from '../security/request-trust.js';

function sanitizeCapturedContent(text: string): string {
  return text
    .replace(/password[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/api[_-]?key[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/secret[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/token[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/session[_-]?id[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/bearer\s+[\S]+/gi, '[REDACTED]')
    .replace(/\b\d{13,19}\b/g, '[CARD_NUMBER]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
}

/** Validate a URL is safe to fetch (no SSRF). */
function validateUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Only HTTP/HTTPS URLs allowed, got ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1'
      || host === '0.0.0.0' || host.endsWith('.local')
      || host.startsWith('10.') || host.startsWith('192.168.')
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      || host === '169.254.169.254') {
    throw new Error(`Private/internal URLs are not allowed: ${host}`);
  }
  return url;
}

export function registerIngestRoutes(
  app: FastifyInstance,
  pipeline: IngestPipeline,
) {
  // Ingest a web page by URL
  app.post<{ Body: { url: string } }>('/api/ingest/web', async (request, reply) => {
    const parsed = ingestUrlBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }
    const { url } = parsed.data;
    validateUrl(url);
    const capture = await scrapeWebPage(url);
    const result = pipeline.ingest(capture);
    return result;
  });

  // Ingest a YouTube video transcript by URL
  app.post<{ Body: { url: string } }>('/api/ingest/youtube', async (request, reply) => {
    const parsed = ingestUrlBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }
    const { url } = parsed.data;
    validateUrl(url);
    const capture = await fetchYouTubeTranscript(url);
    const result = pipeline.ingest(capture);
    return result;
  });

  // Ingest a GitHub repo by URL
  app.post<{ Body: { url: string } }>('/api/ingest/github', async (request, reply) => {
    const parsed = ingestUrlBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }
    const { url } = parsed.data;
    validateUrl(url);
    const capture = await fetchGitHubRepo(url);
    const result = pipeline.ingest(capture);
    return result;
  });

  // Deep-ingest a GitHub repo: fetch actual source files, group by pattern.
  // This is the "teach VAI about a repo" endpoint — much richer than basic /api/ingest/github.
  app.post<{ Body: { url: string; maxFiles?: number } }>('/api/ingest/github/deep', async (request, reply) => {
    const parsed = ingestGitHubDeepBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }
    const { url, maxFiles } = parsed.data;
    validateUrl(url);
    const captures = await deepFetchGitHubRepo(url, {
      maxFiles: maxFiles ?? 60,
      onProgress: (msg) => console.log(`[DeepIngest] ${msg}`),
    });

    const results = [];
    for (const capture of captures) {
      const result = pipeline.ingest(capture);
      results.push({ title: result.title, tokens: result.tokensLearned, group: (capture.meta as Record<string, unknown>)?.group });
    }

    const totalTokens = results.reduce((s, r) => s + r.tokens, 0);
    console.log(`[DeepIngest] ${url}: ${captures.length} groups, ${totalTokens} total tokens`);

    return {
      repo: url,
      groups: results,
      totalGroups: results.length,
      totalTokens,
    };
  });

  // Capture endpoint — receives data from Chrome extension
  app.post<{
    Body: {
      type: string;
      url: string;
      title: string;
      content: string;
      language?: string;
      meta?: Record<string, unknown>;
    };
  }>('/api/capture', async (request, reply) => {
    if (!hasTrustedCaptureAccess(request)) {
      reply.code(403);
      return {
        error: 'Capture endpoint is restricted to local clients or requests with VAI_CAPTURE_API_KEY.',
      };
    }

    const parsed = captureExtensionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }
    const { type, url, title, content, language, meta } = parsed.data;
    const sanitizedMeta = {
      ...(meta ?? {}),
      contentSanitized: true,
      sanitizedAt: new Date().toISOString(),
    };
    const sanitizedContent = sanitizeCapturedContent(content);

    let capture: RawCapture;

    switch (type) {
      case 'SAVE_TRANSCRIPT':
        capture = createYouTubeCapture(url, title, sanitizedContent, sanitizedMeta);
        break;
      case 'SAVE_GITHUB_REPO':
        capture = createGitHubCapture(url, title, sanitizedContent, undefined, sanitizedMeta);
        break;
      case 'SAVE_SEARCH':
      case 'SAVE_CONTENT':
      default:
        capture = {
          sourceType: 'web',
          url,
          title,
          content: sanitizedContent,
          language: (language as RawCapture['language']) ?? undefined,
          meta: sanitizedMeta,
        };
        break;
    }

    const result = pipeline.ingest(capture);
    return result;
  });

  // Search across ingested content
  app.get<{ Querystring: { q: string; limit?: string } }>(
    '/api/search',
    async (request) => {
      const { q, limit } = request.query;
      return pipeline.search(q, limit ? Number(limit) : 10);
    },
  );

  // Dashboard metrics for ingest health and retrieval confidence
  app.get('/api/ingest/metrics', async () => {
    return pipeline.getDashboardMetrics();
  });

  // List all ingested sources
  app.get('/api/sources', async () => {
    return pipeline.listSources();
  });

  // Get detailed info for a single source (includes full content/transcript)
  app.get<{ Params: { id: string } }>('/api/sources/:id', async (request, reply) => {
    const detail = pipeline.getSourceDetail(request.params.id);
    if (!detail) {
      return reply.status(404).send({ error: 'Source not found' });
    }
    return detail;
  });

  // Delete a source and all its chunks
  app.delete<{ Params: { id: string } }>('/api/sources/:id', async (request, reply) => {
    if (!hasTrustedCaptureAccess(request)) {
      reply.code(403);
      return { error: 'Source deletion is restricted to local clients.' };
    }
    const deleted = pipeline.deleteSource(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Source not found' });
    }
    return { ok: true };
  });

  // Re-process all existing sources with improved text cleaning
  // This re-cleans, re-chunks, re-summarizes, and re-trains on all existing content
  app.post('/api/reprocess', async (_request, _reply) => {
    const result = pipeline.reprocessAll((done, total, title) => {
      if (done % 50 === 0 || done === total) {
        console.log(`[VAI] Reprocessing: ${done}/${total} — "${title}"`);
      }
    });
    console.log(`[VAI] Reprocess complete: ${result.processed}/${result.total} sources, ${result.errors} errors`);
    return result;
  });

  // Fix YouTube hasTranscript meta based on actual content
  app.post('/api/fix-youtube-meta', async () => {
    const result = pipeline.fixYouTubeMeta();
    console.log(`[VAI] YouTube meta fix: ${result.fixed} fixed, ${result.alreadyCorrect} already correct`);
    return result;
  });

  // Discover new sources by following links from an existing source
  app.post<{ Body: { url: string; maxPages?: number } }>(
    '/api/discover',
    async (request, reply) => {
      const parsed = discoverBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const { url, maxPages = 5 } = parsed.data;
      const existingUrls = new Set(pipeline.listSources().map(s => s.url));

      // Fetch the seed page and extract links
      const res = await fetch(url, {
        headers: { 'User-Agent': 'VeggaAI/0.1 (Local AI Learning Agent)', Accept: 'text/html' },
      });
      if (!res.ok) return { discovered: 0, ingested: 0, error: `Failed to fetch ${url}` };

      const html = await res.text();
      const links = extractLinks(html, url);

      // Filter out already-known URLs
      const newLinks = links.filter(l => !existingUrls.has(l));
      const toIngest = newLinks.slice(0, maxPages);

      const results = [];
      for (const link of toIngest) {
        try {
          const capture = await scrapeWebPage(link);
          if (capture.content.length > 100) {
            const result = pipeline.ingest(capture);
            results.push({ url: link, title: result.title, tokens: result.tokensLearned });
          }
        } catch {
          // Skip failed pages
        }
      }

      return {
        discovered: newLinks.length,
        ingested: results.length,
        sources: results,
      };
    },
  );
}
