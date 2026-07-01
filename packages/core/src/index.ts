// Database
export { getDb, createDb, resetDbInstance, getRawDb } from './db/client.js';
export type { VaiDatabase } from './db/client.js';
export * as schema from './db/schema.js';
export { and, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';

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
export type {
  ImageInput,
  ChatServiceOptions,
  ChatPromptRewriteOverrides,
  ResponseReviewInput,
  ResponseReviewResult,
  ResponseReviewer,
} from './chat/service.js';

export {
  selectApplicableGuidance,
  toTurnGuidance,
  salientTokens,
  InMemoryGuidanceStore,
} from './chat/route-guidance.js';
export type {
  RouteGuidance,
  TurnSignals,
  SelectGuidanceOptions,
  ActorInvitation,
  ActorPermissions,
  ActorSession,
  ActorContribution,
  ActorContributionPayload,
  GuidanceStore,
} from './chat/route-guidance.js';
export type { SelfImproveQueue, SelfImproveJob } from './chat/self-improve-queue-port.js';
export type { ConversationRecord, MessageRecord, ImageRecord } from './chat/types.js';
export {
  hasExplicitSoftwareExecutionAnchor,
  hasProductEngineeringSignal,
  isProductEngineeringPlanningPrompt,
} from './chat/product-engineering-intent.js';
export {
  CONVERSATION_MODE_SYSTEM_PROMPTS,
  DEFAULT_CONVERSATION_MODE,
  ENGINEERING_DISCIPLINE_PROMPT,
  isConversationMode,
  SANDBOX_TEMPLATE_DEPLOY_CONTEXT,
} from './chat/modes.js';
export {
  isBuildExecutionMode,
  isExplicitBuildExecutionRequest,
} from './chat/build-execution-intent.js';
export {
  CHAT_STRUCTURE_SYSTEM_HINT,
  KNOWLEDGE_RETRIEVAL_SCORE_MIN,
  shouldInjectChatStructureHint,
} from './chat/chat-quality.js';
export {
  buildConversationGrounding,
  classifyContextGroundedFollowUpIntent,
  shouldDeferContextGroundedFollowUp,
} from './chat/conversation-grounding.js';
export type {
  ConversationGrounding,
  ConversationGroundingDependencies,
  ContextGroundedFollowUpIntent,
} from './chat/conversation-grounding.js';
export { classifyTurn } from './chat/turn-classifier.js';
export type { TurnClass, TurnClassification } from './chat/turn-classifier.js';
export { extractActiveTopicBrief, hasTopicOverlap } from './chat/active-topic-brief.js';
export type { ActiveTopicBrief, ExtractActiveTopicBriefOptions } from './chat/active-topic-brief.js';
export { evaluateChatAnswerQuality } from './chat/chat-answer-quality.js';
export type {
  ChatAnswerQualityInput,
  ChatAnswerQualityReport,
  ChatAnswerQualityRequirement,
  ChatAnswerQualityVerdict,
} from './chat/chat-answer-quality.js';

// Proof-backed builder loop (evidence vocabulary for ledgers / narration)
export type { EvidenceConfidenceTier, FailureClass, ProofFlags } from './builder-loop/evidence-types.js';
export { evidenceTierFromProof } from './builder-loop/evidence-types.js';
export { isFreshBuildRequestForEmptySandbox, routeBuilderRequest } from './models/builder/builder-request-router.js';
export type { BuilderRequestRoute, BuilderRequestRouteInput, BuilderRequestRouteKind } from './models/builder/builder-request-router.js';
export { evaluateBuilderPreviewQuality } from './models/builder/preview-quality.js';
export type { BuilderPreviewQualityInput, BuilderPreviewQualityReport, BuilderPreviewQualityRequirement, BuilderPreviewQualityVerdict } from './models/builder/preview-quality.js';
export { BRAND_BLUEPRINTS, councilGenerateApp, detectBrandBlueprint, extractAppFiles, validateGeneratedApp } from './models/builder/council-codegen/index.js';
export type { BrandBlueprint } from './models/builder/council-codegen/index.js';
export type {
  AppValidationReport,
  CodegenReviewNote,
  CouncilAppSpec,
  CouncilCodegenEvent,
  CouncilCodegenInput,
  CouncilCodegenMember,
  CouncilCodegenMessage,
  CouncilCodegenResult,
} from './models/builder/council-codegen/index.js';
export type { ConversationMode } from './chat/modes.js';
export { resolveChatPromptRewriteConfig, rewriteChatPrompt } from './chat/prompt-rewrite.js';
export type { ChatPromptRewriteResult } from './chat/prompt-rewrite.js';
export {
  reduceConversationContract,
  buildContractSystemPrelude,
  CONVERSATION_CONTRACT_JSON_SCHEMA,
} from './chat/conversation-contract.js';
export type {
  ConversationContract,
  ContractConstraint,
  ContractDecision,
  Correction,
  OutputFormatContract,
  OutputFormatKind,
  ConstraintKind,
  LedgerStatus,
} from './chat/conversation-contract.js';
export { reviewTurnSecurity, SECURITY_REVIEW_BUDGET_MS } from './chat/security-review.js';

// Friend Review Panel — Qwen + other AIs review a draft before release and
// return one consolidated notice. See docs/capabilities/friend-review-panel.md.
export {
  runFriendReviewPanel,
  aggregateVerdicts,
  createModelReviewer,
  createGrokFriendReviewer,
  parseFriendVerdict,
  toResponseReviewer as friendPanelToResponseReviewer,
} from './friend-review/index.js';
export type {
  FriendVerdictKind,
  FriendReviewOutcome,
  FriendReviewInput,
  FriendVerdict,
  FriendReviewNotice,
  FriendReviewer,
  RunFriendReviewPanelOptions,
  ModelReviewerOptions,
  GrokFriendReviewerOptions,
  FriendChannelAsk,
  PanelResponseReviewerOptions,
} from './friend-review/index.js';

// SCIS Consensus Council — topic-routed council of models reaches an ephemeral
// consensus (ship/act/escalate) on a Vai draft. See docs/capabilities/scis-consensus-council.md.
export {
  routeTopic,
  selectMembers,
  reachConsensus,
  runCouncil,
  convene,
  toCouncilThinking,
  createCouncilMember,
  parseCouncilNote,
  LOCAL_COUNCIL_LENSES,
  LOCAL_COUNCIL_ROLES,
  isRole,
  buildLocalLensMembers,
  buildRoleMembers,
  assignModelsToRoles,
  deliberate,
  isDeliberationEnabled,
  THORSEN_TIER_RANK,
  memberStatuses,
  councilUserActionHints,
  resetCouncilAvailability,
  createCouncilContextTools,
  resolveSandboxed,
  gatherMemberEvidence,
  parseToolRequests,
  runToolRequest,
  EVIDENCE_TOOL_INSTRUCTIONS,
  buildMemberContextLedger,
  classifyContextItem,
  labelForRequest,
  distinctiveTokens,
  parseProofProposal,
  runProof,
  gatherMemberProof,
  proofTrustWeight,
  PROOF_INSTRUCTIONS,
} from './consensus/index.js';
export type {
  CouncilContextTools,
  ContextToolLimits,
  ReadFileResult,
  GrepResult,
  GrepHit,
  ListFilesResult,
  ToolRequest,
  MemberEvidence,
  ContextStateKind,
  ContextItemState,
  MemberContextLedger,
  FetchedEvidence,
  ProofProposal,
  ProofResult,
  ProofStatus,
  ProofRunner,
  MemberLiveStatus,
  MemberStatusSnapshot,
  CouncilTopic,
  CouncilAction,
  CouncilOutcome,
  CouncilVerdict,
  CouncilInput,
  CouncilMemberNote,
  CouncilConsensus,
  CouncilMember,
  CouncilThinking,
  CouncilRoster,
  RunCouncilOptions,
  CouncilMemberOptions,
  CouncilLens,
  LocalLensMembersOptions,
} from './consensus/index.js';
export { resolveIntent } from './consensus/intent-resolver.js';
export type { ResolvedIntent, ValueKind } from './consensus/intent-resolver.js';
export {
  extractCheckableClaim,
  assessClaimAgreement,
  applyCrossCheck,
  MIN_CORROBORATION,
} from './consensus/cross-check.js';
export type { CheckableClaim, ClaimAssessment } from './consensus/cross-check.js';
export { checkCorrectionGuard, collectDisputedValues } from './consensus/correction-guard.js';
export type { CorrectionTurn, CorrectionGuardResult } from './consensus/correction-guard.js';
export { logGrounding } from './consensus/grounding-log.js';
export type { GroundingErrorType, GroundingVerdict, GroundingLogEntry } from './consensus/grounding-log.js';
export {
  MemberAvailabilityStore,
  classifyUnavailability,
  fixHintFor,
  needsUserAction,
} from './consensus/member-availability.js';
export type {
  MemberAvailability,
  UnavailabilityReason,
  MemberAvailabilitySnapshot,
} from './consensus/member-availability.js';
export { createGrokCliAdapter, isGrokCliAvailable } from './models/grok-cli-adapter.js';
export type { GrokCliAdapterOptions } from './models/grok-cli-adapter.js';
export { NullVisionAdapter, createGrokVisionAdapter } from './vision/index.js';
export type { VisionAdapter, VisionDescribeInput, VisionDescription, GrokVisionOptions } from './vision/index.js';
export {
  NullImageProducer,
  createComfyUiProducer,
  isComfyUiReachable,
  recommendImageGenDefaults,
  detectVramMb,
  generateWithVerification,
  modelBackedWantsImageGate,
} from './vision/index.js';
export type {
  ImageProducer,
  ImageGenRequest,
  GeneratedImage,
  ComfyUiOptions,
  ImageGenDefaults,
  ImageGenLoopOptions,
  ImageGenLoopResult,
  ImageGenAttempt,
} from './vision/index.js';
export { tryEmitConversationReasoning } from './chat/conversation-reasoning.js';
export {
  LIVE_CONTEXT_MAX_AGE_MS,
  getExplicitGrokFriendPrompt,
  getRequestedLiveContextFields,
  isWorkspaceDeltaQuestion,
  tryEmitAttachedLiveContextResponse,
  tryEmitBridgeCapabilityAudit,
  tryEmitPrivateLiveContextResponse,
} from './chat/bridge-evidence-discipline.js';
export type { AttachedLiveContextEvidence } from './chat/bridge-evidence-discipline.js';
export type { LiveContextField } from './chat/bridge-evidence-discipline.js';
export type {
  ConversationReasoningKind,
  ConversationReasoningReply,
  ConversationReasoningRequest,
} from './chat/conversation-reasoning.js';
export type {
  SecurityReviewResult,
  SecurityReviewInput,
  SecurityIncident,
  SecurityFamily,
  SecuritySeverity,
} from './chat/security-review.js';
export { runDimensionClusterBench } from './eval/dimension-cluster-bench.js';
export type {
  DimensionClusterScenario,
  DimensionClusterBenchResult,
  DimensionClusterReport,
} from './eval/dimension-cluster-bench.js';

export {
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  LocalOpenAICompatibleAdapter,
  createAdapterForProfile,
} from './models/provider-adapters.js';

export {
  discoverOllamaModels,
  parseDiscoveredModel,
  parseParameterSize,
  extractContextWindow,
  rankDiscoveredModels,
  buildDiscoveredModelProfile,
  resolveEffectiveLocalChain,
} from './models/ollama-discovery.js';
export type { DiscoveredOllamaModel, DiscoverOllamaOptions } from './models/ollama-discovery.js';

// Ingestion
export { IngestPipeline } from './ingest/pipeline.js';
export type { IngestResult, RawCapture } from './ingest/pipeline.js';
export { scrapeWebPage, extractLinks } from './ingest/web.js';
export { fetchYouTubeTranscript, extractVideoId, createYouTubeCapture } from './ingest/youtube.js';
export { fetchGitHubRepo, deepFetchGitHubRepo, parseGitHubUrl, createGitHubCapture } from './ingest/github.js';

// Network Safety
export { assertPublicHostname, isPrivateNetworkAddress, safeFetch, validatePublicUrl } from './network/safe-fetch.js';
export type { LookupAddress, LookupAll, SafeFetchOptions } from './network/safe-fetch.js';

// Search Pipeline (Perplexity-style structured search)
export { SearchPipeline, buildSearchPlan, validateSearchUrl, scoreDomain, scanContentSafety, contentFingerprint, assessUrl, DEFAULT_SEARCH_CONFIG } from './search/index.js';
export type { VaiSearchPlan, SearchConstraints, TrustTier, TrustSignal, SearchSnippet, SearchResponse, AuditEntry, SearchPipelineConfig, UrlAssessment } from './search/index.js';

// Tools
export { ToolRegistry } from './tools/registry.js';
export { ToolExecutor } from './tools/executor.js';
export type { Tool, ToolContext, ToolResult } from './tools/interface.js';
export type { ToolExecutorConfig, ToolExecutionResult, AgentLoopResult } from './tools/executor.js';
export { readUrl, formatReadUrlForContext } from './tools/read-url.js';
export type { ReadUrlOptions, ReadUrlResult } from './tools/read-url.js';

// Deterministic, evidence-bound power-user capabilities (read-only git as evidence,
// no-model synthesis). See plan: evidence-bound capabilities ("wormhole tools").
export {
  gatherGitEvidence,
  gitEvidenceIds,
  hasGitEvidence,
} from './tools/git-evidence.js';
export type {
  GitEvidence,
  GitChangedFile,
  GitDiffHunk,
  GitBlameLine,
  GitLogEntry,
  GitBranchState,
  GitRunner,
  GatherGitEvidenceOptions,
} from './tools/git-evidence.js';
export { gitCapability, classifyGitQuery } from './chat/capabilities/git-capability.js';
export { execCapability, isExecQuery } from './chat/capabilities/exec-capability.js';
export { pageCapability, isPageQuery } from './chat/capabilities/page-capability.js';
export {
  gatherPageEvidence,
  pageEvidenceIds,
  hasPageEvidence,
} from './tools/page-evidence.js';
export type {
  PageEvidence,
  PageSelectorEvidence,
  PageObserver,
  GatherPageEvidenceOptions,
} from './tools/page-evidence.js';
export { observePage } from './search/browser-search.js';
export type { PageObservation, SelectorObservation } from './search/browser-search.js';
export {
  runCommandEvidence,
  isAllowlistedCommand,
  hasRunEvidence,
  SAFE_COMMAND_BASENAMES,
} from './tools/run-evidence.js';
export type {
  RunEvidence,
  RawRunResult,
  CommandRunner,
  RunCommandOptions,
} from './tools/run-evidence.js';
export {
  proposeFsEdit,
  applyFsEdit,
  verifyFsEdit,
  rollbackFsEdit,
  confinePath,
  lineDiff,
  contentHash,
  isRegularFile,
  ABSENT_HASH,
} from './tools/fs-edit.js';
export type {
  FsEditPlan,
  FsProposeResult,
  FsApplyResult,
  FsVerification,
  FsEditOptions,
  FsApplyOptions,
} from './tools/fs-edit.js';
export {
  synthesizeFromEvidence,
  gitEvidenceToItems,
  webEvidenceToItems,
  aiOverviewToItem,
  pageEvidenceToItems,
  notesToItems,
  synthesizeAcrossSources,
  formatSummaryBrief,
  formatContradictions,
  formatDecisionRecord,
} from './synthesis/index.js';
export type {
  EvidenceItem,
  SynthesizedClaim,
  SynthesizedContradiction,
  SynthesisResult,
  SynthesizeOptions,
  WebSourceLike,
  NoteLike,
  CrossSourceInputs,
  CrossSourceSynthesis,
} from './synthesis/index.js';
export type { TurnEvidence } from './chat/turn-pipeline.js';

// Capability kernel + learned-history loop (the kernel's `history` term, alive).
export {
  scoreFromBreakdown,
  scoreWithHistory,
  withLearnedHistory,
  describeBreakdown,
  asTurnHandler,
  shadowScore,
  DEFAULT_SCORE_WEIGHTS,
} from './chat/capability-kernel.js';
export type {
  Capability,
  ScoreBreakdown,
  ScoreWeights,
  VerificationResult,
  ShadowScore,
  CapabilityHistory,
} from './chat/capability-kernel.js';
export {
  CapabilityOutcomeLedger,
  KnowledgeConfidenceLedger,
  classifyFeedback,
} from './learning/index.js';
export type {
  CapabilityStat,
  CapabilityOutcomeKind,
  CapabilityLedgerSnapshot,
  CapabilityLedgerOptions,
  HistoryProvider,
} from './learning/index.js';

// Usage Tracking
export { UsageService } from './usage/index.js';
export type { UsageRecord, UsageSummary } from './usage/index.js';

// Eval Framework
export { EvalRunner, registerEvalTasks, getEvalTasks, getEvalTracks, computeGrade, ConversationScorer, extractTurnPairs, LearningExtractor, extractLessons, aggregateLessons, formatContextInjection, extractScenarios, runMultiTurn, computeRegression, runABTest, buildTestReport } from './eval/index.js';
export { runMemoryRetrievalEval } from './eval/index.js';
export { judgeAnswers, runParityBench, shouldContinueParityLoop, describeParityReport } from './eval/index.js';
export type {
  JudgeCandidate,
  JudgeVerdict,
  JudgeContext,
  JudgeOptions,
  ParityTask,
  ParityTaskResult,
  ParityReport,
  ParityBenchOptions,
} from './eval/index.js';
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
