/**
 * Feedback Routes — POST /api/feedback
 *
 * Records user thumbs-up/thumbs-down on assistant messages.
 * Stores the feedback in the messages table for future training signal.
 */

import type { FastifyInstance } from 'fastify';
import { type VaiDatabase, schema } from '@vai/core';
import { eq } from 'drizzle-orm';
import { feedbackBodySchema } from '@vai/api-types/feedback';
import { invalidRequestBody } from '../validation/http-validation.js';

export function registerFeedbackRoutes(
  app: FastifyInstance,
  db: VaiDatabase,
) {
  app.post<{
    Body: { messageId: string; helpful: boolean };
  }>('/api/feedback', async (request, reply) => {
    const parsed = feedbackBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }
    const { messageId, helpful } = parsed.data;

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
