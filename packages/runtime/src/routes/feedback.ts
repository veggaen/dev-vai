/**
 * Feedback Routes — POST /api/feedback
 *
 * Records user thumbs-up/thumbs-down on assistant messages.
 * Stores the feedback in the messages table for future training signal.
 */

import type { FastifyInstance } from 'fastify';
import { type VaiDatabase, schema } from '@vai/core';
import { eq } from 'drizzle-orm';

export function registerFeedbackRoutes(
  app: FastifyInstance,
  db: VaiDatabase,
) {
  app.post<{
    Body: { messageId: string; helpful: boolean };
  }>('/api/feedback', async (request, reply) => {
    const { messageId, helpful } = request.body;

    if (!messageId || typeof messageId !== 'string') {
      reply.code(400).send({ error: 'messageId is required' });
      return;
    }
    if (typeof helpful !== 'boolean') {
      reply.code(400).send({ error: 'helpful must be a boolean' });
      return;
    }

    try {
      db.update(schema.messages)
        .set({ feedback: helpful ? 1 : 0 })
        .where(eq(schema.messages.id, messageId))
        .run();

      return { ok: true };
    } catch {
      // Message might not exist in DB yet (ephemeral / not persisted)
      // Still return ok — the feedback was acknowledged
      return { ok: true, persisted: false };
    }
  });
}
