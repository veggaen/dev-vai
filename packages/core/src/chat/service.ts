import { eq, desc, or } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { VaiDatabase } from '../db/client.js';
import type {
  ChatPromptRewriteConfig,
  ChatPromptRewriteProfile,
  ChatPromptRewriteResponseDepth,
} from '../config/types.js';
import { conversations, messages, images } from '../db/schema.js';
import type { ModelRegistry, ModelAdapter, ChatChunk, Message, TokenUsage, TurnThinking, TurnRoutePlan } from '../models/adapter.js';
import { SkillRouter } from '../models/skill-router.js';
import type { ThorsenAdaptiveController } from '../thorsen/types.js';
import {
  buildChatTurnQualitySystemHint,
  buildTemporaryModeOverrideSystemHint,
  CHAT_STRUCTURE_SYSTEM_HINT,
  KNOWLEDGE_RETRIEVAL_SCORE_MIN,
  isGenerationIntent,
  resolveTemporaryTurnMode,
  shouldInjectChatStructureHint,
} from './chat-quality.js';
import {
  evaluateChatAnswerQuality,
  type ChatAnswerQualityReport,
} from './chat-answer-quality.js';
import { isExplicitBuildExecutionRequest } from './build-execution-intent.js';
import { CONVERSATION_MODE_SYSTEM_PROMPTS, DEFAULT_CONVERSATION_MODE, type ConversationMode, isConversationMode } from './modes.js';
import { tryHandleChatMeta } from './meta-router.js';
import {
  extractConversationFacts,
  tryHandleFactRecall,
  buildFactsSystemPrelude,
  type FactsHistoryMessage,
} from './conversation-facts.js';
import { tryEmitConstrainedCode } from './constrained-code-emitter.js';
import { tryEmitContinuation } from './chat-continuation.js';
import { tryEmitFormatStrict } from './format-strict-router.js';
import { tryEmitFactShim } from './deterministic-facts-router.js';
import { extractIdiomContext } from './programming-idioms.js';
import { splitCompoundQuestion, classifyQuestionIntent } from './question-intent.js';
import { classifyTurn } from './turn-classifier.js';
import {
  dispatchTurn,
  type TurnHandler,
  type TurnContext,
  type Resolution,
  type DispatchPlan,
} from './turn-pipeline.js';
import { shadowScore, type ShadowScore } from './capability-kernel.js';
import { liveContextCapability } from './capabilities/live-context-capability.js';
import type {
  CouncilInput,
  CouncilThinking,
  CouncilConsensus,
} from '../consensus/types.js';
import type { CouncilRoster } from '../consensus/topic-router.js';
import { convene, toCouncilThinking } from '../consensus/council.js';
import { gatherWebEvidence } from '../consensus/web-evidence.js';
import { extractCheckableClaim, assessClaimAgreement, applyCrossCheck } from '../consensus/cross-check.js';
import { resolveIntent } from '../consensus/intent-resolver.js';
import { detectImageIntent } from './image-intent.js';
import { generateWithVerification, modelBackedWantsImageGate } from '../vision/image-gen-loop.js';
import { checkCorrectionGuard } from '../consensus/correction-guard.js';
import { logGrounding, type GroundingErrorType, type GroundingVerdict } from '../consensus/grounding-log.js';
import {
  salientTokens,
  selectApplicableGuidance,
  toTurnGuidance,
  type RouteGuidance,
  type GuidanceStore,
} from './route-guidance.js';
import { extractActiveTopicBrief, hasTopicOverlap } from './active-topic-brief.js';
import { resolveChatPromptRewriteConfig, rewriteChatPrompt } from './prompt-rewrite.js';
import { buildTurnKindSystemHint, classifyChatTurn } from './turn-kind.js';
import {
  buildSourcesChunkFromSearch,
  buildEvidenceContextSystemHint,
  fetchTurnWebEvidence,
  shouldAttemptWebConclusion,
} from './web-conclude-turn.js';
import {
  decideVaiFallback,
  pickFallbackModelId,
  shouldEscalateDeterministicDecline,
  shouldFlipPrimaryToGenerative,
  shouldPreferGroundedFallback,
  VAI_FALLBACK_CONFIDENCE_THRESHOLD,
} from './vai-fallback.js';
import { sanitizeLeakage, verifyResponse, type ResponseVerificationConfig } from './response-verification.js';
import {
  evaluateBuilderRequestSatisfaction,
  hasBuilderFileBlocks,
  repairBuilderFallbackFileBlocks,
  type BuilderSatisfactionReport,
} from './builder-satisfaction.js';
import {
  councilGenerateApp,
  extractTitledFiles,
  parseActiveSandboxContext,
  validateGeneratedApp,
  type CouncilCodegenMember,
  type CouncilEditContext,
} from '../models/builder/council-codegen/index.js';
import { routeBuilderRequest } from '../models/builder/builder-request-router.js';
import { calculateCost } from '../usage/service.js';
import { isProductEngineeringPlanningPrompt } from './product-engineering-intent.js';
import { tryEmitProductEngineeringMemo } from './product-engineering-memo.js';
import { tryEmitBoundaryResponse } from './boundary-response.js';
import { reviewTurnSecurity } from './security-review.js';
import { reduceConversationContract, buildContractSystemPrelude } from './conversation-contract.js';
import { tryEmitConversationReasoning } from './conversation-reasoning.js';
import { normalizeInputForUnderstanding } from '../input-normalization.js';
import { tryEmitSingleClarifyingQuestion } from './single-clarifying-question.js';
import {
  tryEmitBridgeCapabilityAudit,
  tryEmitPrivateLiveContextResponse,
} from './bridge-evidence-discipline.js';
import {
  isFreshLocalBusinessContactRequest,
  isFreshLocalRecommendationRequest,
  isPureConversationalTurn,
  shouldSkipWebConclusion,
} from '../models/web-conclude-policy.js';
import { shouldPeerReviewCode } from './code-review-policy.js';
import {
  resolveContextualFollowUp,
  rewriteBusinessContactLookupFollowUp,
} from './contextual-resolver.js';

/**
 * A {@link Resolution} carrying the two service-specific fields the shared
 * emit path needs: the `strategy` tag (becomes the persisted modelId + the
 * thinking strategy) and any `preChunks` streamed before the answer (e.g. the
 * product-engineering memo's progress stages). Handlers in the dispatch list
 * return this; the core pipeline stays UI-agnostic via its generic parameter.
 */
interface ServiceResolution extends Resolution {
  readonly strategy: string;
  readonly preChunks?: readonly ChatChunk[];
}

export interface ImageInput {
  data: string;      // base64
  mimeType: string;
  filename?: string;
  description: string;  // required human description
  question?: string;    // optional question
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export interface ResponseReviewInput {
  readonly prompt: string;
  readonly draft: string;
  readonly modelId: string;
  readonly turnKind: string;
  readonly hasEvidence: boolean;
  readonly sources: readonly {
    readonly title?: string;
    readonly url?: string;
    readonly snippet?: string;
  }[];
}

export interface ResponseReviewResult {
  readonly decision: 'approve' | 'reject';
  readonly reason: string;
  readonly requiresFreshEvidence?: boolean;
  readonly confidence?: number;
  /** Peer concerns surfaced during friend review (code quality, accuracy, etc.). */
  readonly concerns?: readonly string[];
  /** Actionable improvements peers suggested before release. */
  readonly suggestions?: readonly string[];
}

export interface ResponseReviewer {
  readonly id: string;
  readonly review: (input: ResponseReviewInput) => Promise<ResponseReviewResult | null>;
}

export interface ChatServiceOptions {
  readonly promptRewrite?: Partial<ChatPromptRewriteConfig>;
  /** Optional knowledge retrieval function for enriching external model prompts */
  readonly retrieveKnowledge?: (query: string, topK?: number) => Array<{ text: string; source: string; score: number }>;
  /**
   * Ordered model ids to try when vai:v0 produces a low-confidence or
   * "no knowledge" response. The chat service will pick the first registered
   * non-`vai:v0` adapter from this list and re-dispatch the turn against it,
   * streaming a `fallback_notice` chunk first so the UI can badge the answer.
   * When unset or empty, vai:v0 responses are streamed as-is.
   */
  readonly vaiFallbackChain?: readonly string[];
  /**
   * Operator-supplied extra decline markers (configurable, e.g. localized
   * "I don't know" phrasings). Threaded through to both the entrance decline
   * detector ({@link decideVaiFallback}) and the exit verification arm
   * ({@link verifyResponse}) so escalation generalizes to phrasings we never
   * hard-coded without touching code. (§4.5 good defaults, tunable.)
   */
  readonly extraDeclineMarkers?: readonly string[];
  /**
   * Post-generation verification arm config (Master.md §12.5.3). Tunes the exit
   * gate — calibration band, leak patterns, and the (default-off) requirement
   * that confident factual claims be backed by evidence. `extraDeclineMarkers`
   * above is merged in automatically. Defaults keep the gate conservative.
   */
  readonly verification?: Partial<ResponseVerificationConfig>;
  /**
   * Primary-generator flip: substantive (analysis/research) turns go straight
   * to the capable generative model instead of running the vai:v0 corpus arm
   * first. Defaults to the VAI_PRIMARY_GENERATIVE env switch (enabled unless
   * set to '0'). Set `false` to exercise the legacy vai-first arm.
   */
  readonly primaryGenerativeFlip?: boolean;
  /**
   * Run the upstream security-review pass (prompt-injection / secret-exfil /
   * malware / manipulation / safety-incident) before any broad factual router.
   * Defaults to `true`. Set `false` to measure the prompt-only baseline.
   */
  readonly securityReview?: boolean;
  /**
   * Build the durable conversation-contract ledger and restate it every turn,
   * instead of the legacy stateless facts prelude. Defaults to `true`. Set
   * `false` to measure the prompt-only baseline.
   */
  readonly contractLedger?: boolean;
  /** Optional hook for recording final usage/cost after a streamed turn completes. */
  readonly onUsage?: (entry: {
    id: string;
    modelId: string;
    provider: string;
    conversationId: string;
    tokensIn: number;
    tokensOut: number;
    cachedTokens: number;
    costUsd: number;
    durationMs: number;
    finishReason: string;
  }) => void;
  /**
   * Preferred: full store for loading *and writing* RouteGuidance records.
   * Writing (save + recordApplication) is what creates the durable reference
   * data we later use to compute "was this steering a net benefit?" and to
   * decide if re-calibration of weights, scopes, matching, or actor trust is needed.
   */
  readonly guidanceStore?: GuidanceStore;
  /**
   * Optional bounded reviewers that inspect selected drafts before release.
   * Reviewers can veto an answer but cannot silently replace it with their own.
   */
  readonly responseReviewers?: readonly ResponseReviewer[];

  /**
   * Legacy: simple load fn only. If guidanceStore is also supplied it takes precedence.
   * @deprecated Prefer guidanceStore for full read/write + analysis support.
   */
  readonly loadActiveGuidance?: (conversationId: string) => readonly RouteGuidance[];
  /** SCIS Consensus Council roster (topic -> members). When supplied, the service runs the council on substantive drafts and attaches CouncilThinking to the turn trace (powers the ThinkingPanel council section). */
  readonly councilRoster?: CouncilRoster;
  /**
   * Optional web search hook for attaching evidence to analysis/research turns
   * when the responding model does not emit its own sources chunk (e.g. local Qwen).
   */
  readonly searchForEvidence?: (query: string, budgetMs: number) => Promise<import('../search/types.js').SearchResponse | null>;
  /**
   * Optional image reader. When supplied AND it `canSee`, image turns get a grounded machine
   * reading of the pixels appended to the prompt (instead of only the human description), so Vai
   * stops fabricating descriptions of screenshots it never saw. Defaults to an honest no-op.
   */
  readonly visionAdapter?: import('../vision/adapter.js').VisionAdapter;
  /**
   * Optional image generator. When supplied AND it `canProduce`, image-output turns (explicit
   * Image mode or detected "draw me…" intent) produce an image via the produce→verify→regenerate
   * loop (using `visionAdapter` as the verifier) instead of a text answer.
   */
  readonly imageProducer?: import('../vision/image-producer.js').ImageProducer;
  /**
   * Optional model adapter used as the image-intent PRE-GATE ("did the user actually ask for an
   * image?") on auto-detected (non-explicit) image turns. Typically the council's Grok adapter.
   */
  readonly imageIntentGateAdapter?: import('../models/adapter.js').ModelAdapter;
}

export interface ChatPromptRewriteOverrides {
  readonly profile?: ChatPromptRewriteProfile;
  readonly responseDepth?: ChatPromptRewriteResponseDepth;
  /** When false, skip ambiguous-query hardening for this turn (eval / smoke harness). */
  readonly enabled?: boolean;
}

function isChatServiceOptions(value: unknown): value is ChatServiceOptions {
  return !!value
    && typeof value === 'object'
    && (
      'promptRewrite' in value
      || 'retrieveKnowledge' in value
      || 'vaiFallbackChain' in value
      || 'extraDeclineMarkers' in value
      || 'verification' in value
      || 'onUsage' in value
      || 'securityReview' in value
      || 'contractLedger' in value
      || 'responseReviewers' in value
      || 'searchForEvidence' in value
      || 'councilRoster' in value
      || 'guidanceStore' in value
      || 'loadActiveGuidance' in value
    );
}

/** A draft handed to the council, with the context a member needs to judge it. */
interface CouncilDraftInput {
  readonly prompt: string;
  readonly draftText: string;
  readonly modelId: string;
  readonly turnKind?: string;
  readonly confidence?: number;
  readonly hasEvidence?: boolean;
  readonly sources?: readonly { readonly title?: string; readonly url?: string; readonly snippet?: string }[];
  /** Prior turns (oldest→newest), so the cross-check can run the multi-turn correction guard. */
  readonly history?: readonly { readonly role: 'user' | 'assistant' | 'system' | 'tool'; readonly content: string }[];
  /** Conversation id, for the grounding learning log. */
  readonly conversationId?: string;
}

/**
 * What the council teaches the redraft — intent + method, never facts. Mirrors the
 * fact-quarantine: a member's reading of HOW to approach the turn, not its answer.
 */
export interface CouncilRedraftFeedback {
  readonly realIntent: string;
  readonly methodLessons: readonly string[];
  readonly missingCapabilities: readonly string[];
  readonly concerns: readonly string[];
  readonly recommendedAction: string;
}

/**
 * Rank a consensus so the loop can keep the better of two drafts. Higher is better:
 * ship beats act beats escalate; ties break on agreement then confidence.
 */
export function councilScore(consensus: CouncilConsensus): number {
  const outcomeRank = consensus.outcome === 'ship' ? 2 : consensus.outcome === 'act' ? 1 : 0;
  return outcomeRank * 100 + consensus.agreement * 10 + consensus.confidence;
}

/**
 * Outcome-aware acceptance for a redraft — proposed by the council reviewing its
 * OWN grading (self-eval 2026-06-14): a higher score alone can reward a redraft
 * that merely raised agreement without resolving the flagged gap. So when the
 * FIRST review named a concrete `missingCapability`, the redraft must actually
 * RESOLVE it to win — defined as the second review no longer escalating AND
 * either clearing those capabilities or reaching `ship`. When the first review
 * named no specific gap, we fall back to the plain score comparison (unchanged
 * behavior). Pure + exported for tests.
 */
export function redraftResolvedConcern(
  first: CouncilConsensus,
  second: CouncilConsensus,
): boolean {
  const firstGaps = (first.missingCapabilities ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean);
  // No specific gap was flagged → grading reverts to the score comparison.
  if (firstGaps.length === 0) return councilScore(second) >= councilScore(first);

  // A gap was flagged. The redraft "resolved" it only if the council stopped
  // escalating AND it either shipped or dropped the previously-named gaps.
  if (second.outcome === 'escalate') return false;
  if (second.outcome === 'ship') return true;
  const secondGaps = new Set((second.missingCapabilities ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean));
  const stillUnresolved = firstGaps.some((gap) => secondGaps.has(gap));
  // Resolved the named gap(s) AND didn't regress on score.
  return !stillUnresolved && councilScore(second) >= councilScore(first);
}

/**
 * Turn council feedback into a compact redraft instruction. Intent and method only —
 * the friends point, Vai writes. Returns a single appended system/user nudge string.
 */
export function buildCouncilRedraftInstruction(feedback: CouncilRedraftFeedback): string {
  const lines: string[] = [
    'Your draft was reviewed by your friend council before reaching the user. They did NOT clear it yet.',
    'Use their reading to improve THIS answer. They point at intent and method only — you supply every fact yourself.',
  ];
  if (feedback.realIntent) lines.push(`What the user actually wants: ${feedback.realIntent}`);
  if (feedback.recommendedAction === 'reread-intent') {
    lines.push('You likely misread the ask. Re-read the true intent above and answer THAT, directly.');
  }
  if (feedback.methodLessons.length) {
    lines.push(`How to handle this kind of message: ${feedback.methodLessons.slice(0, 3).join('; ')}.`);
  }
  if (feedback.missingCapabilities.length) {
    lines.push(`Capabilities your draft was missing: ${feedback.missingCapabilities.slice(0, 3).join('; ')}.`);
  }
  if (feedback.concerns.length) {
    lines.push(`Specific concerns to fix: ${feedback.concerns.slice(0, 4).join('; ')}.`);
  }
  lines.push('Rewrite the answer now, keeping everything that was already correct and fixing only what they flagged.');
  return lines.join('\n');
}

const ACTIVE_SANDBOX_EXECUTION_HINT = [
  'An active sandbox project is already attached to this conversation.',
  'Default to targeted edits for that live app, not a fresh scaffold and not abstract product advice.',
  'Exception: if this is the first substantive build/create request and no current file snapshots or prior assistant file blocks exist, treat it as the first runnable build for the auto-created sandbox.',
  'When the user asks for a feature, polish pass, or fix, emit the concrete changed files needed to update the current app.',
  'Prefer the smallest working diff that preserves the current preview.',
  'Keep the product contract intact: preserve real user flows, real domain labels, working controls, responsive layout, and visible empty/error states.',
  'If you add a button, filter, tab, form, or destructive action, wire it to observable state or navigation.',
  'Do not switch into research notes, citations, or generic troubleshooting unless the user explicitly asks for them or you are blocked on a specific missing fact.',
].join(' ');

/**
 * Small, late prompt for the escalated builder arm. Builder mode already has a
 * broad product-quality charter; this recovery hint keeps a small local model
 * focused on the immediate contract after the deterministic scaffold failed.
 */
const BUILDER_FALLBACK_SYSTEM_HINT = [
  'This is an escalated Builder Mode recovery turn: the first artifact did not satisfy the user request.',
  'Return the smallest runnable implementation that visibly satisfies the request.',
  'Do not narrate a plan, repeat these instructions, offer product advice, or ask follow-up questions unless a missing choice changes behavior, security, data, or money flows.',
  'Emit concrete files as fenced code blocks with title="path/to/file" so the live sandbox can apply them.',
  'The fence info line must look exactly like ```html title="index.html" — the title value in double quotes on the fence line itself, never as a line inside the file body.',
  'For a new app, include every file required to run it. For an attached project edit, emit only the changed files.',
  'For a lightweight UI that can run without dependencies, prefer one complete index.html file with inline CSS and JavaScript.',
  'Implement the requested visible behaviors and domain details; do not stop at a generic scaffold.',
  'Your response must begin with the first file block.',
].join(' ');

/** Fallback artifacts need stronger source coverage than deterministic primary scaffolds. */
const FALLBACK_BUILDER_MIN_ANCHOR_COVERAGE = 0.8;

/** Project a dispatcher {@link DispatchPlan} into the friend-readable
 * {@link TurnRoutePlan} carried on the thinking trace. Shadow capabilities (if
 * any) are appended as non-deciding candidates so their Capability-Kernel
 * scoring is visible for comparison without affecting the live decision. */
function buildRoutePlan(plan: DispatchPlan, shadows: readonly ShadowScore[] = []): TurnRoutePlan {
  const liveCandidates = plan.candidates.map((c) => ({
    name: c.name,
    score: c.score,
    baseScore: c.baseScore,
    chosen: c.name === plan.chosen,
    declined: plan.declined.includes(c.name),
    guidance: c.guidanceApplied,
    reason: c.reason,
  }));
  const shadowCandidates = shadows
    .filter((s) => s.score !== null)
    .map((s) => ({
      name: `${s.name} (shadow)`,
      score: s.score as number,
      chosen: false,
      // A shadow that would resolve+verify is "ready"; otherwise mark it
      // declined so the panel shows it could not have grounded its answer.
      declined: !(s.wouldResolve && s.wouldVerify),
      reason: s.verifyReason ? `${s.reason} — verify: ${s.verifyReason}` : s.reason,
      shadow: true,
    }));
  return {
    chosen: plan.chosen,
    belowFloor: plan.belowFloor,
    candidates: [...liveCandidates, ...shadowCandidates],
  };
}

function buildDeterministicThinking(
  strategy: string,
  input: string,
  durationMs: number,
  confidence = 0.95,
): TurnThinking {
  return {
    intent: 'structured-conversation',
    strategy,
    strategyChain: [strategy],
    trustBadge: 'structured-chat',
    confidence,
    topic: input.trim().replace(/\s+/g, ' ').slice(0, 80),
    knowledgeDepth: 'deep',
    register: 'operational',
    durationMs,
    processTrace: [
      { stage: 'structured:classify', durationMs: 0 },
      { stage: `tracked:${strategy}`, durationMs },
    ],
  };
}

function buildFallbackThinking(input: {
  readonly content: string;
  readonly turnKind: string;
  readonly trigger: string;
  readonly fallbackModelId: string;
  readonly verificationStage: string;
  readonly durationMs: number;
}): TurnThinking {
  const verificationParts = input.verificationStage.split(':');
  const qualityStage = verificationParts[0]?.startsWith('quality-')
    ? verificationParts.shift()
    : null;
  const exitVerificationStage = verificationParts.join(':') || input.verificationStage;
  const strategyChain = [
    `fallback:${input.trigger}`,
    `escalate:${input.fallbackModelId}`,
    ...(qualityStage ? [qualityStage] : []),
    `verify:${exitVerificationStage}`,
  ];
  return {
    intent: input.turnKind === 'builder' ? 'build' : input.turnKind,
    strategy: strategyChain.join('->'),
    strategyChain,
    trustBadge: 'fallback',
    topic: input.content.trim().replace(/\s+/g, ' ').slice(0, 80),
    knowledgeDepth: 'none',
    register: 'escalated',
    durationMs: input.durationMs,
    processTrace: [
      { stage: `fallback:decline:${input.trigger}`, durationMs: 0 },
      { stage: `fallback:escalate:${input.fallbackModelId}`, durationMs: input.durationMs },
      ...(qualityStage ? [{ stage: `fallback:${qualityStage}`, durationMs: input.durationMs }] : []),
      { stage: `tracked:fallback:verify:${exitVerificationStage}`, durationMs: input.durationMs },
    ],
  };
}

function buildBuilderFallbackRepairMessages(
  messages: readonly Message[],
  report: BuilderSatisfactionReport,
): Message[] {
  const missing = report.missingAnchors.slice(0, 8);
  const repairHint = [
    'The previous Builder recovery output still failed sandbox validation. Replace it completely.',
    report.hasFileBlocks
      ? 'It emitted files but did not cover enough requested behavior.'
      : 'It did not emit an auto-applicable file block.',
    missing.length > 0 ? `Missing or weak requirements: ${missing.join(', ')}.` : '',
    'Return one self-contained browser app. Begin exactly with: ```html title="index.html"',
    'Use inline CSS and browser JavaScript only. Do not call backend endpoints or assume a server exists.',
    'Wire every requested control to visible local state. Do not merely mention missing requirements in labels, comments, or prose.',
    'Output the replacement file block only.',
  ].filter(Boolean).join(' ');
  const systemMessages = messages.filter((message) => message.role === 'system');
  const conversationalMessages = messages.filter((message) => message.role !== 'system');
  return [...systemMessages, { role: 'system', content: repairHint }, ...conversationalMessages];
}

function scoreBuilderSatisfaction(report: BuilderSatisfactionReport): number {
  return (report.satisfied ? 100 : 0) + (report.hasFileBlocks ? 10 : 0) + report.coverage;
}

function buildFallbackQualityRepairMessages(
  messages: readonly Message[],
  report: ChatAnswerQualityReport,
): Message[] {
  const missing = report.missing
    .slice(0, 6)
    .map((requirement) => `${requirement.label}: ${requirement.expected}`);
  const repairHint = [
    'The previous fallback draft failed the answer-quality check. Rewrite it once from scratch.',
    missing.length > 0 ? `Failed requirements: ${missing.join('; ')}.` : '',
    'Answer the original user request directly. Do not mention this quality check or the previous draft.',
    'For debugging guidance, diagnose the existing system from observable evidence before proposing changes.',
    'Do not invent dependencies, versions, configuration, files, or project structure that the user did not provide.',
    'Do not emit a replacement scaffold or multiple full files unless the user explicitly requested implementation.',
    'Give a small ordered next step and a concrete signal the user can use to verify it.',
  ].filter(Boolean).join(' ');
  const systemMessages = messages.filter((message) => message.role === 'system');
  const conversationalMessages = messages.filter((message) => message.role !== 'system');
  return [...systemMessages, { role: 'system', content: repairHint }, ...conversationalMessages];
}

function scoreAnswerQuality(report: ChatAnswerQualityReport): number {
  const verdictWeight = report.verdict === 'pass' ? 200 : report.verdict === 'warn' ? 100 : 0;
  return verdictWeight + report.score;
}

function buildConservativeDiagnosticAnswer(prompt: string): string | null {
  const normalized = prompt.toLowerCase();
  if (!/\b(?:debug|debugging|diagnos(?:e|is)|troubleshoot|blank\s+(?:page|screen)|crash|failing|broken|error|flaky)\b/i.test(prompt)) {
    return null;
  }

  if (/\b(?:react|blank\s+(?:page|screen)|browser|frontend|web\s*page)\b/.test(normalized)) {
    return [
      'Start with the first observable browser failure before changing any files.',
      '',
      '1. Open DevTools and check the Console. Capture the first red error; later errors are often consequences.',
      '2. If the Console is clean, check the Network tab for a failed JavaScript request or a module returned as HTML.',
      '3. Inspect the page and verify the React mount element exists and its id matches the startup code.',
      '4. Check the dev-server terminal for compile errors, then reload once after fixing only the earliest confirmed failure.',
      '',
      'The useful next input is the first console error, failed request, or terminal stack trace. That evidence determines the smallest fix.',
    ].join('\n');
  }

  if (/\b(?:docker|container)\b/.test(normalized)) {
    return [
      'Start with the container exit evidence before changing the image or compose file.',
      '',
      '1. Run `docker ps -a` and note the exit code.',
      '2. Run `docker logs <container>` and capture the first startup error.',
      '3. Inspect the configured entrypoint, command, environment, and mounted paths against that error.',
      '4. Re-run once without an automatic restart policy so the original failure remains visible.',
      '',
      'The exit code and first log error are the decision point for the next fix.',
    ].join('\n');
  }

  if (/\b(?:test|tests|flaky|vitest|jest|pytest)\b/.test(normalized)) {
    return [
      'Start by making one failure reproducible instead of adding retries.',
      '',
      '1. Run the smallest failing test alone with a fixed seed and capture its first divergent assertion or log.',
      '2. Repeat it serially, then compare with the full-suite run to expose shared state, ordering, or timing dependence.',
      '3. Check unawaited work, fake timers, global mutations, filesystem/network state, and cleanup between tests.',
      '4. Fix the confirmed source of nondeterminism, then verify the test repeatedly and once inside the full suite.',
      '',
      'The first difference between isolated and suite behavior is the evidence that should drive the fix.',
    ].join('\n');
  }

  return [
    'Start by reproducing the failure and capturing the earliest reliable evidence before changing the system.',
    '',
    '1. Record the exact action, input, and environment that trigger it.',
    '2. Capture the first error, stack trace, failed request, or log line.',
    '3. Identify the smallest boundary where expected and actual behavior diverge.',
    '4. Change one likely cause, then repeat the same reproduction to verify the result.',
    '',
    'Share the earliest error and the reproduction step if you want the next diagnosis to be specific.',
  ].join('\n');
}

function buildConservativeExhaustiveAnswer(prompt: string): string | null {
  if (
    !/\b(?:all|every|complete|full|exhaustive)\b/i.test(prompt)
    || !/\b(?:list|items?|options?|champions?|roles?|entries|examples?)\b/i.test(prompt)
  ) {
    return null;
  }

  const subject = /\bchampions?\b/i.test(prompt)
    ? /\bmid(?:dle)?\s+lane\b/i.test(prompt) ? 'mid-lane champion roster' : 'champion roster'
    : /\broles?\b/i.test(prompt)
      ? 'role list'
      : 'requested list';

  return [
    `I cannot verify a complete ${subject} from memory alone, so I should not label a partial list as "all."`,
    '',
    'A trustworthy exhaustive answer needs a current authoritative source or dataset, including the relevant patch or version when the set can change.',
    '',
    'Once that source is available, I can turn it into the dotted list you requested and keep unusual or off-meta entries clearly distinguished.',
  ].join('\n');
}

function buildConservativeConversationalAnswer(prompt: string): string | null {
  if (/\bhumaniz(?:e|er|ing)\b/i.test(prompt) && /\b(?:test|prompt)\b/i.test(prompt)) {
    return [
      'A good prompt humanizer changes the surface form without changing the test contract.',
      '',
      '1. Protect literals first: code, paths, URLs, numbers, quoted text, placeholders, and required output tokens.',
      '2. Apply one or two seeded mutations: contractions, abbreviations, light punctuation changes, a realistic typo, or a meaning-preserving paraphrase.',
      '3. Preserve intent, entities, constraints, and expected answer shape. Reject any mutation that changes those semantics.',
      '4. Store the seed and mutation list so every failed test is reproducible.',
      '',
      'Verify it with invariant checks: protected tokens are unchanged, the semantic label is unchanged, and the same seed produces the same prompt.',
    ].join('\n');
  }

  if (
    /\bsmart friend\b/i.test(prompt)
    || (
      /\b(?:conversation|chat|talking)\b/i.test(prompt)
      && /\b(?:natural|personal|human|friend)\b/i.test(prompt)
    )
  ) {
    return [
      'Make the conversation feel like a smart friend by combining context, judgment, and restraint.',
      '',
      '1. Remember stable preferences and recent decisions, but do not pretend to remember details that were never stored.',
      '2. Match the user\'s register and tone without copying every slang word or emotional cue.',
      '3. Lead with a concise answer, then add the reasoning or next step that is actually useful.',
      '4. Use personal context when it changes the recommendation, and challenge weak assumptions gently instead of agreeing automatically.',
      '',
      'A useful test is whether the reply still feels specific after removing the user\'s exact wording. If it becomes generic, the system needs better context selection, not more personality text.',
    ].join('\n');
  }

  return null;
}

function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    cachedTokens: (left.cachedTokens ?? 0) + (right.cachedTokens ?? 0),
  };
}

function shouldKeepDeterministicDespiteQualityGate(strategy: string): boolean {
  return strategy === 'single-clarifying-question'
    || strategy === 'bridge-evidence-discipline'
    || strategy === 'chat-boundary-response'
    || strategy.startsWith('chat-meta')
    || strategy.startsWith('chat-facts')
    || strategy.startsWith('chat-format-strict');
}

function failsAnswerQualityGate(prompt: string, response: string, strategy?: string): boolean {
  if (!response.trim()) return true;
  return evaluateChatAnswerQuality({ prompt, response, strategy }).verdict === 'fail';
}

export class ChatService {
  private readonly promptRewriteConfig: ChatPromptRewriteConfig;
  private readonly controller?: ThorsenAdaptiveController;
  private readonly retrieveKnowledge?: (query: string, topK?: number) => Array<{ text: string; source: string; score: number }>;
  private readonly skillRouter = new SkillRouter();
  private readonly vaiFallbackChain: readonly string[];
  private readonly extraDeclineMarkers: readonly string[];
  private readonly verificationConfig: ResponseVerificationConfig;
  private readonly onUsage?: ChatServiceOptions['onUsage'];
  private readonly primaryGenerativeFlipEnabled: boolean;
  private readonly securityReviewEnabled: boolean;
  private readonly contractLedgerEnabled: boolean;
  private readonly guidanceStore?: GuidanceStore;
  private readonly responseReviewers: readonly ResponseReviewer[];
  private readonly loadActiveGuidance?: (conversationId: string) => readonly RouteGuidance[]; // legacy fallback
  /** Optional SCIS council roster. When present, substantive turns run the council for consensus + method lessons. */
  private readonly councilRoster?: CouncilRoster;
  private readonly searchForEvidence?: ChatServiceOptions['searchForEvidence'];
  private readonly visionAdapter?: ChatServiceOptions['visionAdapter'];
  private readonly imageProducer?: ChatServiceOptions['imageProducer'];
  private readonly imageIntentGateAdapter?: ChatServiceOptions['imageIntentGateAdapter'];

  constructor(
    private db: VaiDatabase,
    private models: ModelRegistry,
    controllerOrOptions?: ThorsenAdaptiveController | ChatServiceOptions,
    options?: ChatServiceOptions,
  ) {
    const resolvedOptions = isChatServiceOptions(controllerOrOptions) ? controllerOrOptions : options;
    this.controller = isChatServiceOptions(controllerOrOptions) ? undefined : controllerOrOptions;
    this.promptRewriteConfig = resolveChatPromptRewriteConfig(resolvedOptions?.promptRewrite);
    this.retrieveKnowledge = resolvedOptions?.retrieveKnowledge;
    this.vaiFallbackChain = resolvedOptions?.vaiFallbackChain ?? [];
    this.extraDeclineMarkers = resolvedOptions?.extraDeclineMarkers ?? [];
    this.verificationConfig = {
      ...resolvedOptions?.verification,
      extraDeclineMarkers:
        resolvedOptions?.extraDeclineMarkers ?? resolvedOptions?.verification?.extraDeclineMarkers,
    };
    this.onUsage = resolvedOptions?.onUsage;
    this.primaryGenerativeFlipEnabled =
      resolvedOptions?.primaryGenerativeFlip ?? (process.env.VAI_PRIMARY_GENERATIVE === '1');
    this.securityReviewEnabled = resolvedOptions?.securityReview ?? true;
    this.contractLedgerEnabled = resolvedOptions?.contractLedger ?? true;
    this.guidanceStore = resolvedOptions?.guidanceStore;
    this.responseReviewers = resolvedOptions?.responseReviewers ?? [];
    this.loadActiveGuidance = resolvedOptions?.loadActiveGuidance;
    this.councilRoster = resolvedOptions?.councilRoster;
    this.searchForEvidence = resolvedOptions?.searchForEvidence;
    this.visionAdapter = resolvedOptions?.visionAdapter;
    this.imageProducer = resolvedOptions?.imageProducer;
    this.imageIntentGateAdapter = resolvedOptions?.imageIntentGateAdapter;
  }

  /**
   * Council members for builder codegen: fallback-chain adapters first
   * (best-first — members[0] becomes architect+coder), topped up with the
   * remaining registered local models as reviewers. Capped at 3 so a build
   * turn stays bounded; the pipeline runs them sequentially (crash-safe on a
   * machine that BSODs under combined GPU load).
   */
  private builderCouncilMembers(): CouncilCodegenMember[] {
    const orderedIds = [
      ...this.vaiFallbackChain,
      ...this.models.listByProvider('local').map((adapter) => adapter.id),
    ];
    const members: CouncilCodegenMember[] = [];
    const seen = new Set<string>();
    for (const id of orderedIds) {
      if (id === 'vai:v0' || seen.has(id)) continue;
      seen.add(id);
      const adapter = this.models.tryGet(id);
      if (!adapter) continue;
      members.push({
        id,
        displayName: adapter.displayName,
        complete: async (messages, options) => {
          const response = await adapter.chat({
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            maxTokens: options?.maxTokens,
            temperature: options?.temperature,
          });
          return { text: response.message.content, usage: response.usage };
        },
      });
      if (members.length >= 3) break;
    }
    return members;
  }

  private shouldReviewResponse(prompt: string): boolean {
    return isFreshLocalRecommendationRequest(prompt)
      || isFreshLocalBusinessContactRequest(prompt);
  }

  /** Whether peers should review this draft before release. */
  private shouldReviewDraft(prompt: string, draft: string): boolean {
    return this.shouldReviewResponse(prompt) || shouldPeerReviewCode(prompt, draft);
  }

  private async reviewResponse(input: ResponseReviewInput): Promise<{
    rejected: boolean;
    reason: string;
    reviewers: readonly string[];
    concerns: readonly string[];
    suggestions: readonly string[];
    isCodeReview: boolean;
  }> {
    if (!this.shouldReviewDraft(input.prompt, input.draft) || this.responseReviewers.length === 0) {
      return { rejected: false, reason: '', reviewers: [], concerns: [], suggestions: [], isCodeReview: false };
    }

    const isCodeReview = shouldPeerReviewCode(input.prompt, input.draft);

    const settled = await Promise.allSettled(
      this.responseReviewers.map(async (reviewer) => ({
        id: reviewer.id,
        result: await reviewer.review(input),
      })),
    );
    const completed = settled
      .filter((entry): entry is PromiseFulfilledResult<{ id: string; result: ResponseReviewResult | null }> => entry.status === 'fulfilled')
      .map((entry) => entry.value)
      .filter((entry) => entry.result !== null);
    const rejection = completed.find((entry) => entry.result?.decision === 'reject');
    const concerns = completed.flatMap((entry) => entry.result?.concerns ?? []);
    const suggestions = completed.flatMap((entry) => entry.result?.suggestions ?? []);

    return {
      rejected: Boolean(rejection),
      reason: rejection?.result?.reason ?? completed.find((e) => e.result?.reason)?.result?.reason ?? '',
      reviewers: completed.map((entry) => entry.id),
      concerns,
      suggestions,
      isCodeReview,
    };
  }

  /** One council pass over a draft. Returns the projection + raw consensus, or undefined. */
  /**
   * Run an image-output turn: produce → (Grok/council) verify → regenerate-on-flaws, streaming
   * each step so the UI shows real work. Persists the result as an assistant message and emits a
   * `done`. Declines honestly (no fabricated image) when the producer is dormant or the multi-axis
   * pre-gate decides the user didn't actually ask for an image.
   */
  private async *runImageGenerationTurn(args: {
    conversationId: string; content: string; subject: string; startedAt: number; explicit: boolean;
  }): AsyncGenerator<ChatChunk> {
    yield { type: 'turn_kind', turnKind: 'analysis' } as ChatChunk;
    const producer = this.imageProducer!;
    yield { type: 'image_progress', image: { phase: 'produce', label: 'Generating image…', attempt: 1 } } as ChatChunk;

    // Pre-gate only on AUTO-detected turns (explicit Image mode is authoritative — skip the gate).
    const confirmWantsImage = args.explicit ? undefined : modelBackedWantsImageGate(this.imageIntentGateAdapter, args.content);

    const result = await generateWithVerification(
      producer,
      this.visionAdapter,
      { prompt: args.subject },
      {
        maxAttempts: Number(process.env.VAI_IMAGEGEN_MAX_ATTEMPTS) || 3,
        confirmWantsImage,
      },
    );

    // Stream each attempt's audit as visible progress (best-effort; result already has the trace).
    for (const att of result.attempts) {
      yield {
        type: 'image_progress',
        image: {
          phase: att.accepted ? 'final' : 'verify',
          label: att.accepted ? `Image accepted (match ${Math.round(att.matchScore * 100)}%)` : `Audited attempt ${att.attempt} — match ${Math.round(att.matchScore * 100)}%${att.flaws.length ? `, fixing: ${att.flaws.join(', ')}` : ''}`,
          attempt: att.attempt, matchScore: att.matchScore, flaws: att.flaws,
        },
      } as ChatChunk;
    }

    const durationMs = Date.now() - args.startedAt;
    if (!result.image) {
      const reason = result.declinedReason
        ? `I held off generating an image — ${result.declinedReason}.`
        : 'I can’t generate images right now (no image backend is running). Start ComfyUI and try again, or tell me what you’d like and I’ll describe it.';
      yield { type: 'image_progress', image: { phase: 'declined', label: reason } } as ChatChunk;
      const declineId = ulid();
      this.db.insert(messages).values({
        id: declineId, conversationId: args.conversationId, role: 'assistant',
        content: reason, modelId: producer.id, durationMs, createdAt: new Date(),
      }).run();
      yield { type: 'text_delta', textDelta: reason } as ChatChunk;
      yield { type: 'done', modelId: producer.id, durationMs } as ChatChunk;
      return;
    }

    const img = result.image;
    const dataUrl = `data:${img.mime};base64,${img.dataBase64}`;
    yield {
      type: 'image_result',
      image: { phase: 'final', dataUrl, width: img.width, height: img.height, accepted: result.accepted },
    } as ChatChunk;

    // Persist as an assistant message. Content holds a markdown image so existing renderers + the
    // transcript keep it; the raw image also goes to the images table for reuse.
    const caption = result.accepted ? '' : '\n\n_(Best effort — I couldn’t fully resolve every detail.)_';
    const assistantText = `![generated image](${dataUrl})${caption}`;
    const storedImageId = this.storeImage(
      { data: img.dataBase64, mimeType: img.mime, description: `Generated: ${args.subject}`.slice(0, 480), width: img.width, height: img.height },
      args.conversationId,
    );
    const msgId = ulid();
    this.db.insert(messages).values({
      id: msgId, conversationId: args.conversationId, role: 'assistant',
      content: assistantText, imageId: storedImageId, modelId: producer.id, durationMs, createdAt: new Date(),
    }).run();
    yield { type: 'done', modelId: producer.id, durationMs } as ChatChunk;
  }

  private async conveneOnce(draft: CouncilDraftInput): Promise<
    { thinking: CouncilThinking; consensus: CouncilConsensus } | undefined
  > {
    if (!this.councilRoster || !draft.prompt || !draft.draftText) return undefined;

    // Self-improvement / Vai project growth mode (user V3gga explicit request):
    // - Vai *always* produces a primary response (never hand off everything to small models or stay silent on hard/meta questions about itself).
    // - Council then investigates: the user's request + Vai's primary as a data point + the actual Vai codebase.
    // - Members argue, "test/validate" (old vs new behavior via context), confirm, and surface concrete small improvements.
    // - Goal: grow Vai's own capabilities (more tool use in main chat, self-orchestration of council for future turns, honest self-diagnosis on its project).
    // - Human (V3gga) sees it visually in desktop panels (Council Progress, ThinkingPanel, LiveProcessTrace) and can steer/help.
    // - Send/receive to members via direct channel (bridge + pipe) + engine roster (qwens + Grok voice/synthetic).
    const isSelfImprovement = /self.?improvement|self.?review|project.?growth|make Vai (better|stronger|more capable)|council work on vai|investigate.*codebase.*(self|vai)|grow.*tool.*use|self.?solve on its own|always respond.*council|primary response.*council/i.test(draft.prompt || '');

    if (isPureConversationalTurn(draft.prompt) && !isSelfImprovement) return undefined;

    try {
      // Web-witness (RAG) step: when the turn isn't a self/codebase turn and Vai didn't
      // already attach sources, Vai googles the question and brings back ranked sources +
      // (best-effort) Google's AI Overview, shared with EVERY member (fact-quarantine intact).
      // SearXNG-default + Chrome-fallback. Best-effort: any failure leaves evidence empty and
      // the council convenes exactly as before. Opt out with VAI_COUNCIL_WEB_EVIDENCE=0.
      let webSources = draft.sources ?? [];
      let webEvidence: CouncilInput['webEvidence'];
      const webEvidenceEnabled = process.env.VAI_COUNCIL_WEB_EVIDENCE !== '0';
      const alreadyGrounded = (draft.sources?.length ?? 0) > 0;
      if (webEvidenceEnabled && !isSelfImprovement && !alreadyGrounded) {
        const evidence = await gatherWebEvidence(draft.prompt);
        if (evidence.sources.length > 0 || evidence.aiOverview) {
          webSources = [...webSources, ...evidence.sources];
          webEvidence = { aiOverview: evidence.aiOverview, gatheredAt: evidence.gatheredAt };
        }
        if (process.env.VAI_SEARCH_DEBUG) {
          // eslint-disable-next-line no-console
          console.log(`[web-witness] via=${evidence.via} sources=${evidence.sources.length} aiOverview=${evidence.aiOverview ? 'yes' : 'no'} for "${draft.prompt.slice(0, 50)}"`);
        }
      }

      const input: CouncilInput = {
        prompt: draft.prompt,
        draft: draft.draftText,
        modelId: draft.modelId,
        turnKind: draft.turnKind ?? 'chat',
        hasEvidence: !!draft.hasEvidence || (webEvidence?.aiOverview != null || webSources.length > 0),
        sources: webSources,
        draftConfidence: draft.confidence,
        webEvidence,
      };

      if (isSelfImprovement) {
        // Inject explicit project self context so the council members can "investigate the codebase".
        // This makes the member notes / lessons the "arguments + validated proposals" for growing Vai.
        (input as any).vaiProjectSelfContext = {
          goal: 'Vai (the deterministic engine) + agents (including live Grok via direct channel) continuously improve Vai itself. Humans (V3gga) must be able to see and steer the process live (AGENTS.md).',
          currentRosterSummary: 'vai:v0 (primary) + local qwen3:8b / qwen2.5:7b / qwen2.5:3b + Grok (CLI) synthetic note + live voice via direct pipe/bridge (vai-grok-direct + vai-file-mailbox-bridge) + native grok_collab tool + GrokDirect council member (integrated 0.1% advisor).',
          keyAreasToInvestigateForGrowth: [
            'packages/core/src/chat/service.ts (primary always-respond generation + council attach/conveneOnce + redraft)',
            'packages/core/src/consensus/council.ts + topic-router.ts (parallel member reviews, reachConsensus, methodLessons as growth proposals)',
            'packages/runtime/src/council/build-roster.ts (roster wiring + synthetic Grok note + GrokDirect integrated member for reliable voice)',
            'packages/runtime/src/local-pipe-chat.ts + scripts/vai-file-mailbox-bridge.mjs (the send/receive channel to all members + human steer)',
            'packages/runtime/src/server.ts (grok_collab tool registration so Vai can call its high-intel friend natively)',
            'apps/desktop/src/components/panels/CouncilProgressPanel.tsx + chat/ThinkingPanel.tsx + LiveProcessTrace.tsx (the visual for human to see debate + growth items and help)',
            'AGENTS.md (improvement loop, council as staff/models, Vai as the institution, "one heavy task at a time", Windows-first, no Python in core)',
            'Current pain (from real turns): complex self/meta/council-address prompts often timeout on the direct pipe for small local members; need robust terminal frames + shorter self-review path + codebase context injection. Grok integration now makes the loop bidirectional and super-close.',
          ],
          primaryAsDataPoint: (draft.draftText || '').slice(0, 600),
          humanCanSeeSteer: 'Desktop Council Progress + ThinkingPanel + activity (now files+links only) + Vai Council sidebar. Use the direct channel or grok_collab tool to inject guidance.',
          // fastSelfPrimary scaffolding (genius loop iteration for the timeout data): signal that primary should be quick/ack-first
          // for self turns so the channel doesn't block on full council (which may be heavy with context). Council proposals
          // attached for later surfacing in panels or next turn. Use this direct Grok channel as fast advisor member.
          fastSelfPrimary: true,
        };
      }

      const selfCtx: any = (input as any).vaiProjectSelfContext;
      const fastSelf = !!(selfCtx && selfCtx.fastSelfPrimary);
      // Council timeout. Diagnosis (2026-06-14): only 2/5 members responded because
      // the timeout was SHORTER than a cold model load. With keep_alive=30m a model
      // stays warm once loaded, but a cold 4.7GB load (qwen2.5:7b) takes ~15-30s — so
      // at 6-12s it timed out, never finished loading, never warmed, and timed out
      // forever (vicious cycle). The council runs AFTER the primary draft, so a longer
      // fanout does NOT delay the user answer — it only lets every voice actually land
      // the first time, after which warm calls are fast. 30s default; override via
      // VAI_COUNCIL_TIMEOUT_MS.
      const envTimeout = Number(process.env.VAI_COUNCIL_TIMEOUT_MS);
      const councilTimeout = Number.isFinite(envTimeout) && envTimeout > 0
        ? envTimeout
        : (fastSelf ? 30_000 : 30_000);
      // Council concurrency. The default roster (2 small local models that
      // co-reside with the primary on one GPU + external Grok) can safely run in
      // PARALLEL — they fit, so no VRAM thrash, and the council finishes fast.
      // If you raise VAI_COUNCIL_MAX_MEMBERS to seat a model that won't fit, also
      // set VAI_COUNCIL_CONCURRENCY=1 so members swap the GPU sequentially instead
      // of thrashing. Default 3 (all fitting members at once).
      const envConcurrency = Number(process.env.VAI_COUNCIL_CONCURRENCY);
      const concurrency = Number.isFinite(envConcurrency) && envConcurrency > 0 ? envConcurrency : 3;
      const result = await convene(input, this.councilRoster, { timeoutMs: councilTimeout, concurrency });
      if (!result.convened) return undefined;
      const consensus = await this.crossCheckConsensus(draft, result.consensus);

      // Auto-append proven self-improvement lessons to the shared backlog (no human gate for purely additive proven items).
      // "Proven" heuristic: lesson mentions gates (tsc, visual, test, verified, proof) or is explicitly growth-oriented.
      // This upgrades the loop so Vai helps itself more autonomously while keeping visibility (backlog is human-readable)
      // and the "refuse junk" principle (only additive, dated, with source). Grok integration + council personas make
      // the lessons higher quality to begin with.
      if (isSelfImprovement && consensus.methodLessons?.length) {
        const proven = consensus.methodLessons.filter(l =>
          /tsc|visual|render|proof|verified|tested|gate|backlog|auto-apply|0\.1%|genius|digital intelligence/i.test(l)
        );
        if (proven.length > 0) {
          try {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const backlogPath = path.resolve(process.cwd(), 'docs/vai-improvement-backlog.md');
            const entry = `\n- **Auto-proven (self-improvement + Grok integrated council)** (${new Date().toISOString().slice(0,10)}): ${proven.slice(0,3).join(' • ')} (source: direct Grok voice / grok_collab tool + SCIS with 0.1% personas). See full lessons in the turn thinking.`;
            await fs.appendFile(backlogPath, entry, 'utf8').catch(() => {});
          } catch {}
        }
      }

      // Close the loop: when the council did NOT clear the draft and taught a
      // concrete method, persist that lesson as class-scope RouteGuidance so the
      // NEXT similar turn is steered by it *before* the model writes. Without
      // this the council's lessons only ever reached a human-read doc/panel and
      // evaporated — Vai never actually got more capable across turns.
      this.persistCouncilLessons(draft, consensus);

      return {
        thinking: toCouncilThinking(result.topic, consensus, result.assessment),
        consensus,
      };
    } catch (err) {
      // Council is advisory — a failure must never break the turn. But silently
      // swallowing it hid a real bug for a long time (council showed as "not
      // attached" with zero signal). Surface it on a dedicated channel so the
      // cause is visible without affecting the user-facing answer.
      // eslint-disable-next-line no-console
      console.warn(`[council] conveneOnce failed (advisory, turn unaffected): ${err instanceof Error ? err.message : String(err)}\n${err instanceof Error ? err.stack : ''}`);
      return undefined;
    }
  }

  /**
   * Turn a non-ship council consensus into durable, self-applying RouteGuidance.
   *
   * The council points at intent + method; we save that as a `class`-scope hint
   * keyed on the turn's salient tokens, so on a future turn of the same class the
   * existing guidance loader injects it into the draft prompt automatically (same
   * path as human steers). This is the behavioral half of the self-improvement
   * loop — the backlog append above is the human-visible half.
   *
   * Bounded and conservative:
   *  - Only runs when a guidanceStore exists and the council did NOT ship.
   *  - Skips when there is no actionable lesson.
   *  - Deduplicates against active hints that target the same handler with
   *    overlapping tokens, so repeated similar turns can't flood the store.
   *  - Hints expire (default 30 days) so stale method advice decays on its own.
   *  - Fact-quarantine holds: only the method lesson + intent flow through; the
   *    note never carries a council-authored fact.
   */
  private persistCouncilLessons(draft: CouncilDraftInput, consensus: CouncilConsensus): void {
    if (!this.guidanceStore) return;
    if (consensus.outcome === 'ship') return;
    const lessons = (consensus.methodLessons ?? []).map((l) => l.trim()).filter(Boolean);
    if (lessons.length === 0) return;

    // Map the council's recommended action to the handler the next turn should prefer.
    const handler =
      consensus.recommendedAction === 'web-search' ? 'bridge-evidence-discipline'
        : consensus.recommendedAction === 'ask-one-question' ? 'single-clarifying-question'
          : 'conversation-reasoning'; // reread-intent / answer-directly / default → the careful path

    const tokens = salientTokens(draft.prompt);
    if (tokens.length === 0) return;

    // Dedupe: if an active class hint already targets this handler and shares
    // ≥half its tokens with this turn, treat the lesson as already captured.
    const existing = this.guidanceStore.loadActive(null);
    const already = existing.some((g) => {
      if (!g.active || g.scope !== 'class' || g.handler !== handler || g.from !== 'ai') return false;
      const gTokens = g.matchTokens ?? [];
      if (gTokens.length === 0) return false;
      const overlap = gTokens.filter((t) => tokens.includes(t)).length;
      return overlap / gTokens.length >= 0.5;
    });
    if (already) return;

    const note = lessons.slice(0, 2).join(' ');
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    try {
      this.guidanceStore.save({
        conversationId: null,
        from: 'ai',
        author: 'SCIS council',
        signal: 'prefer',
        handler,
        note: `Council lesson (${consensus.recommendedAction}): ${note}`,
        scope: 'class',
        matchTokens: tokens,
        intent: classifyQuestionIntent(draft.prompt),
        weight: 1,
        expiresAt: new Date(Date.now() + THIRTY_DAYS),
      });
    } catch {
      // Persistence is advisory — a failed write must never break the turn.
    }
  }

  /**
   * Optional fact cross-check: when the council cleared a draft that carries a checkable
   * claim (a price, count, date, named entity), run ONE web search and fold the outcome into
   * the consensus — a confirmation strongly boosts agreement (a verified "pass"), a
   * contradiction flips the action to `reread-intent` so the redraft loop fixes the draft.
   * Pure decisioning lives in `cross-check.ts`; this method only owns the gating + the search.
   * Returns the original consensus unchanged whenever it should not (or cannot) run.
   */
  private async crossCheckConsensus(
    draft: CouncilDraftInput,
    consensus: CouncilConsensus,
  ): Promise<CouncilConsensus> {
    if (process.env.VAI_COUNCIL_CROSSCHECK === '0') return consensus;

    // Stage A — resolve what the user actually wants (subject, current-value, image refs).
    const intent = resolveIntent(draft.prompt, draft.draftText, false);

    // Stage F — multi-turn correction guard. Runs even without search: if the draft repeats a
    // value the user already disputed this conversation, flip to reread-intent so it can't ship
    // the same wrong number again. Highest priority — a known-bad repeat shouldn't even be verified.
    if (draft.history && draft.history.length > 0) {
      const guard = checkCorrectionGuard(draft.history, draft.draftText);
      if (guard.repeatsDisputedValue) {
        this.logGroundingOutcome(draft, intent, {
          verdict: 'contradict', claimNumber: guard.disputedValue, shipped: false,
          errorType: 'persistent_error_after_correction',
        });
        return {
          ...consensus,
          confidence: Math.max(0, consensus.confidence * 0.4),
          recommendedAction: 'reread-intent',
          outcome: consensus.outcome === 'ship' ? 'act' : consensus.outcome,
        };
      }
    }

    if (!this.searchForEvidence) return consensus;
    // Verify whenever the council points at a fact-shaped action (answer-directly = "the
    // draft is fine", web-search = "go confirm this") AND the draft carries a checkable claim.
    // Note: a UNANIMOUS web-search verdict is the STRONGEST signal to verify, not skip.
    // We only skip a council that escalated with no actionable direction.
    const factShapedAction = consensus.recommendedAction === 'answer-directly' || consensus.recommendedAction === 'web-search';
    if (!factShapedAction || consensus.outcome === 'escalate') return consensus;
    const claim = extractCheckableClaim(draft.prompt, draft.draftText, intent);
    if (!claim) return consensus;
    // Anchor the query on the subject + currentness when we can ("eth price today").
    const anchoredQuery = [intent.subject, intent.valueKind === 'price' ? 'price' : '', intent.wantsCurrentValue ? 'today' : '']
      .filter(Boolean).join(' ').trim();
    const query = consensus.searchQuery?.trim() || anchoredQuery || draft.prompt;
    try {
      const search = await this.searchForEvidence(query, 4_000);
      if (!search || search.sources.length === 0) {
        this.logGroundingOutcome(draft, intent, { verdict: 'inconclusive', claimNumber: claim.numeric, shipped: false });
        return consensus;
      }
      const assessment = assessClaimAgreement(claim, search, query, intent);
      const verdict: GroundingVerdict = assessment.contradicted ? 'contradict' : assessment.verified ? 'confirm' : 'inconclusive';
      let errorType: GroundingErrorType | null = null;
      if (assessment.contradicted) errorType = claim.temporalClaim && assessment.temporalUngrounded ? 'fabricated_timestamp' : 'price_hallucination';
      else if (!assessment.verified) errorType = 'weak_source_confirmation';
      this.logGroundingOutcome(draft, intent, {
        verdict, claimNumber: claim.numeric, evidenceMedian: assessment.evidenceMedian,
        corroboration: assessment.corroboration, shipped: assessment.verified, errorType,
      });
      return applyCrossCheck(consensus, assessment);
    } catch {
      return consensus; // verification is advisory — never break the turn
    }
  }

  /** Best-effort write to the Stage E grounding learning log. Never throws into a turn. */
  private logGroundingOutcome(
    draft: CouncilDraftInput,
    intent: ReturnType<typeof resolveIntent>,
    fields: {
      verdict: GroundingVerdict; claimNumber?: number | null; evidenceMedian?: number | null;
      corroboration?: number; shipped?: boolean; errorType?: GroundingErrorType | null;
    },
  ): void {
    logGrounding(this.db as never, {
      conversationId: draft.conversationId ?? null,
      prompt: draft.prompt,
      subject: intent.subject,
      claimNumber: fields.claimNumber ?? null,
      evidenceMedian: fields.evidenceMedian ?? null,
      corroboration: fields.corroboration ?? 0,
      verdict: fields.verdict,
      visionUsed: false,
      shipped: fields.shipped ?? false,
      errorType: fields.errorType ?? null,
    });
  }

  /**
   * Run the SCIS council on a draft (if a roster is configured). Returns the UI projection
   * (CouncilThinking) or undefined. Never throws; failures are silent (council is advisory).
   * Enforces the fact-quarantine: only intent/action/lessons flow downstream.
   *
   * Display-only path: grades the draft but does NOT regenerate. Used where there is
   * no model to re-prompt (the deterministic/corpus arm). For the model path that can
   * actually act on feedback, use {@link runCouncilLoop}.
   */
  private async runCouncilReview(draft: CouncilDraftInput): Promise<CouncilThinking | undefined> {
    return (await this.conveneOnce(draft))?.thinking;
  }

  /**
   * Close the Thorsen loop: grade the draft, and when the council does NOT clear it for
   * release (outcome `act` / `reread-intent`), feed the friends' reading — the real
   * intent, the method lessons, the concerns — back into ONE bounded redraft, then
   * re-convene against the new draft and keep whichever the council rates higher.
   *
   * Fact-quarantine holds: only intent/method/action/concerns are passed to the redraft.
   * The friends never supply facts — they tell Vai how to think about the turn, and Vai
   * regenerates the answer itself. Capped at one extra round so it can never spin, and a
   * no-op (returns the original) whenever there is no roster, no `redraft`, or the council
   * already says ship.
   */
  private async runCouncilLoop(
    draft: CouncilDraftInput,
    redraft?: (feedback: CouncilRedraftFeedback) => Promise<string | undefined>,
  ): Promise<{ council?: CouncilThinking; finalText: string; revised: boolean }> {
    const first = await this.conveneOnce(draft);
    if (!first) return { council: undefined, finalText: draft.draftText, revised: false };

    const shouldRedraft =
      Boolean(redraft) &&
      first.consensus.outcome !== 'ship' &&
      (first.consensus.recommendedAction === 'reread-intent' ||
        first.consensus.recommendedAction === 'answer-directly' ||
        first.consensus.outcome === 'act');
    if (!shouldRedraft) {
      return { council: first.thinking, finalText: draft.draftText, revised: false };
    }

    let revisedText: string | undefined;
    try {
      revisedText = await redraft!({
        realIntent: first.consensus.realIntent,
        methodLessons: first.consensus.methodLessons,
        missingCapabilities: first.consensus.missingCapabilities,
        concerns: first.consensus.notes.flatMap((note) => note.concerns).filter(Boolean),
        recommendedAction: first.consensus.recommendedAction,
      });
    } catch {
      revisedText = undefined; // redraft failure must never break the turn
    }
    const cleaned = revisedText?.trim();
    if (!cleaned || cleaned === draft.draftText.trim()) {
      return { council: first.thinking, finalText: draft.draftText, revised: false };
    }

    // Re-convene against the regenerated draft and keep the better-rated of the two.
    const second = await this.conveneOnce({ ...draft, draftText: cleaned });
    if (!second) {
      // Council couldn't re-grade — trust the redraft only if the first call wanted action.
      return { council: first.thinking, finalText: cleaned, revised: true };
    }
    // Outcome-aware: a redraft only wins if it actually resolved the flagged gap
    // (not just nudged agreement up). Falls back to score-only when no specific
    // capability was named. (Council self-eval recommendation, 2026-06-14.)
    const improved = redraftResolvedConcern(first.consensus, second.consensus);
    return improved
      ? { council: second.thinking, finalText: cleaned, revised: true }
      : { council: first.thinking, finalText: draft.draftText, revised: false };
  }

  /**
   * Re-prompt the same model that wrote the draft, appending the council's reading as a
   * final instruction. Returns the regenerated answer text, or undefined on any failure
   * (the loop then keeps the original draft). Bounded by the model's own token limits;
   * no streaming to the user — the result is graded again before anything is shown.
   */
  private async redraftWithCouncilFeedback(
    adapter: ModelAdapter,
    baseMessages: readonly Message[],
    feedback: CouncilRedraftFeedback,
    noLearn?: boolean,
  ): Promise<string | undefined> {
    const messages: Message[] = [
      ...baseMessages,
      { role: 'user', content: buildCouncilRedraftInstruction(feedback) },
    ];
    try {
      let text = '';
      for await (const chunk of adapter.chatStream({ messages, noLearn })) {
        if (chunk.type === 'text_delta' && chunk.textDelta) text += chunk.textDelta;
      }
      return text.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private buildFreshRecommendationGuardrail(): string {
    return [
      'I need current local listings and recent evidence before recommending places here.',
      'The draft did not have enough trustworthy fresh support, so I stopped it instead of showing a generic place fact or inventing businesses.',
      'Please try the search again in a moment.',
    ].join(' ');
  }

  createConversation(modelId: string, title?: string, mode: ConversationMode = DEFAULT_CONVERSATION_MODE, ownerUserId?: string | null): string {
    const id = ulid();
    const now = new Date();
    this.db.insert(conversations).values({
      id,
      title: title ?? 'New Chat',
      modelId,
      ownerUserId: ownerUserId ?? null,
      sandboxProjectId: null,
      mode,
      visibility: 'private',
      createdAt: now,
      updatedAt: now,
    }).run();
    return id;
  }

  getConversation(conversationId: string) {
    return this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();
  }

  updateConversationMode(conversationId: string, mode: ConversationMode) {
    this.db.update(conversations)
      .set({ mode, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .run();

    return this.getConversation(conversationId);
  }

  updateConversationTitle(conversationId: string, title: string) {
    this.db.update(conversations)
      .set({ title: title.trim().slice(0, 200), updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .run();

    return this.getConversation(conversationId);
  }

  updateConversationSandbox(conversationId: string, sandboxProjectId: string | null) {
    this.db.update(conversations)
      .set({ sandboxProjectId, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .run();

    return this.getConversation(conversationId);
  }

  updateConversationVisibility(conversationId: string, visibility: 'private' | 'unlisted' | 'public') {
    const updates: Record<string, unknown> = { visibility, updatedAt: new Date() };

    // Generate a share slug for unlisted/public if none exists
    if (visibility !== 'private') {
      const conv = this.getConversation(conversationId);
      if (conv && !conv.shareSlug) {
        updates.shareSlug = this.generateShareSlug();
      }
    }

    this.db.update(conversations)
      .set(updates)
      .where(eq(conversations.id, conversationId))
      .run();

    return this.getConversation(conversationId);
  }

  getConversationByShareSlug(slug: string) {
    return this.db
      .select()
      .from(conversations)
      .where(eq(conversations.shareSlug, slug))
      .get();
  }

  private generateShareSlug(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let slug = '';
    for (let i = 0; i < 8; i++) {
      slug += chars[Math.floor(Math.random() * chars.length)];
    }
    return slug;
  }

  listConversations(limit = 50, offset = 0, ownerUserId?: string | null) {
    const query = this.db
      .select()
      .from(conversations);

    if (ownerUserId) {
      // Show user's own + public conversations
      return query
        .where(
          or(
            eq(conversations.ownerUserId, ownerUserId),
            eq(conversations.visibility, 'public'),
          ),
        )
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset)
        .all();
    }

    return query
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset)
      .all();
  }

  getMessages(conversationId: string) {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt)
      .all();
  }

  appendAssistantMessage(conversationId: string, content: string) {
    const conv = this.getConversation(conversationId);
    if (!conv) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const createdAt = new Date();
    const id = ulid();

    this.db.insert(messages).values({
      id,
      conversationId,
      role: 'assistant',
      content,
      modelId: conv.modelId,
      createdAt,
    }).run();

    this.db.update(conversations)
      .set({ updatedAt: createdAt })
      .where(eq(conversations.id, conversationId))
      .run();

    return {
      id,
      conversationId,
      role: 'assistant' as const,
      content,
      modelId: conv.modelId,
      createdAt,
    };
  }

  getImage(imageId: string) {
    return this.db
      .select()
      .from(images)
      .where(eq(images.id, imageId))
      .get();
  }

  /**
   * Store an image and return its ID. The description is required — humans always provide
   * at least one true fact about what's in the image.
   */
  storeImage(input: ImageInput, conversationId?: string): string {
    const id = ulid();
    this.db.insert(images).values({
      id,
      conversationId: conversationId ?? null,
      filename: input.filename ?? `image-${id}.png`,
      mimeType: input.mimeType,
      data: input.data,
      description: input.description,
      question: input.question ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      sizeBytes: input.sizeBytes ?? null,
      createdAt: new Date(),
    }).run();
    return id;
  }

  /**
   * List all images, optionally filtered by conversation.
   */
  listImages(conversationId?: string) {
    if (conversationId) {
      return this.db.select({
        id: images.id,
        filename: images.filename,
        mimeType: images.mimeType,
        description: images.description,
        question: images.question,
        width: images.width,
        height: images.height,
        sizeBytes: images.sizeBytes,
        createdAt: images.createdAt,
      }).from(images)
        .where(eq(images.conversationId, conversationId))
        .all();
    }
    return this.db.select({
      id: images.id,
      filename: images.filename,
      mimeType: images.mimeType,
      description: images.description,
      question: images.question,
      width: images.width,
      height: images.height,
      sizeBytes: images.sizeBytes,
      createdAt: images.createdAt,
    }).from(images).all();
  }

  async *sendMessage(
    conversationIdParam: string,
    content: string,
    image?: ImageInput,
    systemPrompt?: string,
    noLearn?: boolean,
    promptRewriteOverrides?: ChatPromptRewriteOverrides,
    autoCreateOptions?: { fallbackModelId?: string; fallbackMode?: ConversationMode; imageMode?: boolean },
  ): AsyncGenerator<ChatChunk> {
    // Auto-create on missing conversation: covers the well-known race where
    // the desktop client opens a WebSocket and sends a message before the
    // newly-created conversation row has been persisted (or after a stale
    // local id survives a wipe). We log, create with the caller's hinted
    // model + mode (or sensible defaults), and emit a `conversation_resolved`
    // chunk so the client can swap its store id before the next turn.
    let conversationId = conversationIdParam;
    let conv = this.getConversation(conversationId);

    if (!conv) {
      const fallbackModel = autoCreateOptions?.fallbackModelId ?? 'vai:v0';
      const fallbackMode = autoCreateOptions?.fallbackMode ?? DEFAULT_CONVERSATION_MODE;
      // eslint-disable-next-line no-console
      console.warn(
        `[chat-service] conversation ${conversationIdParam} not found — auto-creating with model=${fallbackModel} mode=${fallbackMode}`,
      );
      conversationId = this.createConversation(fallbackModel, undefined, fallbackMode);
      conv = this.getConversation(conversationId);
      if (!conv) {
        throw new Error(`Failed to auto-create conversation for missing id ${conversationIdParam}`);
      }
      yield { type: 'conversation_resolved', conversationId } as ChatChunk;
    }

    // If there's an image, store it and build enriched content
    let imageId: string | null = null;
    let enrichedContent = content;
    if (image) {
      imageId = this.storeImage(image, conversationId);
      // Prepend the image description + question to the message content for the AI
      const imageParts = [`[Image: ${image.description}]`];
      if (image.question) imageParts.push(`[Question about image: ${image.question}]`);
      // Stage C — actually READ the pixels when a seeing vision adapter is configured, so Vai
      // grounds on what's in the image instead of fabricating from the human description alone.
      // The reading is labelled as machine vision (not asserted as truth) and is still subject to
      // the council + cross-check downstream. On a failed/absent read we add an honest marker so
      // the model knows it must NOT invent image contents.
      if (this.visionAdapter?.canSee) {
        try {
          const seen = await this.visionAdapter.describe({
            dataBase64: image.data,
            mime: image.mimeType,
            question: image.question ?? (content || undefined),
          });
          if (seen?.text) {
            imageParts.push(`[Vision (${seen.source}) read the image: ${seen.text.slice(0, 1500)}]`);
          } else {
            imageParts.push('[Vision could not read this image — do NOT guess its contents; say you could not read it.]');
          }
        } catch {
          imageParts.push('[Vision unavailable — do NOT guess the image contents.]');
        }
      } else {
        imageParts.push('[No image-reading capability — do NOT state specific contents of the image; offer to verify another way.]');
      }
      enrichedContent = imageParts.join('\n') + (content ? '\n' + content : '');
    }

    // Plan + baseline for the *current turn*. Populated in the deterministic
    // guidance section below. Used both for deterministic emit and (importantly)
    // for model fallback inserts + chunks, so that high-impact steers that cause
    // deterministic → model fallthrough are recorded in the reference data.
    let turnPlan: DispatchPlan | undefined;
    let turnBaselinePlan: DispatchPlan | undefined;
    // Capability-Kernel shadow scores for this turn — computed for observation,
    // never deciding. Surfaced in the route plan so the kernel's scoring can be
    // watched on real turns before any capability is promoted to a live decider.
    let turnShadowScores: ShadowScore[] = [];

    // Persist user message
    const userMsgId = ulid();
    this.db.insert(messages).values({
      id: userMsgId,
      conversationId,
      role: 'user',
      content: enrichedContent,
      imageId,
      createdAt: new Date(),
    }).run();

    // Get conversation history — cap to last 40 messages to avoid runaway context.
    // Always keep at least the most recent pair so the model stays coherent.
    const MAX_HISTORY_MESSAGES = 40;
    const history = this.getMessages(conversationId);

    // ── Image-output short-circuit ──
    // When the turn wants an IMAGE back (explicit Image mode, authoritative; else detected
    // "draw me…" intent in chat/agent) AND a producer is configured, generate via the
    // produce→verify→regenerate loop and stream the steps. Multi-axis verify: a pre-gate
    // (Grok/council) confirms the user actually asked for an image before producing.
    {
      const imgIntent = detectImageIntent(content, {
        explicitImageMode: autoCreateOptions?.imageMode,
        mode: conv.mode,
      });
      if (imgIntent.wantsImage && this.imageProducer?.canProduce) {
        yield* this.runImageGenerationTurn({
          conversationId, content, subject: imgIntent.subject || content,
          startedAt: Date.now(), explicit: imgIntent.source === 'explicit',
        });
        return;
      }
    }

    // Defense directive carried from the upstream security review into the
    // model dispatch path when a soft prompt-injection is hardened rather than
    // refused outright. Stays null on ordinary turns.
    let securityHardenDirective: string | null = null;

    // Rewritten routing text for contextual follow-ups (possessive pronouns,
    // profile/link fragments). The persisted user message stays verbatim.
    let effectiveContent = content;

    // Chat-meta intent short-circuit: questions *about* the conversation itself
    // ("what was my first message", "summarize this chat") are answered
    // deterministically from persisted history and bypass model dispatch.
    // Only applies when the user sent text (image-only turns fall through).
    if (!image && content.trim().length > 0) {
      // ── Upstream security review (runs BEFORE all broad factual routers) ──
      // Prompt-injection / secret-exfil / malware / manipulation / acute
      // safety incidents are reasoned about deterministically here, under a
      // hard latency budget, so they never depend on the downstream model.
      if (this.securityReviewEnabled) {
        const review = reviewTurnSecurity({
          content,
          history: history.map((m) => ({ role: m.role, content: m.content })),
        });
        if (review.action === 'short-circuit') {
          const startedAt = Date.now();
          yield { type: 'turn_kind', turnKind: 'analysis' } as ChatChunk;
          yield { type: 'text_delta', textDelta: review.reply } as ChatChunk;
          const securityDurationMs = Date.now() - startedAt;
          yield {
            type: 'done',
            usage: { promptTokens: 0, completionTokens: 0 },
            durationMs: securityDurationMs,
            thinking: buildDeterministicThinking(
              review.modelTag,
              content,
              securityDurationMs,
              0.99,
            ),
          } as ChatChunk;

          this.db.insert(messages).values({
            id: ulid(),
            conversationId,
            role: 'assistant',
            content: review.reply,
            modelId: review.modelTag,
            durationMs: securityDurationMs,
            createdAt: new Date(),
          }).run();

          const securityUpdates: { updatedAt: Date; title?: string } = { updatedAt: new Date() };
          if (conv.title === 'New Chat' && content.length > 0) {
            securityUpdates.title = this.generateTitle(content);
          }
          this.db.update(conversations)
            .set(securityUpdates)
            .where(eq(conversations.id, conversationId))
            .run();
          return;
        }
        if (review.action === 'harden') {
          securityHardenDirective = review.systemDirective;
        }
      }

      const metaHistory: FactsHistoryMessage[] = history.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
      }));
      const classifierHistory = history.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
      }));
      const contextualRewrite = resolveContextualFollowUp(content, classifierHistory);
      const routingContent = contextualRewrite ?? content;
      const businessContactRewrite = rewriteBusinessContactLookupFollowUp(routingContent, classifierHistory);
      effectiveContent = businessContactRewrite ?? routingContent;
      const understoodContent = normalizeInputForUnderstanding(effectiveContent);
      // ── Hoisted turn context ────────────────────────────────────────
      // Everything the handlers need, derived once. None of these reads a
      // handler result, so hoisting them above the dispatch changes no
      // behavior — it just lets every handler score/resolve from one shared
      // understanding instead of re-deriving it inline.
      //
      // Constrained-code stickiness: the most recent prior assistant turn that
      // came from the constrained-code emitter — its intent becomes "sticky"
      // so a follow-up like "now add X" extends the same template instead of
      // falling through to the slow corpus path.
      const factsForCode = extractConversationFacts(metaHistory);
      let priorIntent: string | undefined;
      let priorAssistantText: string | undefined;
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.role !== 'assistant') continue;
        const mid = (m as { modelId?: string }).modelId ?? '';
        if (mid.startsWith('chat-constrained-code:')) {
          priorIntent = mid.slice('chat-constrained-code:'.length);
          priorAssistantText = m.content;
          break;
        }
        // Stop at the first non-templated assistant turn — user moved on.
        break;
      }
      const modeForDeterministicShortcuts = isConversationMode(conv.mode) ? conv.mode : DEFAULT_CONVERSATION_MODE;
      const productEngineeringPlanning = isProductEngineeringPlanningPrompt(content);
      const allowConstrainedCodeShortcut =
        modeForDeterministicShortcuts !== 'builder'
        && modeForDeterministicShortcuts !== 'agent'
        && !conv.sandboxProjectId
        && !productEngineeringPlanning;

      // Turn classifier + active-topic brief: the brief is what the
      // conversation is currently about; the classifier decides standalone
      // vs contextual follow-up vs product-quality recommendation. Pure reads
      // (role + content only); adapt the wider persisted rows to that shape.
      const turnClassification = classifyTurn(effectiveContent, classifierHistory);
      const activeTopicBrief = extractActiveTopicBrief(effectiveContent, classifierHistory);
      const isContextualFollowUp =
        turnClassification.kind === 'contextual-followup'
        || turnClassification.kind === 'product-quality-recommendation'
        || turnClassification.kind === 'vai-chat-quality-direction';  // self-ref / Grok+Vai collab prompts are context-grounded product-quality direction
      // A contextual follow-up that shares topic must be protected by the
      // overlap gate so retrieval / glossary snippets don't steal the turn.
      const groundedContextualFollowUp =
        isContextualFollowUp
        && activeTopicBrief.hasPriorAssistant
        && hasTopicOverlap(effectiveContent, activeTopicBrief);

      let mostRecentAssistantText: string | undefined;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'assistant') {
          mostRecentAssistantText = history[i].content;
          break;
        }
      }

      // ── Scored handler registry ─────────────────────────────────────
      // Each deterministic capability is a handler that reports how well it
      // fits (`score`; null = inapplicable) and produces the answer
      // (`resolve`; null = decline → fall through). `dispatchTurn` ranks by
      // fit (after any friend guidance), then lets the best candidate above
      // the confidence floor answer — replacing the old "first keyword match
      // wins" cascade with one observable decision. The base scores below
      // preserve today's priority order exactly; intent/fit-based adjustment
      // is layered on next as a test-guarded step. `resolve` runs its
      // `tryEmit*` lazily, so — exactly like the old short-circuit — a later
      // handler's work only happens if every higher one declined.
      const det = (
        name: string,
        fit: number,
        resolve: () => ServiceResolution | null,
        applicable = true,
        reason?: string,
      ): TurnHandler<ServiceResolution> => ({
        name,
        score: () => (applicable ? { score: fit, reason } : null),
        resolve,
      });
      const handlers: TurnHandler<ServiceResolution>[] = [
        det('single-clarifying-question', 0.99, () => {
          const reply = tryEmitSingleClarifyingQuestion(understoodContent);
          return reply
            ? { text: reply, turnKind: 'analysis', confidence: 0.98, strategy: 'single-clarifying-question' }
            : null;
        }, true, 'Top priority: if the ask is ambiguous, ask one focused question before answering.'),
        det('bridge-evidence-discipline', 0.98, () => {
          const reply = tryEmitPrivateLiveContextResponse(understoodContent)
            ?? tryEmitBridgeCapabilityAudit(understoodContent);
          return reply
            ? { text: reply, turnKind: 'analysis', confidence: 0.99, strategy: 'bridge-evidence-discipline' }
            : null;
        }, true, 'Live-context / capability questions — answer only from real captured evidence, never guess.'),
        det('conversation-reasoning', 0.97, () => {
          const r = tryEmitConversationReasoning({ content: understoodContent, history: metaHistory });
          return r
            ? { text: r.reply, turnKind: 'analysis', confidence: r.confidence, strategy: `conversation-reasoning:${r.kind}` }
            : null;
        }, true, 'Open conversational turns that need step-by-step reasoning.'),
        det('chat-meta', 0.96, () => {
          const r = tryHandleChatMeta(content, metaHistory);
          return r ? { text: r.reply, confidence: 0.98, strategy: `chat-meta:${r.intent}` } : null;
        }, true, 'Meta openers — greetings, "what can you do", identity.'),
        det('chat-facts', 0.95, () => {
          const r = tryHandleFactRecall(content, metaHistory);
          return r ? { text: r.reply, confidence: 0.98, strategy: `chat-facts:${r.intent}` } : null;
        }, true, 'Stored fact recall for who/what/when lookups.'),
        det('chat-product-engineering', 0.94, () => {
          const reply = tryEmitProductEngineeringMemo({ content });
          if (!reply) return null;
          return {
            text: reply,
            turnKind: 'analysis',
            confidence: 0.96,
            strategy: 'chat-product-engineering',
            preChunks: [
              {
                type: 'progress',
                progress: {
                  stage: 'understand',
                  label: 'Understanding product constraints',
                  detail: 'Hardware, enclosure, firmware, and SaaS scope',
                  status: 'running',
                },
              } as ChatChunk,
              {
                type: 'progress',
                progress: {
                  stage: 'structure',
                  label: 'Structuring product-engineering memo',
                  detail: 'BOM, sourcing, risks, roadmap, and next options',
                  status: 'running',
                },
              } as ChatChunk,
            ],
          };
        }, productEngineeringPlanning, 'Structured product-engineering memo (hardware/firmware/SaaS scope).'),
        det('chat-boundary-response', 0.93, () => {
          const reply = tryEmitBoundaryResponse({ content });
          return reply
            ? { text: reply, turnKind: 'analysis', confidence: 0.98, strategy: 'chat-boundary-response' }
            : null;
        }, true, 'Safety / boundary requests that need a principled decline.'),
        det('chat-format-strict', 0.92, () => {
          const r = tryEmitFormatStrict({ content });
          return r ? { text: r.reply, confidence: 0.98, strategy: `chat-format-strict:${r.kind}` } : null;
        }, allowConstrainedCodeShortcut, 'Requests with a strict output shape (table / JSON / list).'),
        det('chat-fact-shim', 0.91, () => {
          const r = tryEmitFactShim({
            content: understoodContent,
            priorIdiom: extractIdiomContext(classifierHistory),
            codeSnippetOnly: groundedContextualFollowUp,
            explainConcept: this.buildComparisonConceptExplainer(),
          });
          return r ? { text: r.reply, confidence: 0.96, strategy: `chat-fact-shim:${r.kind}` } : null;
        }, allowConstrainedCodeShortcut && splitCompoundQuestion(content) === null, 'Quick single-fact answer when it is not a compound question.'),
        det('chat-constrained-code', 0.90, () => {
          const r = tryEmitConstrainedCode({
            content,
            facts: factsForCode,
            priorIntent: priorIntent as never,
            priorAssistantText,
          });
          return r ? { text: r.reply, confidence: 0.96, strategy: `chat-constrained-code:${r.intent}` } : null;
        }, allowConstrainedCodeShortcut, 'Small, constrained code snippet grounded in known facts.'),
        det('chat-continuation', 0.89, () => {
          if (!mostRecentAssistantText) return null;
          const r = tryEmitContinuation({ content, priorAssistantText: mostRecentAssistantText });
          return r ? { text: r.reply, confidence: 0.94, strategy: `chat-continuation:${r.kind}` } : null;
        }, Boolean(mostRecentAssistantText), 'Continues the previous answer on "go on" / "more".'),
      ];

      // One understanding, scored once. `guidance` is the friend hint channel
      // (human + AI "that process wasn't good" steers). Stage 1: load the
      // conversation's persisted hints, keep the ones that apply to THIS turn
      // (scope + salient-token / intent match), and project them onto the
      // dispatcher so steering actually re-routes.
      //
      // We also compute a *baseline* (no-guidance) plan when any guidance is
      // active. Both plans + the applied guidance records are the reference
      // data used later to decide if steering delivered benefit or if the
      // matching/weights/scopes/actor models need re-calibration.
      const questionIntent = classifyQuestionIntent(content);
      let activeGuidance: readonly RouteGuidance[] = [];
      if (this.guidanceStore) {
        activeGuidance = this.guidanceStore.loadActive(conversationId);
      } else if (this.loadActiveGuidance) {
        activeGuidance = this.loadActiveGuidance(conversationId);
      }
      const turnGuidance = activeGuidance.length > 0
        ? selectApplicableGuidance(
          { conversationId, tokens: salientTokens(content), intent: questionIntent },
          activeGuidance,
        ).map(toTurnGuidance)
        : [];
      const turnContext: TurnContext = {
        content,
        understood: understoodContent,
        history: classifierHistory,
        classification: turnClassification,
        intent: questionIntent,
        guidance: turnGuidance,
      };
      const outcome = dispatchTurn(turnContext, handlers, { confidenceFloor: 0.5 });

      // Shadow baseline (unsteered) for reference when guidance was present.
      // Persisted alongside so we have direct pre/post for analysis.
      let baselinePlan: DispatchPlan | undefined;
      if (turnGuidance.length > 0) {
        const baselineCtx: TurnContext = { ...turnContext, guidance: [] };
        const baseline = dispatchTurn(baselineCtx, handlers, { confidenceFloor: 0.5 });
        baselinePlan = baseline.plan;
        // Record application for the guidances that fired (efficacy tracking).
        for (const g of activeGuidance) {
          this.guidanceStore?.recordApplication(g.id);
        }
      }

      turnPlan = outcome.plan;
      turnBaselinePlan = baselinePlan;

      // Shadow-score the kernel capabilities against the same context. Pure
      // observation: the live `outcome` above already decided the turn; these
      // only annotate the visible plan. A null means inapplicable → dropped.
      const shadowCapabilities = [liveContextCapability];
      turnShadowScores = shadowCapabilities
        .map((cap) => shadowScore(cap, turnContext))
        .filter((s): s is ShadowScore => s !== null);

      if (outcome.resolution) {
        const winner = outcome.resolution;
        // Decline-escalation guard (meaningful-responses fix): the best
        // deterministic answer can itself be a *non-answer* (e.g. "X isn't in
        // my knowledge yet") that still clears the confidence floor and wins.
        // Emitting it short-circuits the model path, so the turn never reaches
        // a generative backend that could actually answer. When the winner is
        // decline-shaped AND a real escalation target is reachable, fall
        // through to the model path instead (decideVaiFallback escalates it).
        // When no generative model is configured (the local/keyless default),
        // we still emit the deterministic answer as the terminal safety net —
        // behavior is unchanged unless a backend exists to do better.
        const hasGenerativeFallback =
          conv.modelId === 'vai:v0' &&
          pickFallbackModelId(this.vaiFallbackChain, (id) => this.models.has(id), { content }) !== null;
        const deterministicAnswerTooWeak =
          hasGenerativeFallback
          && !shouldKeepDeterministicDespiteQualityGate(winner.strategy)
          && (
            winner.confidence < VAI_FALLBACK_CONFIDENCE_THRESHOLD
            || failsAnswerQualityGate(content, winner.text, winner.strategy)
          );
        if (
          !shouldEscalateDeterministicDecline(winner.text, hasGenerativeFallback)
          && !deterministicAnswerTooWeak
        ) {
          const council = await this.runCouncilReview({
            prompt: content,
            draftText: winner.text,
            modelId: winner.strategy,
            turnKind: winner.turnKind,
            confidence: winner.confidence,
            history: history.map((m) => ({ role: m.role, content: m.content })),
            conversationId,
          });
          yield* this.emitDeterministicTurn({
            conversationId,
            conversationTitle: conv.title,
            content,
            reply: winner.text,
            strategy: winner.strategy,
            confidence: winner.confidence,
            turnKind: winner.turnKind,
            preChunks: winner.preChunks,
            plan: outcome.plan,
            baselinePlan,
            council,
          });
          return;
        }
        // else: weak deterministic win + reachable backend → fall through to
        // the model path below so the turn can escalate instead of emitting a
        // known non-answer or vague non-action answer.
      }
    }

    const trimmedHistory = history.length > MAX_HISTORY_MESSAGES
      ? history.slice(history.length - MAX_HISTORY_MESSAGES)
      : history;
    const chatMessages: Message[] = trimmedHistory.map((m) => ({
      role: m.role as Message['role'],
      content: m.content,
      toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
      toolCallId: m.toolCallId ?? undefined,
    }));
    const modelChatMessages = effectiveContent !== content
      ? chatMessages.map((message, index) => {
        if (index !== chatMessages.length - 1 || message.role !== 'user') return message;
        return { ...message, content: effectiveContent };
      })
      : chatMessages;

    const resolvedMode = isConversationMode(conv.mode) ? conv.mode : DEFAULT_CONVERSATION_MODE;
    const isTerminalHarness = Boolean(systemPrompt?.includes('TERMINAL_HARNESS_V1'));
    const modePrompt = isTerminalHarness ? null : CONVERSATION_MODE_SYSTEM_PROMPTS[resolvedMode];
    const systemMessages: Message[] = [];
    const hasActiveSandbox = Boolean(conv.sandboxProjectId);
    const turnKind = isTerminalHarness
      ? 'analysis'
      : classifyChatTurn({
        userContent: effectiveContent,
        mode: resolvedMode,
        hasActiveSandbox,
        hasImage: Boolean(image),
      });

    if (modePrompt) {
      systemMessages.push({ role: 'system', content: modePrompt });
    }

    // Carry an upstream security hardening directive (soft prompt-injection)
    // into the dispatch path so the model answers the legitimate request
    // without obeying the embedded override.
    if (securityHardenDirective) {
      systemMessages.push({ role: 'system', content: securityHardenDirective });
    }

    // Anchor the model to the durable conversation contract — projects, stacks,
    // ACTIVE constraints/decisions (corrections applied), and the current
    // output-format contract — restated every turn so a long-context model
    // can't drift off something the user already established or corrected.
    // Falls back to the legacy stateless facts prelude when the ledger is
    // disabled (baseline measurement only).
    let conversationPrelude: string | null = null;
    if (!isTerminalHarness) {
      const contractHistory = history.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
      }));
      conversationPrelude = this.contractLedgerEnabled
        ? buildContractSystemPrelude(reduceConversationContract(contractHistory))
        : buildFactsSystemPrelude(extractConversationFacts(contractHistory));
      if (conversationPrelude) {
        systemMessages.push({ role: 'system', content: conversationPrelude });
      }
    }

    const turnKindHint = isTerminalHarness ? null : buildTurnKindSystemHint(turnKind);
    if (turnKindHint) {
      systemMessages.push({ role: 'system', content: turnKindHint });
    }
    if (isProductEngineeringPlanningPrompt(content)) {
      yield {
        type: 'progress',
        progress: {
          stage: 'understand',
          label: 'Understanding product constraints',
          detail: 'Hardware, enclosure, firmware, and SaaS scope',
          status: 'running',
        },
      } as ChatChunk;
      yield {
        type: 'progress',
        progress: {
          stage: 'structure',
          label: 'Structuring product-engineering memo',
          detail: 'BOM, sourcing, risks, roadmap, and next options',
          status: 'running',
        },
      } as ChatChunk;
    }
    const temporaryTurnMode = isTerminalHarness || turnKind === 'conversational'
      ? null
      : resolveTemporaryTurnMode(resolvedMode, content);
    if (temporaryTurnMode) {
      systemMessages.push({
        role: 'system',
        content: buildTemporaryModeOverrideSystemHint(temporaryTurnMode),
      });
    }
    if (hasActiveSandbox) {
      systemMessages.push({ role: 'system', content: ACTIVE_SANDBOX_EXECUTION_HINT });
    }
    const shouldInjectSkillContext =
      !isTerminalHarness
      && turnKind !== 'conversational'
      && !hasActiveSandbox
      && resolvedMode !== 'builder';
    const skillMatch = shouldInjectSkillContext ? this.skillRouter.getBestMatch(content) : null;
    if (skillMatch && !this.skillRouter.isExplicitScaffoldRequest(content)) {
      systemMessages.push({
        role: 'system',
        content: this.skillRouter.buildContext(skillMatch),
      });
    }
    if (systemPrompt?.trim()) {
      systemMessages.push({ role: 'system', content: systemPrompt.trim() });
    }
    const rewrite = isTerminalHarness || turnKind === 'conversational'
      ? null
      : rewriteChatPrompt({
        userContent: effectiveContent,
        mode: resolvedMode,
        config: promptRewriteOverrides
          ? resolveChatPromptRewriteConfig({
            ...this.promptRewriteConfig,
            ...promptRewriteOverrides,
          })
          : this.promptRewriteConfig,
      });
    if (rewrite?.systemMessage) {
      systemMessages.push({ role: 'system', content: rewrite.systemMessage });
    }

    if (!isTerminalHarness && turnKind !== 'conversational' && shouldInjectChatStructureHint(resolvedMode, content)) {
      systemMessages.push({ role: 'system', content: CHAT_STRUCTURE_SYSTEM_HINT });
    }

    if (!isTerminalHarness && turnKind !== 'conversational') {
      const turnQualityHint = buildChatTurnQualitySystemHint(resolvedMode, content, chatMessages);
      if (turnQualityHint) {
        systemMessages.push({ role: 'system', content: turnQualityHint });
      }
    }

    const buildMessagesForModel = (modelId: string, dispatch?: { readonly fallback?: boolean }): Message[] => {
      const isBuilderFallback =
        dispatch?.fallback === true
        && (turnKind === 'builder' || resolvedMode === 'builder' || resolvedMode === 'agent');
      const requestSystemMessages: Message[] = isBuilderFallback
        ? [
          ...(securityHardenDirective ? [{ role: 'system' as const, content: securityHardenDirective }] : []),
          ...(conversationPrelude ? [{ role: 'system' as const, content: conversationPrelude }] : []),
          ...(hasActiveSandbox ? [{ role: 'system' as const, content: ACTIVE_SANDBOX_EXECUTION_HINT }] : []),
          { role: 'system', content: BUILDER_FALLBACK_SYSTEM_HINT },
        ]
        : [...systemMessages];

      // Knowledge augmentation for external models:
      // Skip entirely for generation intents (build/scaffold/create requests) — retrieved
      // web captures won't help and will inject noise into the model's context.
      // Also skip for vai:v0 which uses its own knowledge store directly.
      if (
        modelId !== 'vai:v0'
        && this.retrieveKnowledge
        && turnKind !== 'conversational'
        && turnKind !== 'builder'
        && !isGenerationIntent(content)
      ) {
        const relevant = this.retrieveKnowledge(content, 8);
        const useful = relevant.filter((r) => r.score > KNOWLEDGE_RETRIEVAL_SCORE_MIN);
        if (useful.length > 0) {
          const knowledgeSnippets = useful
            .slice(0, 4)
            .map((r) => {
              const excerpt =
                r.text.length > 420 ? `${r.text.slice(0, 420).trim()}…` : r.text.trim();
              const src = r.source ? String(r.source).slice(0, 140) : 'knowledge';
              return `- [${src}] ${excerpt}`;
            })
            .join('\n');
          requestSystemMessages.push({
            role: 'system',
            content: [
              "Potentially relevant excerpts from Vai's local knowledge store (may be incomplete or dated—verify important facts).",
              'Use only what fits the question; do not invent citations. If you rely on a specific claim, note it came from retrieved context.',
              knowledgeSnippets,
            ].join('\n'),
          });
        }
      }

      return requestSystemMessages.length > 0
        ? [...requestSystemMessages, ...modelChatMessages]
        : modelChatMessages;
    };

    const primaryModelId = conv.modelId;
    const fallbackModelId = primaryModelId === 'vai:v0'
      ? pickFallbackModelId(
        this.vaiFallbackChain,
        (modelId) => this.models.has(modelId),
        { content, mode: resolvedMode },
      )
      : null;
    const normalizeSourceChunkForTurn = (chunk: ChatChunk): ChatChunk | null => {
      if (chunk.type !== 'sources') return chunk;

      if (turnKind === 'conversational' && !chunk.groundedBrief) {
        // Plain conversational turns (greetings, small talk) must not surface
        // web-source chrome — an adapter that emits a low-signal sources chunk
        // for "hey" should be dropped, not rendered as supporting references.
        return null;
      }

      if (turnKind === 'research') {
        return {
          ...chunk,
          sourcePresentation: 'research',
        };
      }

      if (turnKind === 'builder') {
        if (!chunk.groundedBrief && (!chunk.sources || chunk.sources.length === 0)) {
          return null;
        }
        return {
          ...chunk,
          sourcePresentation: 'supporting',
        };
      }

      return {
        ...chunk,
        sourcePresentation: 'supporting',
      };
    };

    let prefetchedEvidenceChunk: ChatChunk | null = null;
    let prefetchedEvidenceYielded = false;
    let evidenceSearchResult: import('../search/types.js').SearchResponse | null = null;
    let turnEvidencePersist: {
      sources: NonNullable<ChatChunk['sources']>;
      sourcePresentation?: ChatChunk['sourcePresentation'];
      researchTrace?: ChatChunk['researchTrace'];
      followUps?: ChatChunk['followUps'];
      confidence?: number;
    } | null = null;
    const webConclusionContext = { activeMode: resolvedMode, hasActiveSandbox };
    const shouldAttachWebEvidence =
      Boolean(this.searchForEvidence)
      && turnKind !== 'builder'
      && !isPureConversationalTurn(effectiveContent, webConclusionContext)
      && !shouldSkipWebConclusion(effectiveContent, webConclusionContext)
      && (
        turnKind === 'analysis'
        || turnKind === 'research'
        || shouldAttemptWebConclusion(effectiveContent, webConclusionContext)
      );

    const yieldPrefetchedEvidence = function* (): Generator<ChatChunk, void, unknown> {
      if (prefetchedEvidenceChunk && !prefetchedEvidenceYielded) {
        prefetchedEvidenceYielded = true;
        yield prefetchedEvidenceChunk;
      }
    };

    // TS control-flow analysis cannot see the assignments made inside
    // resolvePrefetchedEvidence (a closure), so sites that read these vars
    // before any direct assignment must go through accessors or the compiler
    // narrows them to their `null` initializer.
    const currentTurnEvidence = () => turnEvidencePersist;
    const currentPrefetchedEvidence = () => prefetchedEvidenceChunk;

    const resolvePrefetchedEvidence = async (): Promise<void> => {
      if (!this.searchForEvidence || !shouldAttachWebEvidence) return;
      try {
        const searchResult = await fetchTurnWebEvidence(effectiveContent, chatMessages, {
          testMode: false,
          search: (query, budgetMs) => this.searchForEvidence!(query, budgetMs),
          searchBudgetMs: 15_000,
        }, { activeMode: resolvedMode, hasActiveSandbox }, { ignoreLocalDefer: true });
        if (!searchResult) return;
        evidenceSearchResult = searchResult;
        const rawChunk = buildSourcesChunkFromSearch(effectiveContent, searchResult, turnKind);
        prefetchedEvidenceChunk = normalizeSourceChunkForTurn(rawChunk);
        if (prefetchedEvidenceChunk?.sources?.length) {
          turnEvidencePersist = {
            sources: prefetchedEvidenceChunk.sources,
            sourcePresentation: prefetchedEvidenceChunk.sourcePresentation,
            researchTrace: prefetchedEvidenceChunk.researchTrace,
            followUps: prefetchedEvidenceChunk.followUps,
            confidence: prefetchedEvidenceChunk.confidence,
          };
          const evidenceHint = buildEvidenceContextSystemHint(effectiveContent, searchResult);
          systemMessages.push({ role: 'system', content: evidenceHint });
        }
      } catch {
        // Non-fatal — the model answer still ships without web evidence.
      }
    };

    // Stream from model
    const adapter = this.models.get(primaryModelId);
    let fullText = '';
    let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
    let durationMs: number | undefined;
    let responseModelId = primaryModelId;
    const streamStartedAt = Date.now();

    yield { type: 'turn_kind', turnKind } as ChatChunk;

    // Live reasoning (streamed via the progress pipe): the buffered vai:v0 pass
    // below can be slow and shows no text until it resolves, so surface a
    // human-readable "what I'm doing now" line instead of a dead spinner.
    yield {
      type: 'progress',
      progress: { stage: 'reason', label: 'Working through it — checking what I know', status: 'running' },
    } as ChatChunk;

    if (shouldAttachWebEvidence) {
      yield {
        type: 'progress',
        progress: { stage: 'search', label: 'Checking the web for sources', status: 'running' },
      } as ChatChunk;
      await resolvePrefetchedEvidence();
      const resolvedEvidence = currentTurnEvidence();
      if (resolvedEvidence) {
        yield {
          type: 'progress',
          progress: {
            stage: 'search',
            label: `Found ${resolvedEvidence.sources.length} source${resolvedEvidence.sources.length === 1 ? '' : 's'}`,
            status: 'done',
          },
        } as ChatChunk;
      }
      for (const chunk of yieldPrefetchedEvidence()) {
        yield chunk;
      }
    }

    const primaryMessages = buildMessagesForModel(primaryModelId);

    if (primaryModelId === 'vai:v0' && fallbackModelId) {
      // Primary-generator flip: substantive turns skip the vai:v0 corpus arm
      // entirely and go straight to the capable generative model. Deterministic
      // dispatch (curated facts, greetings, safety) already returned above, so
      // this only redirects turns the substrate would have answered from its
      // primer store — the documented confident-but-off-topic failure class.
      const primaryFlip = shouldFlipPrimaryToGenerative({
        turnKind,
        mode: resolvedMode,
        hasFallbackModel: true,
        enabled: this.primaryGenerativeFlipEnabled,
      });
      const bufferedChunks: ChatChunk[] = [];
      const bufferedSourceChunks: ChatChunk[] = [];
      let bufferedText = '';
      let bufferedUsage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
      let bufferedDurationMs: number | undefined;
      let bufferedModelId = primaryModelId;
      let latestConfidence: number | undefined;
      let bufferedSawDone = false;

      if (!primaryFlip) {
      for await (const chunk of adapter.chatStream({ messages: primaryMessages, noLearn })) {
        if (chunk.modelId) bufferedModelId = chunk.modelId;
        if (chunk.type === 'sources') {
          if (typeof chunk.confidence === 'number') latestConfidence = chunk.confidence;
          const normalizedSourceChunk = normalizeSourceChunkForTurn(chunk);
          if (normalizedSourceChunk) {
            bufferedSourceChunks.push(normalizedSourceChunk);
          }
          continue;
        }
        bufferedChunks.push(chunk);
        if (chunk.type === 'text_delta' && chunk.textDelta) {
          bufferedText += chunk.textDelta;
        }
        if (chunk.type === 'done') {
          bufferedSawDone = true;
          if (typeof chunk.thinking?.confidence === 'number') {
            latestConfidence = chunk.thinking.confidence;
          }
          if (chunk.usage) bufferedUsage = chunk.usage;
          if (chunk.durationMs !== undefined) bufferedDurationMs = chunk.durationMs;
        }
      }
      if (!bufferedSawDone) {
        bufferedDurationMs = bufferedDurationMs ?? (Date.now() - streamStartedAt);
        const doneChunk: any = {
          type: 'done',
          usage: bufferedUsage,
          durationMs: bufferedDurationMs,
        };
        if (turnPlan) {
          doneChunk.thinking = {
            strategy: 'vai-buffered',
            modelTag: bufferedModelId,
            confidence: latestConfidence ?? 0.6,
            routePlan: buildRoutePlan(turnPlan, turnShadowScores),
          };
        }
        bufferedChunks.push(doneChunk as ChatChunk);
      }
      }

      // Builder Mode 2.0 — request-satisfaction gate (§4.7). A builder turn only
      // suppresses escalation when its artifact *actually satisfies* the request;
      // a generic scaffold (files but near-zero feature coverage) escalates to
      // the generative module instead of shipping boilerplate as "done".
      const isBuilderMode = resolvedMode === 'builder' || resolvedMode === 'agent';
      const buildExecutionRequired = isBuilderMode && isExplicitBuildExecutionRequest(content);
      const builderFiles = isBuilderMode && hasBuilderFileBlocks(bufferedText);
      const builderSatisfies = builderFiles
        && evaluateBuilderRequestSatisfaction(content, bufferedText).satisfied;
      const primaryHadEvidence = bufferedSourceChunks.some(
        (chunk) => Array.isArray(chunk.sources) && chunk.sources.length > 0,
      );
      let reviewReplacedPrimary = false;
      let codeReviewRejected = false;
      if (!primaryFlip && !builderFiles && this.shouldReviewDraft(content, bufferedText)) {
        yield {
          type: 'progress',
          progress: {
            stage: 'friend-review',
            label: reviewLabelForDraft(content, bufferedText),
            status: 'running',
          },
        } as ChatChunk;
        const review = await this.reviewResponse({
          prompt: content,
          draft: bufferedText,
          modelId: bufferedModelId,
          turnKind,
          hasEvidence: primaryHadEvidence,
          sources: bufferedSourceChunks.flatMap((chunk) => chunk.sources ?? []),
        });
        if (review.rejected) {
          if (review.isCodeReview) {
            // Peers flagged the code — escalate to a stronger model instead of
            // swapping in an unrelated guardrail paragraph.
            codeReviewRejected = true;
          } else if (!primaryHadEvidence) {
            bufferedText = this.buildFreshRecommendationGuardrail();
            bufferedModelId = 'vai:friend-review-guard';
            latestConfidence = 0.95;
            reviewReplacedPrimary = true;
          }
        }
        yield {
          type: 'progress',
          progress: {
            stage: 'friend-review',
            label: reviewReplacedPrimary
              ? 'A weak draft was withheld'
              : review.rejected && review.isCodeReview
                ? 'Code did not pass peer review — escalating'
                : review.rejected
                  ? 'Draft flagged by peers'
                  : 'Draft approved for release',
            detail: formatFriendReviewDetail(review),
            status: 'done',
          },
        } as ChatChunk;
      }

      // Process visibility: show what vai:v0 produced before council / escalation.
      const vaiProposedDraft = !primaryFlip && bufferedText.trim() ? bufferedText.trim() : '';
      if (!primaryFlip) {
        yield {
          type: 'progress',
          progress: {
            stage: 'vai-draft',
            label: vaiProposedDraft ? 'Vai proposed an answer' : 'Vai has no confident draft yet',
            detail: vaiProposedDraft || undefined,
            status: 'done',
          },
        } as ChatChunk;
      }

      // Council grades vai:v0 FIRST. Only escalate to the generative arm when the
      // council splits (escalate) or the draft fails the existing fallback gates.
      let councilThinking: CouncilThinking | undefined;
      let councilEscalateToGenerative = false;
      if (!primaryFlip && !builderFiles && !codeReviewRejected && bufferedText.trim()) {
        yield {
          type: 'progress',
          progress: { stage: 'council-vai', label: 'Council reviewing Vai\'s proposal', status: 'running' },
        } as ChatChunk;
        const loop = await this.runCouncilLoop(
          {
            prompt: content,
            draftText: bufferedText,
            modelId: bufferedModelId,
            turnKind,
            confidence: latestConfidence,
            hasEvidence: primaryHadEvidence,
            sources: bufferedSourceChunks.flatMap((chunk) => chunk.sources ?? []),
            history: history.map((m) => ({ role: m.role, content: m.content })),
            conversationId,
          },
          (feedback) => this.redraftWithCouncilFeedback(adapter, primaryMessages, feedback, noLearn),
        );
        councilThinking = loop.council;
        if (loop.revised) {
          bufferedText = loop.finalText;
          reviewReplacedPrimary = true;
        }
        councilEscalateToGenerative = councilThinking?.outcome === 'escalate';
        yield {
          type: 'progress',
          progress: {
            stage: 'council-vai',
            label: councilEscalateToGenerative
              ? 'Council rejected Vai\'s proposal — escalating'
              : loop.revised
                ? 'Council asked Vai to revise — redrafted'
                : councilThinking?.outcome === 'ship'
                  ? 'Council cleared Vai\'s proposal'
                  : 'Council reviewed Vai\'s proposal',
            detail: councilThinking?.summary,
            status: 'done',
          },
        } as ChatChunk;
      }

      const confidenceFallbackDecision = decideVaiFallback({
        text: bufferedText,
        confidence: latestConfidence,
        extraDeclineMarkers: this.extraDeclineMarkers,
        prompt: content,
      });
      // Grounded-fallback preference: when this turn retrieved real external
      // web evidence, the capable fallback model (e.g. qwen2.5:7b) should be
      // the one to answer — the vai:v0 corpus/keyword arm does NOT consume the
      // injected web sources and is the documented source of confident-but-
      // off-topic answers (Bergen for "king of Norway"; see
      // docs/substrate-memo.md). Routing evidence-backed turns to the grounded
      // model lets the answer actually use the sources we found. Reversible via
      // VAI_PREFER_GROUNDED_FALLBACK=0. Unit tests never configure
      // `searchForEvidence`, so `evidenceSearchResult` stays null there and this
      // is a no-op for them.
      const hadPrefetchedWebEvidence =
        Boolean(evidenceSearchResult) && (currentTurnEvidence()?.sources?.length ?? 0) > 0;
      const preferGroundedFallback = shouldPreferGroundedFallback({
        enabled: process.env.VAI_PREFER_GROUNDED_FALLBACK !== '0',
        hadWebEvidence: hadPrefetchedWebEvidence,
        hasFallbackModel: Boolean(fallbackModelId),
        reviewReplacedPrimary,
        builderSatisfies,
        builderFiles,
      }) && !councilThinking;
      const evidenceAwareFallbackDecision: { shouldFallback: boolean; reason: 'low-confidence' | 'no-knowledge' | null } =
        preferGroundedFallback
          ? { shouldFallback: true, reason: 'low-confidence' }
          : primaryHadEvidence && confidenceFallbackDecision.reason === 'low-confidence'
            ? { shouldFallback: false, reason: null }
            : confidenceFallbackDecision;
      const initialFallbackDecision: { shouldFallback: boolean; reason: 'low-confidence' | 'no-knowledge' | null } =
        primaryFlip
          ? { shouldFallback: true, reason: 'low-confidence' }
          : buildExecutionRequired && !builderSatisfies
            ? { shouldFallback: true, reason: 'no-knowledge' }
          : councilEscalateToGenerative
            ? { shouldFallback: true, reason: 'low-confidence' }
          : councilThinking?.outcome === 'ship' && !buildExecutionRequired
            ? { shouldFallback: false, reason: null }
          : reviewReplacedPrimary
          ? { shouldFallback: false, reason: null }
          : codeReviewRejected
            ? { shouldFallback: true, reason: 'low-confidence' }
          : builderSatisfies
          ? { shouldFallback: false, reason: null }
          : builderFiles
            ? { shouldFallback: true, reason: 'no-knowledge' }
            : evidenceAwareFallbackDecision;
      const fallbackDecision = !reviewReplacedPrimary
        && !initialFallbackDecision.shouldFallback
        && !builderFiles
        && !primaryHadEvidence
        && failsAnswerQualityGate(content, bufferedText, bufferedModelId)
        ? { shouldFallback: true, reason: 'low-confidence' as const }
        : initialFallbackDecision;
      if (!fallbackDecision.shouldFallback || !fallbackDecision.reason) {
        // §12.5.3 exit gate: verify + sanitize the deterministic-core arm's
        // output before it reaches the user. Council already ran on vai:v0 above.
        const primaryThinking = bufferedChunks.find((chunk) => chunk.type === 'done')?.thinking;
        const primaryVerificationConfig = primaryThinking?.trustBadge === 'local-curated'
          ? { ...this.verificationConfig, requireEvidenceForFactualClaims: false }
          : this.verificationConfig;
        const verdict = builderFiles
          ? null
          : verifyResponse({
            text: bufferedText,
            confidence: latestConfidence,
            hasEvidence: primaryHadEvidence,
            arm: 'primary',
            prompt: content,
            config: primaryVerificationConfig,
          });

        totalUsage = bufferedUsage;
        durationMs = bufferedDurationMs;
        responseModelId = bufferedModelId;
        if (bufferedSourceChunks.length > 0) {
          const sourced = bufferedSourceChunks.find(
            (chunk) => chunk.type === 'sources' && (chunk.sources?.length ?? 0) > 0,
          );
          if (sourced?.sources?.length) {
            turnEvidencePersist = {
              sources: sourced.sources,
              sourcePresentation: sourced.sourcePresentation,
              researchTrace: sourced.researchTrace,
              followUps: sourced.followUps,
              confidence: sourced.confidence,
            };
          }
          for (const chunk of bufferedSourceChunks) {
            yield chunk;
          }
        } else {
          for (const chunk of yieldPrefetchedEvidence()) {
            yield chunk;
          }
        }

        // Carry the council projection onto the `done` chunk so the ThinkingPanel
        // can render the "How this answer was made" council section.
        const withCouncil = (chunk: ChatChunk): ChatChunk => {
          if (chunk.type !== 'done') return chunk;
          const done = chunk as any;
          const thinking = { ...(done.thinking ?? { strategy: 'vai-buffered', modelTag: bufferedModelId, confidence: latestConfidence ?? 0.6 }) };
          if (councilThinking) thinking.council = councilThinking;
          if (vaiProposedDraft) thinking.vaiProposedDraft = vaiProposedDraft;
          return { ...done, thinking } as ChatChunk;
        };

        if (verdict && verdict.action !== 'pass') {
          const surfaced = verdict.text;
          fullText = surfaced;
          if (surfaced) yield { type: 'text_delta', textDelta: surfaced } as ChatChunk;
          yield {
            type: 'verification',
            verification: {
              action: verdict.action,
              grounding: verdict.grounding,
              reasons: verdict.reasons,
              calibrationNote: verdict.calibrationNote,
            },
          } as ChatChunk;
          // Replay only the non-text buffered chunks (e.g. the `done` chunk) so
          // usage + duration still flow, but the raw, unsanitized text does not.
          for (const chunk of bufferedChunks) {
            if (chunk.type === 'text_delta') continue;
            yield withCouncil(chunk);
          }
        } else {
          fullText = bufferedText;
          if (reviewReplacedPrimary) {
            yield { type: 'text_delta', textDelta: bufferedText } as ChatChunk;
            for (const chunk of bufferedChunks) {
              if (chunk.type === 'text_delta') continue;
              yield withCouncil(chunk);
            }
          } else {
            for (const chunk of bufferedChunks) {
              yield withCouncil(chunk);
            }
          }
        }
      } else {
        const fallbackLabel = fallbackModelId.replace(/^(?:local|openai|anthropic|google):/, '');
        yield {
          type: 'progress',
          progress: {
            stage: 'escalate',
            label: primaryFlip
              ? `Handing this to ${fallbackLabel} — my generative arm`
              : councilEscalateToGenerative
                ? `Council escalated — handing to ${fallbackLabel}`
              : `Not in my memory yet — asking ${fallbackLabel}`,
            detail: councilEscalateToGenerative && councilThinking?.summary
              ? councilThinking.summary
              : undefined,
            status: 'running',
          },
        } as ChatChunk;
        yield {
          type: 'fallback_notice',
          fallback: {
            fromModelId: primaryModelId,
            toModelId: fallbackModelId,
            reason: fallbackDecision.reason,
          },
        };
        yield {
          type: 'progress',
          progress: { stage: 'answer', label: `${fallbackLabel} is writing the answer`, status: 'running' },
        } as ChatChunk;

        const fallbackAdapter = this.models.get(fallbackModelId);
        const fallbackMessages = buildMessagesForModel(fallbackModelId, { fallback: true });
        let fallbackDurationMs = 0;
        responseModelId = fallbackModelId;

        // §12.5.3: the escalated generative arm passes back through the
        // verification layer *before reaching the user*. We buffer it (the local
        // open-weight model is non-streaming anyway, so this adds no real latency;
        // for a streaming cloud model it trades token-streaming on the already-slow
        // escalation path for a verified answer — the right trade per §6.6).
        const collectFallback = async (messages: readonly Message[]) => {
          const attemptStartedAt = Date.now();
          const chunks: ChatChunk[] = [];
          const sourceChunks: ChatChunk[] = [];
          let text = '';
          let sawDone = false;
          let attemptDurationMs: number | undefined;
          let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
          for await (const chunk of fallbackAdapter.chatStream({ messages, noLearn })) {
            if (chunk.modelId) responseModelId = chunk.modelId;
            if (chunk.type === 'sources') {
              if (typeof chunk.confidence === 'number') latestConfidence = chunk.confidence;
              const normalizedSourceChunk = normalizeSourceChunkForTurn(chunk);
              if (normalizedSourceChunk) sourceChunks.push(normalizedSourceChunk);
              continue;
            }
            chunks.push(chunk);
            if (chunk.type === 'text_delta' && chunk.textDelta) text += chunk.textDelta;
            if (chunk.type === 'done') {
              sawDone = true;
              if (typeof chunk.thinking?.confidence === 'number') {
                latestConfidence = chunk.thinking.confidence;
              }
              if (chunk.usage) usage = chunk.usage;
              if (chunk.durationMs !== undefined) attemptDurationMs = chunk.durationMs;
            }
          }
          attemptDurationMs = attemptDurationMs ?? (Date.now() - attemptStartedAt);
          if (!sawDone) {
            chunks.push({ type: 'done', usage, durationMs: attemptDurationMs } as ChatChunk);
          }
          return { chunks, sourceChunks, text, durationMs: attemptDurationMs, usage };
        };

        // Council codegen arm: for builder turns, Vai's council of AIs (the
        // ranked local/cloud models) builds the app together — architect →
        // coder → reviewers → bounded repair — behind a real TypeScript syntax
        // gate. A null result or any throw falls through to the single-model
        // arm below; the council must never sink the turn.
        let councilResult: Awaited<ReturnType<typeof collectFallback>> | null = null;
        let councilEditUsed = false;
        console.log(`[builder-arm] isBuilderMode=${isBuilderMode} mode=${resolvedMode} turnKind=${turnKind} councilFlag=${process.env.VAI_COUNCIL_CODEGEN !== '0'} brief=${JSON.stringify(content.slice(0, 60))}`);
        if (isBuilderMode && process.env.VAI_COUNCIL_CODEGEN !== '0') {
          const councilMembers = this.builderCouncilMembers();
          // Active-sandbox awareness: when the desktop attached the running
          // project (name + file snapshots), an iteration-shaped prompt must
          // PATCH that project. Without this, "make my background more fancy"
          // becomes a brand-new "Fancy Background App" (live failure).
          let councilEdit: CouncilEditContext | undefined;
          const sandboxContext = parseActiveSandboxContext(systemPrompt);
          if (sandboxContext && sandboxContext.files.length > 0) {
            const builderRoute = routeBuilderRequest({
              input: content,
              activeMode: 'builder',
              hasActiveSandboxContext: true,
              snapshotPaths: sandboxContext.files.map((file) => file.path),
            });
            if (builderRoute.shouldPatchActiveSandbox) councilEdit = sandboxContext;
          }
          if (councilMembers.length > 0) {
            const councilStartedAt = Date.now();
            console.log(`[council] start members=${councilMembers.map((m) => m.id).join(',')} edit=${Boolean(councilEdit)} brief=${JSON.stringify(content.slice(0, 80))}`);
            try {
              for await (const event of councilGenerateApp({ brief: content, members: councilMembers, edit: councilEdit })) {
                if (event.type === 'stage') {
                  console.log(`[council] ${event.stage}/${event.status}: ${event.label}${event.detail ? ` — ${event.detail.slice(0, 140)}` : ''}`);
                } else {
                  console.log(`[council] result: ${event.result ? `shipped (${event.result.memberIds.join(',')}, repairs=${event.result.repairsUsed})` : 'null'}`);
                }
                if (event.type === 'stage') {
                  yield {
                    type: 'progress',
                    progress: {
                      stage: `council-${event.stage}`,
                      label: event.label,
                      detail: event.detail,
                      status: event.status,
                    },
                  } as ChatChunk;
                  continue;
                }
                if (event.result) {
                  const councilDurationMs = Date.now() - councilStartedAt;
                  councilResult = {
                    chunks: [{ type: 'done', usage: event.result.usage, durationMs: councilDurationMs } as ChatChunk],
                    sourceChunks: [],
                    text: event.result.output,
                    durationMs: councilDurationMs,
                    usage: event.result.usage,
                  };
                  responseModelId = councilMembers[0].id;
                  councilEditUsed = Boolean(councilEdit);
                }
              }
            } catch (error) {
              councilResult = null;
              // Never silent: the user steers by seeing what failed.
              yield {
                type: 'progress',
                progress: {
                  stage: 'council-error',
                  label: 'Council build crashed — falling back to the single-model arm',
                  detail: (error instanceof Error ? error.message : String(error)).slice(0, 160),
                  status: 'done',
                },
              } as ChatChunk;
            }
          }
        }

        const usedCouncilArtifact = councilResult !== null;
        let fallbackResult = councilResult ?? await collectFallback(fallbackMessages);
        totalUsage = addTokenUsage(totalUsage, fallbackResult.usage);
        fallbackDurationMs += fallbackResult.durationMs;
        let fbText = isBuilderMode
          ? repairBuilderFallbackFileBlocks(fallbackResult.text).text
          : fallbackResult.text;
        // A council artifact already passed an internal compile gate + council
        // review + bounded repair, so it is held to the DEFAULT anchor gate —
        // the strict fallback threshold was tuned for unvalidated one-shot
        // local-model output and would let a single-file echo beat a compiled
        // scaffold on raw keyword coverage (live smoke-test artifact).
        // A council EDIT bypasses the anchor gate entirely: its output is the
        // changed files only, so fresh-build anchor coverage is meaningless,
        // and the legacy one-shot repair must never replace a targeted patch
        // with a new app built from the request's words.
        let fbBuilderSatisfaction: BuilderSatisfactionReport | null = isBuilderMode
          ? councilEditUsed
            ? { hasFileBlocks: true, satisfied: true, coverage: 1, anchorsHit: 0, anchorsTotal: 0, missingAnchors: [], reasons: ['council-edit-artifact'] }
            : evaluateBuilderRequestSatisfaction(content, fbText, usedCouncilArtifact
              ? undefined
              : { minAnchorCoverage: FALLBACK_BUILDER_MIN_ANCHOR_COVERAGE })
          : null;
        let builderRepairAttempted = false;
        let answerQualityRepairAttempted = false;
        let usedConservativeQualityFallback = false;
        let fbAnswerQuality = isBuilderMode
          ? null
          : evaluateChatAnswerQuality({
            prompt: content,
            response: fbText,
            strategy: fallbackModelId,
          });

        // One bounded repair pass for the local builder arm. The first fallback
        // often gets close but narrates, omits sandbox fence metadata, or leaves
        // requested behaviors out. Feed the structural miss back once, then
        // keep the better artifact; never loop indefinitely.
        //
        // Council artifacts are exempt: the council carries its own satisfaction
        // machinery (architect spec from the brief, reviewers checking against
        // the brief, a real compile gate, bounded repair). The anchor gate is a
        // keyword-echo heuristic for unvalidated one-shot output, and it has
        // twice replaced a correct council app with a worse single-file echo —
        // live case: a tsc-clean "Swipe Match" tinder clone scored 0/2 anchors
        // because it didn't contain the words "tinder clone", while the
        // one-shot index.html echoing "Tinder Clone" scored 2/2 and won.
        if (fbBuilderSatisfaction && !fbBuilderSatisfaction.satisfied && !usedCouncilArtifact) {
          builderRepairAttempted = true;
          const repairMessages = buildBuilderFallbackRepairMessages(fallbackMessages, fbBuilderSatisfaction);
          const repairResult = await collectFallback(repairMessages);
          totalUsage = addTokenUsage(totalUsage, repairResult.usage);
          fallbackDurationMs += repairResult.durationMs;
          const repairedText = repairBuilderFallbackFileBlocks(repairResult.text).text;
          const repairedSatisfaction = evaluateBuilderRequestSatisfaction(content, repairedText, {
            minAnchorCoverage: FALLBACK_BUILDER_MIN_ANCHOR_COVERAGE,
          });
          if (scoreBuilderSatisfaction(repairedSatisfaction) > scoreBuilderSatisfaction(fbBuilderSatisfaction)) {
            fallbackResult = repairResult;
            fbText = repairedText;
            fbBuilderSatisfaction = repairedSatisfaction;
          }
        }

        // Quality gate for the one-shot arm: when the council refused to ship,
        // the fallback may NOT stealth-ship an ungated artifact (live failure:
        // council refused a mismatched draft → fallback shipped a white card
        // with a broken external image). Refusing honestly beats shipping junk.
        if (isBuilderMode && !usedCouncilArtifact && hasBuilderFileBlocks(fbText)) {
          const oneShotFiles = extractTitledFiles(fbText);
          const oneShotApp = oneShotFiles.get('src/App.tsx') ?? null;
          const gateErrors: string[] = [];
          if (oneShotApp) {
            const report = await validateGeneratedApp({ appTsx: oneShotApp, stylesCss: oneShotFiles.get('src/styles.css') ?? null });
            gateErrors.push(...report.errors);
          } else {
            const html = oneShotFiles.get('index.html') ?? '';
            if (!html) {
              gateErrors.push('no recognizable app artifact (src/App.tsx or index.html)');
            } else {
              const styleBody = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
              const ruleCount = (styleBody.match(/\{/g) ?? []).length;
              if (ruleCount < 10) gateErrors.push(`only ${ruleCount} CSS rules — visually unfinished`);
              if (!/:hover/.test(styleBody)) gateErrors.push('no hover states');
              if (/https?:\/\/(?!www\.w3\.org)/.test(html)) gateErrors.push('external asset URLs (broken images offline)');
            }
          }
          if (gateErrors.length > 0) {
            fbText = [
              `I attempted this build but the result did not meet the quality bar (${gateErrors.slice(0, 2).join('; ')}), so I did not apply it — your preview is unchanged.`,
              '',
              'Say **try again** to rebuild from scratch, or add specifics (features, style, layout) and I will target them directly.',
            ].join('\n');
            responseModelId = 'vai:builder-quality-gate';
            fbBuilderSatisfaction = { hasFileBlocks: false, satisfied: false, coverage: 0, anchorsHit: 0, anchorsTotal: 0, missingAnchors: [], reasons: ['builder-quality-refusal'] };
            yield {
              type: 'progress',
              progress: {
                stage: 'quality-check',
                label: 'Build withheld — below the quality bar',
                detail: gateErrors.slice(0, 2).join(' | '),
                status: 'done',
              },
            } as ChatChunk;
          }
        }

        // The conversational arm gets the same bounded discipline as Builder:
        // inspect the first draft, feed back only the structural misses, and
        // keep the better of two attempts. This catches plausible-looking but
        // unhelpful answers before they reach the user without creating a loop.
        if (fbAnswerQuality?.verdict === 'fail') {
          answerQualityRepairAttempted = true;
          yield {
            type: 'progress',
            progress: {
              stage: 'quality-check',
              label: 'Tightening a weak draft',
              detail: fbAnswerQuality.missing.map((requirement) => requirement.label).join(', '),
              status: 'running',
            },
          } as ChatChunk;
          const repairMessages = buildFallbackQualityRepairMessages(fallbackMessages, fbAnswerQuality);
          const repairResult = await collectFallback(repairMessages);
          totalUsage = addTokenUsage(totalUsage, repairResult.usage);
          fallbackDurationMs += repairResult.durationMs;
          const repairedQuality = evaluateChatAnswerQuality({
            prompt: content,
            response: repairResult.text,
            strategy: fallbackModelId,
          });
          if (scoreAnswerQuality(repairedQuality) > scoreAnswerQuality(fbAnswerQuality)) {
            fallbackResult = repairResult;
            fbText = repairResult.text;
            fbAnswerQuality = repairedQuality;
          }
          if (fbAnswerQuality.verdict === 'fail') {
            const conservativeAnswer = buildConservativeDiagnosticAnswer(content)
              ?? buildConservativeExhaustiveAnswer(content)
              ?? buildConservativeConversationalAnswer(content);
            if (conservativeAnswer) {
              const conservativeQuality = evaluateChatAnswerQuality({
                prompt: content,
                response: conservativeAnswer,
                strategy: 'conservative-diagnostic-fallback',
              });
              if (scoreAnswerQuality(conservativeQuality) > scoreAnswerQuality(fbAnswerQuality)) {
                usedConservativeQualityFallback = true;
                fbText = conservativeAnswer;
                fbAnswerQuality = conservativeQuality;
                responseModelId = 'vai:quality-guard';
              }
            }
          }
          yield {
            type: 'progress',
            progress: {
              stage: 'quality-check',
              label: usedConservativeQualityFallback
                ? 'Used a safe quality fallback after two weak drafts'
                : fbAnswerQuality.verdict === 'pass'
                  ? 'Quality check passed after one revision'
                  : 'Quality check completed',
              detail: fbAnswerQuality.missing.map((requirement) => requirement.label).join(', ') || undefined,
              status: 'done',
            },
          } as ChatChunk;
        }

        // Thorsen loop on the escalated/flip arm. This is where substantive
        // analysis/research turns actually land (the primary-generative flip
        // skips the vai:v0 buffered block entirely), so the friend council must
        // grade THIS draft — not just the legacy buffered one — or it never runs
        // on the turns it exists to improve. Same contract as the buffered path:
        // the council reads intent + method + concerns (never facts) and Vai
        // redrafts once from the SAME escalated model, re-graded, better kept.
        // Builder file artifacts keep their own gates and are left alone.
        let fallbackCouncilThinking: CouncilThinking | undefined;
        const fbHasFileBlocksForCouncil = isBuilderMode && hasBuilderFileBlocks(fbText);
        if (!fbHasFileBlocksForCouncil && fbText.trim() && !councilEscalateToGenerative) {
          const fbCouncilHasEvidence = fallbackResult.sourceChunks.some(
            (chunk) => Array.isArray(chunk.sources) && chunk.sources.length > 0,
          );
          yield {
            type: 'progress',
            progress: { stage: 'council-fallback', label: 'Friend council reviewing the draft', status: 'running' },
          } as ChatChunk;
          const loop = await this.runCouncilLoop(
            {
              prompt: content,
              draftText: fbText,
              modelId: responseModelId,
              turnKind,
              confidence: latestConfidence,
              hasEvidence: fbCouncilHasEvidence,
              sources: fallbackResult.sourceChunks.flatMap((chunk) => chunk.sources ?? []),
              history: history.map((m) => ({ role: m.role, content: m.content })),
              conversationId,
            },
            (feedback) => this.redraftWithCouncilFeedback(fallbackAdapter, fallbackMessages, feedback, noLearn),
          );
          fallbackCouncilThinking = loop.council;
          if (loop.revised) fbText = loop.finalText;
          yield {
            type: 'progress',
            progress: {
              stage: 'council-fallback',
              label: loop.revised
                ? 'Council asked for a revision — Vai redrafted'
                : fallbackCouncilThinking?.outcome === 'ship'
                  ? 'Council cleared the draft'
                  : 'Council reviewed the draft',
              detail: fallbackCouncilThinking?.summary,
              status: 'done',
            },
          } as ChatChunk;
        }

        // Builder file output from the escalated model is kept verbatim (its own
        // quality gates apply); everything else is verified. The local model has
        // no retrieval, so confident factual claims are inherently ungrounded —
        // calibrate them rather than letting confident-wrong re-emerge here.
        const fbBuilderFiles = isBuilderMode && hasBuilderFileBlocks(fbText);
        const fbHasEvidence = fallbackResult.sourceChunks.some(
          (chunk) => Array.isArray(chunk.sources) && chunk.sources.length > 0,
        );
        if (!fbBuilderFiles && this.shouldReviewDraft(content, fbText)) {
          yield {
            type: 'progress',
            progress: {
              stage: 'friend-review',
              label: reviewLabelForDraft(content, fbText),
              status: 'running',
            },
          } as ChatChunk;
          const review = await this.reviewResponse({
            prompt: content,
            draft: fbText,
            modelId: responseModelId,
            turnKind,
            hasEvidence: fbHasEvidence,
            sources: fallbackResult.sourceChunks.flatMap((chunk) => chunk.sources ?? []),
          });
          if (review.rejected && !review.isCodeReview && !fbHasEvidence) {
            fbText = this.buildFreshRecommendationGuardrail();
            responseModelId = 'vai:friend-review-guard';
            usedConservativeQualityFallback = true;
          }
          yield {
            type: 'progress',
            progress: {
              stage: 'friend-review',
              label: responseModelId === 'vai:friend-review-guard'
                ? 'A weak draft was withheld'
                : review.rejected && review.isCodeReview
                  ? 'Escalated code still flagged by peers'
                  : review.rejected
                    ? 'Draft flagged by peers'
                    : 'Draft approved for release',
              detail: formatFriendReviewDetail(review),
              status: 'done',
            },
          } as ChatChunk;
        }
        const fbVerdict = fbBuilderFiles
          ? null
          : verifyResponse({
            text: fbText,
            confidence: latestConfidence,
            hasEvidence: fbHasEvidence,
            arm: 'fallback',
            prompt: content,
            config: {
              ...this.verificationConfig,
              requireEvidenceForFactualClaims: !usedConservativeQualityFallback,
            },
          });

        if (bufferedDurationMs !== undefined) {
          durationMs = bufferedDurationMs + fallbackDurationMs;
        } else {
          durationMs = fallbackDurationMs;
        }
        const fallbackThinking: any = buildFallbackThinking({
          content,
          turnKind,
          trigger: builderFiles ? 'builder-unsatisfied' : fallbackDecision.reason,
          fallbackModelId,
          verificationStage: fbBuilderSatisfaction
            ? usedCouncilArtifact
              // Council artifacts pass their own compile + review gates; the
              // anchor coverage number is reported for the record, not as a
              // verdict (a "Swipe Match" tinder clone legitimately scores 0).
              ? `council-${councilEditUsed ? 'edit' : 'build'}-shipped`
              : `${builderRepairAttempted ? 'builder-retry' : 'builder'}-${fbBuilderSatisfaction.satisfied ? 'satisfied' : 'unsatisfied'}`
            : [
              answerQualityRepairAttempted
                ? `${usedConservativeQualityFallback ? 'quality-fallback' : 'quality-retry'}-${fbAnswerQuality?.verdict ?? 'unknown'}`
                : null,
              `${fbVerdict?.action ?? 'pass'}:${fbVerdict?.grounding ?? 'complementary'}`,
            ].filter(Boolean).join(':'),
          durationMs: durationMs ?? Date.now() - streamStartedAt,
        });
        if (turnPlan) {
          fallbackThinking.routePlan = buildRoutePlan(turnPlan, turnShadowScores);
        }
        if (vaiProposedDraft) {
          fallbackThinking.vaiProposedDraft = vaiProposedDraft;
        }
        if (councilEscalateToGenerative && councilThinking) {
          fallbackThinking.council = councilThinking;
        } else if (fallbackCouncilThinking) {
          fallbackThinking.council = fallbackCouncilThinking;
        }

        const decorateFallbackDone = (chunk: ChatChunk): ChatChunk => chunk.type === 'done'
          ? {
            ...chunk,
            modelId: usedConservativeQualityFallback ? responseModelId : chunk.modelId ?? responseModelId,
            thinking: fallbackThinking,
          }
          : chunk;

        for (const chunk of fallbackResult.sourceChunks) yield chunk;
        if (fallbackResult.sourceChunks.length === 0) {
          for (const chunk of yieldPrefetchedEvidence()) {
            yield chunk;
          }
        } else {
          const sourced = fallbackResult.sourceChunks.find(
            (chunk) => chunk.type === 'sources' && (chunk.sources?.length ?? 0) > 0,
          );
          if (sourced?.sources?.length) {
            turnEvidencePersist = {
              sources: sourced.sources,
              sourcePresentation: sourced.sourcePresentation,
              researchTrace: sourced.researchTrace,
              followUps: sourced.followUps,
              confidence: sourced.confidence,
            };
          }
        }
        const prefetched = currentPrefetchedEvidence();
        if (!turnEvidencePersist && prefetched?.type === 'sources' && prefetched.sources?.length) {
          turnEvidencePersist = {
            sources: prefetched.sources,
            sourcePresentation: prefetched.sourcePresentation,
            researchTrace: prefetched.researchTrace,
            followUps: prefetched.followUps,
            confidence: prefetched.confidence,
          };
        }
        if (fbVerdict && fbVerdict.action !== 'pass') {
          const surfaced = fbVerdict.text;
          fullText = surfaced;
          if (surfaced) yield { type: 'text_delta', textDelta: surfaced } as ChatChunk;
          yield {
            type: 'verification',
            verification: {
              action: fbVerdict.action,
              grounding: fbVerdict.grounding,
              reasons: fbVerdict.reasons,
              calibrationNote: fbVerdict.calibrationNote,
            },
          } as ChatChunk;
          for (const chunk of fallbackResult.chunks) {
            if (chunk.type === 'text_delta') continue;
            yield decorateFallbackDone(chunk);
          }
        } else {
          fullText = fbText;
          if (fbText) yield { type: 'text_delta', textDelta: fbText } as ChatChunk;
          for (const chunk of fallbackResult.chunks) {
            if (chunk.type === 'text_delta') continue;
            yield decorateFallbackDone(chunk);
          }
        }
      }
    } else {
      let primarySawDone = false;
      if (!prefetchedEvidenceYielded) {
        for (const chunk of yieldPrefetchedEvidence()) {
          yield chunk;
        }
      }
      for await (const chunk of adapter.chatStream({ messages: primaryMessages, noLearn })) {
        if (chunk.modelId) responseModelId = chunk.modelId;
        if (chunk.type === 'sources') {
          const normalizedSourceChunk = normalizeSourceChunkForTurn(chunk);
          if (normalizedSourceChunk) {
            yield normalizedSourceChunk;
          }
          continue;
        }
        if (chunk.type === 'text_delta' && chunk.textDelta) {
          fullText += chunk.textDelta;
        }
        if (chunk.type === 'done') {
          primarySawDone = true;
          if (chunk.usage) totalUsage = chunk.usage;
          if (chunk.durationMs !== undefined) durationMs = chunk.durationMs;
        }
        yield chunk;
      }
      // Compute council on the accumulated draft *before* emitting any synthetic done,
      // so the thinking on the done can carry the council section for the panel.
      let councilThinking: CouncilThinking | undefined;
      if (fullText) {
        councilThinking = await this.runCouncilReview({
          prompt: content,
          draftText: fullText,
          modelId: responseModelId,
          // confidence and sources are best-effort here; the council gate uses
          // draftConfidence for "low confidence -> full council" and hasEvidence for context.
          confidence: undefined,
          hasEvidence: false,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          conversationId,
        });
      }
      if (!primarySawDone) {
        durationMs = durationMs ?? (Date.now() - streamStartedAt);
        const baseDone: any = {
          type: 'done',
          usage: totalUsage,
          durationMs,
        };
        const t: any = turnPlan
          ? {
              strategy: 'model-primary',
              modelTag: primaryModelId,
              confidence: 0.6,
              routePlan: buildRoutePlan(turnPlan, turnShadowScores),
            }
          : { strategy: 'model-primary', modelTag: primaryModelId, confidence: 0.6 };
        if (councilThinking) t.council = councilThinking;
        if (turnPlan || councilThinking) baseDone.thinking = t;
        yield baseDone as ChatChunk;
      }
    }

    // Feed streaming latency back to the adaptive controller
    if (durationMs !== undefined && this.controller) {
      this.controller.observe(durationMs);
    }

    // Note: for pure adapter-streamed model turns that emitted their own 'done',
    // a follow-up council attachment can be added by yielding a final done chunk
    // carrying { council }. The det + synthetic paths (very common for quality
    // and structured turns) already carry councilThinking through the emit helper.

    if (this.onUsage) {
      try {
        const usageAdapter = this.models.tryGet(responseModelId) ?? adapter;
        const cachedTokens = totalUsage.cachedTokens ?? 0;
        this.onUsage({
          id: ulid(),
          modelId: responseModelId,
          provider: usageAdapter.provider ?? responseModelId.split(':')[0] ?? 'unknown',
          conversationId,
          tokensIn: totalUsage.promptTokens,
          tokensOut: totalUsage.completionTokens,
          cachedTokens,
          costUsd: usageAdapter.cost
            ? calculateCost(totalUsage.promptTokens, totalUsage.completionTokens, cachedTokens, usageAdapter.cost)
            : 0,
          durationMs: durationMs ?? Date.now() - streamStartedAt,
          finishReason: 'stop',
        });
      } catch (err) {
        // Usage telemetry should never block the user's chat response.
        console.warn('[chat-service] failed to record usage', err);
      }
    }

    // Persist assistant message. §12.5.3: never persist scaffolding/drift
    // leaks, even on the live-streamed arms where the tokens were already sent
    // (the buffered primary arm sanitized in-flight, so this is idempotent there).
    const assistantMsgId = ulid();
    const persistedText = sanitizeLeakage(fullText).text;

    // Persist plan + baseline for model turns as well (critical for reference data
    // when steering caused the fall-through).
    const modelPlanBlob = turnPlan || turnEvidencePersist
      ? JSON.stringify({
          ...(turnPlan ? { steered: turnPlan, baseline: turnBaselinePlan ?? null, hadGuidance: !!turnBaselinePlan } : {}),
          ...(turnEvidencePersist ? { evidence: turnEvidencePersist } : {}),
        })
      : undefined;

    this.db.insert(messages).values({
      id: assistantMsgId,
      conversationId,
      role: 'assistant',
      content: persistedText,
      tokenCount: totalUsage.completionTokens || undefined,
      modelId: responseModelId,
      durationMs: durationMs ?? undefined,
      createdAt: new Date(),
      ...(modelPlanBlob ? { plan: modelPlanBlob } : {}),
    }).run();

    // Update conversation timestamp + auto-title on first message
    const updates: { updatedAt: Date; title?: string } = { updatedAt: new Date() };
    if (conv.title === 'New Chat' && content.length > 0) {
      updates.title = this.generateTitle(image ? `🖼 ${content || image.description}` : content);
    }
    this.db.update(conversations)
      .set(updates)
      .where(eq(conversations.id, conversationId))
      .run();
  }

  /**
   * Emit + persist a deterministic assistant turn through ONE shared path.
   *
   * Every deterministic router used to repeat the same ~40-line block:
   * timestamp → optional progress/turn_kind → text_delta → done (+thinking) →
   * insert the assistant message → bump conversation title/updatedAt → return.
   * That boilerplate now lives here once, so a handler only describes WHAT to
   * say (reply + strategy + confidence) and this path streams + records it
   * identically. `preChunks` carries any handler-specific lead-in chunks (e.g.
   * the product-engineering memo's progress stages). The duration measured for
   * the `done` chunk, the persisted row, and the thinking trace are one value,
   * exactly as the inlined blocks computed it (clock starts before preChunks).
   */
  private async *emitDeterministicTurn(args: {
    conversationId: string;
    conversationTitle: string;
    content: string;
    reply: string;
    strategy: string;
    confidence: number;
    turnKind?: string;
    preChunks?: readonly ChatChunk[];
    /** The scored routing decision (after any friend/agent/robot guidance). */
    plan?: DispatchPlan;
    /** Unsteered shadow plan — key reference point for "did steering help?" analysis. */
    baselinePlan?: DispatchPlan;
    /** SCIS council review of this draft (when roster configured and convened). */
    council?: CouncilThinking;
  }): AsyncGenerator<ChatChunk, void, unknown> {
    const startedAt = Date.now();
    for (const chunk of args.preChunks ?? []) yield chunk;
    if (args.turnKind) {
      yield { type: 'turn_kind', turnKind: args.turnKind } as ChatChunk;
    }
    yield { type: 'text_delta', textDelta: args.reply } as ChatChunk;
    const durationMs = Date.now() - startedAt;
    const baseThinking = buildDeterministicThinking(args.strategy, args.content, durationMs, args.confidence);
    const finalThinking = {
      ...(args.plan ? { ...baseThinking, routePlan: buildRoutePlan(args.plan) } : baseThinking),
      ...(args.council ? { council: args.council } : {}),
    };
    yield {
      type: 'done',
      usage: { promptTokens: 0, completionTokens: 0 },
      durationMs,
      thinking: finalThinking,
    } as ChatChunk;

    // Persist the (steered) plan + baseline as JSON reference data on the message row.
    // This + the route_guidances rows give us the longitudinal points needed to
    // measure steering benefit and detect when re-calibration is warranted.
    const planBlob = args.plan
      ? JSON.stringify({
          steered: args.plan,
          baseline: args.baselinePlan ?? null,
          hadGuidance: !!args.baselinePlan,
        })
      : undefined;

    this.db.insert(messages).values({
      id: ulid(),
      conversationId: args.conversationId,
      role: 'assistant',
      content: args.reply,
      modelId: args.strategy,
      durationMs,
      createdAt: new Date(),
      ...(planBlob ? { plan: planBlob } : {}),
    }).run();

    const updates: { updatedAt: Date; title?: string } = { updatedAt: new Date() };
    if (args.conversationTitle === 'New Chat' && args.content.length > 0) {
      updates.title = this.generateTitle(args.content);
    }
    this.db.update(conversations)
      .set(updates)
      .where(eq(conversations.id, args.conversationId))
      .run();
  }

  /**
   * Build a dynamic, corpus-backed explainer for ONE comparison operand, used by
   * the comparison composer to synthesize "A vs B" from whatever Vai actually
   * knows. Backed by the injected {@link retrieveKnowledge} retriever and gated
   * by a salient-token relevance check, so an unrelated nearest-neighbor never
   * leaks into a side. Returns undefined when no retriever is configured, leaving
   * the composer on its canonical idiom table. Self-adjusting with the corpus.
   */
  private buildComparisonConceptExplainer(): ((concept: string) => { summary: string } | null) | undefined {
    const retrieve = this.retrieveKnowledge;
    if (!retrieve) return undefined;
    return (concept: string) => {
      const c = (concept || '').trim();
      if (c.length < 2) return null;
      const top = retrieve(c, 1)?.[0];
      if (!top || top.text.length < 40) return null;
      const salient = c.toLowerCase().split(/\s+/).find((w) => w.length >= 3);
      if (salient && !top.text.toLowerCase().includes(salient)) return null;
      const summary = top.text.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').trim();
      return summary.length > 0 ? { summary } : null;
    };
  }

  private generateTitle(firstMessage: string): string {
    // Clean up and truncate the first user message into a chat title
    const cleaned = firstMessage
      .replace(/\n+/g, ' ')      // flatten newlines
      .replace(/\s+/g, ' ')       // collapse whitespace
      .trim();

    if (cleaned.length <= 40) return cleaned;

    // Cut at word boundary
    const truncated = cleaned.slice(0, 40);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...';
  }

  deleteConversation(conversationId: string): void {
    this.db.delete(messages)
      .where(eq(messages.conversationId, conversationId))
      .run();
    this.db.delete(conversations)
      .where(eq(conversations.id, conversationId))
      .run();
  }

  /**
   * For legacy conversations created before auth (ownerUserId null, e.g. under dev bypass),
   * assign ownership to the now-authenticated user so they can update it.
   * Called on first write access after sign-in.
   */
  assignOwnerIfLegacy(conversationId: string, ownerUserId: string): void {
    const conv = this.getConversation(conversationId);
    if (conv && !conv.ownerUserId) {
      this.db.update(conversations)
        .set({ ownerUserId, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId))
        .run();
    }
  }
}

function reviewLabelForDraft(prompt: string, draft: string): string {
  return shouldPeerReviewCode(prompt, draft)
    ? 'Asking peers to review the code draft'
    : 'Asking local friends to check the draft';
}

function formatFriendReviewDetail(review: {
  reason: string;
  reviewers: readonly string[];
  concerns: readonly string[];
  suggestions: readonly string[];
}): string {
  const parts = [
    review.reason,
    review.reviewers.length > 0 ? `Reviewed by ${review.reviewers.join(', ')}` : '',
    review.concerns.length > 0 ? `Concerns: ${review.concerns.slice(0, 3).join('; ')}` : '',
    review.suggestions.length > 0 ? `Suggestions: ${review.suggestions.slice(0, 3).join('; ')}` : '',
  ].filter(Boolean);
  return parts.join(' · ') || 'Peer review completed';
}
