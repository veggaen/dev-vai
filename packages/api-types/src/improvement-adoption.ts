import { z } from 'zod';

export const improvementAdoptionStatusSchema = z.enum([
  'backlog',
  'in-review',
  'approved',
  'rejected',
  'shipped',
]);

export const improvementGenerationPolicySchema = z.object({
  state: z.enum(['paused', 'active']),
  paused: z.boolean(),
  reason: z.string().min(1).max(1_000),
  minimumShipments: z.number().int().nonnegative(),
  shipped: z.number().int().nonnegative(),
  roi: z.object({
    state: z.enum([
      'insufficient-data',
      'wasteful',
      'unproven',
      'diminishing',
      'productive-plateau',
      'productive',
    ]),
    realizedPerUnit: z.number().nonnegative(),
    potentialPerUnit: z.number().nonnegative(),
    realized: z.number().int().nonnegative(),
    qualified: z.number().int().nonnegative(),
    compute: z.number().nonnegative(),
  }).strict(),
}).strict();

export const improvementAdoptionItemSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{24}$/),
  class: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  target: z.string().min(1).max(500),
  targetKnown: z.boolean(),
  observationCount: z.number().int().positive(),
  failureCount: z.number().nonnegative(),
  firstObservedAt: z.string().max(64),
  latestObservedAt: z.string().max(64),
  sourceFixIds: z.array(z.number().int().positive()).max(2_000),
  proposals: z.object({
    open: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
  }).strict(),
  status: improvementAdoptionStatusSchema,
  assignee: z.string().max(160).nullable(),
  risk: z.enum(['low', 'medium', 'high', 'critical']).nullable(),
  expiresAt: z.string().max(64).nullable(),
  decisionReason: z.string().max(1_000).nullable(),
  rollback: z.string().max(1_000).nullable(),
  evidence: z.string().max(1_000).nullable(),
  commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i).nullable(),
  computeRoundId: z.number().int().positive().nullable(),
  qualityBefore: z.number().nullable(),
  qualityAfter: z.number().nullable(),
  updatedAt: z.string().max(64).nullable(),
  score: z.number(),
}).strict();

export const improvementAdoptionBoardSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  available: z.literal(true),
  source: z.literal('self-improve:corpus'),
  stats: z.object({
    rawQueuedFixes: z.number().int().nonnegative(),
    deduplicatedItems: z.number().int().nonnegative(),
    duplicatesCollapsed: z.number().int().nonnegative(),
    openProposals: z.number().int().nonnegative(),
    rejectedProposals: z.number().int().nonnegative(),
    shipped: z.number().int().nonnegative(),
  }).strict(),
  generation: improvementGenerationPolicySchema,
  items: z.array(improvementAdoptionItemSchema).max(50),
}).strict();

export type ImprovementAdoptionBoard = z.infer<typeof improvementAdoptionBoardSchema>;
export type ImprovementAdoptionItem = z.infer<typeof improvementAdoptionItemSchema>;
