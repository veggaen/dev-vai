// Database
export { getDb, createDb, resetDbInstance, getRawDb } from './db/client.js';
export type { VaiDatabase } from './db/client.js';
export * as schema from './db/schema.js';

// Errors
export { VaiError, VaiValidationError, type VaiErrorCode } from './errors/vai-errors.js';

// Config
export { loadConfig, printConfigDiagnostic, getModelProfile, getProviderProfiles, listModelIds } from './config/index.js';
export type { VaiConfig, ProviderConfig, ProviderId, ModelProfile, ModelCapabilities, ModelCost, RoutingRule, FallbackChain, PlatformAuthConfig, PlatformAuthProviderId, PlatformAuthProviderConfig, GoogleOAuthConfig, WorkOSAuthConfig, ChatPromptRewriteConfig, ChatPromptRewriteProfile, ChatPromptRewriteResponseDepth, ChatPromptRewriteRulesConfig } from './config/index.js';

// Models
export {
  ModelRegistry,
  type ModelAdapter,
  type ChatRequest,
  type ChatResponse,
  type ChatChunk,
  type GroundedBuildBrief,
  type SearchSource,
  type Message,
  type ToolCall,
  type ToolDefinition,
  type TokenUsage,
} from './models/adapter.js';
export { VaiEngine, VaiTokenizer, KnowledgeStore } from './models/vai-engine.js';
export { SkillRouter } from './models/skill-router.js';
export type { DomainId, DomainSkill, SkillMatch } from './models/skill-router.js';
export type { KnowledgeEntry, VaiEngineOptions, VaiSnapshot, ResponseMeta, VaiDiagnosis } from './models/vai-engine.js';
export { KnowledgeIntelligence, classifyQuestionCategory } from './models/knowledge-intelligence.js';
export { ShadowRouter, extractShadowFeatures, contextFromHistory } from './models/shadow-router.js';
export type { ShadowObservation, ShadowPrediction, ShadowAgreementStats, ShadowSnapshot } from './models/shadow-router.js';
export { HybridRetriever, scoreHybrid } from './models/hybrid-retrieval.js';
export type { HybridDocument, HybridScore, HybridIndexStats } from './models/hybrid-retrieval.js';
export type { AtomicFact, FactType, SubPattern, Connection, DuplicateGroup, HygieneReport, SubQuestion, SubAnswer, CompositeAnswer, QuestionType, QuestionCategory, InterrogativeType, ProceduralType, OperationalType } from './models/knowledge-intelligence.js';

// Chat
export { ChatService } from './chat/service.js';
export type { ImageInput, ChatServiceOptions, ChatPromptRewriteOverrides } from './chat/service.js';
export type { ConversationRecord, MessageRecord, ImageRecord } from './chat/types.js';
export {
  CONVERSATION_MODE_SYSTEM_PROMPTS,
  DEFAULT_CONVERSATION_MODE,
  ENGINEERING_DISCIPLINE_PROMPT,
  isConversationMode,
  SANDBOX_TEMPLATE_DEPLOY_CONTEXT,
} from './chat/modes.js';
export {
  CHAT_STRUCTURE_SYSTEM_HINT,
  KNOWLEDGE_RETRIEVAL_SCORE_MIN,
  shouldInjectChatStructureHint,
} from './chat/chat-quality.js';

// Proof-backed builder loop (evidence vocabulary for ledgers / narration)
export type { EvidenceConfidenceTier, FailureClass, ProofFlags } from './builder-loop/evidence-types.js';
export { evidenceTierFromProof } from './builder-loop/evidence-types.js';
export { isFreshBuildRequestForEmptySandbox, routeBuilderRequest } from './models/builder/builder-request-router.js';
export type { BuilderRequestRoute, BuilderRequestRouteInput, BuilderRequestRouteKind } from './models/builder/builder-request-router.js';
export { evaluateBuilderPreviewQuality } from './models/builder/preview-quality.js';
export type { BuilderPreviewQualityInput, BuilderPreviewQualityReport, BuilderPreviewQualityRequirement, BuilderPreviewQualityVerdict } from './models/builder/preview-quality.js';
export type { ConversationMode } from './chat/modes.js';
export { resolveChatPromptRewriteConfig, rewriteChatPrompt } from './chat/prompt-rewrite.js';
export type { ChatPromptRewriteResult } from './chat/prompt-rewrite.js';

export {
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  LocalOpenAICompatibleAdapter,
  createAdapterForProfile,
} from './models/provider-adapters.js';

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
export { EvalRunner, registerEvalTasks, getEvalTasks, getEvalTracks, computeGrade, ConversationScorer, extractTurnPairs, LearningExtractor, extractLessons, aggregateLessons, formatContextInjection, extractScenarios, runMultiTurn, computeRegression, runABTest, buildTestReport } from './eval/index.js';
export { runMemoryRetrievalEval } from './eval/index.js';
export type {
  EvalTrack, EvalTask, EvalExpectation, EvalTaskResult,
  EvalRunResult, EvalRunConfig, EvalRunSummary,
  MemoryRetrievalThresholds, MemoryRetrievalDataset, MemoryRetrievalDocumentFixture, MemoryRetrievalQueryFixture, MemoryRetrievalEvalReport, MemoryRetrievalEvalQueryReport,
  ConversationScore, SubScore, ScoreFactor,
  AntiPatternReport, AntiPatternDetection, AntiPatternType,
  SpeakingDimensionScores, CurvePoint, ScoredHighlight, TurnPair,
  CognitiveLesson, LessonCategory, LearningReport,
  CognitiveProfile, FoundationStrength, AggregatedPattern, ContextInjection,
  ScenarioCategory, ScenarioDifficulty, GradingItem, ScenarioTurn,
  ConversationScenario, MultiTurnResult, RegressionResult, ABTestResult,
  CognitiveTestReport, CognitiveTestSummary, ScoredSession,
} from './eval/index.js';

// Sessions (Agent Dev Logs)
export { SessionService, SESSION_TABLES_SQL, getSessionAnalyzer, SessionAnalyzer } from './sessions/index.js';
export type { SessionAnalysis, SessionOutcome, FailurePattern, SessionInsightsAggregate } from './sessions/index.js';
export type {
  AgentSession, SessionEvent, SessionStats, SessionEventType,
  EventMeta, MessageMeta, ThinkingMeta, PlanningMeta, ContextGatherMeta,
  CheckpointMeta, VerificationMeta, RecoveryMeta, ArtifactMeta,
  FileCreateMeta, FileEditMeta,
  FileReadMeta, TerminalMeta, SearchMeta, TodoUpdateMeta, TodoItem,
  StateChangeMeta, ErrorMeta, ToolCallMeta, SummaryMeta, NoteMeta,
  PinnedNote, PinnedNoteCategory, ContextSummary, SearchResult,
} from './sessions/index.js';
export { createSessionId, createEventId, createPinnedNoteId, EVENT_TYPE_CONFIG } from './sessions/index.js';

// Skills System
export { SkillRegistry, getSkillRegistry, SubAgentRouter, getSubAgentRouter, TeacherAgent, getTeacherAgent } from './skills/index.js';
export type { RoutedTask } from './skills/index.js';
export type { TeacherDecision } from './skills/index.js';
export type {
  SkillManifest,
  LoadedSkill,
  SkillTool,
  SkillPermission,
  SkillTrust,
  SubAgentRole,
  SubAgentConfig,
  AgentTask,
  AgentTaskResult,
  EvidenceBlock,
  CitedAnswer,
  ProvenanceRecord,
  TraceSpan,
  LearnedUnit,
  LearnedFrom,
  LearnedKind,
} from './skills/index.js';

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
