/**
 * Shared response shapes for client type-safety.
 *
 * Performance: import only as `import type { ... } from '@vai/api-types/responses'`
 * so bundlers do not include Zod or this module at runtime.
 */
import { z } from 'zod';

export const conversationModeResponseSchema = z.enum(['chat', 'agent', 'builder', 'plan', 'debate']);

/** GET /api/conversations — one row (decorated) */
export const conversationSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    modelId: z.string(),
    ownerUserId: z.string().nullable().optional(),
    sandboxProjectId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    projectName: z.string().nullable().optional(),
    mode: conversationModeResponseSchema,
    visibility: z.enum(['private', 'unlisted', 'public']).optional(),
    shareSlug: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/** POST /api/conversations */
export const createConversationResponseSchema = z
  .object({
    id: z.string(),
    sandboxProjectId: z.string().nullable().optional(),
  })
  .passthrough();

export type CreateConversationResponse = z.infer<typeof createConversationResponseSchema>;
