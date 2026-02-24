import type { FastifyInstance } from 'fastify';
import {
  IngestPipeline,
  scrapeWebPage,
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
}
