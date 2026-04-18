import { z } from 'zod';

export const handoffTargetSchema = z.enum(['desktop', 'vscode', 'cursor', 'antigravity']);
export const projectRoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer', 'tester']);
export const projectPeerStatusSchema = z.enum(['idle', 'invited', 'ready', 'active']);

const projectPeerInputSchema = z
  .object({
    peerKey: z.string().optional(),
    displayName: z.string().trim().min(1),
    ide: z.string().trim().min(1),
    model: z.string().trim().min(1),
    status: projectPeerStatusSchema.optional(),
    launchTarget: handoffTargetSchema.optional(),
    preferredClientId: z.union([z.string(), z.null()]).optional(),
    instructions: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

/** PUT /api/projects/:id/peers */
export const projectPeersBodySchema = z
  .object({
    peers: z.array(projectPeerInputSchema).optional().default([]),
  })
  .strict();

/** POST /api/projects/:id/audits */
export const createProjectAuditBodySchema = z
  .object({
    prompt: z.string().trim().min(1),
    scope: z.string().optional(),
    peerKeys: z.array(z.string()).optional(),
  })
  .strict();

/** POST /api/projects/:id/audits/:auditId/results */
export const submitProjectAuditResultBodySchema = z
  .object({
    peerKey: z.string().trim().min(1),
    verdict: z.string().trim().min(1),
    confidence: z.number().optional(),
    rationale: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

/** POST /api/projects/audits/poll-consume */
export const projectAuditPollConsumeBodySchema = z
  .object({
    target: handoffTargetSchema.optional(),
    peerKey: z.string().trim().min(1).optional(),
  })
  .strict();

/** POST /api/projects/:id/share-links */
export const projectShareLinkBodySchema = z
  .object({
    role: projectRoleSchema.optional(),
    expiresInHours: z.number().optional(),
    maxUses: z.number().optional(),
  })
  .strict();

/** POST /api/projects/:id/handoff-intents */
export const projectHandoffIntentBodySchema = z
  .object({
    target: handoffTargetSchema.optional(),
    clientInfo: z.string().optional(),
  })
  .strict();

/** POST /api/projects/handoff/consume */
export const projectHandoffConsumeBodySchema = z
  .object({
    intentToken: z.string().trim().min(1),
    target: handoffTargetSchema.optional(),
  })
  .strict();

/** POST /api/projects/handoff/poll-consume */
export const projectHandoffPollConsumeBodySchema = z
  .object({
    target: handoffTargetSchema.optional(),
  })
  .strict();

export type ProjectPeersBody = z.infer<typeof projectPeersBodySchema>;
