import { z } from 'zod';

export const companionContextFieldSchema = z.enum([
  'openFile',
  'selection',
  'terminalOutput',
]);

export const companionContextEvidenceSchema = z.object({
  source: z.literal('vscode-capture-adapter'),
  capturedAt: z.string().datetime({ offset: true }),
  openFile: z.string().min(1).optional(),
  selection: z.string().optional(),
  terminalOutput: z.string().optional(),
  note: z.string().optional(),
}).strict();

export const companionContextRespondBodySchema = companionContextEvidenceSchema.refine(
  (context) => context.openFile !== undefined
    || context.selection !== undefined
    || context.terminalOutput !== undefined
    || context.note !== undefined,
  'At least one captured editor field or explanatory note is required',
);

export type CompanionContextField = z.infer<typeof companionContextFieldSchema>;
export type CompanionContextEvidence = z.infer<typeof companionContextEvidenceSchema>;

export interface CompanionContextWorkItem {
  requestId: string;
  requestedFields: CompanionContextField[];
  createdAt: string;
  expiresAt: string;
}
