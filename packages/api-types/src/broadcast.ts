import { z } from 'zod';

const broadcastMetaSchema = z
  .object({
    preferredModel: z.string().optional(),
    targetChatApp: z.string().optional(),
    targetSessionId: z.string().optional(),
  })
  .strict();

/** POST /api/broadcasts */
export const createBroadcastBodySchema = z
  .object({
    content: z.string().trim().min(1, 'Message content is required'),
    projectId: z.string().optional(),
    targetClientIds: z.array(z.string()).optional(),
    ttlMs: z.number().optional(),
    meta: broadcastMetaSchema.optional(),
  })
  .strict();

const broadcastResponseMetaSchema = z
  .object({
    model: z.string().optional(),
    tokensIn: z.number().optional(),
    tokensOut: z.number().optional(),
    durationMs: z.number().optional(),
  })
  .strict();

/** POST /api/broadcasts/deliveries/:deliveryId/respond */
export const broadcastRespondBodySchema = z
  .object({
    responseContent: z.string().trim().min(1, 'Response content is required'),
    meta: broadcastResponseMetaSchema.optional(),
  })
  .strict();

const companionModelEntrySchema = z.object({
  id: z.string(),
  family: z.string(),
  name: z.string(),
  vendor: z.string(),
});

/** PATCH /api/companion-clients/models */
export const companionModelsBodySchema = z
  .object({
    models: z.array(companionModelEntrySchema),
  })
  .strict();

/** PATCH /api/companion-clients/chat-info */
export const companionChatInfoBodySchema = z
  .object({
    chatApps: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
      }),
    ),
    sessions: z.array(
      z.object({
        sessionId: z.string(),
        title: z.string(),
        lastModified: z.number(),
        chatApp: z.string(),
      }),
    ),
  })
  .strict();

export type CreateBroadcastBody = z.infer<typeof createBroadcastBodySchema>;
