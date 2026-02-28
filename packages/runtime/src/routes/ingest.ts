import type { FastifyInstance } from 'fastify';
import {
  IngestPipeline,
  scrapeWebPage,
  extractLinks,
  fetchYouTubeTranscript,
  fetchGitHubRepo,
  createYouTubeCapture,
  createGitHubCapture,
} from '@vai/core';
import type { RawCapture } from '@vai/core';

export function registerIngestRoutes(
  app: FastifyInstance,
  pipeline: IngestPipeline,
) {
  // Ingest a web page by URL
  app.post<{ Body: { url: string } }>('/api/ingest/web', async (request) => {
    const { url } = request.body;
    const capture = await scrapeWebPage(url);
    const result = pipeline.ingest(capture);
    return result;
  });

  // Ingest a YouTube video transcript by URL
  app.post<{ Body: { url: string } }>('/api/ingest/youtube', async (request) => {
    const { url } = request.body;
    const capture = await fetchYouTubeTranscript(url);
    const result = pipeline.ingest(capture);
    return result;
  });

  // Ingest a GitHub repo by URL
  app.post<{ Body: { url: string } }>('/api/ingest/github', async (request) => {
    const { url } = request.body;
    const capture = await fetchGitHubRepo(url);
    const result = pipeline.ingest(capture);
    return result;
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
  }>('/api/capture', async (request) => {
    const { type, url, title, content, language, meta } = request.body;

    let capture: RawCapture;

    switch (type) {
      case 'SAVE_TRANSCRIPT':
        capture = createYouTubeCapture(url, title, content, meta);
        break;
      case 'SAVE_GITHUB_REPO':
        capture = createGitHubCapture(url, title, content, undefined, meta);
        break;
      case 'SAVE_SEARCH':
      case 'SAVE_CONTENT':
      default:
        capture = {
          sourceType: 'web',
          url,
          title,
          content,
          language: (language as RawCapture['language']) ?? undefined,
          meta,
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

  // Re-process all existing sources with improved text cleaning
  // This re-cleans, re-chunks, re-summarizes, and re-trains on all existing content
  app.post('/api/reprocess', async (_request, reply) => {
    const result = pipeline.reprocessAll((done, total, title) => {
      if (done % 50 === 0 || done === total) {
        console.log(`[VAI] Reprocessing: ${done}/${total} — "${title}"`);
      }
    });
    console.log(`[VAI] Reprocess complete: ${result.processed}/${result.total} sources, ${result.errors} errors`);
    return result;
  });

  // Discover new sources by following links from an existing source
  app.post<{ Body: { url: string; maxPages?: number } }>(
    '/api/discover',
    async (request) => {
      const { url, maxPages = 5 } = request.body;
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
