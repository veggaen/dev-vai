import { z } from 'zod';
import { pinnedNoteCategorySchema, sessionEventTypeSchema } from './session-models.js';

export { pinnedNoteCategorySchema, sessionEventTypeSchema } from './session-models.js';

const sessionEventInputSchema = z
  .object({
    type: sessionEventTypeSchema,
    timestamp: z.number().optional(),
    durationMs: z.number().optional(),
    content: z.string(),
    meta: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .strict();

/** POST /api/sessions */
export const createSessionBodySchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().optional(),
    agentName: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    tags: z.array(z.string()).optional(),
  })
  .strict();

/** PATCH /api/sessions/:id */
export const patchSessionBodySchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

/** POST /api/sessions/import */
export const importSessionBodySchema = z
  .object({
    session: z.record(z.string(), z.unknown()),
    events: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

/** POST /api/sessions/:id/events */
export const sessionEventsBodySchema = z
  .object({
    events: z.array(sessionEventInputSchema).min(1),
  })
  .strict();

/** POST /api/sessions/:id/events/:eventId/pin */
export const sessionEventPinBodySchema = z
  .object({
    pinned: z.boolean().optional(),
  })
  .strict();

/** POST /api/sessions/:id/end */
export const endSessionBodySchema = z
  .object({
    status: z.enum(['completed', 'failed']).optional(),
  })
  .strict();

/** POST /api/sessions/:id/notes */
export const sessionNoteBodySchema = z
  .object({
    content: z.string().trim().min(1),
    category: pinnedNoteCategorySchema.optional(),
    eventId: z.string().optional(),
  })
  .strict();

export type CreateSessionBody = z.infer<typeof createSessionBodySchema>;
export type PatchSessionBody = z.infer<typeof patchSessionBodySchema>;
