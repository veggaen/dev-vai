// Database
export { getDb, createDb, resetDbInstance, getRawDb } from './db/client.js';
export type { VaiDatabase } from './db/client.js';
export * as schema from './db/schema.js';

// Config
export { loadConfig, printConfigDiagnostic, getModelProfile, listModelIds } from './config/index.js';
export type { VaiConfig, ProviderConfig, ProviderId, ModelProfile, ModelCapabilities, ModelCost, RoutingRule, FallbackChain } from './config/index.js';

// Models
export {
  ModelRegistry,
  type ModelAdapter,
  type ChatRequest,
  type ChatResponse,
  type ChatChunk,
  type SearchSource,
  type Message,
  type ToolCall,
  type ToolDefinition,
  type TokenUsage,
} from './models/adapter.js';
export { VaiEngine, VaiTokenizer, KnowledgeStore } from './models/vai-engine.js';
export type { KnowledgeEntry, VaiEngineOptions, VaiSnapshot, ResponseMeta, VaiDiagnosis } from './models/vai-engine.js';
export { KnowledgeIntelligence, classifyQuestionCategory } from './models/knowledge-intelligence.js';
export type { AtomicFact, FactType, SubPattern, Connection, DuplicateGroup, HygieneReport, SubQuestion, SubAnswer, CompositeAnswer, QuestionType, QuestionCategory, InterrogativeType, ProceduralType, OperationalType } from './models/knowledge-intelligence.js';

// Chat
export { ChatService } from './chat/service.js';
export type { ImageInput } from './chat/service.js';
export type { ConversationRecord, MessageRecord, ImageRecord } from './chat/types.js';

// Ingestion
export { IngestPipeline } from './ingest/pipeline.js';
export type { IngestResult, RawCapture } from './ingest/pipeline.js';
export { scrapeWebPage, extractLinks } from './ingest/web.js';
export { fetchYouTubeTranscript, extractVideoId, createYouTubeCapture } from './ingest/youtube.js';
export { fetchGitHubRepo, deepFetchGitHubRepo, parseGitHubUrl, createGitHubCapture } from './ingest/github.js';

// Search Pipeline (Perplexity-style structured search)
export { SearchPipeline, buildSearchPlan, validateSearchUrl, scoreDomain, scanContentSafety, contentFingerprint, assessUrl, DEFAULT_SEARCH_CONFIG } from './search/index.js';
export type { VaiSearchPlan, SearchConstraints, TrustTier, TrustSignal, SearchSnippet, SearchResponse, AuditEntry, SearchPipelineConfig, UrlAssessment } from './search/index.js';

// Tools
export { ToolRegistry } from './tools/registry.js';
export { ToolExecutor } from './tools/executor.js';
export type { Tool, ToolContext, ToolResult } from './tools/interface.js';
export type { ToolExecutorConfig, ToolExecutionResult, AgentLoopResult } from './tools/executor.js';

// Usage Tracking
export { UsageService } from './usage/index.js';
export type { UsageRecord, UsageSummary } from './usage/index.js';

// Eval Framework
export { EvalRunner, registerEvalTasks, getEvalTasks, getEvalTracks, computeGrade } from './eval/index.js';
export type {
  EvalTrack, EvalTask, EvalExpectation, EvalTaskResult,
  EvalRunResult, EvalRunConfig, EvalRunSummary,
} from './eval/index.js';

// Sessions (Agent Dev Logs)
export { SessionService, SESSION_TABLES_SQL } from './sessions/index.js';
export type {
  AgentSession, SessionEvent, SessionStats, SessionEventType,
  EventMeta, MessageMeta, ThinkingMeta, PlanningMeta, ContextGatherMeta,
  FileCreateMeta, FileEditMeta,
  FileReadMeta, TerminalMeta, SearchMeta, TodoUpdateMeta, TodoItem,
  StateChangeMeta, ErrorMeta, ToolCallMeta, SummaryMeta, NoteMeta,
  PinnedNote, PinnedNoteCategory, ContextSummary, SearchResult,
} from './sessions/index.js';
export { createSessionId, createEventId, createPinnedNoteId, EVENT_TYPE_CONFIG } from './sessions/index.js';

// Stop Words (bilingual EN + NO)
export { STOP_WORDS, STOP_WORDS_EN, STOP_WORDS_NO, QUERY_ACTION_WORDS, TOPIC_STOP_WORDS } from './models/stop-words.js';

// Thorsen Meta-Kernel
export {
  THORSEN_CURVE,
  classifySyncState,
  ThorsenAdaptiveController,
  synthesize,
  listTemplates,
  executePipeline,
  getPipelineInfo,
  runSelfImprovement,
  quickHealth,
} from './thorsen/index.js';
export type {
  ThorsenAction,
  ThorsenDomain,
  ThorsenLogicType,
  ThorsenTargetEnv,
  ThorsenLanguage,
  ThorsenIntent,
  ThorsenArtifact,
  ThorsenSyncState,
  ThorsenSyncStatus,
  ThorsenResponse,
  SynthesizerOptions,
  PipelineStage,
  StageTiming,
  RoutingStrategy,
  IntentComplexity,
  IntentFingerprint,
  PipelineTrace,
  ThorsenPipelineResponse,
  PipelineOptions,
  BenchmarkResult,
  CoverageGap,
  ImprovementSuggestion,
  SelfImprovementReport,
} from './thorsen/index.js';
