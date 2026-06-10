/**
 * Steering Routes — POST /api/steer
 *
 * Allows humans, AI agents, and robots to post RouteGuidance (steers).
 * This is the write path that populates the reference dataset used to
 * evaluate whether steering is delivering value or needs re-calibration.
 */

import type { FastifyInstance } from 'fastify';
import type { GuidanceStore, RouteGuidance } from '@vai/core';
import { z } from 'zod';

const postSteerSchema = z.object({
  conversationId: z.string().nullable().optional(),
  from: z.enum(['human', 'ai']),
  author: z.string().optional(),
  signal: z.enum(['avoid', 'prefer']),
  handler: z.string().min(1),
  note: z.string().optional(),
  scope: z.enum(['class', 'conversation', 'global']),
  matchTokens: z.array(z.string()).optional(),
  intent: z.string().optional(),
  weight: z.number().min(0).max(2).optional(),
  expiresAt: z.number().optional(), // epoch ms
});

export function registerSteeringRoutes(
  app: FastifyInstance,
  guidanceStore: GuidanceStore,
) {
  app.post('/api/steer', async (request, reply) => {
    const parsed = postSteerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'invalid_body', issues: parsed.error.issues });
    }
    const body = parsed.data;

    try {
      const saved: RouteGuidance = guidanceStore.save({
        conversationId: body.conversationId ?? null,
        from: body.from,
        author: body.author,
        signal: body.signal,
        handler: body.handler,
        note: body.note,
        scope: body.scope,
        matchTokens: body.matchTokens,
        intent: body.intent as any,
        weight: body.weight ?? 1,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      });

      return { ok: true, guidance: saved };
    } catch (e: any) {
      console.error('[steering] save failed', e);
      return reply.code(500).send({ ok: false, error: 'persist_failed' });
    }
  });
}
