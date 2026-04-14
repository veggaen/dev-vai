import { z } from 'zod';

/** Matches ChatPromptRewriteOverrides in @vai/core */
const promptRewriteOverrideSchema = z.object({
  profile: z.enum(['light', 'standard', 'strict']).optional(),
  responseDepth: z.enum(['standard', 'deep-design-memo']).optional(),
  enabled: z.boolean().optional(),
});

const imageInputSchema = z
  .object({
    data: z.string(),
    mimeType: z.string(),
    filename: z.string().optional(),
    description: z.string().min(1),
    question: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    sizeBytes: z.number().optional(),
  })
  .strict();

/**
 * Inbound WebSocket payload for /api/chat stream.
 * Strict: unknown keys rejected (explicit contracts).
 */
export const chatWebSocketInboundSchema = z
  .object({
    conversationId: z.string().min(1),
    content: z.string(),
    image: imageInputSchema.optional(),
    systemPrompt: z.string().optional(),
    allowLearn: z.boolean().optional(),
  })
  .merge(promptRewriteOverrideSchema)
  .strict();

export type ChatWebSocketInbound = z.infer<typeof chatWebSocketInboundSchema>;
