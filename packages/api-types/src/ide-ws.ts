import { z } from 'zod';

/** Review status for a file edit proposal. */
export const reviewStatusSchema = z.enum(['pending', 'approved', 'rejected']);

export const editAuthorSchema = z.object({
  memberId: z.string().min(1),
  role: z.string().optional(),
}).strict();

export const fileEditProposalSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  before: z.string().nullable(),
  after: z.string().nullable(),
  summary: z.string(),
  author: editAuthorSchema,
  status: reviewStatusSchema,
}).strict();

export const workspaceRefSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  attachedAt: z.string().min(1),
}).strict();

export const ideEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ide.workspace.attached'),
    workspace: workspaceRefSchema,
  }).strict(),
  z.object({ type: z.literal('ide.workspace.detached') }).strict(),
  z.object({
    type: z.literal('ide.proposal.created'),
    proposals: z.array(fileEditProposalSchema).min(1),
  }).strict(),
  z.object({
    type: z.literal('ide.proposal.updated'),
    id: z.string().min(1),
    status: reviewStatusSchema,
  }).strict(),
  z.object({
    type: z.literal('ide.checkpoint.created'),
    id: z.string().min(1),
    label: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('ide.apply.started'),
    proposalIds: z.array(z.string().min(1)),
  }).strict(),
  z.object({
    type: z.literal('ide.apply.done'),
    applied: z.array(z.string().min(1)),
    failed: z.array(z.object({ id: z.string().min(1), error: z.string() }).strict()).default([]),
  }).strict(),
  z.object({
    type: z.literal('ide.gate.result'),
    gate: z.enum(['tsc', 'visual', 'test']),
    pass: z.boolean(),
    detail: z.string(),
  }).strict(),
  z.object({ type: z.literal('ide.turn.quiescent') }).strict(),
]);

export type IdeEvent = z.infer<typeof ideEventSchema>;
export type FileEditProposalWire = z.infer<typeof fileEditProposalSchema>;
export type WorkspaceRefWire = z.infer<typeof workspaceRefSchema>;