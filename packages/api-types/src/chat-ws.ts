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
    /**
     * Explicit per-turn council seat selection (composer roundtable picker).
     * Omitted / empty → the full configured roster ("full roundtable", the default).
     * Present → only the named members are seated for THIS turn; an explicit pick
     * bypasses the balanced-depth delegation cap because the user chose the tradeoff.
     * Ids come from GET /api/council/config `activeMembers[].id`.
     */
    councilModelIds: z.array(z.string().min(1)).max(24).optional(),
    // Timestamped evidence supplied by the VS Code companion. The runtime only
    // incorporates matching fields while this capture is fresh.
    editorContext: companionContextEvidenceSchema.refine(
      (context) => context.openFile !== undefined
        || context.selection !== undefined
        || context.terminalOutput !== undefined,
      'At least one captured editor field is required',
    ).optional(),
    /** Absolute path to an attached local workspace folder (desktop). */
    workspaceRoot: z.string().min(1).optional(),
    /** When true (default), file extracts become diff proposals instead of silent writes. */
    requireDiffApproval: z.boolean().optional(),
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
  /** Live rolling preview of the advisor model's reasoning as it streams (thinking out loud). */
  reasoningPreview: z.string().optional(),
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
  /**
   * Live, rolling preview of the member's own reasoning as it generates — the model
   * "thinking out loud" (DeepSeek-R1's <think> channel, or qwen's content as it streams).
   * Present while `pending` so the UI can show what each model is actually working through
   * instead of a bare "qwen is working". Capped/sanitized upstream; advisory only — the
   * fact-quarantine still holds (this never becomes a user-facing fact). Cleared once the
   * structured note arrives.
   */
  reasoningPreview: z.string().optional(),
  /** Short label for the member's lens/role on the panel (e.g. "reasoning", "code"). */
  role: z.string().optional(),
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

/**
 * One candidate answer in the first-draft race. Vai and every council member
 * each produce a draft; `provisional: true` marks Vai's quick take, which the
 * UI may show to the user immediately while the race continues.
 */
const draftCandidateSchema = z.object({
  authorId: z.string().min(1),
  authorName: z.string().min(1),
  modelId: z.string().optional(),
  /** Draft text (capped upstream). Empty while `pending`. */
  text: z.string(),
  provisional: z.boolean().optional(),
  pending: z.boolean().optional(),
  failed: z.boolean().optional(),
  durationMs: z.number().nonnegative().optional(),
}).strict();

/** One member's scoring pass over all candidates (authorId → 0-100). */
const draftVoteSchema = z.object({
  voterId: z.string().min(1),
  voterName: z.string().min(1),
  scores: z.record(z.string(), z.number().min(0).max(100)),
  note: z.string().optional(),
  pending: z.boolean().optional(),
  failed: z.boolean().optional(),
}).strict();

/**
 * Live state of the first-draft race: everyone drafts, everyone votes,
 * highest total wins (ties break toward Vai). The winner becomes the base
 * draft for the existing approval-gate rounds.
 */
const draftRaceProgressSchema = z.object({
  status: z.enum(['drafting', 'voting', 'decided']),
  candidates: z.array(draftCandidateSchema),
  votes: z.array(draftVoteSchema).default([]),
  winnerId: z.string().optional(),
  tieBrokenToVai: z.boolean().optional(),
}).strict();

export const chatProgressStepSchema = z.object({
  stage: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().optional(),
  status: z.enum(['running', 'done']),
  /** Wall-clock cost of this step, attached when the stage settles — lets the timeline answer "where did time go". */
  durationMs: z.number().nonnegative().optional(),
  advisor: advisorTraceSchema.optional(),
  /** Per-round council member snapshots for ProcessTree nesting. */
  councilMembers: z.array(councilProgressMemberSchema).optional(),
  /** Structured work/thought/action history for expandable process rows. */
  processLog: z.array(processLogEntrySchema).optional(),
  /** Agent tool batch — each tool expands to input/output in ProcessTree. */
  toolRuns: z.array(toolRunProgressSchema).optional(),
  /** First-draft race snapshot (stage `first-drafts` / `draft-vote`). */
  draftRace: draftRaceProgressSchema.optional(),
}).strict();

export type AdvisorQualityContract = z.infer<typeof advisorQualityContractSchema>;
export type AdvisorRouteGuidance = z.infer<typeof advisorRouteGuidanceSchema>;
export type AdvisorTrace = z.infer<typeof advisorTraceSchema>;
export type ChatProgressStep = z.infer<typeof chatProgressStepSchema>;
export type DraftCandidate = z.infer<typeof draftCandidateSchema>;
export type DraftVote = z.infer<typeof draftVoteSchema>;
export type DraftRaceProgress = z.infer<typeof draftRaceProgressSchema>;
