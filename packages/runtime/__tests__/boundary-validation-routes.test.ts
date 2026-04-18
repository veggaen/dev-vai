import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDb } from '@vai/core';
import { registerFeedbackRoutes } from '../src/routes/feedback.js';
import { registerIngestRoutes } from '../src/routes/ingest.js';
import { registerSearchRoutes } from '../src/routes/search.js';

describe('Boundary Validation Routes', () => {
  let app: FastifyInstance;
  const originalCaptureKey = process.env.VAI_CAPTURE_API_KEY;
  const searchPipeline = {
    search: vi.fn(async () => ({ ok: true })),
    plan: vi.fn((query: string) => ({ query, steps: [] })),
  };
  const ingestPipeline = {
    ingest: vi.fn(() => ({ ok: true })),
    search: vi.fn(() => []),
    listSources: vi.fn(() => []),
    getDashboardMetrics: vi.fn(() => ({
      ingest: {
        totalSources: 1,
        ingestedLast24h: 1,
        updatedSources: 0,
        duplicateUpdateCount: 0,
        duplicateRate: 0,
        domainHotspots: [{ domain: 'example.com', count: 1 }],
      },
      retrieval: {
        totalQueries: 0,
        lowConfidenceQueries: 0,
        lowConfidenceRate: 0,
        averageTopScore: 0,
        averageResultCount: 0,
        domainHotspots: [],
        recentTrend: [],
        recentLowConfidence: [],
      },
    })),
    getSourceDetail: vi.fn(() => null),
    reprocessAll: vi.fn(() => ({ processed: 0, total: 0, errors: 0 })),
    fixYouTubeMeta: vi.fn(() => ({ fixed: 0, alreadyCorrect: 0 })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.VAI_CAPTURE_API_KEY;
    app = Fastify({ logger: false });

    registerSearchRoutes(app, searchPipeline as any);
    registerFeedbackRoutes(app, createDb(':memory:'));
    registerIngestRoutes(app, ingestPipeline as any);

    await app.ready();
  });

  afterEach(async () => {
    if (originalCaptureKey === undefined) {
      delete process.env.VAI_CAPTURE_API_KEY;
    } else {
      process.env.VAI_CAPTURE_API_KEY = originalCaptureKey;
    }
    await app.close();
  });

  it('rejects oversized search queries but allows long search-plan previews', async () => {
    const longQuery = 'x'.repeat(1001);

    const searchRes = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: { query: longQuery },
    });

    expect(searchRes.statusCode).toBe(400);
    expect(searchRes.json()).toMatchObject({ code: 'validation' });
    expect(searchPipeline.search).not.toHaveBeenCalled();

    const planRes = await app.inject({
      method: 'POST',
      url: '/api/search/plan',
      payload: { query: longQuery },
    });

    expect(planRes.statusCode).toBe(200);
    expect(searchPipeline.plan).toHaveBeenCalledWith(longQuery);
  });

  it('accepts legacy conversationId on feedback for backward compatibility', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { conversationId: 'conv-1', messageId: 'msg-1', helpful: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('rejects invalid ingest bodies before pipeline work runs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest/web',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation' });
    expect(ingestPipeline.ingest).not.toHaveBeenCalled();
  });

  it('returns ingest dashboard metrics for the knowledge diagnostics panel', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ingest/metrics',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ingest: { totalSources: 1, ingestedLast24h: 1 },
      retrieval: { totalQueries: 0 },
    });
    expect(ingestPipeline.getDashboardMetrics).toHaveBeenCalledTimes(1);
  });

  it('blocks remote capture requests without trusted access', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/capture',
      remoteAddress: '8.8.8.8',
      payload: {
        type: 'SAVE_CONTENT',
        url: 'https://example.com',
        title: 'Example',
        content: 'Hello world',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: expect.stringMatching(/restricted to local clients/i) });
    expect(ingestPipeline.ingest).not.toHaveBeenCalled();
  });

  it('allows remote capture requests with the trusted capture key', async () => {
    process.env.VAI_CAPTURE_API_KEY = 'capture-secret';

    const res = await app.inject({
      method: 'POST',
      url: '/api/capture',
      remoteAddress: '8.8.8.8',
      headers: { 'x-vai-capture-key': 'capture-secret' },
      payload: {
        type: 'SAVE_CONTENT',
        url: 'https://example.com',
        title: 'Example',
        content: 'Hello world',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(ingestPipeline.ingest).toHaveBeenCalledTimes(1);
  });

  it('accepts forward-compatible capture payloads with extra fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/capture',
      payload: {
        type: 'SAVE_CONTENT',
        url: 'https://example.com',
        title: 'Example',
        content: 'Hello world',
        futureField: 'keep older clients working',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(ingestPipeline.ingest).toHaveBeenCalledTimes(1);
  });
});
