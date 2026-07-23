import { z } from 'zod';
import { agentSessionSchema, sessionEventSchema } from './session-models.js';

export const capabilityScopeSchema = z.enum(['read-only', 'no-shell', 'no-network', 'full']);
export type CapabilityScope = z.infer<typeof capabilityScopeSchema>;
export const toolCapabilitySchema = z.enum(['read', 'write', 'shell', 'network', 'git', 'process']);
export type ToolCapability = z.infer<typeof toolCapabilitySchema>;
export const capabilityGrantSchema = z.object({
  workspaceId: z.string().min(1), sessionId: z.string().min(1).optional(),
  workspaceScope: capabilityScopeSchema, sessionScope: capabilityScopeSchema.optional(),
  grantedBy: z.enum(['default', 'user', 'policy']), grantedById: z.string().min(1).optional(), grantedAt: z.number(),
}).strict();
export type CapabilityGrant = z.infer<typeof capabilityGrantSchema>;
export const capabilityGrantInputSchema = z.object({
  workspaceId: z.string().min(1), sessionId: z.string().min(1).optional(), scope: capabilityScopeSchema,
}).strict();

const agentEventBaseSchema = z.object({
  schemaVersion: z.literal(1), sessionId: z.string(), sequence: z.number().int().nonnegative(),
  providerId: z.string(), timestamp: z.number(),
});
export const agentProcessEventSchema = z.discriminatedUnion('type', [
  agentEventBaseSchema.extend({ type: z.literal('started'), pid: z.number().int().optional() }).strict(),
  agentEventBaseSchema.extend({ type: z.literal('text-delta'), text: z.string() }).strict(),
  agentEventBaseSchema.extend({ type: z.literal('tool'), name: z.string(), payload: z.unknown() }).strict(),
  agentEventBaseSchema.extend({ type: z.literal('diagnostic'), stream: z.enum(['stdout', 'stderr']), text: z.string() }).strict(),
  agentEventBaseSchema.extend({ type: z.literal('completed'), exitCode: z.number().int(), resumableCursor: z.string().optional() }).strict(),
  agentEventBaseSchema.extend({
    type: z.literal('failed'), code: z.enum(['spawn', 'protocol', 'timeout', 'cancelled', 'exit', 'interrupted']),
    message: z.string(), exitCode: z.number().int().optional(), diagnostic: z.string().optional(),
  }).strict(),
]);
export type AgentProcessEvent = z.infer<typeof agentProcessEventSchema>;

export const agentLaunchRequestSchema = z.object({
  sessionId: z.string().min(1), providerId: z.string().min(1), prompt: z.string().min(1),
  workspaceRoot: z.string().min(1), modelId: z.string().optional(), personaIds: z.array(z.string()).max(8).default([]),
  workspaceScope: capabilityScopeSchema.default('read-only'), sessionScope: capabilityScopeSchema.optional(),
}).strict();
export type AgentLaunchRequest = z.infer<typeof agentLaunchRequestSchema>;

export const agentSessionSnapshotSchema = z.object({
  sessionId: z.string(), providerId: z.string(), state: z.enum(['starting', 'running', 'completed', 'failed', 'cancelled']),
  pid: z.number().int().optional(), workspaceRoot: z.string(), worktreeRoot: z.string().optional(),
  startedAt: z.number(), completedAt: z.number().optional(), lastSequence: z.number().int().nonnegative(),
  resumableCursor: z.string().optional(), failure: z.string().optional(),
}).strict();
export type AgentSessionSnapshot = z.infer<typeof agentSessionSnapshotSchema>;

export const agentSessionEventsResponseSchema = z.object({
  session: agentSessionSnapshotSchema, events: z.array(agentProcessEventSchema), nextSequence: z.number().int().nonnegative(),
}).strict();

export const connectionTransportSchema = z.enum(['loopback', 'lan', 'private-mesh', 'https', 'ssh']);
export const environmentSchema = z.object({
  id: z.string(), name: z.string(), transport: connectionTransportSchema,
  endpoint: z.string(), deviceLabel: z.string(), trust: z.enum(['local', 'paired', 'unverified']),
  credentialId: z.string().optional(), exposed: z.boolean(),
  createdAt: z.number(), updatedAt: z.number(), lastHealthAt: z.number().optional(),
}).strict();
export type SavedEnvironment = z.infer<typeof environmentSchema>;
export const environmentInputSchema = z.object({
  name: z.string().min(1).max(100), transport: connectionTransportSchema,
  endpoint: z.string().min(1), deviceLabel: z.string().min(1).max(120), exposed: z.boolean().default(false),
}).strict();

export const pairingTokenSchema = z.object({
  id: z.string(), secret: z.string().min(32), integrationId: z.string(),
  expiresAt: z.number(), scopes: z.array(z.string()), usedAt: z.number().optional(),
}).strict();
export const pairedSessionSchema = z.object({
  id: z.string(), environmentId: z.string(), integrationId: z.string(), credentialId: z.string(),
  scopes: z.array(z.string()), createdAt: z.number(), expiresAt: z.number().optional(), revokedAt: z.number().optional(),
}).strict();
export type PairedSession = z.infer<typeof pairedSessionSchema>;
export const createPairingTokenRequestSchema = z.object({
  integrationId: z.string().min(1), scopes: z.array(z.string().min(1)).min(1).max(20), environmentId: z.string().min(1),
}).strict();
export const pairingExchangeRequestSchema = z.object({
  token: z.string().min(32), deviceLabel: z.string().min(1),
}).strict();

export const sshLaunchRequestSchema = z.object({
  target: z.string().min(1), environmentId: z.string().min(1), remoteRoot: z.string().min(1),
  localPort: z.number().int().min(1024).max(65535), remotePort: z.number().int().min(1024).max(65535),
}).strict();
export const sshCheckSchema = z.object({
  id: z.string(), ok: z.boolean(), detail: z.string(), diagnosticCommand: z.string(), output: z.string().optional(),
}).strict();
export const sshLaunchResultSchema = z.object({
  ok: z.boolean(), platform: z.enum(['windows', 'posix', 'unknown']), checks: z.array(sshCheckSchema),
  nodePath: z.string().optional(), launcherPath: z.string().optional(), tunnelCommand: z.string().optional(), nextAction: z.string(),
}).strict();
export type SshLaunchResult = z.infer<typeof sshLaunchResultSchema>;

export const memoryRecordSchema = z.object({
  id: z.string(), scope: z.enum(['user', 'workspace', 'session']), workspaceId: z.string().optional(),
  sessionId: z.string().optional(), content: z.string(), origin: z.string(), confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()), createdAt: z.number(), updatedAt: z.number(), deletedAt: z.number().optional(),
  revision: z.number().int().positive(),
}).strict();
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

/** Governed conversation memory as persisted by the current runtime store. */
export const governedMemorySchema = z.object({
  id: z.string(), userId: z.string(), conversationId: z.string().nullable(),
  kind: z.enum(['decision', 'project', 'preference', 'fact']), content: z.string(),
  sourceExcerpt: z.string().nullable(), status: z.enum(['active', 'archived']),
  createdAt: z.coerce.date(), updatedAt: z.coerce.date(),
}).strict();
export type GovernedMemory = z.infer<typeof governedMemorySchema>;

export const skillRecordSchema = z.object({
  id: z.string(), name: z.string(), content: z.string(), author: z.enum(['user', 'agent', 'system']),
  confidence: z.number().min(0).max(1), successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(), lastObservedAt: z.number().optional(),
  capabilityCeiling: capabilityScopeSchema, flagged: z.boolean(), createdAt: z.number(), updatedAt: z.number(),
}).strict();
export type SkillRecord = z.infer<typeof skillRecordSchema>;
export const skillRecordInputSchema = z.object({
  name: z.string().min(1).max(120), content: z.string().min(1).max(120_000), author: z.enum(['user', 'agent', 'system']),
  capabilityCeiling: capabilityScopeSchema.default('read-only'),
}).strict();
export const skillObservationSchema = z.object({ success: z.boolean(), evidence: z.string().min(1).max(2_000) }).strict();

export const personaSchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), systemPrompt: z.string(),
  preferredModelId: z.string().optional(), capabilityCeiling: capabilityScopeSchema,
  owner: z.enum(['user', 'system']), version: z.number().int().positive(),
  createdAt: z.number(), updatedAt: z.number(),
}).strict();
export type Persona = z.infer<typeof personaSchema>;
export const personaInputSchema = z.object({
  name: z.string().min(1).max(80), description: z.string().max(500), systemPrompt: z.string().min(1).max(20_000),
  preferredModelId: z.string().optional(), capabilityCeiling: capabilityScopeSchema.default('read-only'),
}).strict();

const blindCandidateSchema = z.object({ laneId: z.string(), text: z.string(), durationMs: z.number().nonnegative() }).strict();
export const blindComparisonRequestSchema = z.object({
  prompt: z.string().min(1), modelIds: z.array(z.string().min(1)).min(2).max(4), personaIds: z.array(z.string()).max(4).default([]),
}).strict();
export const blindComparisonSessionSchema = z.object({
  id: z.string(), prompt: z.string(), candidates: z.array(blindCandidateSchema).min(2), createdAt: z.number(),
  selectedLaneId: z.string().optional(), revealed: z.record(z.string(), z.object({ modelId: z.string(), personaIds: z.array(z.string()) }).strict()).optional(),
}).strict();
export type BlindComparisonSession = z.infer<typeof blindComparisonSessionSchema>;
export const blindComparisonVoteSchema = z.object({ laneId: z.string() }).strict();

export const contextBudgetReceiptSchema = z.object({
  modelId: z.string(), contextWindow: z.number().int().positive(), reservedTokens: z.number().int().nonnegative(),
  included: z.array(z.object({ id: z.string(), tier: z.number().int().min(0).max(4),
    kind: z.enum(['system', 'turn', 'workspace', 'session', 'memory', 'skill', 'tool-schema', 'history', 'evidence']),
    estimatedTokens: z.number().int().nonnegative(), reason: z.string(),
  }).strict()),
  excluded: z.array(z.object({ id: z.string(), reason: z.string() }).strict()),
  totalEstimatedTokens: z.number().int().nonnegative(),
}).strict();
export type ContextBudgetReceipt = z.infer<typeof contextBudgetReceiptSchema>;

export const outboxItemSchema = z.object({
  id: z.string(), environmentId: z.string(), kind: z.string(), payload: z.unknown(),
  createdAt: z.number(), attempts: z.number().int().nonnegative(), state: z.enum(['pending', 'sending', 'failed']),
  lastError: z.string().optional(),
}).strict();
export type OutboxItem = z.infer<typeof outboxItemSchema>;

export const healthStateSchema = z.enum(['healthy', 'degraded', 'offline', 'starting', 'unknown']);
export const subsystemHealthSchema = z.object({
  id: z.string(), label: z.string(), state: healthStateSchema, optional: z.boolean(),
  checkedAt: z.number(), latencyMs: z.number().nonnegative().optional(), cause: z.string().optional(),
  impact: z.string(), nextAction: z.string().optional(), evidenceRef: z.string().optional(),
}).strict();
export type SubsystemHealth = z.infer<typeof subsystemHealthSchema>;
export const healthSnapshotSchema = z.object({
  generatedAt: z.number(), overall: healthStateSchema, subsystems: z.array(subsystemHealthSchema),
}).strict();
export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>;

export const diagnosticFailureSchema = z.object({
  check: z.string(), command: z.string(), output: z.string(), nextAction: z.string(),
}).strict();
export const hardwareProfileSchema = z.object({
  platform: z.string(), cpu: z.string(), logicalCores: z.number().int().positive(), ramBytes: z.number().nonnegative(),
  gpus: z.array(z.object({ name: z.string(), vramBytes: z.number().nonnegative().optional(), backend: z.string() }).strict()),
  failures: z.array(diagnosticFailureSchema), scannedAt: z.number(),
}).strict();
export type HardwareProfile = z.infer<typeof hardwareProfileSchema>;
export const modelFitSchema = z.object({
  modelId: z.string(), score: z.number().min(0).max(100), fits: z.boolean(),
  fitLabel: z.enum(['excellent', 'good', 'tight', 'does-not-fit', 'unknown']),
  estimatedBytes: z.number().nonnegative().optional(), quantization: z.string().optional(), backend: z.string(),
  reasons: z.array(z.string()), nextAction: z.string().optional(),
}).strict();
export type ModelFit = z.infer<typeof modelFitSchema>;
export const hardwareModelReportSchema = z.object({ hardware: hardwareProfileSchema, models: z.array(modelFitSchema) }).strict();

export const shareProtectionSchema = z.enum(['public', 'authenticated', 'token', 'private']);
export const shareManifestItemSchema = z.object({
  objectId: z.string(), path: z.string(), slug: z.string(), protection: shareProtectionSchema,
  included: z.boolean(), checksum: z.string().optional(), content: z.string().optional(), themeCss: z.string().optional(),
}).strict();
export const shareManifestSchema = z.object({
  schemaVersion: z.literal(1), id: z.string(), workspaceId: z.string(), revision: z.number().int().positive(),
  items: z.array(shareManifestItemSchema), createdAt: z.number(), updatedAt: z.number(),
}).strict();
export type ShareManifest = z.infer<typeof shareManifestSchema>;
export const shareManifestInputSchema = z.object({
  workspaceId: z.string().min(1), items: z.array(shareManifestItemSchema.omit({ checksum: true })).min(1),
}).strict();
export const sharePublishReceiptSchema = z.object({
  manifest: shareManifestSchema, publishedAt: z.number(), permalinkBase: z.string(), changedItems: z.number().int().nonnegative(),
}).strict();
export const customDomainRequestSchema = z.object({ domain: z.string().min(3) }).strict();
export const customDomainResultSchema = z.object({
  domain: z.string(), verified: z.boolean(), records: z.array(z.string()), expectedTarget: z.string(),
  diagnostic: z.string(), nextAction: z.string(),
}).strict();

export const linkedObjectSchema = z.object({
  id: z.string(), kind: z.enum(['file', 'heading', 'session', 'run', 'doc', 'memory', 'share']),
  label: z.string(), path: z.string().optional(), targetId: z.string().optional(), updatedAt: z.number(),
}).strict();
export type LinkedObject = z.infer<typeof linkedObjectSchema>;
export const linkIndexUpdateSchema = z.object({
  workspaceId: z.string().min(1), object: linkedObjectSchema, content: z.string(),
}).strict();
export const linkEdgeSchema = z.object({
  workspaceId: z.string(), sourceId: z.string(), targetRef: z.string(), label: z.string(), updatedAt: z.number(),
}).strict();
export type LinkEdge = z.infer<typeof linkEdgeSchema>;

export const exportBundleSchema = z.object({
  schemaVersion: z.literal(1), exportedAt: z.number(),
  personas: z.array(personaSchema), skills: z.array(skillRecordSchema), environments: z.array(environmentSchema),
  memories: z.array(governedMemorySchema), sessions: z.array(z.object({
    session: agentSessionSchema,
    events: z.array(sessionEventSchema.extend({ meta: z.record(z.string(), z.unknown()) }).strict()),
  }).strict()), shares: z.array(shareManifestSchema), links: z.array(linkedObjectSchema),
}).strict();
export type ExportBundle = z.infer<typeof exportBundleSchema>;
export const restoreBundleRequestSchema = z.object({
  bundle: exportBundleSchema,
  dryRun: z.boolean().default(true),
  overwrite: z.boolean().default(false),
}).strict();
export const restoreFolderRequestSchema = z.object({
  sourceFolder: z.string().min(1),
  dryRun: z.boolean().default(true),
  overwrite: z.boolean().default(false),
}).strict();
export const backupManifestSchema = z.object({
  schemaVersion: z.literal(1), exportedAt: z.number(),
  files: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9-]*\.json$/), z.object({
    bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()),
}).strict();
export const restoreBundleReportSchema = z.object({
  dryRun: z.boolean(), overwrite: z.boolean(),
  conflicts: z.array(z.string()),
  wouldApply: z.record(z.string(), z.number().int().nonnegative()),
  applied: z.record(z.string(), z.number().int().nonnegative()),
}).strict();
export type RestoreBundleReport = z.infer<typeof restoreBundleReportSchema>;

export const pluginHostMessageSchema = z.object({
  schemaVersion: z.literal(1), pluginId: z.string(), requestId: z.string(),
  type: z.enum(['request', 'response', 'event', 'error']), action: z.string(), payload: z.unknown(),
}).strict();
export type PluginHostMessage = z.infer<typeof pluginHostMessageSchema>;

export const blindComparisonSchema = z.object({
  id: z.string(), prompt: z.string(), leftLaneId: z.string(), rightLaneId: z.string(),
  assignmentSeed: z.string(), selected: z.enum(['left', 'right', 'tie']).optional(),
  selectedAt: z.number().optional(), revealedAt: z.number().optional(),
}).strict();
export type BlindComparison = z.infer<typeof blindComparisonSchema>;
