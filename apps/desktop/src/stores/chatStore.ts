import { create } from 'zustand';
import type { ConversationSummary, CreateConversationResponse } from '@vai/contracts/responses';
import type {
  ChatProgressStep as ChatProgressStepContract,
  ProgressOutcome,
} from '@vai/contracts/chat-ws';
import { apiFetch, buildChatWebSocketProtocols, buildChatWebSocketUrl } from '../lib/api.js';
import { getActiveCapture, startSessionCapture } from '../lib/sessionCapture.js';
import type { SessionCapture } from '../lib/sessionCapture.js';
import { mergeProjectUpdateMessage } from '../lib/project-update-message.js';
import { useLayoutStore, type ChatMode } from './layoutStore.js';
import { useSettingsStore } from './settingsStore.js';
import { useAuthStore } from './authStore.js';
import { useSandboxStore } from './sandboxStore.js';
import { useWorkspaceStore } from './workspaceStore.js';
import { extractFilesFromMarkdown } from '../lib/file-extractor.js';

interface ImageAttachment {
  data: string;
  mimeType: string;
  description: string;
  question?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export interface SearchSourceUI {
  url: string;
  title: string;
  domain: string;
  snippet: string;
  favicon: string;
  trustTier: 'high' | 'medium' | 'low' | 'untrusted';
  trustScore: number;
}

export type SourcePresentationUI = 'research' | 'supporting';
export type TurnKindUI = 'conversational' | 'research' | 'builder' | 'analysis';

export interface GroundedBuildBriefUI {
  intent: 'build' | 'edit';
  focusLabel: string;
  summary: string;
  recommendation: string;
  nextStep: string;
  reasons: string[];
  sourceDomains: string[];
  sourceCount: number;
  confidence: number;
}

export type ChatProgressStep = ChatProgressStepContract;

export const MAX_PROGRESS_STEPS_PER_MESSAGE = 200;

function progressEvidenceId(stage: string, index: number): string {
  const normalized = stage
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'step';
  return `progress:${index + 1}:${normalized}`;
}

function terminalProgressLabel(outcome: ProgressOutcome): string {
  if (outcome === 'succeeded') return 'Turn completed';
  if (outcome === 'failed') return 'Turn failed';
  if (outcome === 'interrupted') return 'Turn interrupted';
  if (outcome === 'withheld') return 'Output withheld';
  return 'Turn not run';
}

/** IDE agent identity for group chat messages */
export interface MessageSender {
  type: 'vai' | 'ide-agent' | 'user';
  name: string;
  ide?: string;
  model?: string;
  peerKey?: string;
  color?: string;
}

/** Color palette for IDE agent avatars in group chat */
export const IDE_AGENT_COLORS: Record<string, string> = {
  vscode: '#3B82F6',
  cursor: '#8B5CF6',
  antigravity: '#F59E0B',
  desktop: '#10B981',
};

/**
 * Vai-native decision trace for a turn (mirror of core `TurnThinking`). Vai is
 * a deterministic engine, so this is the strategy chain it walked — not LLM
 * token reasoning. Rendered by the collapsible Thinking panel.
 */
export interface TurnRouteCandidateUI {
  name: string;
  /** Fit 0..1 after any friend guidance. */
  score: number;
  /** Fit 0..1 before friend guidance — shows how a hint moved the value. */
  baseScore?: number;
  chosen: boolean;
  /** Scored high enough but declined — couldn't ground its answer. */
  declined: boolean;
  /** Friend guidance note that moved this candidate's score, if any. */
  guidance?: string;
  /** Why this handler valued the turn as it did — the reviewable rationale. */
  reason?: string;
  /** A scored-but-non-deciding Capability-Kernel candidate, shown for comparison. */
  shadow?: boolean;
}

/** The scored routing decision Vai made — shown so all friends can see and steer it. */
export interface TurnRoutePlanUI {
  chosen: string | null;
  /** No candidate cleared the confidence floor → honest "I don't know". */
  belowFloor: boolean;
  candidates: TurnRouteCandidateUI[];
}

export type AuditOutcomeKindUI = 'O1' | 'O2' | 'O3' | 'O4' | 'O5' | 'O6' | 'O7' | 'O8';

export interface AuditMetaUI {
  outcomeKind: AuditOutcomeKindUI;
  convened: boolean;
  revised: boolean;
  resetFired: boolean;
  draftStrategy?: string;
  visibleTextChanged: boolean;
  realIntent?: string;
  methodLesson?: string;
  councilOutcome?: 'ship' | 'act' | 'escalate';
  priorTextExcerpt?: string;
}

export interface TurnThinkingUI {
  intent: string;
  strategy: string;
  strategyChain: string[];
  trustBadge?: string;
  confidence?: number;
  topic?: string;
  knowledgeDepth?: 'deep' | 'shallow' | 'none';
  register?: string;
  durationMs?: number;
  processTrace?: Array<{ stage: string; durationMs: number; detail?: string }>;
  /** Scored routing decision (candidates + scores + winner). */
  routePlan?: TurnRoutePlanUI;
  /** SCIS consensus council view (who reviewed, the consensus, intent, missing method). */
  council?: CouncilThinkingUI;
  /** Durable honest metadata for async council review/revise outcomes. */
  auditMeta?: AuditMetaUI;
  /** vai:v0 draft before council — visible in process even when council escalated. */
  vaiProposedDraft?: string;
}

/** The council's ephemeral consensus for one turn — rendered in the thinking panel. */
export interface CouncilThinkingUI {
  outcome: 'ship' | 'act' | 'escalate';
  agreement: number;
  confidence: number;
  topic: string;
  summary: string;
  realIntent: string;
  recommendedAction: string;
  missingCapabilities: string[];
  methodLessons: string[];
  members: Array<{
    name: string;
    topic: string;
    verdict: 'good' | 'needs-work' | 'bad';
    confidence: number;
    action: string;
    note: string;
    failed?: boolean;
  }>;
  /**
   * Surfaced minority objection (transparency): present when a non-trivial-weight minority
   * pushed back even though the modal verdict carried. Audit-only — the outcome already
   * accounted for the vote; this makes the dissent visible instead of buried.
   */
  dissent?: {
    dissentStrength: number;
    dissentingMembers: Array<{ memberName: string; weight: number; confidence: number; concerns: string[] }>;
  };
  /**
   * Verification spine (transparency): how much of the context the panel fetched actually
   * grounded the answer, and whether any grounding is web-disputed. Advisory — does not gate.
   */
  provenance?: {
    total: number;
    groundedness: number;
    hasDisputed: boolean;
    verdict: 'grounded' | 'thin' | 'contested' | 'none';
    counts: { used: number; unused: number; considered: number; unavailable: number; disputed: number };
  };
}

export interface ResearchTraceStageUI {
  step: 'clarify' | 'fan-out' | 'fetch' | 'rank' | 'read' | 'cross-check' | 'conclude';
  label: string;
  detail: string;
  durationMs: number;
}

/** Inspectable web-search execution trace for one assistant turn. */
export interface ResearchTraceUI {
  mode: 'linear' | 'parallel' | 'wormhole';
  latencyMs: number;
  recommendedConcurrency: number;
  rawResultCount: number;
  sourceCount: number;
  intent: string;
  entities: string[];
  fanOutQueries: string[];
  stages: ResearchTraceStageUI[];
}

export interface ResponseVerificationUI {
  action: 'pass' | 'sanitize' | 'calibrate' | 'decline';
  grounding: 'grounded' | 'ungrounded' | 'contradicted' | 'complementary';
  reasons: string[];
  calibrationNote?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** ISO timestamp — persisted server-side, stamped locally for optimistic messages. */
  createdAt?: string;
  imageId?: string | null;
  imagePreview?: string;
  /** Which model actually produced this assistant response. */
  respondingModelId?: string;
  /** Present when Vai transparently fell back to another model. */
  fallback?: {
    fromModelId: string;
    toModelId: string;
    reason: 'low-confidence' | 'no-knowledge';
  };
  /** Who sent this message (group chat identity) */
  sender?: MessageSender;
  /** Search sources attached to this response */
  sources?: SearchSourceUI[];
  /** Whether citations should render as full research chrome or lighter supporting references */
  sourcePresentation?: SourcePresentationUI;
  /** High-level routing classification for the assistant turn */
  turnKind?: TurnKindUI;
  /** Follow-up question suggestions */
  followUps?: string[];
  /** Confidence score (0-1) from search pipeline */
  confidence?: number;
  /** Structured research-to-build handoff for source-backed build replies */
  groundedBuildBrief?: GroundedBuildBriefUI;
  /** Vai-native thinking trace (strategy chain, intent, trust, confidence). */
  thinking?: TurnThinkingUI;
  /** Rehydrated audit metadata from the persisted message plan. */
  auditMeta?: AuditMetaUI;
  /** Exit-gate result. Exposed in the process panel, never prepended to answer text. */
  verification?: ResponseVerificationUI;
  /** Live image-generation steps (produce→verify→regenerate) shown as visible process. */
  imageGenSteps?: { phase: string; label: string; attempt?: number; matchScore?: number; flaws?: string[] }[];
  /** Final generated image (data URL) for an image-output turn. */
  imageGenResult?: { dataUrl: string; width?: number; height?: number; accepted?: boolean };
  /** Search pipeline trace for inspectable research turns, including empty-result attempts. */
  researchTrace?: ResearchTraceUI;
  /** User feedback: true = helpful, false = not helpful, undefined = no feedback */
  feedback?: boolean;
  /** Set when message was auto-generated by the repair loop (not typed by user) */
  isAutoRepair?: boolean;
  /** Repair attempt number (1-based) when isAutoRepair is true */
  repairAttempt?: number;
  /** Real server-side activity/progress stages for long turns */
  progressSteps?: ChatProgressStep[];
  /** EPHEMERAL live work-product: Vai's draft answer as it streams, BEFORE the council
   *  accepts/redrafts it. Shown in a discardable "Draft (in review)" block and never persisted
   *  (it may be withdrawn). Cleared/replaced via the draft lifecycle (start/delta/reset/
   *  committed). Not hidden reasoning — observable work product only. */
  liveDraft?: {
    text: string;
    phase: 'start' | 'delta' | 'reset' | 'committed' | 'discarded';
    seq: number;
    turnId?: string;
    priorText?: string;
  } | null;
  /** Deterministic HTML info blocks (sandboxed-iframe rendered) emitted by Vai/council. */
  infoBlocks?: { id: string; html: string; title?: string }[];
}

/** Preserve nested payloads when the backend re-emits the same stage (e.g. council members arriving late). */
function mergeProgressStep(existing: ChatProgressStep | undefined, incoming: ChatProgressStep): ChatProgressStep {
  if (!existing) return incoming;
  const staleRunningUpdate = existing.outcome !== undefined && incoming.status === 'running';
  return {
    ...existing,
    ...incoming,
    status: staleRunningUpdate ? existing.status : incoming.status,
    outcome: staleRunningUpdate
      ? existing.outcome
      : incoming.outcome ?? existing.outcome,
    evidenceId: incoming.evidenceId ?? existing.evidenceId,
    advisor: incoming.advisor ?? existing.advisor,
    councilMembers: incoming.councilMembers?.length ? incoming.councilMembers : existing.councilMembers,
    processLog: incoming.processLog?.length ? incoming.processLog : existing.processLog,
    toolRuns: incoming.toolRuns?.length ? incoming.toolRuns : existing.toolRuns,
  };
}

export function mergeProgressStepsForMessage(
  existing: readonly ChatProgressStep[],
  incoming: ChatProgressStep,
): ChatProgressStep[] {
  let priorIndex = -1;
  for (let index = existing.length - 1; index >= 0; index -= 1) {
    if (existing[index]?.stage === incoming.stage) {
      priorIndex = index;
      break;
    }
  }

  if (priorIndex !== -1) {
    const prior = existing[priorIndex];
    const identifiesOneLogicalStep = prior?.status === 'running'
      || prior?.label === incoming.label
      || incoming.stage === 'search'
      || /(?:^|-)round-?\d+(?:$|-)/i.test(incoming.stage);
    if (identifiesOneLogicalStep) {
      const next = [...existing];
      next[priorIndex] = mergeProgressStep(prior, incoming);
      return next.slice(-MAX_PROGRESS_STEPS_PER_MESSAGE);
    }
  }

  const normalizedExisting = existing.map((step, index) => ({
    ...step,
    evidenceId: step.evidenceId ?? progressEvidenceId(step.stage, index),
  }));
  return [
    ...normalizedExisting,
    {
      ...incoming,
      evidenceId: incoming.evidenceId ?? progressEvidenceId(incoming.stage, existing.length),
    },
  ].slice(-MAX_PROGRESS_STEPS_PER_MESSAGE);
}

/**
 * Settle the exact assistant trace that received the terminal transport event.
 * Lifecycle (`running`/`done`) remains backwards-compatible while semantic
 * outcome records whether the work actually succeeded, failed, or was stopped.
 */
export function finalizeProgressStepsForMessage(
  existing: readonly ChatProgressStep[],
  turnOutcome: ProgressOutcome,
): ChatProgressStep[] {
  if (existing.length === 0) return [];
  const withoutPriorTerminal = existing.filter((step) => step.stage !== 'turn-terminal');
  const settled = withoutPriorTerminal.map((step, index): ChatProgressStep => {
    const outcome = step.outcome
      ?? (step.status === 'done'
        ? 'succeeded'
        : turnOutcome === 'failed'
          ? 'failed'
          : turnOutcome === 'succeeded'
            ? 'interrupted'
            : turnOutcome);
    const stepId = step.evidenceId ?? progressEvidenceId(step.stage, index);
    return {
      ...step,
      status: 'done',
      outcome,
      evidenceId: stepId,
      toolRuns: step.toolRuns?.map((run) => {
        const toolOutcome = run.outcome
          ?? (run.status === 'failed' || run.success === false
            ? 'failed'
            : run.status === 'done'
              ? 'succeeded'
              : turnOutcome === 'failed'
                ? 'failed'
                : turnOutcome === 'succeeded'
                  ? 'interrupted'
                  : turnOutcome);
        return {
          ...run,
          status: toolOutcome === 'failed' ? 'failed' as const : 'done' as const,
          outcome: toolOutcome,
          evidenceId: run.evidenceId ?? `${stepId}:tool:${run.id}`,
        };
      }),
      draftRace: step.draftRace
        ? {
            ...step.draftRace,
            status: 'decided',
            outcome: step.draftRace.outcome
              ?? (step.draftRace.status === 'decided'
                ? 'succeeded'
                : turnOutcome === 'succeeded'
                  ? 'interrupted'
                  : turnOutcome),
            evidenceId: step.draftRace.evidenceId ?? `${stepId}:draft-race`,
          }
        : undefined,
    };
  });
  const terminal: ChatProgressStep = {
    stage: 'turn-terminal',
    label: terminalProgressLabel(turnOutcome),
    status: 'done',
    outcome: turnOutcome,
    evidenceId: 'progress:terminal:turn',
  };
  return [...settled, terminal].slice(-MAX_PROGRESS_STEPS_PER_MESSAGE);
}

function isAuditMetaUI(value: unknown): value is AuditMetaUI {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuditMetaUI>;
  return (
    typeof candidate.outcomeKind === 'string' &&
    ['O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8'].includes(candidate.outcomeKind) &&
    typeof candidate.convened === 'boolean' &&
    typeof candidate.revised === 'boolean' &&
    typeof candidate.resetFired === 'boolean' &&
    typeof candidate.visibleTextChanged === 'boolean'
  );
}

export function auditPriorDraftExcerpt(text: string | undefined, maxLength = 600): string | undefined {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function mergeAuditPriorDraftExcerpt(
  thinking: TurnThinkingUI | undefined,
  priorText: string | undefined,
): TurnThinkingUI | undefined {
  if (!thinking?.auditMeta || thinking.auditMeta.priorTextExcerpt || !thinking.auditMeta.visibleTextChanged) {
    return thinking;
  }
  const priorTextExcerpt = auditPriorDraftExcerpt(priorText);
  if (!priorTextExcerpt) return thinking;
  return {
    ...thinking,
    auditMeta: {
      ...thinking.auditMeta,
      priorTextExcerpt,
    },
  };
}

export function parseAssistantMessagePlan(plan: string | null | undefined): Partial<Pick<
  ChatMessage,
  'sources' | 'sourcePresentation' | 'researchTrace' | 'followUps' | 'confidence' | 'auditMeta'
>> {
  if (!plan) return {};
  try {
    const parsed = JSON.parse(plan) as {
      auditMeta?: unknown;
      evidence?: {
        sources?: SearchSourceUI[];
        sourcePresentation?: SourcePresentationUI;
        researchTrace?: ResearchTraceUI;
        followUps?: string[];
        confidence?: number;
      };
    };
    const out: Partial<Pick<
      ChatMessage,
      'sources' | 'sourcePresentation' | 'researchTrace' | 'followUps' | 'confidence' | 'auditMeta'
    >> = {};
    if (isAuditMetaUI(parsed.auditMeta)) {
      out.auditMeta = parsed.auditMeta;
    }
    const evidence = parsed.evidence;
    if (evidence?.sources?.length) {
      out.sources = evidence.sources;
      out.sourcePresentation = evidence.sourcePresentation;
      out.researchTrace = evidence.researchTrace;
      out.followUps = evidence.followUps;
      out.confidence = evidence.confidence;
    }
    return out;
  } catch {
    return {};
  }
}

/** Server list row - kept in sync via @vai/contracts/responses. */
type Conversation = ConversationSummary;

interface ChatState {
  conversations: Conversation[];
  /** True after the initial conversation list and saved chat have settled. */
  conversationsHydrated: boolean;
  activeConversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  /** Which conversation is actually generating right now — independent of the
   *  active selection, so the sidebar "Working…" badge stays pinned to the chat
   *  that's working even after the user switches to another chat. */
  streamingConversationId: string | null;
  /** Follow-up the user composed while a turn was streaming — sent automatically when the turn completes. */
  queuedMessage: string | null;
  /** Owner-only explicit teach toggle, only active inside training workspace. */
  learningEnabled: boolean;
  /** Composer deliberation depth for the next turn: quick / balanced / deep. */
  processDepth: 'quick' | 'balanced' | 'deep';
  /** Explicit council seats for upcoming turns; null = full roundtable (server default). */
  councilModelIds: string[] | null;
  /** Separate owner workspace for curating what can train Vai. */
  trainingWorkspace: boolean;
  /** Active broadcast ID being polled for IDE responses */
  activeBroadcastId: string | null;
  /** When true, sent messages go through broadcast API instead of VaiEngine */
  broadcastMode: boolean;
  /** Target client IDs for broadcast mode (empty = all connected) */
  broadcastTargetClientIds: string[];
  /** Per-conversation broadcast connections: conversationId → targetClientIds */
  broadcastChats: Record<string, string[]>;

  fetchConversations: () => Promise<void>;
  createConversation: (modelId: string, mode?: ChatMode, options?: { sandboxProjectId?: string | null }) => Promise<string>;
  startNewChat: () => void;
  selectConversation: (id: string) => Promise<void>;
  updateConversationMode: (id: string, mode: ChatMode) => Promise<void>;
  setConversationSandbox: (id: string, sandboxProjectId: string | null) => Promise<void>;
  setConversationVisibility: (id: string, visibility: 'private' | 'unlisted' | 'public') => Promise<string | null>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string, image?: ImageAttachment, systemPrompt?: string, opts?: { isAutoRepair?: boolean; repairAttempt?: number; imageMode?: boolean; regenerate?: boolean }) => void;
  /** Re-runs the latest turn ("Retry"): drops the superseded assistant answer and resends the last user message without duplicating it. */
  regenerateLastTurn: () => void;
  /** Inject a message from an IDE agent (group chat) */
  injectAgentMessage: (content: string, sender: MessageSender) => void;
  /** Persist a backend-authored project update into the current conversation */
  injectProjectUpdate: (content: string, conversationId?: string | null) => Promise<void>;
  /** Send a broadcast message to connected IDE extensions */
  sendBroadcast: (content: string, targetClientIds?: string[], preferredModel?: string, targetChatApp?: string, targetSessionId?: string) => Promise<void>;
  /** Enable/disable broadcast mode for the chat input */
  setBroadcastMode: (enabled: boolean, targetClientIds?: string[]) => void;
  /** Update broadcast target client IDs without changing mode */
  setBroadcastTargetClientIds: (ids: string[]) => void;
  stopStreaming: () => void;
  /** Queue a follow-up to auto-send when the current turn finishes (null clears it). */
  setQueuedMessage: (content: string | null) => void;
  appendToLastMessage: (text: string) => void;
  setFeedback: (messageId: string, helpful: boolean) => void;
  setLearningEnabled: (enabled: boolean) => void;
  /** Set the composer deliberation depth for subsequent turns. */
  setProcessDepth: (depth: 'quick' | 'balanced' | 'deep') => void;
  setCouncilModelIds: (ids: string[] | null) => void;
  setTrainingWorkspace: (enabled: boolean) => void;
  startOwnerTrainingSession: (modelId?: string, mode?: ChatMode) => Promise<string | null>;
  /** Post a steering guidance (avoid/prefer a handler) so it persists and affects future routing for this convo/class/global. */
  postSteer: (args: {
    conversationId: string;
    signal: 'avoid' | 'prefer';
    handler: string;
    note?: string;
    scope?: 'class' | 'conversation' | 'global';
    matchTokens?: string[];
  }) => Promise<{ ok: boolean; guidance?: any; error?: string }>;
}

/** Load persisted per-chat broadcast map from localStorage */
function loadBroadcastChats(): Record<string, string[]> {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem('vai-broadcast-chats') : null;
    return raw ? JSON.parse(raw) as Record<string, string[]> : {};
  } catch { return {}; }
}

function saveBroadcastChats(chats: Record<string, string[]>): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('vai-broadcast-chats', JSON.stringify(chats));
    }
  } catch { /* silent */ }
}

export const LAST_ACTIVE_CONVERSATION_STORAGE_KEY = 'vai:lastActiveConversationId';

function loadLastActiveConversationId(): string | null {
  try {
    const value = typeof window !== 'undefined'
      ? window.localStorage.getItem(LAST_ACTIVE_CONVERSATION_STORAGE_KEY)
      : null;
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function saveLastActiveConversationId(conversationId: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (conversationId) {
      window.localStorage.setItem(LAST_ACTIVE_CONVERSATION_STORAGE_KEY, conversationId);
    } else {
      window.localStorage.removeItem(LAST_ACTIVE_CONVERSATION_STORAGE_KEY);
    }
  } catch { /* non-fatal persistence */ }
}

export function resolveConversationResumeId(
  conversations: Array<{ id: string }>,
  savedConversationId: string | null | undefined,
): string | null {
  if (!savedConversationId) return null;
  return conversations.some((conversation) => conversation.id === savedConversationId)
    ? savedConversationId
    : null;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { message?: string; error?: string };
    return payload.message || payload.error || fallback;
  } catch {
    return fallback;
  }
}

export function resolveConversationSandboxProjectIdOption(
  options: { sandboxProjectId?: string | null } | undefined,
  activeSandboxProjectId: string | null | undefined,
): string | null {
  if (options && Object.prototype.hasOwnProperty.call(options, 'sandboxProjectId')) {
    return options.sandboxProjectId ?? null;
  }
  return activeSandboxProjectId ?? null;
}

/**
 * Whether a sidebar chat row should show the "Working…" badge. The badge belongs
 * to the conversation that is ACTUALLY streaming, never to whichever chat is
 * merely selected — otherwise switching chats mid-turn moves the badge to the
 * wrong row (the bug this replaced: `isStreaming && conv.id === activeId`).
 */
export function isConversationWorking(
  conversationId: string,
  streamingConversationId: string | null,
): boolean {
  return streamingConversationId !== null && conversationId === streamingConversationId;
}

/**
 * Whether opening `incoming` should eagerly reset the sandbox view. True when a
 * project is currently loaded and the chat being opened is NOT bound to that same
 * project — so the previous chat's code/preview can't linger during the switch.
 */
export function shouldResetSandboxOnSwitch(
  currentProjectId: string | null,
  incomingSandboxProjectId: string | null | undefined,
): boolean {
  return currentProjectId !== null && incomingSandboxProjectId !== currentProjectId;
}

/** Active broadcast response poller */
let broadcastPollTimer: ReturnType<typeof setInterval> | null = null;

/** Monotonic token so only the most recent selectConversation call wins. */
let selectConversationToken = 0;
let resumeSelectionInFlight: string | null = null;
let conversationBootstrapInFlight = false;

/** Currently active streaming WebSocket. Only one may be open at a time. */
let activeWs: WebSocket | null = null;
let activeStreamingAssistantId: string | null = null;
let pendingStreamDelta = '';
let streamDeltaFlushScheduled = false;

function flushPendingStreamDelta(): void {
  if (!pendingStreamDelta) {
    streamDeltaFlushScheduled = false;
    return;
  }

  const text = pendingStreamDelta;
  pendingStreamDelta = '';
  streamDeltaFlushScheduled = false;

  useChatStore.setState((state) => {
    const msgs = [...state.messages];
    const targetIndex = activeStreamingAssistantId
      ? msgs.findIndex((message) => message.id === activeStreamingAssistantId)
      : msgs.length - 1;
    const target = targetIndex >= 0 ? msgs[targetIndex] : null;
    if (target && target.role === 'assistant') {
      msgs[targetIndex] = { ...target, content: target.content + text };
    }
    return { messages: msgs };
  });
}

function scheduleStreamDeltaFlush(): void {
  if (streamDeltaFlushScheduled) return;
  streamDeltaFlushScheduled = true;
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => flushPendingStreamDelta());
    return;
  }
  setTimeout(() => flushPendingStreamDelta(), 16);
}

function isProjectUpdateContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('Project update:') || trimmed.includes('[vai-artifact]');
}

function collapseRedundantProjectMessages(messages: ChatMessage[]): ChatMessage[] {
  const collapsed: ChatMessage[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index];
    const next = messages[index + 1];

    if (
      current?.role === 'assistant'
      && extractFilesFromMarkdown(current.content).length > 0
      && next?.role === 'assistant'
      && isProjectUpdateContent(next.content)
    ) {
      continue;
    }

    collapsed.push(current);
  }

  return collapsed;
}

/**
 * Generate a clean session title from the first user message.
 * Strips markdown, collapses whitespace, truncates at word boundary.
 */
function deriveSessionTitle(content: string): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, '[code]')  // collapse code blocks
    .replace(/\[.*?\]\(.*?\)/g, '')        // remove links
    .replace(/[#*_`~]/g, '')              // strip markdown
    .replace(/\n+/g, ' ')                 // flatten newlines
    .replace(/\s+/g, ' ')                 // collapse whitespace
    .trim();

  if (cleaned.length <= 60) return cleaned || 'Chat Session';
  const truncated = cleaned.slice(0, 60);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

/**
 * Ensure there's an active SessionCapture for dev logs.
 * Auto-creates one on the first message if none exists.
 */
async function ensureCapture(firstMessage: string, modelId?: string): Promise<SessionCapture | null> {
  const existing = getActiveCapture();
  if (existing) return existing;

  // Auto-start a new dev logs session
  const title = deriveSessionTitle(firstMessage);
  const capture = await startSessionCapture(
    title,
    'VeggaAI',
    modelId || 'unknown',
    { batched: true, flushInterval: 2000 },
  );
  return capture;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  conversationsHydrated: false,
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamingConversationId: null,
  queuedMessage: null,
  learningEnabled: false,
  processDepth: (() => {
    try {
      const saved = localStorage.getItem('vai:processDepth');
      if (saved === 'quick' || saved === 'balanced' || saved === 'deep') return saved;
    } catch { /* SSR / no storage */ }
    return 'balanced' as const;
  })(),
  councilModelIds: (() => {
    try {
      const saved = localStorage.getItem('vai:councilModelIds');
      if (saved) {
        const parsed = JSON.parse(saved) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((v) => typeof v === 'string')) {
          return parsed as string[];
        }
      }
    } catch { /* SSR / no storage */ }
    return null;
  })(),
  trainingWorkspace: false,
  activeBroadcastId: null,
  broadcastMode: false,
  broadcastTargetClientIds: [],
  broadcastChats: loadBroadcastChats(),

  fetchConversations: async () => {
    const ownsBootstrap = !get().conversationsHydrated && !conversationBootstrapInFlight;
    if (ownsBootstrap) conversationBootstrapInFlight = true;
    try {
      const res = await apiFetch('/api/conversations?limit=50');
      const conversations = (await res.json()) as ConversationSummary[];
      set({ conversations });
      const savedConversationId = loadLastActiveConversationId();
      const resumeId = resolveConversationResumeId(conversations, savedConversationId);
      if (savedConversationId && !resumeId) {
        saveLastActiveConversationId(null);
      }
      if (!get().activeConversationId && resumeId && resumeSelectionInFlight !== resumeId) {
        resumeSelectionInFlight = resumeId;
        const selection = get().selectConversation(resumeId).finally(() => {
          if (resumeSelectionInFlight === resumeId) {
            resumeSelectionInFlight = null;
          }
        });
        if (ownsBootstrap) await selection;
      }
    } catch {
      console.error('Failed to fetch conversations');
    } finally {
      if (ownsBootstrap) {
        conversationBootstrapInFlight = false;
        set({ conversationsHydrated: true });
      }
    }
  },

  createConversation: async (modelId: string, mode?: ChatMode, options?: { sandboxProjectId?: string | null }) => {
    const resolvedMode = mode ?? useSettingsStore.getState().defaultConversationMode;
    const resolvedSandboxProjectId = resolveConversationSandboxProjectIdOption(
      options,
      useSandboxStore.getState().projectId,
    );
    const res = await apiFetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, mode: resolvedMode, sandboxProjectId: resolvedSandboxProjectId }),
    });

    if (!res.ok) {
      throw new Error(await readApiError(res, 'Unable to create a new chat.'));
    }

    const { id, sandboxProjectId } = (await res.json()) as CreateConversationResponse;
    if (!id) {
      throw new Error('Unable to create a new chat: server did not return a conversation id.');
    }

    await get().fetchConversations();
    await get().selectConversation(id);

    // Auto-attach sandbox for builder conversations
    if (sandboxProjectId) {
      await useSandboxStore.getState().attachProject(sandboxProjectId);
    }

    return id;
  },

  startNewChat: () => {
    // Cancel a slower saved-chat restore so it cannot attach its project after
    // the user explicitly chose a clean chat.
    selectConversationToken += 1;
    resumeSelectionInFlight = null;
    if (activeWs) {
      activeWs.close();
      activeWs = null;
    }
    activeStreamingAssistantId = null;
    useLayoutStore.getState().setMode(useSettingsStore.getState().defaultConversationMode);
    useLayoutStore.getState().collapseBuilder();
    useSandboxStore.getState().reset();
    saveLastActiveConversationId(null);
    set({
      activeConversationId: null,
      messages: [],
      isStreaming: false,
      streamingConversationId: null,
      broadcastMode: false,
      broadcastTargetClientIds: [],
    });
  },

  startOwnerTrainingSession: async (modelId?: string, mode?: ChatMode) => {
    const resolvedMode = mode ?? useSettingsStore.getState().defaultConversationMode;
    const auth = useAuthStore.getState();
    if (!auth.isOwner) {
      return null;
    }

    const selectedModelId = modelId
      ?? get().conversations.find((conversation) => conversation.id === get().activeConversationId)?.modelId
      ?? 'vai:v0';

    const id = await get().createConversation(selectedModelId, resolvedMode, { sandboxProjectId: null });
    set({ trainingWorkspace: true, learningEnabled: false });
    return id;
  },

  selectConversation: async (id: string) => {
    // Guard against rapid conversation switches: only the LATEST selection may
    // mutate state, otherwise a slow fetch for chat A lands after the user
    // already opened chat B and attaches A's sandbox over B's preview.
    const token = ++selectConversationToken;
    const isStale = () => token !== selectConversationToken;
    // Eagerly drop the OUTGOING chat's sandbox view if the chat we're opening
    // isn't bound to that same project — so the previous chat's code/preview can't
    // linger on screen during the async message + project fetch below.
    const incoming = get().conversations.find((c) => c.id === id);
    const currentProjectId = useSandboxStore.getState().projectId;
    if (shouldResetSandboxOnSwitch(currentProjectId, incoming?.sandboxProjectId ?? null)) {
      useSandboxStore.getState().reset();
    }
    const [res] = await Promise.all([
      apiFetch(`/api/conversations/${id}/messages`),
      get().fetchConversations(),
    ]);
    if (isStale()) return;
    const rawMessages = (await res.json()) as Array<{
      id: string;
      role: string;
      content: string;
      imageId?: string | null;
      plan?: string | null;
      modelId?: string | null;
      createdAt?: string | null;
      /** Pruned process trace rehydrated server-side, so the ProcessTree re-expands. */
      progressSteps?: ChatProgressStep[] | null;
    }>;
    const conversation = get().conversations.find((item) => item.id === id);
    if (conversation?.sandboxProjectId) {
      try {
        await useSandboxStore.getState().attachProject(conversation.sandboxProjectId);
        if (isStale()) return;
        useLayoutStore.getState().expandBuilder();
      } catch {
        if (isStale()) return;
        // External sandbox ids are process-local. After a runtime restart the
        // durable conversation still knows its folder, so reopen that folder and
        // atomically replace the stale id instead of falling into fresh-app mode.
        if (conversation.workspaceRoot) {
          try {
            const reopened = await useSandboxStore.getState().openLocalFolder(conversation.workspaceRoot);
            if (isStale()) return;
            const patch = await apiFetch(`/api/conversations/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sandboxProjectId: reopened.id, workspaceRoot: conversation.workspaceRoot }),
            });
            if (!patch.ok) throw new Error('Unable to persist the restored project binding');
            const updated = await patch.json() as Conversation;
            set((state) => ({
              conversations: state.conversations.map((item) => item.id === id ? updated : item),
            }));
            useLayoutStore.getState().expandBuilder();
            return;
          } catch {
            // The folder itself is now unavailable; surface a stopped project
            // instead of letting the next Builder turn invent a replacement app.
          }
        }
        useSandboxStore.getState().reset();
        useLayoutStore.getState().collapseBuilder();
      }
    }
    // Restore per-chat broadcast state
    const broadcastChats = get().broadcastChats;
    const isBroadcastChat = id in broadcastChats;
    set({
      activeConversationId: id,
      messages: collapseRedundantProjectMessages(rawMessages.map((m) => ({
        id: m.id,
        role: m.role as ChatMessage['role'],
        content: m.content,
        imageId: m.imageId,
        ...(m.createdAt ? { createdAt: m.createdAt } : {}),
        ...(m.role === 'assistant' ? parseAssistantMessagePlan(m.plan) : {}),
        ...(m.role === 'assistant' && m.modelId ? { respondingModelId: m.modelId } : {}),
        ...(m.role === 'assistant' && m.progressSteps?.length ? { progressSteps: m.progressSteps } : {}),
      }))),
      broadcastMode: isBroadcastChat,
      broadcastTargetClientIds: isBroadcastChat ? broadcastChats[id] : [],
    });
    saveLastActiveConversationId(id);
    if (conversation?.mode) {
      useLayoutStore.getState().setMode(conversation.mode);
    }

    if (conversation?.sandboxProjectId) {
      return;
    }

    if (conversation?.workspaceRoot) {
      try {
        const reopened = await useSandboxStore.getState().openLocalFolder(conversation.workspaceRoot);
        if (isStale()) return;
        const patch = await apiFetch(`/api/conversations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sandboxProjectId: reopened.id, workspaceRoot: conversation.workspaceRoot }),
        });
        if (!patch.ok) throw new Error('Unable to persist the restored project binding');
        const updated = await patch.json() as Conversation;
        set((state) => ({
          conversations: state.conversations.map((item) => item.id === id ? updated : item),
        }));
        useLayoutStore.getState().expandBuilder();
        return;
      } catch {
        // Fall through to the honest empty workspace state.
      }
    }

    if (isStale()) return;
    useSandboxStore.getState().reset();
    useLayoutStore.getState().collapseBuilder();
  },

  updateConversationMode: async (id: string, mode: ChatMode) => {
    const res = await apiFetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });

    if (!res.ok) {
      throw new Error('Failed to update conversation mode');
    }

    const updated = await res.json() as Conversation;
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === id ? updated : conversation
      )),
    }));
    useLayoutStore.getState().setMode(updated.mode);

    if (updated.sandboxProjectId) {
      try {
        await useSandboxStore.getState().attachProject(updated.sandboxProjectId);
        useLayoutStore.getState().expandBuilder();
      } catch {
        useSandboxStore.getState().reset();
        useLayoutStore.getState().collapseBuilder();
      }
      return;
    }

    if (updated.mode !== 'builder' && updated.mode !== 'agent') {
      useSandboxStore.getState().reset();
      useLayoutStore.getState().collapseBuilder();
    }
  },

  setConversationSandbox: async (id: string, sandboxProjectId: string | null) => {
    const res = await apiFetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandboxProjectId }),
    });

    if (!res.ok) {
      throw new Error('Failed to update conversation sandbox');
    }

    const updated = await res.json() as Conversation;
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === id ? updated : conversation
      )),
    }));

    if (get().activeConversationId === id) {
      useLayoutStore.getState().setMode(updated.mode);
      if (updated.sandboxProjectId) {
        try {
          await useSandboxStore.getState().attachProject(updated.sandboxProjectId);
          useLayoutStore.getState().expandBuilder();
        } catch {
          useSandboxStore.getState().reset();
          useLayoutStore.getState().collapseBuilder();
        }
      }
    }
  },

  setConversationVisibility: async (id: string, visibility: 'private' | 'unlisted' | 'public') => {
    const res = await apiFetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility }),
    });

    if (!res.ok) return null;

    const updated = await res.json() as Conversation;
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === id ? updated : conversation
      )),
    }));

    return updated.shareSlug ?? null;
  },

  renameConversation: async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    // Optimistic — show the new title immediately, reconcile from the server.
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === id ? { ...conversation, title: trimmed } : conversation
      )),
    }));
    const res = await apiFetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    });
    if (!res.ok) {
      // Reconcile from the server on failure (restores the prior title).
      void get().fetchConversations();
      return;
    }
    const updated = await res.json() as Conversation;
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === id ? updated : conversation
      )),
    }));
  },

  deleteConversation: async (id: string) => {
    await apiFetch(`/api/conversations/${id}`, { method: 'DELETE' });
    // Clean up broadcast state for deleted conversation
    const chats = { ...get().broadcastChats };
    if (id in chats) {
      delete chats[id];
      saveBroadcastChats(chats);
    }
    const state = get();
    if (state.activeConversationId === id) {
      useLayoutStore.getState().setMode(useSettingsStore.getState().defaultConversationMode);
      useLayoutStore.getState().collapseBuilder();
      saveLastActiveConversationId(null);
      set({ activeConversationId: null, messages: [], broadcastMode: false, broadcastTargetClientIds: [], broadcastChats: chats });
    } else {
      set({ broadcastChats: chats });
    }
    await get().fetchConversations();
  },

  regenerateLastTurn: () => {
    const state = get();
    if (state.isStreaming || !state.activeConversationId) return;
    const msgs = state.messages;
    let userIndex = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { userIndex = i; break; }
    }
    if (userIndex === -1) return;
    const userMsg = msgs[userIndex];
    // Image turns can't be re-run faithfully — the raw image bytes aren't retained client-side.
    if (userMsg.imageId || userMsg.imagePreview) return;
    // Drop the superseded assistant answer locally; the server drops its row via the regenerate flag.
    set({ messages: msgs.slice(0, userIndex + 1) });
    get().sendMessage(userMsg.content, undefined, undefined, { regenerate: true });
  },

  sendMessage: (content: string, image?: ImageAttachment, systemPrompt?: string, opts?: { isAutoRepair?: boolean; repairAttempt?: number; imageMode?: boolean; regenerate?: boolean }) => {
    const state = get();
    if (!state.activeConversationId) return;

    // Find conversation to get model ID
    const conv = state.conversations.find((c) => c.id === state.activeConversationId);
    const modelId = conv?.modelId;

    // Build display content for user message
    let displayContent = content;
    if (image) {
      const parts = [`[Image: ${image.description}]`];
      if (image.question) parts.push(`[Question: ${image.question}]`);
      if (content) parts.push(content);
      displayContent = parts.join('\n');
    }

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: displayContent,
      createdAt: new Date().toISOString(),
      imagePreview: image ? `data:${image.mimeType};base64,${image.data}` : undefined,
      isAutoRepair: opts?.isAutoRepair,
      repairAttempt: opts?.repairAttempt,
    };

    const assistantMsg: ChatMessage = {
      id: `temp-${Date.now()}-assistant`,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };

    set({
      // Regenerate turns reuse the existing user message — only a fresh assistant row is appended.
      messages: opts?.regenerate
        ? [...get().messages, assistantMsg]
        : [...state.messages, userMsg, assistantMsg],
      isStreaming: true,
      streamingConversationId: state.activeConversationId,
    });
    activeStreamingAssistantId = assistantMsg.id;

    // Close any existing stream — one stream at a time.
    if (activeWs) {
      activeWs.close();
      activeWs = null;
    }

    // Use a local reference so callbacks always target *this* socket, not a later replacement.
    const ws = new WebSocket(buildChatWebSocketUrl(), buildChatWebSocketProtocols());
    activeWs = ws;

    ws.onopen = () => {
      // Guard: if we've already been superseded, bail immediately.
      if (activeWs !== ws) { ws.close(); return; }

      const payload: Record<string, unknown> = {
        conversationId: state.activeConversationId,
        content,
      };
      // Hint the server which model + mode to use if the conversation row is
      // missing on the backend (race recovery — see `conversation_resolved`).
      if (modelId) payload.modelId = modelId;
      // NOTE: this is the CHAT mode ('chat'|'agent'|'builder'|'plan'|'debate') — the
      // layout store also has `layoutMode` ('compact'|'open'|'odyssey') which is
      // visual-only and must never go on the wire.
      const chatMode = useLayoutStore.getState().mode;
      if (chatMode) payload.mode = chatMode;
      if (opts?.imageMode) payload.imageMode = true;
      if (opts?.regenerate) payload.regenerate = true;
      if (image) {
        payload.image = {
          data: image.data,
          mimeType: image.mimeType,
          description: image.description,
          question: image.question,
          width: image.width,
          height: image.height,
          sizeBytes: image.sizeBytes,
        };
      }
      if (systemPrompt) {
        payload.systemPrompt = systemPrompt;
      }
      const auth = useAuthStore.getState();
      payload.allowLearn = Boolean(auth.isOwner && get().trainingWorkspace && get().learningEnabled);
      // Per-turn deliberation depth (composer control). Omit 'balanced' (the server default).
      const depth = get().processDepth;
      if (depth && depth !== 'balanced') payload.processDepth = depth;
      // Explicit council seats (composer roundtable picker). Omit for full roundtable.
      const seats = get().councilModelIds;
      if (seats && seats.length > 0) payload.councilModelIds = seats;

      const wsRoot = useWorkspaceStore.getState().localRoot;
      if (wsRoot) payload.workspaceRoot = wsRoot;
      if (useWorkspaceStore.getState().requireDiffApproval) {
        payload.requireDiffApproval = true;
      }

      ws.send(JSON.stringify(payload));

      // Auto-create session + capture user message in dev logs
      void ensureCapture(content, modelId).then((capture) => {
        if (capture) {
          capture.message('user', content);
        }
      });
    };

    // Track reasoning text separately
    let reasoningText = '';

    ws.onmessage = (event) => {
      // Ignore messages from superseded sockets
      if (activeWs !== ws) return;

      const chunk = JSON.parse(event.data as string) as {
        type: string;
        turnOutcome?: ProgressOutcome;
        textDelta?: string;
        reasoningDelta?: string;
        draftText?: string;
        draft?: { phase: 'start' | 'delta' | 'reset' | 'committed' | 'discarded'; turnId?: string; seq: number; source?: string; isDiscardable?: boolean };
        infoBlock?: { id: string; html: string; title?: string };
        sources?: SearchSourceUI[];
        sourcePresentation?: SourcePresentationUI;
        turnKind?: TurnKindUI;
        followUps?: string[];
        confidence?: number;
        groundedBrief?: GroundedBuildBriefUI;
        progress?: ChatProgressStep;
        modelId?: string;
        fallback?: {
          fromModelId: string;
          toModelId: string;
          reason: 'low-confidence' | 'no-knowledge';
        };
        thinking?: TurnThinkingUI;
        verification?: ResponseVerificationUI;
        researchTrace?: ResearchTraceUI;
        error?: string;
        conversationId?: string;
        image?: {
          phase: string; label?: string; attempt?: number; matchScore?: number;
          flaws?: string[]; dataUrl?: string; width?: number; height?: number; accepted?: boolean;
        };
        ideEvent?: { type: string; [key: string]: unknown };
      };

      // Server auto-created a conversation because our id was unknown — adopt
      // the new id locally and refresh the list so subsequent turns use it.
      if (chunk.type === 'conversation_resolved' && chunk.conversationId) {
        flushPendingStreamDelta();
        set({ activeConversationId: chunk.conversationId });
        saveLastActiveConversationId(chunk.conversationId);
        void get().fetchConversations();
        return;
      }

      if (chunk.type === 'ide_event' && chunk.ideEvent) {
        window.dispatchEvent(new CustomEvent('vai:ws-ide-event', { detail: chunk.ideEvent }));
      } else if (chunk.type === 'progress' && chunk.progress) {
        set((state) => {
          const msgs = [...state.messages];
          const targetIndex = activeStreamingAssistantId
            ? msgs.findIndex((message) => message.id === activeStreamingAssistantId)
            : msgs.length - 1;
          const target = targetIndex >= 0 ? msgs[targetIndex] : null;
          const incoming = chunk.progress;
          if (target && target.role === 'assistant' && incoming) {
            msgs[targetIndex] = {
              ...target,
              progressSteps: mergeProgressStepsForMessage(target.progressSteps ?? [], incoming),
            };
          }
          return { messages: msgs };
        });
      } else if (chunk.type === 'turn_kind' && chunk.turnKind) {
        set((state) => {
          const msgs = [...state.messages];
          const targetIndex = activeStreamingAssistantId
            ? msgs.findIndex((message) => message.id === activeStreamingAssistantId)
            : msgs.length - 1;
          const target = targetIndex >= 0 ? msgs[targetIndex] : null;
          if (target && target.role === 'assistant') {
            msgs[targetIndex] = {
              ...target,
              turnKind: chunk.turnKind,
            };
          }
          return { messages: msgs };
        });
      } else if (chunk.type === 'sources') {
        const sourceList = chunk.sources ?? [];
        set((state) => {
          const msgs = [...state.messages];
          const targetIndex = activeStreamingAssistantId
            ? msgs.findIndex((message) => message.id === activeStreamingAssistantId)
            : msgs.length - 1;
          const target = targetIndex >= 0 ? msgs[targetIndex] : null;
          if (target && target.role === 'assistant') {
            const hasSources = sourceList.length > 0;
            const hasGroundedBrief = Boolean(chunk.groundedBrief);
            const shouldAttachEvidenceMeta = hasSources || hasGroundedBrief || Boolean(chunk.researchTrace);
            msgs[targetIndex] = {
              ...target,
              sources: hasSources ? sourceList : target.sources,
              sourcePresentation: shouldAttachEvidenceMeta
                ? (chunk.sourcePresentation ?? target.sourcePresentation)
                : target.sourcePresentation,
              followUps: chunk.followUps ?? target.followUps,
              confidence: shouldAttachEvidenceMeta
                ? (chunk.confidence ?? target.confidence)
                : target.confidence,
              groundedBuildBrief: chunk.groundedBrief ?? target.groundedBuildBrief,
              researchTrace: chunk.researchTrace ?? target.researchTrace,
              respondingModelId: chunk.modelId ?? target.respondingModelId,
            };
          }
          return { messages: msgs };
        });
      } else if (chunk.type === 'fallback_notice' && chunk.fallback) {
        const fallback = chunk.fallback;
        set((state) => {
          const msgs = [...state.messages];
          const targetIndex = activeStreamingAssistantId
            ? msgs.findIndex((message) => message.id === activeStreamingAssistantId)
            : msgs.length - 1;
          const target = targetIndex >= 0 ? msgs[targetIndex] : null;
          if (target && target.role === 'assistant') {
            msgs[targetIndex] = {
              ...target,
              fallback,
              respondingModelId: fallback.toModelId,
            };
          }
          return { messages: msgs };
        });
      } else if (chunk.type === 'verification' && chunk.verification) {
        set((state) => {
          const msgs = [...state.messages];
          const targetIndex = activeStreamingAssistantId
            ? msgs.findIndex((message) => message.id === activeStreamingAssistantId)
            : msgs.length - 1;
          const target = targetIndex >= 0 ? msgs[targetIndex] : null;
          if (target && target.role === 'assistant') {
            msgs[targetIndex] = {
              ...target,
              verification: chunk.verification,
            };
          }
          return { messages: msgs };
        });
      } else if ((chunk.type === 'image_progress' || chunk.type === 'image_result') && chunk.image) {
        const img = chunk.image;
        set((state) => {
          const msgs = [...state.messages];
          const idx = activeStreamingAssistantId
            ? msgs.findIndex((m) => m.id === activeStreamingAssistantId)
            : msgs.length - 1;
          const target = idx >= 0 ? msgs[idx] : null;
          if (target && target.role === 'assistant') {
            if (chunk.type === 'image_result' && img.dataUrl) {
              msgs[idx] = { ...target, imageGenResult: { dataUrl: img.dataUrl, width: img.width, height: img.height, accepted: img.accepted } };
            } else {
              const steps = [...(target.imageGenSteps ?? []), { phase: img.phase, label: img.label ?? '', attempt: img.attempt, matchScore: img.matchScore, flaws: img.flaws }];
              msgs[idx] = { ...target, imageGenSteps: steps };
            }
          }
          return { messages: msgs };
        });
      } else if (chunk.type === 'draft_delta') {
        // Live WORK PRODUCT (not the final answer): stash the in-review draft on the target
        // assistant message as EPHEMERAL state. Never routed through appendToLastMessage, so the
        // council can still discard/redraft it without corrupting the committed answer. Server
        // sends cumulative draftText (replace, not append); we drop out-of-order seqs.
        const d = chunk.draft;
        set((state) => {
          const msgs = [...state.messages];
          const idx = activeStreamingAssistantId
            ? msgs.findIndex((m) => m.id === activeStreamingAssistantId)
            : msgs.length - 1;
          if (idx < 0) return {};
          const target = msgs[idx];
          const prev = target.liveDraft ?? null;
          if (prev && d && d.seq < prev.seq) return {}; // stale frame
          const phase = d?.phase ?? 'delta';
          const nextText = chunk.draftText ?? prev?.text ?? '';
          const priorText = phase === 'reset'
            ? prev?.priorText ?? prev?.text
            : prev?.priorText;
          msgs[idx] = {
            ...target,
            liveDraft: {
              text: nextText,
              phase,
              seq: d?.seq ?? (prev?.seq ?? 0) + 1,
              turnId: d?.turnId ?? prev?.turnId,
              priorText,
            },
          };
          return { messages: msgs };
        });
      } else if (chunk.type === 'info_block' && chunk.infoBlock) {
        // Append-only, addressable by id (replace on repeat id).
        const block = chunk.infoBlock;
        set((state) => {
          const msgs = [...state.messages];
          const idx = activeStreamingAssistantId
            ? msgs.findIndex((m) => m.id === activeStreamingAssistantId)
            : msgs.length - 1;
          if (idx < 0) return {};
          const existing = msgs[idx].infoBlocks ?? [];
          const at = existing.findIndex((b) => b.id === block.id);
          const next = at >= 0
            ? existing.map((b, i) => (i === at ? block : b))
            : [...existing, block];
          msgs[idx] = { ...msgs[idx], infoBlocks: next };
          return { messages: msgs };
        });
      } else if (chunk.type === 'text_delta' && chunk.textDelta) {
        get().appendToLastMessage(chunk.textDelta);
      } else if (chunk.type === 'reasoning_delta' && chunk.reasoningDelta) {
        // Accumulate reasoning text for dev logs capture
        reasoningText += chunk.reasoningDelta;
      } else if (chunk.type === 'done') {
        flushPendingStreamDelta();
        // The final answer has committed into message.content — retire the in-review draft block
        // so the UI shows the answer, not the stale draft.
        set((state) => {
          const targetIndex = activeStreamingAssistantId
            ? state.messages.findIndex((message) => message.id === activeStreamingAssistantId)
            : state.messages.length - 1;
          const msgs = state.messages.map((m, index) => {
            if (index !== targetIndex || m.role !== 'assistant') {
              return m.liveDraft ? { ...m, liveDraft: null } : m;
            }
            const thinking = mergeAuditPriorDraftExcerpt(chunk.thinking, m.liveDraft?.priorText);
            return {
              ...m,
              liveDraft: null,
              progressSteps: finalizeProgressStepsForMessage(
                m.progressSteps ?? [],
                chunk.turnOutcome ?? 'succeeded',
              ),
              ...(chunk.modelId ? { respondingModelId: chunk.modelId } : {}),
              ...(thinking ? { thinking } : {}),
              ...(thinking?.auditMeta ? { auditMeta: thinking.auditMeta } : {}),
            };
          });
          return { messages: msgs, isStreaming: false, streamingConversationId: null };
        });
        // Capture assistant response + reasoning in dev logs
        const capture = getActiveCapture();
        if (capture) {
          const msgs = get().messages;
          const lastMsg = activeStreamingAssistantId
            ? msgs.find((message) => message.id === activeStreamingAssistantId)
            : msgs[msgs.length - 1];
          if (lastMsg?.role === 'assistant' && lastMsg.content) {
            capture.message('assistant', lastMsg.content, lastMsg.respondingModelId ?? modelId);
          }
          if (reasoningText) {
            capture.thinking(reasoningText, { label: 'Model Reasoning' });
          }
        }
        ws.close();
        if (activeWs === ws) activeWs = null;
        activeStreamingAssistantId = null;
        // Refresh conversations to get updated titles/timestamps
        get().fetchConversations();
        // Drain a queued follow-up the user composed mid-turn — send it now that
        // the turn has settled. Defer a tick so isStreaming:false commits first.
        const queued = get().queuedMessage;
        if (queued && queued.trim()) {
          set({ queuedMessage: null });
          setTimeout(() => {
            if (!get().isStreaming) get().sendMessage(queued);
          }, 0);
        }
      } else if (chunk.type === 'error') {
        flushPendingStreamDelta();
        set((state) => ({
          isStreaming: false,
          streamingConversationId: null,
          messages: state.messages.map((message) =>
            message.id === activeStreamingAssistantId && message.role === 'assistant'
              ? {
                  ...message,
                  progressSteps: finalizeProgressStepsForMessage(message.progressSteps ?? [], 'failed'),
                }
              : message,
          ),
        }));
        get().appendToLastMessage(`\n\nError: ${chunk.error}`);
        flushPendingStreamDelta();
        // Log error in dev logs
        const capture = getActiveCapture();
        if (capture) {
          capture.error(`Chat error: ${chunk.error}`, { errorType: 'stream' });
        }
        ws.close();
        if (activeWs === ws) activeWs = null;
        activeStreamingAssistantId = null;
      }
    };

    ws.onerror = () => {
      if (activeWs !== ws) return;
      flushPendingStreamDelta();
      set((state) => ({
        isStreaming: false,
        streamingConversationId: null,
        messages: state.messages.map((message) =>
          message.id === activeStreamingAssistantId && message.role === 'assistant'
            ? {
                ...message,
                progressSteps: finalizeProgressStepsForMessage(message.progressSteps ?? [], 'interrupted'),
              }
            : message,
        ),
      }));
      get().appendToLastMessage('\n\nConnection error');
      flushPendingStreamDelta();
      const capture = getActiveCapture();
      if (capture) {
        capture.error('WebSocket connection error', { errorType: 'connection' });
      }
      if (activeWs === ws) activeWs = null;
      activeStreamingAssistantId = null;
    };

    ws.onclose = () => {
      // `done`, explicit error, and manual stop clear activeWs before their
      // intentional close reaches this callback. Only an unexpected close
      // remains active and therefore owns this interrupted terminal path.
      if (activeWs !== ws) return;
      flushPendingStreamDelta();
      set((state) => ({
        isStreaming: false,
        streamingConversationId: null,
        messages: state.messages.map((message) =>
          message.id === activeStreamingAssistantId && message.role === 'assistant'
            ? {
                ...message,
                progressSteps: finalizeProgressStepsForMessage(message.progressSteps ?? [], 'interrupted'),
              }
            : message,
        ),
      }));
      get().appendToLastMessage('\n\nConnection closed before completion');
      flushPendingStreamDelta();
      activeWs = null;
      activeStreamingAssistantId = null;
    };
  },

  stopStreaming: () => {
    flushPendingStreamDelta();
    const stoppedAssistantId = activeStreamingAssistantId;
    if (activeWs) {
      activeWs.close();
      activeWs = null;
    }
    activeStreamingAssistantId = null;
    // A manual stop cancels any queued follow-up — the user chose to halt.
    set((state) => ({
      isStreaming: false,
      streamingConversationId: null,
      queuedMessage: null,
      messages: state.messages.map((message) =>
        message.id === stoppedAssistantId && message.role === 'assistant'
          ? {
              ...message,
              progressSteps: finalizeProgressStepsForMessage(message.progressSteps ?? [], 'interrupted'),
            }
          : message,
      ),
    }));
  },

  setQueuedMessage: (content: string | null) => {
    set({ queuedMessage: content && content.trim() ? content : null });
  },

  injectAgentMessage: (content: string, sender: MessageSender) => {
    const msg: ChatMessage = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content,
      sender,
    };
    set((state) => ({ messages: [...state.messages, msg] }));
  },

  injectProjectUpdate: async (content: string, conversationId?: string | null) => {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }

    const targetConversationId = conversationId ?? get().activeConversationId;
    const appendLocally = (message: ChatMessage) => {
      if (targetConversationId && get().activeConversationId !== targetConversationId) {
        return;
      }

      set((state) => {
        const msgs = [...state.messages];
        let replaced = false;

        for (let index = msgs.length - 1; index >= 0; index -= 1) {
          const candidate = msgs[index];
          if (candidate.role !== 'assistant') break;
          if (isProjectUpdateContent(candidate.content)) break;

          if (extractFilesFromMarkdown(candidate.content).length > 0) {
            msgs[index] = mergeProjectUpdateMessage(candidate, message);
            replaced = true;
            break;
          }
        }

        return { messages: replaced ? msgs : [...msgs, message] };
      });
    };

    if (!targetConversationId) {
      appendLocally({
        id: `project-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: trimmed,
      });
      return;
    }

    try {
      const res = await apiFetch(`/api/conversations/${targetConversationId}/assistant-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      });

      if (!res.ok) {
        throw new Error(`Assistant note request failed: ${res.status}`);
      }

      const persisted = await res.json() as {
        id: string;
        role: ChatMessage['role'];
        content: string;
        imageId?: string | null;
      };

      appendLocally({
        id: persisted.id,
        role: persisted.role,
        content: persisted.content,
        imageId: persisted.imageId,
      });

      await get().fetchConversations();
    } catch (error) {
      console.warn('[chat] failed to persist project update', error);
      appendLocally({
        id: `project-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: trimmed,
      });
    }
  },

  sendBroadcast: async (content: string, targetClientIds?: string[], preferredModel?: string, targetChatApp?: string, targetSessionId?: string) => {
    // Add the user message to chat
    const userMsg: ChatMessage = {
      id: `broadcast-user-${Date.now()}`,
      role: 'user',
      content,
      sender: { type: 'user', name: 'You', ide: 'desktop' },
    };
    set((state) => ({ messages: [...state.messages, userMsg] }));

    try {
      const res = await apiFetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          targetClientIds: targetClientIds?.length ? targetClientIds : undefined,
          meta: {
            ...(preferredModel ? { preferredModel } : {}),
            ...(targetChatApp ? { targetChatApp } : {}),
            ...(targetSessionId ? { targetSessionId } : {}),
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Broadcast failed' })) as { error?: string };
        get().injectAgentMessage(
          `Failed to broadcast: ${err.error ?? 'Unknown error'}`,
          { type: 'vai', name: 'System', color: '#EF4444' },
        );
        return;
      }

      const broadcast = await res.json() as { id: string; deliveryCount: number };
      get().injectAgentMessage(
        `Message broadcast to ${broadcast.deliveryCount} IDE${broadcast.deliveryCount === 1 ? '' : 's'}. Waiting for responses...`,
        { type: 'vai', name: 'VeggaAI', ide: 'desktop', color: '#10B981' },
      );

      // Start polling for responses
      set({ activeBroadcastId: broadcast.id });
      if (broadcastPollTimer) clearInterval(broadcastPollTimer);

      let pollCount = 0;
      const maxPolls = 40; // ~2 minutes at 3s intervals

      broadcastPollTimer = setInterval(async () => {
        pollCount++;
        if (pollCount > maxPolls) {
          if (broadcastPollTimer) clearInterval(broadcastPollTimer);
          broadcastPollTimer = null;
          set({ activeBroadcastId: null });
          return;
        }

        try {
          const pollRes = await apiFetch(`/api/broadcasts/${broadcast.id}`);
          if (!pollRes.ok) return;

          const data = await pollRes.json() as {
            id: string;
            status: string;
            deliveries: Array<{
              id: string;
              status: string;
              responseContent: string | null;
              responseMeta: { model?: string; autoAck?: boolean } | null;
              client: { id: string; clientName: string; clientType: string; launchTarget: string };
            }>;
          };

          // Inject any new responses into chat (or update auto-ack → real reply)
          for (const delivery of data.deliveries) {
            if (delivery.status === 'responded' && delivery.responseContent) {
              const msgId = `broadcast-resp-${delivery.id}`;
              const existing = get().messages.find((m) => m.id === msgId);
              const isAutoAck = delivery.responseMeta?.autoAck === true;
              
              if (!existing) {
                const clientName = delivery.client?.clientName ?? 'IDE';
                const clientType = delivery.client?.launchTarget ?? 'ide';

                const msg: ChatMessage = {
                  id: msgId,
                  role: 'assistant',
                  content: delivery.responseContent,
                  sender: {
                    type: 'ide-agent',
                    name: clientName,
                    ide: clientType,
                    model: delivery.responseMeta?.model,
                    color: IDE_AGENT_COLORS[clientType] ?? '#8B5CF6',
                  },
                };
                set((state) => ({ messages: [...state.messages, msg] }));
              } else if (existing.content !== delivery.responseContent && !isAutoAck) {
                // Real reply replaced auto-ack — update the message content and model tag
                const replyContent = delivery.responseContent ?? '';
                const replyModel = delivery.responseMeta?.model;
                set((state) => ({
                  messages: state.messages.map((m) =>
                    m.id === msgId ? {
                      ...m,
                      content: replyContent,
                      sender: m.sender ? { ...m.sender, model: replyModel ?? m.sender.model } : m.sender,
                    } : m,
                  ),
                }));
              }
            }
          }

          // Stop polling when all deliveries have real replies (not just auto-acks)
          const allDone = data.deliveries.every((d) => {
            if (d.status === 'expired') return true;
            if (d.status === 'responded') {
              return !d.responseMeta?.autoAck;
            }
            return false;
          });
          if (allDone && data.deliveries.length > 0) {
            if (broadcastPollTimer) clearInterval(broadcastPollTimer);
            broadcastPollTimer = null;
            set({ activeBroadcastId: null });
          }
        } catch {
          // Silent — will retry on next interval
        }
      }, 3000);
    } catch {
      get().injectAgentMessage(
        'Unable to reach the broadcast service. Is the runtime running?',
        { type: 'vai', name: 'System', color: '#EF4444' },
      );
    }
  },

  setBroadcastMode: (enabled: boolean, targetClientIds?: string[]) => {
    const activeId = get().activeConversationId;
    const chats = { ...get().broadcastChats };
    if (activeId) {
      if (enabled) {
        chats[activeId] = targetClientIds ?? [];
      } else {
        delete chats[activeId];
      }
      saveBroadcastChats(chats);
    }
    set({
      broadcastChats: chats,
      broadcastMode: enabled,
      broadcastTargetClientIds: targetClientIds ?? [],
    });
  },

  setBroadcastTargetClientIds: (ids: string[]) => {
    const activeId = get().activeConversationId;
    const chats = { ...get().broadcastChats };
    if (activeId && chats[activeId] !== undefined) {
      chats[activeId] = ids;
      saveBroadcastChats(chats);
    }
    set({ broadcastTargetClientIds: ids, broadcastChats: chats });
  },

  appendToLastMessage: (text: string) => {
    pendingStreamDelta += text;
    scheduleStreamDeltaFlush();
  },

  setFeedback: (messageId: string, helpful: boolean) => {
    set((state) => {
      const msgs = state.messages.map(m =>
        m.id === messageId ? { ...m, feedback: helpful } : m,
      );
      return { messages: msgs };
    });
    // Fire-and-forget feedback to server
    apiFetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, helpful }),
    }).catch(() => { /* silent */ });
  },

  postSteer: async (args) => {
    try {
      const res = await apiFetch('/api/steer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: args.conversationId,
          from: 'human',
          author: 'desktop',
          signal: args.signal,
          handler: args.handler,
          note: args.note || 'steered from UI',
          scope: args.scope || 'class',
          matchTokens: args.matchTokens,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        return { ok: false, error: json?.error || 'steer failed' };
      }
      return { ok: true, guidance: json.guidance };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network error' };
    }
  },

  setProcessDepth: (depth: 'quick' | 'balanced' | 'deep') => {
    try { localStorage.setItem('vai:processDepth', depth); } catch { /* no storage */ }
    set({ processDepth: depth });
  },
  setCouncilModelIds: (ids: string[] | null) => {
    const normalized = ids && ids.length > 0 ? ids : null;
    try {
      if (normalized) localStorage.setItem('vai:councilModelIds', JSON.stringify(normalized));
      else localStorage.removeItem('vai:councilModelIds');
    } catch { /* no storage */ }
    set({ councilModelIds: normalized });
  },
  setLearningEnabled: (enabled: boolean) => {
    const auth = useAuthStore.getState();
    if (!auth.isOwner || !get().trainingWorkspace) {
      set({ learningEnabled: false });
      return;
    }
    set({ learningEnabled: enabled });
  },

  setTrainingWorkspace: (enabled: boolean) => {
    const auth = useAuthStore.getState();
    if (!auth.isOwner) {
      set({ trainingWorkspace: false, learningEnabled: false });
      return;
    }
    set({ trainingWorkspace: enabled, learningEnabled: enabled ? get().learningEnabled : false });
  },
}));

// Expose store for demo system (injectResponse needs setState access)
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__vai_chat_store = useChatStore;
}
