import { z } from 'zod';

export const vaiBuildManifestSchema = z.object({
  schemaVersion: z.literal(1),
  commit: z.string().regex(/^[a-f0-9]{7,64}$/i),
  branch: z.string().min(1).nullable(),
  dirty: z.boolean(),
  version: z.string().min(1),
  builtAt: z.string().min(1),
  verificationReceiptSha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
export type VaiBuildManifest = z.infer<typeof vaiBuildManifestSchema>;

export const buildOperationalEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  available: z.boolean(),
  runtimeKind: z.enum(['source', 'packaged', 'unknown']),
  commit: z.string().nullable(),
  branch: z.string().nullable(),
  version: z.string().nullable(),
  builtAt: z.string().nullable(),
  dirty: z.boolean().nullable(),
  error: z.string().optional(),
}).strict();

export const repositoryOperationalEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  available: z.boolean(),
  branch: z.string().nullable(),
  changedFiles: z.number().int().nonnegative().nullable(),
  modifiedFiles: z.number().int().nonnegative().nullable(),
  untrackedFiles: z.number().int().nonnegative().nullable(),
  error: z.string().optional(),
}).strict();

export const verificationOperationalEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  available: z.boolean(),
  status: z.enum(['pass', 'fail', 'unknown']),
  capturedAt: z.string().nullable(),
  totalTestsPassed: z.number().int().nonnegative().nullable(),
  typechecks: z.array(z.string()),
  stale: z.boolean(),
  error: z.string().optional(),
}).strict();

export const selfImprovementOperationalEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  available: z.boolean(),
  queuedFixes: z.number().int().nonnegative().nullable(),
  qualified: z.number().int().nonnegative().nullable(),
  adopted: z.number().int().nonnegative().nullable(),
  pendingNominations: z.number().int().nonnegative().nullable(),
  integratedNominations: z.number().int().nonnegative().nullable(),
  latestRunStatus: z.string().nullable(),
  latestRunAt: z.string().nullable(),
  error: z.string().optional(),
}).strict();

export const vaiOperationalEvidenceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string().min(1),
  runtime: z.object({
    sourceId: z.string().min(1),
    healthy: z.boolean(),
    engine: z.string().min(1),
  }).strict(),
  build: buildOperationalEvidenceSchema,
  repository: repositoryOperationalEvidenceSchema,
  verification: verificationOperationalEvidenceSchema,
  selfImprovement: selfImprovementOperationalEvidenceSchema,
}).strict();
export type VaiOperationalEvidenceSnapshot = z.infer<typeof vaiOperationalEvidenceSnapshotSchema>;
