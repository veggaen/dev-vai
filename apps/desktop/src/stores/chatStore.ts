import { create } from 'zustand';
import type { ConversationSummary, CreateConversationResponse } from '@vai/api-types/responses';
import type { ChatProgressStep as ChatProgressStepContract } from '@vai/api-types/chat-ws';
import { apiFetch, buildChatWebSocketUrl } from '../lib/api.js';
import { getActiveCapture, startSessionCapture } from '../lib/sessionCapture.js';
import type { SessionCapture } from '../lib/sessionCapture.js';
import { mergeProjectUpdateMessage } from '../lib/project-update-message.js';
import { useLayoutStore, type ChatMode } from './layoutStore.js';
import { useAuthStore } from './authStore.js';
import { useSandboxStore } from './sandboxStore.js';
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
}

/** The scored routing decision Vai made — shown so all friends can see and steer it. */
export interface TurnRoutePlanUI {
  chosen: string | null;
  /** No candidate cleared the confidence floor → honest "I don't know". */
  belowFloor: boolean;
  candidates: TurnRouteCandidateUI[];
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
  /** Exit-gate result. Exposed in the process panel, never prepended to answer text. */
  verification?: ResponseVerificationUI;
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
}

/** Server list row — kept in sync via @vai/api-types/responses (compile-time contract). */
type Conversation = ConversationSummary;

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  /** Owner-only explicit teach toggle, only active inside training workspace. */
  learningEnabled: boolean;
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
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string, image?: ImageAttachment, systemPrompt?: string, opts?: { isAutoRepair?: boolean; repairAttempt?: number }) => void;
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
  appendToLastMessage: (text: string) => void;
  setFeedback: (messageId: string, helpful: boolean) => void;
  setLearningEnabled: (enabled: boolean) => void;
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

/** Active broadcast response poller */
let broadcastPollTimer: ReturnType<typeof setInterval> | null = null;

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
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  learningEnabled: false,
  trainingWorkspace: false,
  activeBroadcastId: null,
  broadcastMode: false,
  broadcastTargetClientIds: [],
  broadcastChats: loadBroadcastChats(),

  fetchConversations: async () => {
    try {
      const res = await apiFetch('/api/conversations?limit=50');
      const conversations = (await res.json()) as ConversationSummary[];
      set({ conversations });
    } catch {
      console.error('Failed to fetch conversations');
    }
  },

  createConversation: async (modelId: string, mode: ChatMode = 'chat', options) => {
    const resolvedSandboxProjectId = resolveConversationSandboxProjectIdOption(
      options,
      useSandboxStore.getState().projectId,
    );
    const res = await apiFetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, mode, sandboxProjectId: resolvedSandboxProjectId }),
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
    if (activeWs) {
      activeWs.close();
      activeWs = null;
    }
    activeStreamingAssistantId = null;
    useLayoutStore.getState().setMode('chat');
    useLayoutStore.getState().collapseBuilder();
    useSandboxStore.getState().reset();
    set({
      activeConversationId: null,
      messages: [],
      isStreaming: false,
      broadcastMode: false,
      broadcastTargetClientIds: [],
    });
  },

  startOwnerTrainingSession: async (modelId?: string, mode: ChatMode = 'chat') => {
    const auth = useAuthStore.getState();
    if (!auth.isOwner) {
      return null;
    }

    const selectedModelId = modelId
      ?? get().conversations.find((conversation) => conversation.id === get().activeConversationId)?.modelId
      ?? 'vai:v0';

    const id = await get().createConversation(selectedModelId, mode, { sandboxProjectId: null });
    set({ trainingWorkspace: true, learningEnabled: false });
    return id;
  },

  selectConversation: async (id: string) => {
    const [res] = await Promise.all([
      apiFetch(`/api/conversations/${id}/messages`),
      get().fetchConversations(),
    ]);
    const rawMessages = (await res.json()) as Array<{
      id: string;
      role: string;
      content: string;
      imageId?: string | null;
    }>;
    const conversation = get().conversations.find((item) => item.id === id);
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
      }))),
      broadcastMode: isBroadcastChat,
      broadcastTargetClientIds: isBroadcastChat ? broadcastChats[id] : [],
    });
    if (conversation?.mode) {
      useLayoutStore.getState().setMode(conversation.mode);
    }

    if (conversation?.sandboxProjectId) {
      try {
        await useSandboxStore.getState().attachProject(conversation.sandboxProjectId);
      } catch {
        useSandboxStore.getState().reset();
        useLayoutStore.getState().collapseBuilder();
      }
      return;
    }

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
      useLayoutStore.getState().setMode('chat');
      useLayoutStore.getState().collapseBuilder();
      set({ activeConversationId: null, messages: [], broadcastMode: false, broadcastTargetClientIds: [], broadcastChats: chats });
    } else {
      set({ broadcastChats: chats });
    }
    await get().fetchConversations();
  },

  sendMessage: (content: string, image?: ImageAttachment, systemPrompt?: string, opts?: { isAutoRepair?: boolean; repairAttempt?: number }) => {
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
      imagePreview: image ? `data:${image.mimeType};base64,${image.data}` : undefined,
      isAutoRepair: opts?.isAutoRepair,
      repairAttempt: opts?.repairAttempt,
    };

    const assistantMsg: ChatMessage = {
      id: `temp-${Date.now()}-assistant`,
      role: 'assistant',
      content: '',
    };

    set({
      messages: [...state.messages, userMsg, assistantMsg],
      isStreaming: true,
    });
    activeStreamingAssistantId = assistantMsg.id;

    // Close any existing stream — one stream at a time.
    if (activeWs) {
      activeWs.close();
      activeWs = null;
    }

    // Use a local reference so callbacks always target *this* socket, not a later replacement.
    const ws = new WebSocket(buildChatWebSocketUrl());
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
      const layoutMode = useLayoutStore.getState().mode;
      if (layoutMode) payload.mode = layoutMode;
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
        textDelta?: string;
        reasoningDelta?: string;
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
      };

      // Server auto-created a conversation because our id was unknown — adopt
      // the new id locally and refresh the list so subsequent turns use it.
      if (chunk.type === 'conversation_resolved' && chunk.conversationId) {
        flushPendingStreamDelta();
        set({ activeConversationId: chunk.conversationId });
        void get().fetchConversations();
        return;
      }

      if (chunk.type === 'progress' && chunk.progress) {
        set((state) => {
          const msgs = [...state.messages];
          const targetIndex = activeStreamingAssistantId
            ? msgs.findIndex((message) => message.id === activeStreamingAssistantId)
            : msgs.length - 1;
          const target = targetIndex >= 0 ? msgs[targetIndex] : null;
          if (target && target.role === 'assistant') {
            const existing = target.progressSteps ?? [];
            const next = [
              ...existing.filter((step) => step.stage !== chunk.progress?.stage),
              chunk.progress,
            ].filter((step): step is ChatProgressStep => Boolean(step)).slice(-6);
            msgs[targetIndex] = {
              ...target,
              progressSteps: next,
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
      } else if (chunk.type === 'sources' && chunk.sources) {
        // Attach sources + follow-ups + confidence to the current assistant message
        set((state) => {
          const msgs = [...state.messages];
          const targetIndex = activeStreamingAssistantId
            ? msgs.findIndex((message) => message.id === activeStreamingAssistantId)
            : msgs.length - 1;
          const target = targetIndex >= 0 ? msgs[targetIndex] : null;
          if (target && target.role === 'assistant') {
            const hasSources = (chunk.sources?.length ?? 0) > 0;
            const hasGroundedBrief = Boolean(chunk.groundedBrief);
            const shouldAttachEvidenceMeta = hasSources || hasGroundedBrief || Boolean(chunk.researchTrace);
            msgs[targetIndex] = {
              ...target,
              sources: hasSources ? chunk.sources : undefined,
              sourcePresentation: shouldAttachEvidenceMeta ? chunk.sourcePresentation : undefined,
              followUps: chunk.followUps,
              confidence: shouldAttachEvidenceMeta ? chunk.confidence : undefined,
              groundedBuildBrief: chunk.groundedBrief,
              researchTrace: chunk.researchTrace,
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
      } else if (chunk.type === 'text_delta' && chunk.textDelta) {
        get().appendToLastMessage(chunk.textDelta);
      } else if (chunk.type === 'reasoning_delta' && chunk.reasoningDelta) {
        // Accumulate reasoning text for dev logs capture
        reasoningText += chunk.reasoningDelta;
      } else if (chunk.type === 'done') {
        flushPendingStreamDelta();
        set({ isStreaming: false });
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
        if (chunk.modelId || chunk.thinking) {
          set((state) => {
            const msgs = [...state.messages];
            const targetIndex = activeStreamingAssistantId
              ? msgs.findIndex((message) => message.id === activeStreamingAssistantId)
              : msgs.length - 1;
            const target = targetIndex >= 0 ? msgs[targetIndex] : null;
            if (target && target.role === 'assistant') {
              msgs[targetIndex] = {
                ...target,
                ...(chunk.modelId ? { respondingModelId: chunk.modelId } : {}),
                ...(chunk.thinking ? { thinking: chunk.thinking } : {}),
              };
            }
            return { messages: msgs };
          });
        }
        ws.close();
        if (activeWs === ws) activeWs = null;
        activeStreamingAssistantId = null;
        // Refresh conversations to get updated titles/timestamps
        get().fetchConversations();
      } else if (chunk.type === 'error') {
        flushPendingStreamDelta();
        set({ isStreaming: false });
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
      set({ isStreaming: false });
      get().appendToLastMessage('\n\nConnection error');
      flushPendingStreamDelta();
      const capture = getActiveCapture();
      if (capture) {
        capture.error('WebSocket connection error', { errorType: 'connection' });
      }
      if (activeWs === ws) activeWs = null;
      activeStreamingAssistantId = null;
    };
  },

  stopStreaming: () => {
    flushPendingStreamDelta();
    if (activeWs) {
      activeWs.close();
      activeWs = null;
    }
    activeStreamingAssistantId = null;
    set({ isStreaming: false });
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
