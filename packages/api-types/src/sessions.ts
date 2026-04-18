import { z } from 'zod';

export const sessionEventTypeSchema = z.enum([
  'message',
  'thinking',
  'planning',
  'context-gather',
  'checkpoint',
  'verification',
  'recovery',
  'artifact',
  'file-create',
  'file-edit',
  'file-read',
  'file-delete',
  'terminal',
  'search',
  'todo-update',
  'state-change',
  'error',
  'tool-call',
  'summary',
  'note',
]);

export const pinnedNoteCategorySchema = z.enum([
  'decision',
  'blocker',
  'breakthrough',
  'todo',
  'context',
  'custom',
]);

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
