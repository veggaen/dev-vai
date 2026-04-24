import { z } from 'zod';

const conversationModeSchema = z.enum(['chat', 'agent', 'builder', 'plan', 'debate']);

/** POST /api/conversations */
export const createConversationBodySchema = z
  .object({
    modelId: z.string().optional(),
    title: z.string().optional(),
    mode: conversationModeSchema.optional(),
    sandboxProjectId: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

/** PATCH /api/conversations/:id */
export const patchConversationBodySchema = z
  .object({
    mode: conversationModeSchema.optional(),
    sandboxProjectId: z.union([z.string(), z.null()]).optional(),
    visibility: z.enum(['private', 'unlisted', 'public']).optional(),
  })
  .strict();

/** POST /api/conversations/:id/assistant-note */
export const assistantNoteBodySchema = z
  .object({
    content: z.string().min(1, 'Assistant note content is required'),
  })
  .strict();

/** POST /api/conversations/:id/messages (non-streaming HTTP chat) */
export const postConversationMessageBodySchema = z
  .object({
    content: z.string(),
    skipPromptRewrite: z.boolean().optional(),
    profile: z.enum(['light', 'standard', 'strict']).optional(),
    responseDepth: z.enum(['standard', 'deep-design-memo']).optional(),
  })
  .strict();

export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;
export type PatchConversationBody = z.infer<typeof patchConversationBodySchema>;
