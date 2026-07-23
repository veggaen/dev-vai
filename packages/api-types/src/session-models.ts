import { z } from 'zod';

export const sessionStatusSchema = z.enum(['active', 'completed', 'failed']);
export const sessionEventTypeSchema = z.enum([
  'message', 'thinking', 'planning', 'context-gather', 'checkpoint',
  'verification', 'recovery', 'artifact', 'file-create', 'file-edit',
  'file-read', 'file-delete', 'terminal', 'search', 'todo-update',
  'state-change', 'error', 'tool-call', 'summary', 'note',
]);
export type SessionEventType = z.infer<typeof sessionEventTypeSchema>;

export const todoItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  status: z.enum(['not-started', 'in-progress', 'completed']),
}).strict();
export type TodoItem = z.infer<typeof todoItemSchema>;

const messageMetaSchema = z.object({
  eventType: z.literal('message'),
  role: z.enum(['user', 'assistant']),
  modelId: z.string().optional(),
}).passthrough();
const thinkingMetaSchema = z.object({
  eventType: z.literal('thinking'),
  label: z.string().optional(),
  reasoning: z.string().optional(),
  intent: z.string().optional(),
  constraints: z.array(z.string()).optional(),
}).passthrough();
const planningMetaSchema = z.object({
  eventType: z.literal('planning'),
  intent: z.string(),
  approach: z.string(),
  steps: z.array(z.string()).optional(),
  decisions: z.array(z.string()).optional(),
}).passthrough();
const contextGatherMetaSchema = z.object({
  eventType: z.literal('context-gather'),
  filesRead: z.array(z.string()),
  queriesRun: z.array(z.string()),
  findings: z.string(),
}).passthrough();
const checkpointMetaSchema = z.object({
  eventType: z.literal('checkpoint'), checkpoint: z.string(),
  status: z.enum(['started', 'completed', 'failed']), detail: z.string().optional(),
  sandboxProjectId: z.string().optional(), conversationId: z.string().optional(),
  files: z.array(z.string()).optional(), port: z.number().int().optional(),
}).passthrough();
const verificationMetaSchema = z.object({
  eventType: z.literal('verification'),
  target: z.enum(['dev-server', 'preview-runtime', 'template-preview', 'deploy-preview', 'sandbox-link']),
  status: z.enum(['started', 'passed', 'failed', 'skipped']),
  port: z.number().int().optional(), timeoutMs: z.number().optional(),
  evidence: z.array(z.string()).optional(),
}).passthrough();
const recoveryMetaSchema = z.object({
  eventType: z.literal('recovery'), strategy: z.string(),
  status: z.enum(['triggered', 'succeeded', 'failed']),
  attempt: z.number().int().optional(), maxAttempts: z.number().int().optional(),
  reason: z.string().optional(), port: z.number().int().optional(),
  files: z.array(z.string()).optional(),
}).passthrough();
const artifactMetaSchema = z.object({
  eventType: z.literal('artifact'), artifactType: z.string(), label: z.string().optional(),
  value: z.string().optional(), itemCount: z.number().int().optional(),
}).passthrough();
const fileCreateMetaSchema = z.object({
  eventType: z.literal('file-create'), filePath: z.string(), linesAdded: z.number().int(),
  language: z.string().optional(), sizeBytes: z.number().int().nonnegative().optional(),
}).passthrough();
const fileEditMetaSchema = z.object({
  eventType: z.literal('file-edit'), filePath: z.string(), linesAdded: z.number().int(),
  linesRemoved: z.number().int(), oldString: z.string().optional(), newString: z.string().optional(),
}).passthrough();
const fileReadMetaSchema = z.object({
  eventType: z.literal('file-read'), filePath: z.string(),
  startLine: z.number().int().optional(), endLine: z.number().int().optional(),
}).passthrough();
const fileDeleteMetaSchema = z.object({ eventType: z.literal('file-delete'), filePath: z.string() }).passthrough();
const terminalMetaSchema = z.object({
  eventType: z.literal('terminal'), command: z.string(), exitCode: z.number().int().optional(),
  cwd: z.string().optional(), output: z.string().optional(),
}).passthrough();
const searchMetaSchema = z.object({
  eventType: z.literal('search'), query: z.string(),
  searchType: z.enum(['grep', 'semantic', 'file', 'subagent']),
  resultCount: z.number().int().optional(),
}).passthrough();
const todoUpdateMetaSchema = z.object({ eventType: z.literal('todo-update'), todos: z.array(todoItemSchema) }).passthrough();
const stateChangeMetaSchema = z.object({
  eventType: z.literal('state-change'), state: z.string(), detail: z.string().optional(),
}).passthrough();
const errorMetaSchema = z.object({
  eventType: z.literal('error'), errorType: z.string().optional(),
  filePath: z.string().optional(), line: z.number().int().optional(),
}).passthrough();
const toolCallMetaSchema = z.object({
  eventType: z.literal('tool-call'), toolName: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(), result: z.string().optional(),
}).passthrough();
const summaryMetaSchema = z.object({
  eventType: z.literal('summary'), originalMessageCount: z.number().int(), compressedTo: z.number().int(),
}).passthrough();
const noteMetaSchema = z.object({ eventType: z.literal('note'), author: z.string().optional() }).passthrough();

export const eventMetaSchema = z.discriminatedUnion('eventType', [
  messageMetaSchema, thinkingMetaSchema, planningMetaSchema, contextGatherMetaSchema,
  checkpointMetaSchema, verificationMetaSchema, recoveryMetaSchema, artifactMetaSchema,
  fileCreateMetaSchema, fileEditMetaSchema, fileReadMetaSchema, fileDeleteMetaSchema,
  terminalMetaSchema, searchMetaSchema, todoUpdateMetaSchema, stateChangeMetaSchema,
  errorMetaSchema, toolCallMetaSchema, summaryMetaSchema, noteMetaSchema,
]);
export type EventMeta = z.infer<typeof eventMetaSchema>;
export type MessageMeta = z.infer<typeof messageMetaSchema>;
export type ThinkingMeta = z.infer<typeof thinkingMetaSchema>;
export type PlanningMeta = z.infer<typeof planningMetaSchema>;
export type ContextGatherMeta = z.infer<typeof contextGatherMetaSchema>;
export type CheckpointMeta = z.infer<typeof checkpointMetaSchema>;
export type VerificationMeta = z.infer<typeof verificationMetaSchema>;
export type RecoveryMeta = z.infer<typeof recoveryMetaSchema>;
export type ArtifactMeta = z.infer<typeof artifactMetaSchema>;
export type FileCreateMeta = z.infer<typeof fileCreateMetaSchema>;
export type FileEditMeta = z.infer<typeof fileEditMetaSchema>;
export type FileReadMeta = z.infer<typeof fileReadMetaSchema>;
export type FileDeleteMeta = z.infer<typeof fileDeleteMetaSchema>;
export type TerminalMeta = z.infer<typeof terminalMetaSchema>;
export type SearchMeta = z.infer<typeof searchMetaSchema>;
export type TodoUpdateMeta = z.infer<typeof todoUpdateMetaSchema>;
export type StateChangeMeta = z.infer<typeof stateChangeMetaSchema>;
export type ErrorMeta = z.infer<typeof errorMetaSchema>;
export type ToolCallMeta = z.infer<typeof toolCallMetaSchema>;
export type SummaryMeta = z.infer<typeof summaryMetaSchema>;
export type NoteMeta = z.infer<typeof noteMetaSchema>;

export const sessionStatsSchema = z.object({
  messageCount: z.number().int(), filesCreated: z.number().int(), filesModified: z.number().int(),
  filesRead: z.number().int(), terminalCommands: z.number().int(), thinkingBlocks: z.number().int(),
  totalTokensEstimate: z.number().int().optional(), totalDurationMs: z.number(),
  linesAdded: z.number().int(), linesRemoved: z.number().int(), todosCompleted: z.number().int(),
  todosTotal: z.number().int(), errorsEncountered: z.number().int(),
  verificationsRun: z.number().int().optional(), verificationsPassed: z.number().int().optional(),
  recoveriesTriggered: z.number().int().optional(), recoveriesSucceeded: z.number().int().optional(),
  checkpointsRecorded: z.number().int().optional(), artifactsCaptured: z.number().int().optional(),
}).strict();
export type SessionStats = z.infer<typeof sessionStatsSchema>;

export const agentSessionSchema = z.object({
  id: z.string(), title: z.string(), description: z.string().optional(), agentName: z.string(),
  modelId: z.string(), startedAt: z.number(), endedAt: z.number().optional(),
  lastActivityAt: z.number().optional(), status: sessionStatusSchema,
  stats: sessionStatsSchema, tags: z.array(z.string()),
}).strict();
export type AgentSession = z.infer<typeof agentSessionSchema>;

export const sessionEventSchema = z.object({
  id: z.string(), sessionId: z.string(), type: sessionEventTypeSchema,
  timestamp: z.number(), durationMs: z.number().optional(), content: z.string(), meta: eventMetaSchema,
}).strict();
export type SessionEvent = z.infer<typeof sessionEventSchema>;

export const pinnedNoteCategorySchema = z.enum(['decision', 'blocker', 'breakthrough', 'todo', 'context', 'custom']);
export type PinnedNoteCategory = z.infer<typeof pinnedNoteCategorySchema>;
export const pinnedNoteSchema = z.object({
  id: z.string(), sessionId: z.string(), eventId: z.string().optional(), content: z.string(),
  category: pinnedNoteCategorySchema, createdAt: z.number(), resolved: z.boolean(),
}).strict();
export type PinnedNote = z.infer<typeof pinnedNoteSchema>;

export const contextSummarySchema = z.object({
  recentSessions: z.array(z.object({
    id: z.string(), title: z.string(), status: z.string(), startedAt: z.number(), endedAt: z.number().optional(),
    stats: sessionStatsSchema, keyDecisions: z.array(z.string()), filesTouched: z.array(z.string()), errors: z.array(z.string()),
  }).strict()),
  unresolvedNotes: z.array(pinnedNoteSchema), totalSessions: z.number().int(), totalEvents: z.number().int(),
  cognitiveContext: z.string().optional(),
}).strict();
export type ContextSummary = z.infer<typeof contextSummarySchema>;

export const searchResultSchema = z.object({
  event: sessionEventSchema, sessionTitle: z.string(), sessionId: z.string(), matchScore: z.number(),
}).strict();
export type SearchResult = z.infer<typeof searchResultSchema>;

const scoreFactorSchema = z.object({ name: z.string(), weight: z.number(), raw: z.number() }).strict();
const subScoreSchema = z.object({
  value: z.number(), factors: z.array(scoreFactorSchema), explanation: z.string(), scoreable: z.boolean(),
}).strict();
export type SubScore = z.infer<typeof subScoreSchema>;
const antiPatternSchema = z.enum(['confident-bullshitter', 'verbose-hedger', 'template-matcher', 'sycophant', 'over-generator', 'literal-interpreter']);
export const conversationScoreSchema = z.object({
  sessionId: z.string(), efficiency: subScoreSchema, teachingQuality: subScoreSchema,
  antiPatterns: z.object({ score: z.number(), detections: z.array(z.object({
    pattern: antiPatternSchema, turnPairIndex: z.number().int(), severity: z.number(), evidence: z.string(),
  }).strict()) }).strict(),
  cognitiveAlignment: subScoreSchema,
  speakingDimensions: z.object({
    adaptiveDepth: subScoreSchema, proactiveReframing: subScoreSchema,
    epistemicTransparency: subScoreSchema, narrativeCoherence: subScoreSchema,
    teachingVelocity: subScoreSchema,
  }).strict(),
  conversationCurve: z.array(z.object({
    turnIndex: z.number().int(), turnScore: z.number(), cumulativeScore: z.number(), slope: z.number(),
  }).strict()),
  overall: z.number(), overallGrade: z.enum(['A+', 'A', 'B', 'C', 'D', 'F']),
  highlights: z.array(z.object({
    turnPairIndex: z.number().int(), type: z.enum(['best', 'worst', 'critical-anti-pattern']),
    reason: z.string(), score: z.number(),
  }).strict()),
  turnPairCount: z.number().int(), totalEvents: z.number().int(), scoredAt: z.number(), scorerVersion: z.string(),
}).strict();
export type ConversationScore = z.infer<typeof conversationScoreSchema>;

const lessonCategorySchema = z.enum(['breakthrough-question', 'success-pattern', 'anti-pattern', 'reasoning-chain']);
const cognitiveLessonSchema = z.object({
  id: z.string(), sessionId: z.string(), category: lessonCategorySchema, summary: z.string(), evidence: z.string(),
  turnPairIndices: z.array(z.number().int()), foundationAlignment: z.array(z.string()),
  confidence: z.number(), extractedAt: z.number(),
}).strict();
const foundationStrengthSchema = z.object({
  foundationId: z.string(), score: z.number(), lessonCount: z.number().int(),
  trend: z.enum(['improving', 'stable', 'declining']),
}).strict();
export const learningReportSchema = z.object({
  sessionId: z.string(), lessons: z.array(cognitiveLessonSchema), topBreakthroughs: z.array(z.string()),
  recurringPatterns: z.array(z.string()), avoidanceList: z.array(z.string()), reasoningExemplars: z.array(z.string()),
  cognitiveProfile: z.object({
    strongFoundations: z.array(foundationStrengthSchema), weakFoundations: z.array(foundationStrengthSchema),
    overallStrength: z.number(), improvementPriority: z.array(z.string()),
  }).strict(),
}).strict();
export type LearningReport = z.infer<typeof learningReportSchema>;

export const failurePatternSchema = z.enum([
  'wrong-file', 'wrong-approach', 'missed-requirement', 'verbose-no-code', 'infinite-loop',
  'context-drop', 'over-engineered', 'compile-error', 'none',
]);
export const sessionOutcomeSchema = z.enum(['success', 'partial', 'failure', 'abandoned', 'unknown']);
export const sessionAnalysisSchema = z.object({
  sessionId: z.string(), intent: z.string(), primaryActivity: z.string(), outcome: sessionOutcomeSchema,
  failurePattern: failurePatternSchema,
  metrics: z.object({
    totalMessages: z.number(), userMessages: z.number(), aiMessages: z.number(), thinkingBlocks: z.number(),
    filesChanged: z.number(), terminalCommands: z.number(), errorsEncountered: z.number(), planningEvents: z.number(),
    avgResponseWordCount: z.number(), concreteResponseRatio: z.number(),
  }).strict(),
  whatWorked: z.array(z.string()), whatFailed: z.array(z.string()), suggestedImprovement: z.string(),
  keyMoments: z.array(z.object({ timestamp: z.number(), type: z.string(), summary: z.string() }).strict()),
}).strict();
export type SessionAnalysis = z.infer<typeof sessionAnalysisSchema>;

const countedInsightSchema = z.object({ count: z.number(), pct: z.number() });
export const sessionInsightsAggregateSchema = z.object({
  topFailures: z.array(countedInsightSchema.extend({ pattern: failurePatternSchema })),
  topSuccessFactors: z.array(countedInsightSchema.extend({ factor: z.string() })),
  outcomeBreakdown: z.record(sessionOutcomeSchema, z.number()), avgConcreteRatio: z.number(),
  avgResponseLength: z.number(), recommendation: z.string(),
}).strict();
export type SessionInsightsAggregate = z.infer<typeof sessionInsightsAggregateSchema>;
