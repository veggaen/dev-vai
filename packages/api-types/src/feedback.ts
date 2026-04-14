import { z } from 'zod';

/**
 * POST /api/feedback
 *
 * `conversationId` is accepted for backward compatibility with older desktop
 * clients, but the route only needs `messageId` + `helpful`.
 */
export const feedbackBodySchema = z
  .object({
    conversationId: z.string().min(1).optional(),
    messageId: z.string().min(1),
    helpful: z.boolean(),
  })
  .strict();
