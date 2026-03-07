/**
 * Thorsen Meta-Kernel — barrel export.
 */

// Types
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
} from './types.js';

export { THORSEN_CURVE, classifySyncState, ThorsenAdaptiveController } from './types.js';

// Synthesizer (low-level)
export { synthesize, listTemplates } from './synthesizer.js';
export type { SynthesizerOptions } from './synthesizer.js';

// Pipeline (expanded 6-stage architecture)
export { executePipeline, getPipelineInfo } from './pipeline.js';
export type {
  PipelineStage,
  StageTiming,
  RoutingStrategy,
  IntentComplexity,
  IntentFingerprint,
  ReceivedIntent,
  NormalizedIntent,
  RoutingDecision,
  RawArtifact,
  VerifiedArtifact,
  ScoredArtifact,
  PipelineTrace,
  ThorsenPipelineResponse,
  PipelineHook,
  PipelineOptions,
} from './pipeline.js';

// Self-Improvement Engine
export { runSelfImprovement, quickHealth } from './self-improve.js';
export type {
  BenchmarkResult,
  CoverageGap,
  ImprovementSuggestion,
  SelfImprovementReport,
} from './self-improve.js';
