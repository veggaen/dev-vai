import { z } from 'zod';
import { companionContextEvidenceSchema } from './companion-context.js';

/** Matches ChatPromptRewriteOverrides in @vai/core */
const promptRewriteOverrideSchema = z.object({
  profile: z.enum(['light', 'standard', 'strict']).optional(),
  responseDepth: z.enum(['standard', 'deep-design-memo']).optional(),
  enabled: z.boolean().optional(),
});

const imageInputSchema = z
  .object({
    data: z.string(),
    mimeType: z.string(),
    filename: z.string().optional(),
    description: z.string().min(1),
    question: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    sizeBytes: z.number().optional(),
  })
  .strict();

/**
 * Inbound WebSocket payload for /api/chat stream.
 * Strict: unknown keys rejected (explicit contracts).
 *
 * `modelId` / `mode` are *hints*: only consulted by the server when
 * `conversationId` resolves to a missing row and the chat service has to
 * auto-create one (race recovery). Ignored on the happy path.
 */
export const chatWebSocketInboundSchema = z
  .object({
    conversationId: z.string().min(1),
    content: z.string(),
    image: imageInputSchema.optional(),
    systemPrompt: z.string().optional(),
    allowLearn: z.boolean().optional(),
    modelId: z.string().min(1).optional(),
    mode: z.enum(['chat', 'agent', 'builder', 'plan', 'debate']).optional(),
    /** Explicit "Image" input mode — when true the turn is answered with a generated image. */
    imageMode: z.boolean().optional(),
    /**
     * How much deliberation the user wants on THIS turn (composer depth control):
     *  - 'quick'    → ship the first good draft; skip the advisory council loop & escalation.
     *  - 'balanced' → default; one council review + bounded redraft within a normal budget.
     *  - 'deep'     → full multi-pass council (all seated models, thinking models included),
     *                 round-2 re-review, larger wall-clock budget. Slower but most thorough.
     * Maps to council budget + how many passes are allowed in the chat service.
     */
    processDepth: z.enum(['quick', 'balanced', 'deep']).optional(),
    // Timestamped evidence supplied by the VS Code companion. The runtime only
    // incorporates matching fields while this capture is fresh.
    editorContext: companionContextEvidenceSchema.refine(
      (context) => context.openFile !== undefined
        || context.selection !== undefined
        || context.terminalOutput !== undefined,
      'At least one captured editor field is required',
    ).optional(),
  })
  .merge(promptRewriteOverrideSchema)
  .strict();

export type ChatWebSocketInbound = z.infer<typeof chatWebSocketInboundSchema>;

export const advisorQualityContractSchema = z.object({
  answerLength: z.enum(['literal', 'short', 'medium', 'structured']),
  mustBeGuiding: z.boolean(),
  mustBeCurrent: z.boolean(),
  mustUseJson: z.boolean(),
  shouldAskClarifyingQuestion: z.boolean(),
}).strict();

export const advisorRouteGuidanceSchema = z.object({
  signal: z.enum(['prefer', 'avoid']),
  handler: z.string().min(1),
  reason: z.string().min(1),
}).strict();

/**
 * Sanitized, user-visible advice from a shadow model. This is deliberately
 * separate from the final answer: advisors can classify risks and suggest
 * routes, while Vai remains responsible for the turn.
 */
export const advisorTraceSchema = z.object({
  schemaVersion: z.literal(1),
  actorId: z.string().min(1),
  modelId: z.string().min(1),
  state: z.enum(['running', 'ready', 'invalid', 'unavailable', 'background']),
  taskShape: z.string().min(1).optional(),
  qualityContract: advisorQualityContractSchema.optional(),
  routeGuidance: z.array(advisorRouteGuidanceSchema).default([]),
  riskFlags: z.array(z.string()).default([]),
  retrievalHints: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  durationMs: z.number().nonnegative().optional(),
  error: z.string().min(1).optional(),
}).strict();

const councilProgressMemberSchema = z.object({
  memberId: z.string().min(1).optional(),
  name: z.string().min(1),
  topic: z.string().optional(),
  verdict: z.enum(['good', 'needs-work', 'bad']),
  confidence: z.number().min(0).max(1),
  durationMs: z.number().nonnegative().optional(),
  note: z.string().optional(),
  /** True while the member is still being consulted (before their note arrives). */
  pending: z.boolean().optional(),
  failed: z.boolean().optional(),
  realIntent: z.string().optional(),
  hiddenMeaning: z.string().optional(),
  missingCapability: z.string().optional(),
  methodLesson: z.string().optional(),
  suggestedAction: z.string().optional(),
  concerns: z.array(z.string()).optional(),
}).strict();

const processLogEntrySchema = z.object({
  kind: z.enum(['thought', 'read', 'action', 'event', 'show', 'artifact', 'tool', 'tool-response', 'feedback', 'verdict']),
  label: z.string().min(1),
  body: z.string().optional(),
}).strict();

const toolRunProgressSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['running', 'done', 'failed']),
  success: z.boolean().optional(),
  durationMs: z.number().nonnegative().optional(),
  input: z.string().optional(),
  output: z.string().optional(),
}).strict();

export const chatProgressStepSchema = z.object({
  stage: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().optional(),
  status: z.enum(['running', 'done']),
  advisor: advisorTraceSchema.optional(),
  /** Per-round council member snapshots for ProcessTree nesting. */
  councilMembers: z.array(councilProgressMemberSchema).optional(),
  /** Structured work/thought/action history for expandable process rows. */
  processLog: z.array(processLogEntrySchema).optional(),
  /** Agent tool batch — each tool expands to input/output in ProcessTree. */
  toolRuns: z.array(toolRunProgressSchema).optional(),
}).strict();

export type AdvisorQualityContract = z.infer<typeof advisorQualityContractSchema>;
export type AdvisorRouteGuidance = z.infer<typeof advisorRouteGuidanceSchema>;
export type AdvisorTrace = z.infer<typeof advisorTraceSchema>;
export type ChatProgressStep = z.infer<typeof chatProgressStepSchema>;
