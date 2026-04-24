/**
 * Thorsen Pipeline — The expanded 6-stage intent-to-artifact pipeline.
 *
 * Original concept:  Human → IntentPacket (4 fields) → Engine → SoftwareArtifact
 *
 * Expanded reality:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Human                                                           │
 *   │  ↓                                                              │
 *   │ Stage 1 — RECEIVE     Parse + validate structured IntentPacket  │
 *   │  ↓                    (4 core fields: action, domain,           │
 *   │                        logicType, targetEnv)                    │
 *   │                                                                 │
 *   │ Stage 2 — NORMALIZE   Resolve defaults, compute 4-field         │
 *   │  ↓                    fingerprint, classify complexity          │
 *   │                                                                 │
 *   │ Stage 3 — ROUTE       Decide strategy: deterministic template,  │
 *   │  ↓                    LLM synthesis, or hybrid pipeline         │
 *   │                                                                 │
 *   │ Stage 4 — SYNTHESIZE  Execute the chosen strategy → raw code    │
 *   │  ↓                                                              │
 *   │                                                                 │
 *   │ Stage 5 — VERIFY      Parse-check, optional execution,          │
 *   │  ↓                    constraint validation                     │
 *   │                                                                 │
 *   │ Stage 6 — SCORE       Compute thorsenScore, classify sync       │
 *   │  ↓                    state on the Thorsen Curve, emit trace    │
 *   │                                                                 │
 *   │ SoftwareArtifact + PipelineTrace                                │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Each stage:
 *   - Has a typed input and output
 *   - Records start/end timing
 *   - Can be hooked (pre/post middleware)
 *   - Fails gracefully with typed error propagation
 *
 * The pipeline trace captures the full execution for observability,
 * debugging, and Thorsen Curve analysis.
 *
 * @author V3gga Thorsen
 */

import type {
  ThorsenIntent,
  ThorsenArtifact,
  ThorsenResponse,
  ThorsenSyncState,
  ThorsenAction,
  ThorsenDomain,
  ThorsenLogicType,
  ThorsenTargetEnv,
  ThorsenLanguage,
} from './types.js';
import { classifySyncState, THORSEN_CURVE } from './types.js';
import { synthesize as rawSynthesize, listTemplates, type SynthesizerOptions } from './synthesizer.js';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Pipeline Types
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** The 6 pipeline stages, in execution order */
export type PipelineStage = 'receive' | 'normalize' | 'route' | 'synthesize' | 'verify' | 'score';

/** Timing for a single stage */
export interface StageTiming {
  stage: PipelineStage;
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** Routing strategy decided in Stage 3 */
export type RoutingStrategy = 'template' | 'llm' | 'hybrid' | 'skeleton';

/** Complexity classification from Stage 2 */
export type IntentComplexity = 'trivial' | 'standard' | 'complex' | 'novel';

/** The 4-field fingerprint that uniquely identifies an intent class */
export interface IntentFingerprint {
  /** action:domain:logicType:targetEnv */
  key: string;
  action: ThorsenAction;
  domain: ThorsenDomain;
  logicType: ThorsenLogicType;
  targetEnv: ThorsenTargetEnv;
}

/* ── Stage Intermediates ──────────────────────────────────────── */

/** Stage 1 output: validated intent with reception metadata */
export interface ReceivedIntent {
  intent: ThorsenIntent;
  receivedAtUs: number;
  valid: boolean;
  validationErrors: string[];
}

/** Stage 2 output: normalized intent with defaults resolved */
export interface NormalizedIntent {
  intent: Required<Pick<ThorsenIntent, 'action' | 'domain' | 'logicType' | 'targetEnv' | 'language'>> &
    Pick<ThorsenIntent, 'spec' | 'constraints' | 'timestampUs'>;
  fingerprint: IntentFingerprint;
  complexity: IntentComplexity;
  templateAvailable: boolean;
}

/** Stage 3 output: routing decision */
export interface RoutingDecision {
  strategy: RoutingStrategy;
  templateKey: string | null;
  reason: string;
  estimatedLatencyMs: number;
}

/** Stage 4 output: raw artifact before verification */
export interface RawArtifact {
  artifact: ThorsenArtifact;
  generationMethod: RoutingStrategy;
  rawLatencyMs: number;
}

/** Stage 5 output: artifact after verification */
export interface VerifiedArtifact {
  artifact: ThorsenArtifact;
  parseValid: boolean;
  constraintsPassed: boolean;
  constraintResults: Array<{ constraint: string; passed: boolean; reason?: string }>;
}

/** Stage 6 output: scored artifact with sync classification */
export interface ScoredArtifact {
  artifact: ThorsenArtifact;
  syncState: ThorsenSyncState;
  pipelineLatencyMs: number;
  adjustedScore: number;
  scoreFactors: Record<string, number>;
}

/* ── Pipeline Trace ───────────────────────────────────────────── */

/** Complete execution trace for a single pipeline run */
export interface PipelineTrace {
  /** Unique trace ID */
  traceId: string;
  /** Total pipeline execution time */
  totalMs: number;
  /** Per-stage timing */
  stages: StageTiming[];
  /** Stage outputs (for debugging — can be stripped in production) */
  intermediates: {
    received?: ReceivedIntent;
    normalized?: NormalizedIntent;
    routed?: RoutingDecision;
    synthesized?: RawArtifact;
    verified?: VerifiedArtifact;
    scored?: ScoredArtifact;
  };
  /** Whether the pipeline completed without errors */
  success: boolean;
  /** Error message if pipeline failed */
  error?: string;
  /** Which stage failed, if any */
  failedAt?: PipelineStage;
}

/** Extended response that includes the pipeline trace */
export interface ThorsenPipelineResponse extends ThorsenResponse {
  trace: PipelineTrace;
}

/* ── Hook System ──────────────────────────────────────────────── */

export type PipelineHook = (stage: PipelineStage, data: unknown) => void | Promise<void>;

export interface PipelineOptions extends SynthesizerOptions {
  /** Run in trace mode — records all intermediates (default: true) */
  traceMode?: boolean;
  /** Pre-stage hooks */
  preHooks?: Partial<Record<PipelineStage, PipelineHook>>;
  /** Post-stage hooks */
  postHooks?: Partial<Record<PipelineStage, PipelineHook>>;
  /** Skip verification stage (faster, less safe) */
  skipVerify?: boolean;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Pipeline Stages
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const VALID_ACTIONS = new Set<ThorsenAction>(['create', 'optimize', 'debug', 'explain', 'transpile', 'test', 'converse']);
const VALID_DOMAINS = new Set<ThorsenDomain>(['calculator', 'component', 'api-route', 'utility', 'dataset', 'pipeline', 'vai-drill', 'test', 'cognitive-test', 'custom']);
const VALID_LOGIC = new Set<ThorsenLogicType>(['functional', 'stateful', 'reactive', 'declarative']);
const VALID_TARGETS = new Set<ThorsenTargetEnv>(['node', 'browser', 'wsl2', 'docker', 'edge']);
const VALID_LANGUAGES = new Set<ThorsenLanguage>(['typescript', 'python', 'rust', 'go', 'auto']);

/**
 * Stage 1 — RECEIVE
 * Parse and validate the raw intent packet.
 * The "4 fields" to structured IntentPacket barrier.
 */
function stageReceive(intent: ThorsenIntent): ReceivedIntent {
  const errors: string[] = [];

  if (!intent.action || !VALID_ACTIONS.has(intent.action)) {
    errors.push(`Invalid action: "${intent.action}". Valid: ${[...VALID_ACTIONS].join(', ')}`);
  }
  if (!intent.domain || !VALID_DOMAINS.has(intent.domain)) {
    errors.push(`Invalid domain: "${intent.domain}". Valid: ${[...VALID_DOMAINS].join(', ')}`);
  }
  if (intent.logicType && !VALID_LOGIC.has(intent.logicType)) {
    errors.push(`Invalid logicType: "${intent.logicType}". Valid: ${[...VALID_LOGIC].join(', ')}`);
  }
  if (intent.targetEnv && !VALID_TARGETS.has(intent.targetEnv)) {
    errors.push(`Invalid targetEnv: "${intent.targetEnv}". Valid: ${[...VALID_TARGETS].join(', ')}`);
  }
  if (intent.language && !VALID_LANGUAGES.has(intent.language)) {
    errors.push(`Invalid language: "${intent.language}". Valid: ${[...VALID_LANGUAGES].join(', ')}`);
  }
  if (intent.domain === 'custom' && !intent.spec) {
    errors.push('Custom domain requires a spec field');
  }
  if (intent.constraints && !Array.isArray(intent.constraints)) {
    errors.push('Constraints must be an array of strings');
  }

  return {
    intent,
    receivedAtUs: intent.timestampUs ?? Date.now() * 1000,
    valid: errors.length === 0,
    validationErrors: errors,
  };
}

/**
 * Stage 2 — NORMALIZE
 * Apply defaults, compute 4-field fingerprint, classify complexity.
 * This is where the "4 fields" concept lives: every intent reduces
 * to exactly (action, domain, logicType, targetEnv).
 */
function stageNormalize(received: ReceivedIntent): NormalizedIntent {
  const { intent } = received;

  // Resolve defaults — the 4 core fields always have values after this
  const action = intent.action;
  const domain = intent.domain;
  const logicType = intent.logicType ?? 'functional';
  const targetEnv = intent.targetEnv ?? 'node';
  const language = intent.language ?? resolveDefaultLanguage(targetEnv);

  // 4-field fingerprint — the canonical identity of this intent class
  const fingerprint: IntentFingerprint = {
    key: `${action}:${domain}:${logicType}:${targetEnv}`,
    action,
    domain,
    logicType,
    targetEnv,
  };

  // Complexity classification
  const templates = listTemplates();
  const templateKey = `${action}:${domain}:${logicType}`;
  const templateAvailable = templates.includes(templateKey);

  const complexity = classifyComplexity(intent, templateAvailable);

  return {
    intent: {
      action,
      domain,
      logicType,
      targetEnv,
      language,
      spec: intent.spec,
      constraints: intent.constraints,
      timestampUs: intent.timestampUs,
    },
    fingerprint,
    complexity,
    templateAvailable,
  };
}

/**
 * Stage 3 — ROUTE
 * Decide synthesis strategy based on fingerprint, complexity, and available resources.
 * This is where the "gRPC → Vai Engine" routing happens (now HTTP, same concept).
 */
function stageRoute(normalized: NormalizedIntent, options?: PipelineOptions): RoutingDecision {
  const { fingerprint, templateAvailable, complexity } = normalized;

  // Priority 1: deterministic template (wormhole-speed, verified)
  if (templateAvailable) {
    return {
      strategy: 'template',
      templateKey: `${fingerprint.action}:${fingerprint.domain}:${fingerprint.logicType}`,
      reason: `Deterministic template available for ${fingerprint.key}`,
      estimatedLatencyMs: 5,
    };
  }

  // Priority 2: force template-only → skeleton fallback
  if (options?.templateOnly) {
    return {
      strategy: 'skeleton',
      templateKey: null,
      reason: `No template for ${fingerprint.key} and templateOnly=true`,
      estimatedLatencyMs: 2,
    };
  }

  // Priority 3: LLM synthesis if API key available
  if (options?.apiKey) {
    // Hybrid: use LLM but with template structure hints for known domains
    if (complexity === 'trivial' || complexity === 'standard') {
      return {
        strategy: 'llm',
        templateKey: null,
        reason: `LLM synthesis for ${fingerprint.key} (${complexity} complexity)`,
        estimatedLatencyMs: 1500,
      };
    }
    return {
      strategy: 'hybrid',
      templateKey: null,
      reason: `Hybrid LLM+structure for ${fingerprint.key} (${complexity} complexity)`,
      estimatedLatencyMs: 2500,
    };
  }

  // Fallback: skeleton
  return {
    strategy: 'skeleton',
    templateKey: null,
    reason: `No template and no API key — generating skeleton for ${fingerprint.key}`,
    estimatedLatencyMs: 2,
  };
}

/**
 * Stage 4 — SYNTHESIZE
 * Execute the chosen strategy to produce raw code.
 * This is the "Vai Engine" core — the actual generation.
 */
async function stageSynthesize(
  normalized: NormalizedIntent,
  routing: RoutingDecision,
  options?: PipelineOptions,
): Promise<RawArtifact> {
  const synthStart = performance.now();

  // Delegate to the existing synthesizer (which handles template/LLM/skeleton internally)
  const result = await rawSynthesize(normalized.intent as ThorsenIntent, options);

  return {
    artifact: result.artifact,
    generationMethod: routing.strategy,
    rawLatencyMs: performance.now() - synthStart,
  };
}

/**
 * Stage 5 — VERIFY
 * Validate the artifact against the original intent and constraints.
 * Checks: syntax validity, constraint satisfaction, output sanity.
 */
function stageVerify(
  raw: RawArtifact,
  normalized: NormalizedIntent,
): VerifiedArtifact {
  const { artifact } = raw;
  const { intent } = normalized;

  // Basic parse validation — check the code isn't empty or just comments
  const codeLines = artifact.code.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));
  const parseValid = codeLines.length >= 2;

  // Constraint checking
  const constraintResults: VerifiedArtifact['constraintResults'] = [];
  for (const constraint of intent.constraints ?? []) {
    const lower = constraint.toLowerCase();

    if (lower.includes('no external dep')) {
      // Known framework/toolchain packages are NOT "external deps" — they're expected
      const ALLOWED_PACKAGES = new Set([
        'react', 'zustand', 'fastify', 'vitest',
        '@testing-library/react', '@testing-library/jest-dom',
        'next', 'express', 'zod', 'prisma', '@prisma/client',
        'tsx', 'typescript', 'vite', 'tailwindcss',
        'framer-motion', 'lucide-react', 'three',
      ]);
      const importRegex = /import\s.*from\s+['"]([^./][^'"]*)['"/]/g;
      let match: RegExpExecArray | null;
      const unknownImports: string[] = [];
      while ((match = importRegex.exec(artifact.code)) !== null) {
        const pkg = match[1].startsWith('@')
          ? match[1].split('/').slice(0, 2).join('/')
          : match[1].split('/')[0];
        if (!ALLOWED_PACKAGES.has(pkg)) {
          unknownImports.push(pkg);
        }
      }
      const hasExternal = unknownImports.length > 0;
      constraintResults.push({
        constraint,
        passed: !hasExternal,
        reason: hasExternal ? `Unknown external imports: ${unknownImports.join(', ')}` : undefined,
      });
    } else if (lower.match(/< ?\d+ lines/)) {
      const maxLines = parseInt(lower.match(/< ?(\d+)/)?.[1] ?? '50');
      const lineCount = artifact.code.split('\n').length;
      constraintResults.push({
        constraint,
        passed: lineCount < maxLines,
        reason: lineCount >= maxLines ? `Code has ${lineCount} lines (max: ${maxLines})` : undefined,
      });
    } else if (lower.includes('typed') || lower.includes('type-safe')) {
      // TypeScript types
      const hasTsTypes = /:\s*(string|number|boolean|void|Promise|Record|Array|unknown)/.test(artifact.code)
        || /interface\s|type\s/.test(artifact.code);
      // Python type hints (TypeVar, Callable, Dict, List, Optional, -> T, etc.)
      const hasPyTypes = /from typing import/.test(artifact.code)
        || /:\s*(int|float|str|bool|Dict|List|Optional|Callable|Any|TypeVar)/.test(artifact.code)
        || /->\s*(None|int|float|str|bool|Dict|List|Optional|T)/.test(artifact.code);
      const hasTypes = hasTsTypes || hasPyTypes;
      constraintResults.push({
        constraint,
        passed: hasTypes,
        reason: !hasTypes ? 'No type annotations found' : undefined,
      });
    } else {
      // Unknown constraint — pass by default, note it
      constraintResults.push({ constraint, passed: true, reason: 'Constraint not machine-verifiable' });
    }
  }

  const constraintsPassed = constraintResults.every(r => r.passed);

  // Update artifact verified status
  const updatedArtifact: ThorsenArtifact = {
    ...artifact,
    verified: artifact.verified || (parseValid && constraintsPassed),
  };

  return {
    artifact: updatedArtifact,
    parseValid,
    constraintsPassed,
    constraintResults,
  };
}

/**
 * Stage 6 — SCORE
 * Compute the final thorsenScore and classify the Thorsen Curve sync state.
 * This produces the "SoftwareArtifact" output with full scoring.
 */
function stageScore(
  verified: VerifiedArtifact,
  normalized: NormalizedIntent,
  routing: RoutingDecision,
  pipelineStartMs: number,
): ScoredArtifact {
  const pipelineLatencyMs = performance.now() - pipelineStartMs;
  const syncState = classifySyncState(pipelineLatencyMs);

  // Score factors — each contributes to the final thorsenScore
  const factors: Record<string, number> = {};

  // ── Converse branch — conversation quality over code quality ──
  if (normalized.intent.action === 'converse') {
    factors.sourceReliability = routing.strategy === 'llm' ? 0.90 : 0.80;
    factors.verified = verified.parseValid ? 0.05 : 0;
    factors.speed = syncState === 'wormhole' ? 0.10
      : syncState === 'parallel' ? 0.05
      : -0.05;
    // Converse intents value thoroughness; penalize overly short responses
    const responseLength = verified.artifact.code.length;
    factors.responsivenessDepth = responseLength > 200 ? 0.10
      : responseLength > 50 ? 0.05
      : -0.05;

    const baseScore = verified.artifact.thorsenScore;
    const adjustment = Object.values(factors).reduce((sum, v) => sum + v, 0) - factors.sourceReliability;
    const adjustedScore = Math.max(0, Math.min(1, baseScore + adjustment));

    return {
      artifact: { ...verified.artifact, thorsenScore: adjustedScore },
      syncState,
      pipelineLatencyMs: Math.round(pipelineLatencyMs * 100) / 100,
      adjustedScore,
      scoreFactors: factors,
    };
  }

  // ── Default branch — code artifact scoring ────────────────────
  // Base score from generation method
  factors.sourceReliability = routing.strategy === 'template' ? 1.0
    : routing.strategy === 'llm' ? 0.85
    : routing.strategy === 'hybrid' ? 0.90
    : 0.3;

  // Verification bonus
  factors.verified = verified.parseValid ? 0.1 : 0;
  factors.constraints = verified.constraintsPassed ? 0.1 : -0.1;

  // Speed bonus — faster = more aligned (wormhole state)
  factors.speed = syncState === 'wormhole' ? 0.05
    : syncState === 'parallel' ? 0.02
    : -0.05;

  // Complexity alignment — trivial intents with complex output = mismatch
  const codeLength = verified.artifact.code.split('\n').length;
  const expectedLength = normalized.complexity === 'trivial' ? 30
    : normalized.complexity === 'standard' ? 60
    : normalized.complexity === 'complex' ? 120
    : 80;
  const lengthRatio = Math.min(codeLength, expectedLength) / Math.max(codeLength, expectedLength);
  factors.lengthAlignment = lengthRatio * 0.1;

  // Base score from artifact + adjustments
  const baseScore = verified.artifact.thorsenScore;
  const adjustment = Object.values(factors).reduce((sum, v) => sum + v, 0) - factors.sourceReliability;
  const adjustedScore = Math.max(0, Math.min(1, baseScore + adjustment));

  return {
    artifact: { ...verified.artifact, thorsenScore: adjustedScore },
    syncState,
    pipelineLatencyMs: Math.round(pipelineLatencyMs * 100) / 100,
    adjustedScore,
    scoreFactors: factors,
  };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Pipeline Executor
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function generateTraceId(): string {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `th-${now}-${random}`;
}

function timeStage(stage: PipelineStage, startMs: number): StageTiming {
  const endMs = performance.now();
  return {
    stage,
    startMs,
    endMs,
    durationMs: Math.round((endMs - startMs) * 100) / 100,
  };
}

/**
 * Execute the full 6-stage Thorsen pipeline.
 *
 * ```
 * Human → IntentPacket (4 fields) → [receive → normalize → route → synthesize → verify → score] → SoftwareArtifact
 * ```
 *
 * Returns a ThorsenPipelineResponse — identical to ThorsenResponse
 * but with an attached PipelineTrace for full observability.
 */
export async function executePipeline(
  intent: ThorsenIntent,
  options?: PipelineOptions,
): Promise<ThorsenPipelineResponse> {
  const pipelineStartMs = performance.now();
  const traceMode = options?.traceMode !== false; // default: on
  const stages: StageTiming[] = [];
  const intermediates: PipelineTrace['intermediates'] = {};

  const trace: PipelineTrace = {
    traceId: generateTraceId(),
    totalMs: 0,
    stages,
    intermediates: traceMode ? intermediates : {},
    success: false,
  };

  try {
    /* ── Stage 1: RECEIVE ── */
    let stageStart = performance.now();
    await options?.preHooks?.receive?.('receive', intent);
    const received = stageReceive(intent);
    stages.push(timeStage('receive', stageStart));
    if (traceMode) intermediates.received = received;
    await options?.postHooks?.receive?.('receive', received);

    if (!received.valid) {
      trace.success = false;
      trace.error = `Validation failed: ${received.validationErrors.join('; ')}`;
      trace.failedAt = 'receive';
      trace.totalMs = Math.round((performance.now() - pipelineStartMs) * 100) / 100;
      return buildErrorResponse(trace);
    }

    /* ── Stage 2: NORMALIZE ── */
    stageStart = performance.now();
    await options?.preHooks?.normalize?.('normalize', received);
    const normalized = stageNormalize(received);
    stages.push(timeStage('normalize', stageStart));
    if (traceMode) intermediates.normalized = normalized;
    await options?.postHooks?.normalize?.('normalize', normalized);

    /* ── Stage 3: ROUTE ── */
    stageStart = performance.now();
    await options?.preHooks?.route?.('route', normalized);
    const routing = stageRoute(normalized, options);
    stages.push(timeStage('route', stageStart));
    if (traceMode) intermediates.routed = routing;
    await options?.postHooks?.route?.('route', routing);

    /* ── Stage 4: SYNTHESIZE ── */
    stageStart = performance.now();
    await options?.preHooks?.synthesize?.('synthesize', routing);
    const raw = await stageSynthesize(normalized, routing, options);
    stages.push(timeStage('synthesize', stageStart));
    if (traceMode) intermediates.synthesized = raw;
    await options?.postHooks?.synthesize?.('synthesize', raw);

    /* ── Stage 5: VERIFY ── */
    let verified: VerifiedArtifact;
    if (options?.skipVerify) {
      verified = {
        artifact: raw.artifact,
        parseValid: true,
        constraintsPassed: true,
        constraintResults: [],
      };
      stages.push({ stage: 'verify', startMs: performance.now(), endMs: performance.now(), durationMs: 0 });
    } else {
      stageStart = performance.now();
      await options?.preHooks?.verify?.('verify', raw);
      verified = stageVerify(raw, normalized);
      stages.push(timeStage('verify', stageStart));
      if (traceMode) intermediates.verified = verified;
      await options?.postHooks?.verify?.('verify', verified);
    }

    /* ── Stage 6: SCORE ── */
    stageStart = performance.now();
    await options?.preHooks?.score?.('score', verified);
    const scored = stageScore(verified, normalized, routing, pipelineStartMs);
    stages.push(timeStage('score', stageStart));
    if (traceMode) intermediates.scored = scored;
    await options?.postHooks?.score?.('score', scored);

    /* ── Assemble final response ── */
    trace.success = true;
    trace.totalMs = Math.round((performance.now() - pipelineStartMs) * 100) / 100;

    return {
      artifact: scored.artifact,
      sync: {
        state: scored.syncState,
        latencyMs: scored.pipelineLatencyMs,
        resolved: scored.adjustedScore > 0.5,
      },
      trace,
    };
  } catch (err) {
    const failedStage = stages.length < 6
      ? (['receive', 'normalize', 'route', 'synthesize', 'verify', 'score'] as const)[stages.length]
      : 'score';
    trace.success = false;
    trace.error = err instanceof Error ? err.message : String(err);
    trace.failedAt = failedStage;
    trace.totalMs = Math.round((performance.now() - pipelineStartMs) * 100) / 100;
    return buildErrorResponse(trace);
  }
}

/* ── Error response builder ───────────────────────────────────── */

function buildErrorResponse(trace: PipelineTrace): ThorsenPipelineResponse {
  return {
    artifact: {
      language: 'text',
      code: `// Pipeline Error at stage "${trace.failedAt}"\n// ${trace.error}\n`,
      filename: 'thorsen-error.txt',
      thorsenScore: 0,
      verified: false,
      verifyOutput: trace.error,
    },
    sync: {
      state: 'linear' as ThorsenSyncState,
      latencyMs: trace.totalMs,
      resolved: false,
    },
    trace,
  };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Helpers
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function resolveDefaultLanguage(targetEnv: ThorsenTargetEnv): ThorsenLanguage {
  switch (targetEnv) {
    case 'node':
    case 'browser':
    case 'edge':
      return 'typescript';
    case 'docker':
      return 'typescript'; // Vai is TS-first
    case 'wsl2':
      return 'python';     // WSL2 often implies Python workflows
    default:
      return 'typescript';
  }
}

function classifyComplexity(intent: ThorsenIntent, hasTemplate: boolean): IntentComplexity {
  // Templates are trivial by definition — verified, instant
  if (hasTemplate) return 'trivial';

  // Custom domain with spec = at least standard
  if (intent.domain === 'custom') {
    if (intent.spec && intent.spec.length > 100) return 'complex';
    return 'standard';
  }

  // Multiple constraints = more complex
  if (intent.constraints && intent.constraints.length >= 3) return 'complex';

  // Actions that imply existing code context
  if (intent.action === 'optimize' || intent.action === 'debug' || intent.action === 'transpile') {
    return 'complex';
  }

  // Base domains without template — standard
  return 'standard';
}

/* ── Pipeline info (for /api/thorsen/pipeline endpoint) ───────── */

export function getPipelineInfo() {
  return {
    stages: [
      { stage: 'receive', description: 'Parse + validate structured IntentPacket' },
      { stage: 'normalize', description: 'Resolve defaults, compute 4-field fingerprint, classify complexity' },
      { stage: 'route', description: 'Decide strategy: template, LLM, hybrid, or skeleton' },
      { stage: 'synthesize', description: 'Execute chosen strategy → raw code' },
      { stage: 'verify', description: 'Parse-check, constraint validation' },
      { stage: 'score', description: 'Compute thorsenScore, classify sync state on Thorsen Curve' },
    ],
    coreFields: ['action', 'domain', 'logicType', 'targetEnv'],
    strategies: ['template', 'llm', 'hybrid', 'skeleton'],
    complexityLevels: ['trivial', 'standard', 'complex', 'novel'],
    curveThresholds: THORSEN_CURVE,
    templates: listTemplates(),
  };
}
