import type { FastifyInstance } from 'fastify';
import type { ModelRegistry } from '@vai/core';

export function registerModelRoutes(app: FastifyInstance, models: ModelRegistry) {
  app.get('/api/models', async () => {
    return models.list().map((m) => ({
      id: m.id,
      displayName: m.displayName,
      supportsStreaming: m.supportsStreaming,
      supportsToolUse: m.supportsToolUse,
    }));
  });
}
