import type { FastifyInstance } from 'fastify';
import type { ModelRegistry } from '@vai/core';

export function registerModelRoutes(app: FastifyInstance, models: ModelRegistry) {
  app.get('/api/models', async () => {
    return models.list().map((m) => ({
      id: m.id,
      displayName: m.displayName,
      provider: m.provider ?? 'unknown',
      supportsStreaming: m.supportsStreaming,
      supportsToolUse: m.supportsToolUse,
      capabilities: m.capabilities ?? null,
      contextWindow: m.contextWindow ?? null,
      maxOutputTokens: m.maxOutputTokens ?? null,
      speedTier: m.speedTier ?? null,
      qualityTier: m.qualityTier ?? null,
      cost: m.cost ?? null,
    }));
  });

  /** Health check for a specific model adapter */
  app.get<{ Params: { id: string } }>('/api/models/:id/health', async (request) => {
    const adapter = models.tryGet(request.params.id);
    if (!adapter) return { id: request.params.id, status: 'not_found' };

    if (!adapter.healthCheck) return { id: adapter.id, status: 'ok', note: 'no health check implemented' };

    try {
      const healthy = await adapter.healthCheck();
      return { id: adapter.id, status: healthy ? 'ok' : 'unhealthy' };
    } catch (err) {
      return { id: adapter.id, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  });
}
