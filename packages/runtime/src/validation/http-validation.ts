import type { FastifyReply } from 'fastify';
import type { ZodError } from 'zod';

/** Standard JSON shape for Zod failures on REST bodies (matches chat WS `code: validation`). */
export function invalidRequestBody(reply: FastifyReply, error: ZodError) {
  reply.code(400);
  return {
    error: 'Invalid request body',
    code: 'validation' as const,
    issues: error.flatten(),
  };
}
