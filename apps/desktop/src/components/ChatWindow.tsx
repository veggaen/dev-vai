/**
 * ChatWindow — Claude-inspired chat interface.
 *
 * Layout philosophy:
 *   • Empty state: centered welcome + presets in the middle of the window.
 *   • First message: welcome fades out, messages appear ABOVE the input.
 *   • New messages push previous ones UP. The input stays anchored near the
 *     bottom so the user's eyes stay focused on the latest content.
 *   • Smart auto-scroll: auto-follows during streaming unless user scrolled up.
 *   • Scroll-to-bottom FAB when user has scrolled away.
 *   • Auto-growing textarea (1 line → max ~8 lines) with Enter to send.
 *   • Draggable divider between messages and input.
 *
 * Key CSS trick for "messages above input":
 *   The scroll container uses `flex-col justify-end` so when messages are sparse
 *   they sit at the BOTTOM of the viewport, right above the input. As messages
 *   accumulate they naturally push upward and overflow triggers scroll.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useChatStore } from '../stores/chatStore.js';
import { IDE_AGENT_COLORS } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { toast } from 'sonner';
import { useLayoutStore, MODE_PLACEHOLDERS, type ChatMode } from '../stores/layoutStore.js';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { useCollabStore } from '../stores/collabStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { MessageBubble } from './MessageBubble.js';
import { ModeSelector } from './ModeSelector.js';
import { ScrollToBottom } from './ScrollToBottom.js';
import { TypingIndicator } from './TypingIndicator.js';
import { useAutoScroll } from '../hooks/useAutoScroll.js';
import { useIntentStore, computeFallbackMap } from '../stores/intentStore.js';
import { apiFetch } from '../lib/api.js';
import {
  BookOpen, MessageCircle, Sparkles, Shield, Globe,
  Paperclip, X, FileText, ArrowUp, Square,
  Eye, Brain, Bot, Wifi, Plus, Moon, Sun, ChevronDown, ChevronRight,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { FocusModeToggle } from './LayoutModeToggle.js';
import { BroadcastStrip } from './BroadcastStrip.js';
import type { PerIdeConfig } from './BroadcastTargetPicker.js';
import { ResearchContextRail } from './chat/ResearchContextRail.js';
import { ChatEmptyState } from './chat/ChatEmptyState.js';
import { resolveSendTimeWorkIntent } from '../lib/auto-sandbox-intent.js';
import {
  buildIdeMentionItems,
  filterMentionItems,
  mentionSlugSet,
  stripLeadingIdeMentions,
  type IdeMentionItem,
} from '../lib/ideMentions.js';
import { IdeMentionMenu } from './IdeMentionMenu.js';
import { pickSandboxContextPaths } from '../lib/sandbox-context.js';

/** Fallback chat apps when the extension hasn't reported yet */
const FALLBACK_CHAT_APPS: { id: string; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'augment', label: 'Augment' },
];

/** Fallback sessions when the extension hasn't reported yet */
const FALLBACK_SESSIONS: { sessionId: string; title: string; lastModified: number; chatApp: string }[] = [
  { sessionId: 'new-session', title: 'New Session', lastModified: Date.now(), chatApp: 'chat' },
];

/** Fallback model list when dynamic discovery hasn't reported yet */
const FALLBACK_MODELS: { family: string; label: string }[] = [
  { family: 'gpt-4o', label: 'GPT-4o' },
  { family: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { family: 'o3-mini', label: 'o3-mini' },
  { family: 'o4-mini', label: 'o4-mini' },
  { family: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { family: 'claude-3.7-sonnet', label: 'Claude 3.7 Sonnet' },
  { family: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
  { family: 'claude-opus-4', label: 'Claude Opus 4' },
  { family: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { family: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

type DeliveryRoute = 'vai' | 'group' | 'broadcast';
type SendOptions = {
  forceMode?: ChatMode;
};

function formatRelativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function summarizeResearchPrompt(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 72) return cleaned;
  return `${cleaned.slice(0, 69).trimEnd()}...`;
}

/* ── File extension detection ── */
const CODE_PATTERNS: { test: RegExp; ext: string }[] = [
  { test: /^import\s+.*from\s+['"]|^export\s+(default\s+)?/m, ext: 'tsx' },
  { test: /^const\s+\w+\s*[:=]|^let\s+|^var\s+|^function\s+\w+\s*\(|=>\s*\{/m, ext: 'ts' },
  { test: /^<\w+[\s>]|<\/\w+>/m, ext: 'html' },
  { test: /^\.\w+\s*\{|^@media|^@import/m, ext: 'css' },
  { test: /^{[\s\n]*"/m, ext: 'json' },
  { test: /^#!/m, ext: 'sh' },
  { test: /^def\s+\w+|^class\s+\w+|^import\s+\w+$/m, ext: 'py' },
];

function detectFileExtension(text: string): string {
  for (const p of CODE_PATTERNS) {
    if (p.test.test(text)) return p.ext;
  }
  return 'md';
}

function truncateSnapshotContent(content: string, limit = 1600): string {
  if (content.length <= limit) return content;
  return `${content.slice(0, limit).trimEnd()}\n/* truncated for prompt context */`;
}

interface PastedImage {
  data: string;
  mimeType: string;
  preview: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

interface FileAttachment {
  id: string;
  name: string;
  content: string;
  language: string;
  sizeBytes: number;
}

const LARGE_PASTE_THRESHOLD = 500;
const MIN_INPUT_HEIGHT = 44;
const MAX_INPUT_HEIGHT = 240;

export function ChatWindow() {
  const {
    messages,
    activeConversationId,
    isStreaming,
    sendMessage,
    sendBroadcast,
    broadcastMode,
    broadcastTargetClientIds,
    setBroadcastMode,
    setBroadcastTargetClientIds,
    stopStreaming,
    createConversation,
    updateConversationMode,
    learningEnabled,
    setLearningEnabled,
    trainingWorkspace,
    setTrainingWorkspace,
  } = useChatStore();
  const { selectedModelId, selectedFrontendId, frontends, ideTargets } = useSettingsStore();
  const {
    mode,
    showBuilderPanel,
    toggleBuilderPanel,
    expandBuilder,
    setActivePanel,
    buildStatus,
    setBuildStatus,
    setMode,
    themePreference,
    toggleThemePreference,
  } = useLayoutStore();
  const studioBuilderChrome = themePreference === 'light';
  const isOwner = useAuthStore((state) => state.isOwner);
  const ownerFeaturesHidden = useAuthStore((state) => state.ownerFeaturesHidden);
  const authUser = useAuthStore((state) => state.user);
  const persistentProjectId = useSandboxStore((state) => state.persistentProjectId);
  const buildActivity = useSandboxStore((state) => state.buildActivity);
  const sandboxStatus = useSandboxStore((state) => state.status);
  const sandboxFiles = useSandboxStore((state) => state.files);
  const sandboxProjectName = useSandboxStore((state) => state.projectName);
  const sandboxProjectId = useSandboxStore((state) => state.projectId);
  const sandboxDevPort = useSandboxStore((state) => state.devPort);
  const deployPhase = useSandboxStore((state) => state.deployPhase);
  const deploySteps = useSandboxStore((state) => state.deploySteps);
  const fetchPeers = useCollabStore((state) => state.fetchPeers);
  const peers = useCollabStore((state) => state.peers);
  const createAudit = useCollabStore((state) => state.createAudit);
  const fetchAudits = useCollabStore((state) => state.fetchAudits);
  const audits = useCollabStore((state) => state.audits);
  const globalClients = useCollabStore((state) => state.globalClients);
  const fetchGlobalClients = useCollabStore((state) => state.fetchGlobalClients);

  const [input, setInput] = useState('');
  const [pastedImage, setPastedImage] = useState<PastedImage | null>(null);
  const [imageDescription, setImageDescription] = useState('');
  const [imageQuestion, setImageQuestion] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [deliveryRoute, setDeliveryRoute] = useState<DeliveryRoute>('vai');
  const [broadcastModel, setBroadcastModel] = useState('gpt-4o');
  const [broadcastChatApp, setBroadcastChatApp] = useState('chat');
  const [broadcastSession, setBroadcastSession] = useState('new-session');
  const [perIdeConfigs, setPerIdeConfigs] = useState<PerIdeConfig[]>([]);
  const [showIdePopup, setShowIdePopup] = useState(false);
  const [isResearchRailOpen, setIsResearchRailOpen] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  /** `@` mention: start index in `input`, or null when not in a mention token */
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSelected, setMentionSelected] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idePopupRef = useRef<HTMLDivElement>(null);
  const ideButtonRef = useRef<HTMLButtonElement>(null);
  const mentionQueryPrevRef = useRef('');
  /** Hash of the last sandbox file list sent as context — avoids resending unchanged data. */
  const lastSandboxContextHashRef = useRef<string | null>(null);

  const hasMessages = activeConversationId && messages.length > 0;
  const userTurnCount = useMemo(
    () => messages.filter((message) => message.role === 'user').length,
    [messages],
  );
  const latestResearchContext = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== 'assistant' || !message.sources || message.sources.length === 0) continue;

      let question = 'this answer';
      for (let j = i - 1; j >= 0; j -= 1) {
        if (messages[j]?.role === 'user') {
          question = summarizeResearchPrompt(messages[j].content);
          break;
        }
      }

      return {
        assistantIndex: i,
        question,
        sources: message.sources,
      };
    }

    return null;
  }, [messages]);
  const hasResearchRailContext = Boolean(latestResearchContext);
  const researchThreadMode = Boolean(latestResearchContext && userTurnCount > 1);
  const useResearchRailWideLayout = Boolean(hasResearchRailContext && isResearchRailOpen);
  const compactResearchChrome = researchThreadMode || useResearchRailWideLayout;

  useEffect(() => {
    if (!latestResearchContext) {
      setIsResearchRailOpen(false);
      return;
    }

    if (userTurnCount > 1) {
      setIsResearchRailOpen(true);
    }
  }, [latestResearchContext?.assistantIndex, userTurnCount]);

  /* ── Sync broadcast mode from store (per-chat, restored by selectConversation) ── */
  useEffect(() => {
    setDeliveryRoute(broadcastMode ? 'broadcast' : 'vai');
  }, [broadcastMode]);

  /* ── Fetch global clients for broadcast target count + available models ── */
  useEffect(() => { void fetchGlobalClients(); }, [fetchGlobalClients]);
  useEffect(() => {
    if (!broadcastMode) return;
    // Re-fetch clients when broadcast mode is enabled (to get fresh model lists)
    void fetchGlobalClients();
    const id = setInterval(() => void fetchGlobalClients(), 15_000);
    return () => clearInterval(id);
  }, [broadcastMode, fetchGlobalClients]);

  /* ── Smart auto-scroll ── */
  const { scrollRef, showScrollButton, scrollToBottom } = useAutoScroll({
    messageCount: messages.length,
    isStreaming,
  });

  /* ── Adaptive intent tracking ── */
  const intentStore = useIntentStore();
  const { recordUserAction, recordDeployTriggered, setBuildMode, setHasActiveProject, resetConversation, processUserMessage } = intentStore;

  const isBuildMode = mode === 'agent' || mode === 'builder';
  const selectedFrontend = useMemo(
    () => frontends.find((frontend) => frontend.id === selectedFrontendId) ?? null,
    [frontends, selectedFrontendId],
  );
  const hasActiveProject = Boolean(sandboxProjectId);

  useEffect(() => { setBuildMode(isBuildMode); }, [isBuildMode, setBuildMode]);

  /* ── Auto-open preview when the last assistant message has file blocks ── */
  useEffect(() => {
    if (isStreaming || showBuilderPanel) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    // Detect titled code blocks (Base44-style: auto-reveal preview on code generation)
    if (/```\w*\s+(?:title|path|file|filename)=/.test(last.content)) {
      toggleBuilderPanel();
    }
  // Only trigger on new assistant message arrival (messages.length change)
  }, [messages.length]); // eslint-disable-line -- intentional dep subset
  useEffect(() => {
    setHasActiveProject(!!sandboxProjectId);
    // Reset context hash so the next message always sends the full file tree for this project.
    lastSandboxContextHashRef.current = null;
  }, [sandboxProjectId, setHasActiveProject]);
  useEffect(() => { resetConversation(); }, [activeConversationId, resetConversation]);
  useEffect(() => {
    if (!persistentProjectId) return;
    void fetchPeers(persistentProjectId);
    void fetchAudits(persistentProjectId);
  }, [persistentProjectId, fetchAudits, fetchPeers]);
  useEffect(() => {
    if (!isBuildMode) return;

    messages.forEach((message, index) => {
      if (message.role === 'user' && !intentStore.intents.has(index)) {
        processUserMessage(index, message.content);
      }
    });
  }, [isBuildMode, messages, processUserMessage, intentStore.intents]);

  const fallbackDeployMap = useMemo(
    () => computeFallbackMap(messages, intentStore),
    [messages, intentStore, intentStore.intents, intentStore.adaptiveBoost, isBuildMode],
  );
  const roundtablePeers = useMemo(
    () => peers.filter((peer) => peer.status !== 'idle'),
    [peers],
  );
  const _recentAudits = useMemo(
    () => audits.slice(0, 2).map((audit) => ({
      ...audit,
      submittedCount: audit.results.filter((result) => result.status === 'submitted').length,
      claimedCount: audit.results.filter((result) => result.status === 'claimed' && !result.claimIsStale).length,
      pendingCount: audit.results.filter((result) => result.status === 'pending' || (result.status === 'claimed' && result.claimIsStale)).length,
    })),
    [audits],
  );
  const showGroupChatStrip = deliveryRoute === 'group' || roundtablePeers.length > 0;

  /** Models reported by connected IDEs — deduplicated by family, falls back to hardcoded list */
  const ideModels = useMemo(() => {
    const seen = new Set<string>();
    const models: { family: string; label: string }[] = [];
    for (const client of globalClients) {
      if (!client.availableModels) continue;
      try {
        const parsed = JSON.parse(client.availableModels) as Array<{ id: string; family: string; name: string; vendor: string }>;
        for (const m of parsed) {
          if (!seen.has(m.family)) {
            seen.add(m.family);
            models.push({ family: m.family, label: m.name || m.family });
          }
        }
      } catch { /* ignore parse errors */ }
    }
    return models.length > 0 ? models : FALLBACK_MODELS.map((m) => ({ family: m.family, label: m.label }));
  }, [globalClients]);

  /** Chat apps and sessions reported by connected IDEs */
  const { ideChatApps, ideChatSessions } = useMemo(() => {
    const apps = new Map<string, { id: string; label: string }>();
    const sessions: Array<{ sessionId: string; title: string; lastModified: number; chatApp: string }> = [];
    for (const client of globalClients) {
      if (!client.availableChatInfo) continue;
      try {
        const info = JSON.parse(client.availableChatInfo) as {
          chatApps?: Array<{ id: string; label: string }>;
          sessions?: Array<{ sessionId: string; title: string; lastModified: number; chatApp: string }>;
        };
        if (info.chatApps) {
          for (const app of info.chatApps) {
            if (!apps.has(app.id)) apps.set(app.id, app);
          }
        }
        if (info.sessions) {
          for (const s of info.sessions) {
            if (!sessions.some((x) => x.sessionId === s.sessionId)) sessions.push(s);
          }
        }
      } catch { /* ignore parse errors */ }
    }
    const resolvedApps = apps.size > 0 ? Array.from(apps.values()) : FALLBACK_CHAT_APPS;
    const resolvedSessions = sessions.length > 0 ? sessions : FALLBACK_SESSIONS;
    return { ideChatApps: resolvedApps, ideChatSessions: resolvedSessions };
  }, [globalClients]);
  const filteredBroadcastSessions = useMemo(() => {
    const list = broadcastChatApp
      ? ideChatSessions.filter((session) => session.chatApp === broadcastChatApp)
      : ideChatSessions;
    return [...list].sort((a, b) => b.lastModified - a.lastModified);
  }, [broadcastChatApp, ideChatSessions]);

  useEffect(() => {
    const nextModel = ideModels[0]?.family;
    if (!nextModel) return;
    if (!ideModels.some((model) => model.family === broadcastModel)) {
      setBroadcastModel(nextModel);
    }
  }, [broadcastModel, ideModels]);

  useEffect(() => {
    const nextChatApp = ideChatApps[0]?.id ?? '';
    if (!nextChatApp) {
      if (broadcastChatApp) setBroadcastChatApp('');
      return;
    }
    if (!ideChatApps.some((app) => app.id === broadcastChatApp)) {
      setBroadcastChatApp(nextChatApp);
    }
  }, [broadcastChatApp, ideChatApps]);

  useEffect(() => {
    if (!broadcastSession) return;
    if (!filteredBroadcastSessions.some((session) => session.sessionId === broadcastSession)) {
      setBroadcastSession('');
    }
  }, [broadcastSession, filteredBroadcastSessions]);

  const onlineIdeCount = useMemo(() => {
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
    return globalClients.filter((c) => {
      const lastActivity = Math.max(
        c.lastPolledAt ? new Date(c.lastPolledAt).getTime() : 0,
        c.lastSeenAt ? new Date(c.lastSeenAt).getTime() : 0,
      );
      return lastActivity > thirtyMinAgo;
    }).length;
  }, [globalClients]);

  const ideMentionCatalog = useMemo(() => buildIdeMentionItems(globalClients), [globalClients]);
  const ideMentionSlugSetResolved = useMemo(() => mentionSlugSet(ideMentionCatalog), [ideMentionCatalog]);
  const filteredIdeMentions = useMemo(() => {
    if (mentionAt === null) return [];
    return filterMentionItems(ideMentionCatalog, mentionQuery);
  }, [mentionAt, ideMentionCatalog, mentionQuery]);

  useEffect(() => {
    if (filteredIdeMentions.length === 0) return;
    setMentionSelected((i) => Math.min(i, Math.max(0, filteredIdeMentions.length - 1)));
  }, [filteredIdeMentions.length]);

  /** IDE status map for the quick-connect popup */
  const ideClientStatus = useMemo(() => {
    const THRESHOLD = 30 * 60_000;
    const now = Date.now();
    const statusMap = new Map<string, { online: boolean; clientIds: string[]; lastActivity: string }>();
    for (const target of ideTargets) {
      if (target.id === 'desktop') continue;
      const matching = globalClients.filter((c) => c.launchTarget === target.id || c.clientType === target.id);
      const onlineClients = matching.filter((c) => {
        const t = Math.max(c.lastPolledAt ? new Date(c.lastPolledAt).getTime() : 0, c.lastSeenAt ? new Date(c.lastSeenAt).getTime() : 0);
        return now - t < THRESHOLD;
      });
      const latest = matching.reduce((max, c) => {
        const t = Math.max(c.lastPolledAt ? new Date(c.lastPolledAt).getTime() : 0, c.lastSeenAt ? new Date(c.lastSeenAt).getTime() : 0);
        return t > max ? t : max;
      }, 0);
      statusMap.set(target.id, {
        online: onlineClients.length > 0,
        clientIds: matching.map((c) => c.id),
        lastActivity: latest > 0 ? formatRelativeTime(new Date(latest).toISOString()) : 'Never',
      });
    }
    return statusMap;
  }, [ideTargets, globalClients]);

  /** Close IDE popup on click outside */
  useEffect(() => {
    if (!showIdePopup) return;
    const handler = (e: MouseEvent) => {
      if (idePopupRef.current?.contains(e.target as Node)) return;
      if (ideButtonRef.current?.contains(e.target as Node)) return;
      setShowIdePopup(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showIdePopup]);

  const showOwnerFeatures = isOwner && !ownerFeaturesHidden;
  const showOwnerTrainingStrip = showOwnerFeatures || trainingWorkspace;

  /* ── Inject submitted audit results as group chat messages ── */
  const injectedResultIds = useRef(new Set<string>());
  useEffect(() => {
    if (!audits.length || !peers.length) return;
    for (const audit of audits) {
      for (const result of audit.results) {
        if (result.status !== 'submitted' || !result.verdict) continue;
        if (injectedResultIds.current.has(result.id)) continue;
        injectedResultIds.current.add(result.id);
        const peer = peers.find((p) => p.peerKey === result.peerKey);
        if (!peer) continue;
        useChatStore.getState().injectAgentMessage(
          result.verdict,
          {
            type: 'ide-agent',
            name: peer.displayName,
            ide: peer.launchTarget,
            model: peer.model,
            peerKey: result.peerKey,
            color: IDE_AGENT_COLORS[peer.launchTarget as keyof typeof IDE_AGENT_COLORS],
          },
        );
      }
    }
  }, [audits, peers]);

  /** Quick-connect to a specific IDE from the popup */
  const quickConnectIde = useCallback((targetLabel: string, clientIds: string[]) => {
    if (!activeConversationId) {
      const modelId = selectedModelId ?? 'vai:v0';
      void useChatStore.getState().createConversation(modelId, 'chat', {
        sandboxProjectId: sandboxProjectId ?? null,
      });
    }
    setBroadcastMode(true, clientIds);
    setDeliveryRoute('broadcast');
    setShowIdePopup(false);
    toast.success(`Connected to ${targetLabel} — type your message`);
  }, [activeConversationId, sandboxProjectId, selectedModelId, setBroadcastMode]);

  /* ── Auto-grow textarea ── */
  const adjustTextareaHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, []);

  const syncMentionFromTextarea = useCallback((value: string, cursorPos: number) => {
    const before = value.slice(0, cursorPos);
    const at = before.lastIndexOf('@');
    if (at === -1) {
      setMentionAt(null);
      mentionQueryPrevRef.current = '';
      return;
    }
    const fragment = before.slice(at + 1);
    if (fragment.includes(' ') || fragment.includes('\n')) {
      setMentionAt(null);
      mentionQueryPrevRef.current = '';
      return;
    }
    if (fragment !== mentionQueryPrevRef.current) {
      setMentionSelected(0);
      mentionQueryPrevRef.current = fragment;
    }
    setMentionAt(at);
    setMentionQuery(fragment);
  }, []);

  const applyIdeMention = useCallback((item: IdeMentionItem) => {
    const ta = textareaRef.current;
    if (!ta || mentionAt === null) return;
    const pos = ta.selectionStart ?? input.length;
    const before = input.slice(0, mentionAt);
    const after = input.slice(pos);
    const insertion = `@${item.slug} `;
    const next = before + insertion + after;
    setInput(next);
    setMentionAt(null);
    mentionQueryPrevRef.current = '';
    const newPos = before.length + insertion.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
      adjustTextareaHeight();
    });
    if (item.clientId === '__all__') {
      setBroadcastMode(true, []);
    } else {
      setBroadcastMode(true, [item.clientId]);
    }
    setDeliveryRoute('broadcast');
    toast.success(item.clientId === '__all__' ? 'Broadcasting to all connected IDEs' : `Routing to ${item.label}`);
  }, [mentionAt, input, setBroadcastMode, adjustTextareaHeight]);

  useEffect(() => { adjustTextareaHeight(); }, [input, adjustTextareaHeight]);

  /* ── Focus textarea on mount + after sending ── */
  useEffect(() => {
    if (!isStreaming && !pastedImage) {
      textareaRef.current?.focus();
    }
  }, [isStreaming, pastedImage, messages.length]);

  /* ── Image paste + smart text paste ── */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          const mimeType = item.type;
          const img = new Image();
          img.onload = () => {
            setPastedImage({ data: base64, mimeType, preview: dataUrl, sizeBytes: file.size, width: img.width, height: img.height });
            setTimeout(() => descriptionRef.current?.focus(), 100);
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
        return;
      }
    }

    const text = e.clipboardData?.getData('text/plain');
    if (text && text.length > LARGE_PASTE_THRESHOLD) {
      e.preventDefault();
      const ext = detectFileExtension(text);
      const lineCount = text.split('\n').length;
      const name = `pasted-${attachedFiles.length + 1}.${ext}`;
      setAttachedFiles((prev) => [
        ...prev,
        { id: `file-${Date.now()}`, name, content: text, language: ext, sizeBytes: new Blob([text]).size },
      ]);
      if (!input.trim()) {
        setInput(`Analyze attached ${ext} file (${lineCount} lines)`);
      }
    }
  }, [attachedFiles.length, input]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        const ext = file.name.split('.').pop() || detectFileExtension(content);
        setAttachedFiles((prev) => [
          ...prev,
          { id: `file-${Date.now()}-${file.name}`, name: file.name, content, language: ext, sizeBytes: file.size },
        ]);
      };
      reader.readAsText(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeFile = useCallback((id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearImage = useCallback(() => {
    setPastedImage(null);
    setImageDescription('');
    setImageQuestion('');
  }, []);

  const handleSend = async (overrideText?: string, options?: SendOptions) => {
    const isOverrideSend = typeof overrideText === 'string';
    const text = (overrideText ?? input).trim();
    if (isStreaming || !text) return;
    if (!isOverrideSend && pastedImage && !imageDescription.trim()) {
      descriptionRef.current?.focus();
      return;
    }

    const forcedMode = options?.forceMode;
    const effectiveMode = forcedMode ?? mode;

    const sendTimeWorkIntent = resolveSendTimeWorkIntent({
      userPrompt: text,
      mode: effectiveMode,
      hasActiveProject,
    });
    const nextConversationMode = forcedMode
      ?? (effectiveMode === 'chat' && sendTimeWorkIntent.shouldPrimeBuilder
        ? 'builder'
        : effectiveMode);

    let convId = activeConversationId;
    if (!convId) {
      const modelId = selectedModelId ?? 'vai:v0';
      convId = await createConversation(modelId, nextConversationMode, {
        sandboxProjectId: sandboxProjectId ?? null,
      });
    } else if (nextConversationMode !== mode) {
      await updateConversationMode(convId, nextConversationMode);
    }
    if (!convId) return;

    if (nextConversationMode !== mode) {
      setMode(nextConversationMode);
    }

    let fullContent = text;
    if (!isOverrideSend && attachedFiles.length > 0) {
      const fileSections = attachedFiles.map(
        (f) => `\n\n---\n📎 **${f.name}** (${f.language}, ${(f.sizeBytes / 1024).toFixed(1)}KB)\n\`\`\`${f.language}\n${f.content}\n\`\`\``
      );
      fullContent = text + fileSections.join('');
    }

    /* ── Broadcast route: send to connected IDEs via broadcast API ── */
    if (deliveryRoute === 'broadcast') {
      const stripped = stripLeadingIdeMentions(fullContent, ideMentionSlugSetResolved);
      const broadcastBody = stripped.trim() ? stripped : fullContent.trim();
      if (!broadcastBody) {
        toast.error('Enter a message after the IDE mention');
        return;
      }
      await sendBroadcast(
        broadcastBody,
        broadcastTargetClientIds.length > 0 ? broadcastTargetClientIds : undefined,
        broadcastModel,
        broadcastChatApp || undefined,
        broadcastSession || undefined,
      );
      setInput('');
      setAttachedFiles([]);
      requestAnimationFrame(() => {
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      });
      return;
    }

    if (deliveryRoute === 'group') {
      if (!persistentProjectId) {
        toast.error('Open a project first to use group chat');
        return;
      }
      if (roundtablePeers.length === 0) {
        toast.error('No IDEs connected — add agents from Settings');
        return;
      }

      const audit = await createAudit(
        persistentProjectId,
        fullContent,
        roundtablePeers.map((peer) => peer.peerKey),
      );

      if (!audit) {
        toast.error('Unable to broadcast to group');
        return;
      }

      toast.success(`Sent to ${roundtablePeers.length} IDE${roundtablePeers.length === 1 ? '' : 's'}`);
    }

    if (nextConversationMode === 'builder' || sendTimeWorkIntent.shouldPrimeBuilder) {
      expandBuilder();
      setBuildStatus({
        step: 'generating',
        message: forcedMode === 'builder'
          ? 'Turning grounded brief into runnable output...'
          : sendTimeWorkIntent.buildStatusMessage,
      });
    }

    const systemPrompt = selectedFrontend
      ? `The user currently prefers the ${selectedFrontend.framework} shell (${selectedFrontend.id}). When proposing app architecture, scaffold targets, or sandbox templates, bias toward that shell while keeping the shared runtime and alternate shell compatibility in mind.`
      : undefined;

    // Inject sandbox context when a project is active so Vai knows what's running.
    // Hash the file list to avoid re-sending the same blob on every message.
    const sandboxContextPrompt = await (async () => {
      if (!sandboxProjectId || (sandboxStatus !== 'running' && sandboxStatus !== 'writing' && sandboxStatus !== 'idle')) return undefined;

      const fileListKey = sandboxFiles.slice(0, 40).join('|');
      const contextHash = `${sandboxProjectId}:${sandboxDevPort ?? 'none'}:${fileListKey}`;
      const fileTreeUnchanged = lastSandboxContextHashRef.current === contextHash;
      lastSandboxContextHashRef.current = contextHash;

      const lines: string[] = [
        `ACTIVE SANDBOX PROJECT: "${sandboxProjectName || sandboxProjectId}"`,
      ];
      if (sandboxDevPort) {
        lines.push(`Dev server is RUNNING at http://localhost:${sandboxDevPort}`);
      } else {
        lines.push('Dev server is NOT running yet.');
      }
      // Only include the full file tree when it has changed since the last message.
      if (!fileTreeUnchanged && sandboxFiles.length > 0) {
        const fileList = sandboxFiles.slice(0, 40).join('\n  ');
        lines.push(`Current file tree (${sandboxFiles.length} files):\n  ${fileList}${sandboxFiles.length > 40 ? `\n  ... and ${sandboxFiles.length - 40} more` : ''}`);
      } else if (fileTreeUnchanged && sandboxFiles.length > 0) {
        lines.push(`File tree unchanged (${sandboxFiles.length} files — omitted to save context).`);
      }

      const snapshotPaths = pickSandboxContextPaths(sandboxFiles, text);
      const snapshots = (await Promise.all(snapshotPaths.map(async (path) => {
        try {
          const res = await apiFetch(`/api/sandbox/${sandboxProjectId}/file?path=${encodeURIComponent(path)}`);
          if (!res.ok) return null;
          const data = await res.json() as { path: string; content: string };
          return {
            path: data.path,
            content: truncateSnapshotContent(data.content),
            language: detectFileExtension(data.content),
          };
        } catch {
          return null;
        }
      }))).filter((snapshot): snapshot is { path: string; content: string; language: string } => Boolean(snapshot));

      if (snapshots.length > 0) {
        lines.push('');
        lines.push('CURRENT FILE SNAPSHOTS:');
        for (const snapshot of snapshots) {
          lines.push(`FILE: ${snapshot.path}`);
          lines.push(`\`\`\`${snapshot.language}`);
          lines.push(snapshot.content);
          lines.push('```');
        }
      }

      lines.push('');
      lines.push('EDITING RULES: Since a project is active, prefer targeted edits over full re-scaffolds.');
      lines.push('Output only the files that need to change, using title="path/to/file" on each code block.');
      lines.push('Never re-emit files that are unchanged.');
      return lines.join('\n');
    })();

    const routePrompt = deliveryRoute === 'group'
      ? 'This prompt was also sent to connected IDE agents in a group chat. Keep your answer useful on its own, but expect parallel IDE agent responses.'
      : undefined;
    const composedSystemPrompt = [
      systemPrompt,
      sandboxContextPrompt,
      sendTimeWorkIntent.requestSystemPrompt,
      routePrompt,
    ].filter(Boolean).join('\n\n') || undefined;

    if (!isOverrideSend && pastedImage) {
      sendMessage(fullContent, {
        data: pastedImage.data, mimeType: pastedImage.mimeType,
        description: imageDescription.trim(), question: imageQuestion.trim() || undefined,
        width: pastedImage.width, height: pastedImage.height, sizeBytes: pastedImage.sizeBytes,
      }, composedSystemPrompt);
      clearImage();
    } else {
      sendMessage(fullContent, undefined, composedSystemPrompt);
    }

    if (!isOverrideSend) {
      setInput('');
      setAttachedFiles([]);
      // Reset textarea height
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      });
    }
  };

  const handlePresetClick = (label: string) => { handleSend(label); };
  const handleChipClick = (label: string) => {
    setInput(label);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      adjustTextareaHeight();
    });
  };

  /** Switch to Builder mode + focus input — Base44-style "just start building" */
  const startBuilding = async (description?: string) => {
    setMode('builder');
    if (!showBuilderPanel) toggleBuilderPanel();
    const convId = activeConversationId;
    if (!convId) {
      const modelId = selectedModelId ?? 'vai:v0';
      await createConversation(modelId, 'builder', {
        sandboxProjectId: sandboxProjectId ?? null,
      });
    } else {
      await updateConversationMode(convId, 'builder');
    }
    if (description) {
      await handleSend(description);
    } else {
      setTimeout(() => {
        setInput('');
        textareaRef.current?.focus();
      }, 50);
    }
  };
  const charCount = input.length;
  const canSend = input.trim().length > 0 && !isStreaming && (!pastedImage || imageDescription.trim().length > 0);

  const showTypingIndicator = isStreaming && messages.length > 0 && messages[messages.length - 1]?.content === '';
  const activeDeployStep = useMemo(
    () => deploySteps.find((step) => step.status === 'running')
      ?? deploySteps.find((step) => step.status === 'failed')
      ?? null,
    [deploySteps],
  );
  const transientActivity = useMemo(() => {
    const items: Array<{ key: string; tone: 'violet' | 'blue' | 'emerald' | 'amber' | 'orange'; label: string; detail: string }> = [];

    if (isStreaming) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content?.toLowerCase() ?? '';
      const isSearchLikely = /\b(?:what|who|when|where|why|how|latest|current|news|price|weather|search|find|look up|research)\b/.test(lastUserMsg);
      items.push({
        key: 'thinking',
        tone: mode === 'builder' ? 'orange' : isSearchLikely ? 'blue' : 'violet',
        label: mode === 'builder' ? 'thinking...' : isSearchLikely ? 'Searching the web...' : 'Thinking...',
        detail: mode === 'builder'
          ? 'generating code and writing to preview'
          : isSearchLikely
            ? 'fetching sources and composing cited answer'
            : 'composing response',
      });
    }

    if (deployPhase === 'deploying' && activeDeployStep) {
      items.push({
        key: 'deploy',
        tone: 'blue',
        label: activeDeployStep.label,
        detail: activeDeployStep.message || 'working through the live preview pipeline',
      });
    } else if (buildStatus.step !== 'idle' && buildStatus.step !== 'ready') {
      const isSoftMiss = buildStatus.step === 'failed' && /(?:no files|no preview|text only|unchanged|ended early)/i.test(buildStatus.message || '');
      items.push({
        key: 'build-status',
        tone: buildStatus.step === 'failed' ? 'amber' : 'blue',
        label: buildStatus.step === 'failed'
          ? (isSoftMiss ? 'No preview update yet' : 'Build path hit an issue')
          : `Working: ${buildStatus.step}`,
        detail: buildStatus.message || 'processing the current request',
      });
    }

    return items.slice(0, 3);
  }, [activeDeployStep, buildStatus.message, buildStatus.step, deployPhase, isStreaming, mode]);
  const showProjectContextStrip = Boolean(sandboxProjectId);
  const shellModeLabel = `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
  const headerTitle = hasMessages ? 'Workspace' : 'Vai';
  const composerAssistText = pastedImage
    ? 'Describe the screenshot and ask the exact question you want answered.'
    : deliveryRoute === 'broadcast'
      ? 'Send one prompt to connected IDEs and compare the answers in this thread.'
      : showProjectContextStrip
        ? 'Ask for edits, debugging, or polish using the attached project context.'
        : hasMessages
          ? 'Use a sharper follow-up to keep the thread moving.'
          : 'Start with the outcome you want, then add files or screenshots if needed.';
  const composerStateChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; tone: 'emerald' | 'blue' | 'violet' | 'amber' }> = [
      {
        key: 'mode',
        label: `${shellModeLabel} mode`,
        tone: mode === 'builder' || mode === 'agent' ? 'amber' : 'violet',
      },
    ];

    if (deliveryRoute === 'broadcast') {
      const targetCount = broadcastTargetClientIds.length > 0 ? broadcastTargetClientIds.length : onlineIdeCount;
      chips.push({
        key: 'route',
        label: `Broadcast ${Math.max(targetCount, 1)} IDE${targetCount === 1 ? '' : 's'}`,
        tone: 'blue',
      });
    } else if (deliveryRoute === 'group') {
      chips.push({
        key: 'route',
        label: `Group chat ${roundtablePeers.length}`,
        tone: 'violet',
      });
    }

    if (showProjectContextStrip) {
      chips.push({
        key: 'project',
        label: persistentProjectId ? 'Synced project' : 'Project attached',
        tone: 'blue',
      });
    }

    if (attachedFiles.length > 0) {
      chips.push({
        key: 'files',
        label: `${attachedFiles.length} file${attachedFiles.length === 1 ? '' : 's'}`,
        tone: 'amber',
      });
    }

    if (pastedImage) {
      chips.push({ key: 'image', label: 'Image attached', tone: 'amber' });
    }

    return chips.slice(0, 3);
  }, [
    attachedFiles.length,
    broadcastTargetClientIds.length,
    deliveryRoute,
    mode,
    onlineIdeCount,
    pastedImage,
    persistentProjectId,
    roundtablePeers.length,
    shellModeLabel,
    showProjectContextStrip,
  ]);
  const composerHintChips = useMemo(() => {
    const hints = [
      { key: 'enter', label: 'Enter sends' },
      { key: 'newline', label: 'Shift+Enter newline' },
    ];

    if (onlineIdeCount > 0) {
      hints.push({ key: 'route', label: '@ routes to IDE' });
    }

    if (!pastedImage) {
      hints.push({ key: 'paste', label: 'Paste big code to attach' });
    }

    return hints.slice(0, 2);
  }, [onlineIdeCount, pastedImage]);
  const activitySummary = useMemo(() => {
    if (transientActivity.length > 0) {
      return transientActivity[0]?.label ?? 'Working';
    }
    if (buildActivity.length > 0) {
      return `${buildActivity.length} update${buildActivity.length === 1 ? '' : 's'}`;
    }
    return 'Idle';
  }, [buildActivity.length, transientActivity]);
  const contextualComposerActions = useMemo(() => {
    if (!hasMessages) return [];

    if (deliveryRoute === 'broadcast') {
      return [
        { label: 'Ask for fixes', prompt: 'Review the current issue and propose the best fix with tradeoffs.', icon: Shield },
        { label: 'Different approach', prompt: 'Give me a materially different approach to this problem.', icon: Sparkles },
        { label: 'Implementation plan', prompt: 'Turn this into a concrete implementation plan with steps.', icon: BookOpen },
        { label: 'Challenge it', prompt: 'Challenge the current direction and call out the weak assumptions.', icon: Globe },
      ];
    }

    if (mode === 'builder' || mode === 'agent' || showProjectContextStrip) {
      return [
        { label: 'Tighten the layout', prompt: 'Tighten the layout, spacing, and hierarchy without changing the core functionality.', icon: Sparkles },
        { label: 'Make it mobile-ready', prompt: 'Improve the mobile layout and touch behavior without breaking desktop.', icon: Globe },
        { label: 'Explain the structure', prompt: 'Explain what you built, where the important files live, and how the pieces connect.', icon: BookOpen },
      ];
    }

    if (hasResearchRailContext) {
      return [
        { label: 'Short summary', prompt: 'Summarize that in 3 crisp bullets.', icon: BookOpen },
        { label: 'Why it matters', prompt: 'Why does this matter in practice?', icon: Shield },
        { label: 'Turn into a plan', prompt: 'Turn that into an actionable plan.', icon: Sparkles },
        { label: 'Best source first', prompt: 'Which source matters most here, and why?', icon: Globe },
      ];
    }

    return [
      { label: 'Make it shorter', prompt: 'Make that shorter and sharper.', icon: Sparkles },
      { label: 'Give examples', prompt: 'Give me two concrete examples.', icon: BookOpen },
      { label: 'Challenge assumptions', prompt: 'Challenge that answer and point out weak assumptions.', icon: Shield },
      { label: 'Turn into steps', prompt: 'Turn that into clear step-by-step actions.', icon: Globe },
    ];
  }, [deliveryRoute, hasMessages, hasResearchRailContext, mode, showProjectContextStrip]);

  useEffect(() => {
    setActivityCollapsed(false);
  }, [activeConversationId]);

  return (
    <div
      data-studio-builder-chrome={studioBuilderChrome ? 'true' : undefined}
      className={`relative flex h-full min-w-0 flex-1 flex-col overflow-hidden ${
        studioBuilderChrome ? 'bg-[#fafafa]' : 'bg-[#0a0a0a]'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.tsx,.ts,.js,.jsx,.json,.css,.html,.py,.sh,.yaml,.yml,.toml,.xml,.sql,.csv,.env,.log"
        onChange={handleFileUpload}
        className="hidden"
      />

      <div className={studioBuilderChrome ? 'border-b border-zinc-200 bg-white' : 'border-b border-zinc-900 bg-zinc-950/92'}>
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <h2 className={`truncate text-[14px] font-medium ${studioBuilderChrome ? 'text-zinc-900' : 'text-zinc-200'}`}>
                {headerTitle}
              </h2>
              {studioBuilderChrome && (
                <p className="truncate text-[11px] text-zinc-500">
                  {(authUser?.name || authUser?.email?.split('@')[0] || 'Your')}&apos;s workspace
                </p>
              )}
            </div>
            <span
              className={`hidden rounded-md border px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${
                studioBuilderChrome
                  ? 'border-zinc-200 bg-zinc-50 text-zinc-600'
                  : 'border-zinc-800/70 bg-zinc-950 text-zinc-500'
              }`}
            >
              {shellModeLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleThemePreference}
              className={`flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-medium transition-colors ${
                studioBuilderChrome
                  ? 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                  : 'border-zinc-800/70 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100'
              }`}
              title={studioBuilderChrome ? 'Switch to dark theme' : 'Switch to light theme'}
            >
              {studioBuilderChrome ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
              <span>{studioBuilderChrome ? 'Dark' : 'Light'}</span>
            </button>
            {!showBuilderPanel && (
              <button
                onClick={toggleBuilderPanel}
                className={`flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-medium transition-colors ${
                  studioBuilderChrome
                    ? 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                    : 'border-zinc-800/70 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
                title="Show preview (Ctrl+B)"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Preview</span>
              </button>
            )}
            <FocusModeToggle />
          </div>
        </div>
      </div>

      {/* ── Messages area ── */}
      <div
        ref={scrollRef}
        className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        style={{ overscrollBehavior: 'contain' }}
      >
        {/* Scroll-to-bottom FAB */}
        <ScrollToBottom visible={showScrollButton} onClick={scrollToBottom} />

        {showGroupChatStrip && (
          <div className="mx-auto max-w-3xl px-4 pt-3">
            <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/50 p-2.5 backdrop-blur-sm">
              {/* Participant avatars row — Discord-style */}
              <div className="flex items-center gap-2">
                {/* Vai — always present */}
                <div className="flex items-center gap-1.5 rounded-full bg-zinc-800/60 px-2.5 py-1 ring-1 ring-zinc-700/40">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-blue-600">
                    <span className="text-[9px] font-bold text-white">V</span>
                  </div>
                  <span className="text-[11px] font-medium text-zinc-300">Vai</span>
                </div>

                {/* Connected IDE agents */}
                {roundtablePeers.map((peer) => {
                  const agentColor = IDE_AGENT_COLORS[peer.launchTarget] || '#6B7280';
                  return (
                    <div
                      key={peer.peerKey}
                      className="flex items-center gap-1.5 rounded-full bg-zinc-800/60 px-2.5 py-1 ring-1 ring-zinc-700/40 transition-colors hover:ring-zinc-600"
                      title={`${peer.ide} · ${peer.model}`}
                    >
                      <div
                        className="flex h-5 w-5 items-center justify-center rounded-full"
                        style={{ backgroundColor: `${agentColor}30` }}
                      >
                        <span className="text-[9px] font-bold" style={{ color: agentColor }}>
                          {peer.displayName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-[11px] font-medium text-zinc-300">{peer.displayName}</span>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="connected" />
                    </div>
                  );
                })}

                {/* Add more agents button */}
                <button
                  onClick={() => setActivePanel('settings')}
                  className="flex h-7 items-center gap-1 rounded-full border border-dashed border-zinc-700 px-2.5 text-[11px] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
                  title="Manage group chat participants"
                >
                  <Bot className="h-3 w-3" />
                  {roundtablePeers.length === 0 ? 'Add IDEs' : '+'}
                </button>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Group chat toggle */}
                {roundtablePeers.length > 0 && (
                  <button
                    onClick={() => setDeliveryRoute(deliveryRoute === 'group' ? 'vai' : 'group')}
                    className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-all ${
                      deliveryRoute === 'group'
                        ? 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30'
                        : 'bg-zinc-800/40 text-zinc-500 ring-1 ring-zinc-700/40 hover:text-zinc-300'
                    }`}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    {deliveryRoute === 'group' ? 'Group chat on' : 'Group chat'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {showOwnerTrainingStrip && (
          <div className="mx-auto max-w-3xl px-4 pt-3">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 backdrop-blur-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                    <Brain className="h-4 w-4 text-emerald-300" />
                    Owner training workspace
                    {trainingWorkspace && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                        isolated
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {trainingWorkspace
                      ? 'User chats do not train Vai. This workspace is the only place where owner-curated conversations can be marked as teachable.'
                      : 'Learning is locked off for normal chats. Start or enter an owner training workspace when you want to curate training manually.'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {showOwnerFeatures && !trainingWorkspace && (
                    <button
                      onClick={() => setTrainingWorkspace(true)}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200 transition-colors hover:bg-emerald-500/20"
                    >
                      Enter training workspace
                    </button>
                  )}
                  {trainingWorkspace && (
                    <button
                      onClick={() => setTrainingWorkspace(false)}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
                    >
                      Exit training workspace
                    </button>
                  )}
                </div>
              </div>

              {trainingWorkspace && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
                  <button
                    onClick={() => setLearningEnabled(!learningEnabled)}
                    className={`rounded-lg border px-2.5 py-1.5 transition-colors ${
                      learningEnabled
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                        : 'border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                    }`}
                  >
                    {learningEnabled ? 'Training armed' : 'Training blocked'}
                  </button>
                  <span className="text-zinc-500">
                    Only when armed will this owner conversation be allowed to feed Vai.
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {!hasMessages ? (
          /* ═══════════ WELCOME STATE ═══════════ */
          <ChatEmptyState
            onStartBuilding={startBuilding}
            onPresetClick={handlePresetClick}
            onAskMemoryQuestion={(prompt, options) => { void handleSend(prompt, options); }}
            onOpenSettings={() => setActivePanel('settings')}
          />
        ) : (
          /* ═══════════ MESSAGE THREAD ═══════════ */
          /* justify-end makes sparse messages sit at the bottom, above input */
          <div className={`mx-auto flex min-h-full w-full ${useResearchRailWideLayout ? 'max-w-[min(108rem,calc(100vw-2rem))]' : 'max-w-[min(68rem,calc(100vw-2rem))]'} flex-col px-4 py-5 md:px-5`}>
            {hasResearchRailContext && latestResearchContext && (
              <div className="mb-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsResearchRailOpen((open) => !open)}
                  data-research-sidebar-toggle="button"
                  data-state={isResearchRailOpen ? 'open' : 'closed'}
                  aria-expanded={isResearchRailOpen}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/75 px-3 py-2 text-[11px] font-medium text-zinc-300 shadow-[0_10px_40px_rgba(0,0,0,0.22)] backdrop-blur-md transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>{isResearchRailOpen ? 'Hide sources' : 'Open sources'}</span>
                  <span className="rounded-md border border-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {latestResearchContext.sources.length}
                  </span>
                </button>
              </div>
            )}

            <div className={useResearchRailWideLayout ? 'grid min-h-full grid-cols-1 gap-8 xl:grid-cols-[minmax(0,60rem)_24rem] xl:items-start' : ''}>
              <div className="flex min-h-full flex-col justify-start">
                {messages.map((msg, idx) => {
                  const fb = fallbackDeployMap.get(idx);
                  const sourceRailHandlesSources = latestResearchContext?.assistantIndex === idx;
                  return (
                    <div key={msg.id}>
                      <MessageBubble
                        role={msg.role}
                        content={msg.content}
                        imageId={msg.imageId}
                        imagePreview={msg.imagePreview}
                        studioChrome={studioBuilderChrome}
                        fallbackDeploy={fb?.intent ?? null}
                        recoveryPattern={fb?.recovery ?? 'none'}
                        allIntents={fb?.allIntents}
                        onIntentAction={(accepted) => {
                          recordUserAction(idx, accepted);
                          if (accepted) recordDeployTriggered();
                        }}
                        isLatest={idx === messages.length - 1}
                        isStreaming={isStreaming && idx === messages.length - 1}
                        sources={msg.sources}
                        followUps={msg.followUps}
                        confidence={msg.confidence}
                        groundedBuildBrief={msg.groundedBuildBrief}
                        feedback={msg.feedback}
                        onFeedback={(helpful) => useChatStore.getState().setFeedback(msg.id, helpful)}
                        onFollowUp={(question) => { void handleSend(question); }}
                        onGroundedExecute={(prompt) => { void handleSend(prompt, { forceMode: 'builder' }); }}
                        sender={msg.sender}
                        isAutoRepair={msg.isAutoRepair}
                        repairAttempt={msg.repairAttempt}
                        compactResearchChrome={compactResearchChrome}
                        isLatestResearchMessage={sourceRailHandlesSources}
                        sourceRailHandlesSources={sourceRailHandlesSources}
                        sourceRailOpen={sourceRailHandlesSources && isResearchRailOpen}
                        onOpenSources={sourceRailHandlesSources ? () => setIsResearchRailOpen(true) : undefined}
                      />
                    </div>
                  );
                })}

                <AnimatePresence>
                  {showTypingIndicator && <TypingIndicator />}
                </AnimatePresence>

                <div className="h-2 flex-shrink-0" />
              </div>

              {hasResearchRailContext && latestResearchContext && (
                <ResearchContextRail
                  question={latestResearchContext.question}
                  sources={latestResearchContext.sources}
                  isOpen={isResearchRailOpen}
                  onClose={() => setIsResearchRailOpen(false)}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Input area — centered, auto-growing ── */}
      <div className="flex-shrink-0">
        <div className={`mx-auto w-full ${useResearchRailWideLayout ? 'max-w-[min(108rem,calc(100vw-2rem))]' : 'max-w-[min(68rem,calc(100vw-2rem))]'} px-4 pb-4 pt-2 md:px-5`}>

          {/* Image preview row */}
          {pastedImage && (
            <div className="mb-2 rounded-lg border border-zinc-700/50 bg-zinc-900/80 p-2.5">
              <div className="flex items-start gap-3">
                <img
                  src={pastedImage.preview}
                  alt="Pasted screenshot"
                  className="h-14 w-auto rounded border border-zinc-600/50 object-contain"
                />
                <div className="flex-1 space-y-1.5">
                  <input
                    ref={descriptionRef}
                    type="text"
                    value={imageDescription}
                    onChange={(e) => setImageDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                      if (e.key === 'Escape') clearImage();
                    }}
                    placeholder="Describe this image..."
                    className="w-full rounded-md border border-zinc-700/50 bg-zinc-800/60 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                  />
                  <input
                    type="text"
                    value={imageQuestion}
                    onChange={(e) => setImageQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                      if (e.key === 'Escape') clearImage();
                    }}
                    placeholder="Question (optional)"
                    className="w-full rounded-md border border-zinc-700/50 bg-zinc-800/60 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                  />
                </div>
                <button onClick={clearImage} className="rounded-md p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300" title="Remove image (Esc)">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Attached files row */}
          {attachedFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachedFiles.map((file) => (
                <div key={file.id} className="group/file flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-600">
                  <FileText className="h-3 w-3 text-zinc-500" />
                  <span className="max-w-[120px] truncate">{file.name}</span>
                  <span className="text-[10px] text-zinc-600">{(file.sizeBytes / 1024).toFixed(1)}KB</span>
                  <button onClick={() => removeFile(file.id)} className="ml-0.5 rounded p-0.5 text-zinc-700 transition-colors hover:text-red-400" title="Remove">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* The input box */}
          <motion.div
            className={`relative flex flex-col overflow-visible rounded-[1.25rem] border transition-all ${
              deliveryRoute === 'broadcast'
                ? studioBuilderChrome
                  ? 'border-blue-200 bg-white shadow-sm'
                  : 'border-blue-500/15 bg-zinc-950/82 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.55)]'
                : studioBuilderChrome
                  ? 'border-zinc-200 bg-white shadow-sm'
                  : 'border-zinc-800/60 bg-zinc-950/82 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.55)]'
            }`}
            animate={canSend ? { borderColor: deliveryRoute === 'broadcast' ? 'rgba(96,165,250,0.24)' : studioBuilderChrome ? 'rgba(228,228,231,1)' : 'rgba(63,63,70,0.75)' } : {}}
            transition={{ duration: 0.2 }}
          >
            <AnimatePresence initial={false}>
              {deliveryRoute === 'broadcast' && (
                <BroadcastStrip
                  onlineCount={onlineIdeCount}
                  clients={globalClients}
                  models={ideModels}
                  selectedModel={broadcastModel}
                  onModelChange={setBroadcastModel}
                  targetIds={broadcastTargetClientIds}
                  onTargetChange={(ids) => setBroadcastTargetClientIds(ids.filter((id) => id !== '__all__'))}
                  perIdeConfigs={perIdeConfigs}
                  onPerIdeConfigChange={setPerIdeConfigs}
                  chatApps={ideChatApps}
                  selectedChatApp={broadcastChatApp}
                  onChatAppChange={(appId) => { setBroadcastChatApp(appId); setBroadcastSession(''); }}
                  chatSessions={ideChatSessions}
                  selectedSession={broadcastSession}
                  onSessionChange={setBroadcastSession}
                  onDisconnect={() => { setDeliveryRoute('vai'); setBroadcastMode(false); }}
                  onConnectIde={() => setActivePanel('settings')}
                />
              )}
            </AnimatePresence>

            <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2 ${
              studioBuilderChrome ? 'border-zinc-200/80 bg-zinc-50/80' : 'border-zinc-800/75 bg-zinc-950/72'
            }`}>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {composerStateChips.map((chip) => {
                  const toneClass = chip.tone === 'blue'
                    ? studioBuilderChrome
                      ? 'border-sky-200 bg-sky-50 text-sky-700'
                      : 'border-sky-500/20 bg-sky-500/10 text-sky-200'
                    : chip.tone === 'amber'
                      ? studioBuilderChrome
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                      : chip.tone === 'emerald'
                        ? studioBuilderChrome
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                        : studioBuilderChrome
                          ? 'border-violet-200 bg-violet-50 text-violet-700'
                          : 'border-violet-500/20 bg-violet-500/10 text-violet-200';

                  return (
                    <span
                      key={chip.key}
                      className={`rounded-md border px-2.5 py-1 text-[10px] font-medium tracking-[0.02em] ${toneClass}`}
                    >
                      {chip.label}
                    </span>
                  );
                })}
                <span className={`hidden min-w-0 flex-1 truncate text-[11px] lg:inline ${studioBuilderChrome ? 'text-zinc-500' : 'text-zinc-500'}`}>
                  {composerAssistText}
                </span>
              </div>

              <div className="hidden items-center gap-3 md:flex">
                {composerHintChips.map((hint) => (
                  <span
                    key={hint.key}
                    className={`text-[10px] ${studioBuilderChrome ? 'text-zinc-500' : 'text-zinc-500'}`}
                  >
                    {hint.label}
                  </span>
                ))}
              </div>
            </div>

            {(buildActivity.length > 0 || transientActivity.length > 0) && (
              <div className={`border-b px-3.5 py-2.5 ${
                studioBuilderChrome ? 'border-zinc-200/80 bg-white/70' : 'border-zinc-800/75 bg-zinc-950/58'
              }`}>
                <button
                  type="button"
                  onClick={() => setActivityCollapsed((value) => !value)}
                  className={`flex w-full items-center justify-between gap-3 text-left ${
                    studioBuilderChrome ? 'text-zinc-700' : 'text-zinc-300'
                  }`}
                >
                  <div className="min-w-0">
                    <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                      studioBuilderChrome ? 'text-zinc-500' : 'text-zinc-600'
                    }`}>
                      Activity {activityCollapsed ? `• ${activitySummary}` : ''}
                    </div>
                    {activityCollapsed && (
                      <div className={`mt-1 truncate text-[11px] ${
                        studioBuilderChrome ? 'text-zinc-500' : 'text-zinc-400'
                      }`}>
                        {buildStatus.message || 'Recent project writes and startup progress'}
                      </div>
                    )}
                  </div>
                  {activityCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                </button>

                {!activityCollapsed && buildActivity.length > 0 && (
                  <div className="space-y-1.5">
                    {buildActivity.slice(-5).map((a) => (
                      <div key={a.id} className="flex min-w-0 items-start gap-2 text-[11px] leading-snug">
                        <FileText className={`mt-0.5 h-3 w-3 shrink-0 ${studioBuilderChrome ? 'text-zinc-400' : 'text-zinc-500'}`} />
                        <span className="min-w-0">
                          <span className={studioBuilderChrome ? 'font-medium text-zinc-700' : 'font-medium text-zinc-300'}>Wrote</span>{' '}
                          <code className={`break-all rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                            studioBuilderChrome ? 'bg-zinc-100 text-zinc-800' : 'bg-zinc-900 text-zinc-200'
                          }`}>
                            {a.detail}
                          </code>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {!activityCollapsed && transientActivity.length > 0 && (
                  <AnimatePresence initial={false}>
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className={`${buildActivity.length > 0 ? 'mt-2.5' : 'mt-2'} flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${
                        studioBuilderChrome ? 'text-zinc-600' : 'text-zinc-400'
                      }`}
                    >
                      {transientActivity.map((item) => {
                        const toneClass = item.tone === 'blue'
                          ? studioBuilderChrome ? 'text-blue-700' : 'text-blue-300'
                          : item.tone === 'amber'
                            ? studioBuilderChrome ? 'text-amber-700' : 'text-amber-300'
                            : item.tone === 'orange'
                              ? 'text-orange-500'
                              : studioBuilderChrome ? 'text-violet-700' : 'text-violet-300';
                        const dotClass = item.tone === 'orange'
                          ? 'bg-orange-500'
                          : toneClass.replace('text-', 'bg-');
                        const detailMuted = studioBuilderChrome ? 'text-zinc-500' : 'text-zinc-400';

                        return (
                          <div key={item.key} className="flex min-w-0 items-center gap-2">
                            <span className={`inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${dotClass}`} />
                            <span className={`truncate font-medium ${toneClass}`}>{item.label}</span>
                            <span className={`hidden max-w-[42rem] truncate lg:inline ${detailMuted}`}>{item.detail}</span>
                          </div>
                        );
                      })}
                    </motion.div>
                  </AnimatePresence>
                )}

              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                const v = e.target.value;
                const pos = e.target.selectionStart ?? v.length;
                setInput(v);
                syncMentionFromTextarea(v, pos);
              }}
              onSelect={(e) => {
                const ta = e.currentTarget;
                syncMentionFromTextarea(ta.value, ta.selectionStart ?? ta.value.length);
              }}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (mentionAt !== null) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (filteredIdeMentions.length > 0) {
                      setMentionSelected((i) => (i + 1) % filteredIdeMentions.length);
                    }
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (filteredIdeMentions.length > 0) {
                      setMentionSelected((i) => (i - 1 + filteredIdeMentions.length) % filteredIdeMentions.length);
                    }
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setMentionAt(null);
                    mentionQueryPrevRef.current = '';
                    return;
                  }
                  if ((e.key === 'Enter' || e.key === 'Tab') && filteredIdeMentions.length > 0) {
                    e.preventDefault();
                    applyIdeMention(filteredIdeMentions[mentionSelected]);
                    return;
                  }
                  if ((e.key === 'Enter' || e.key === 'Tab') && filteredIdeMentions.length === 0) {
                    e.preventDefault();
                    setMentionAt(null);
                    mentionQueryPrevRef.current = '';
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                pastedImage
                  ? 'Describe what you need help with...'
                  : deliveryRoute === 'broadcast'
                    ? `Message ${onlineIdeCount} connected IDE${onlineIdeCount === 1 ? '' : 's'}...${onlineIdeCount > 0 ? ' · @ route' : ''}`
                    : onlineIdeCount > 0
                      ? `${MODE_PLACEHOLDERS[mode]} · @ IDE`
                      : MODE_PLACEHOLDERS[mode]
              }
              rows={1}
              className={`resize-none overflow-y-auto bg-transparent px-4 pb-2.5 pt-2.5 text-sm leading-relaxed focus:outline-none ${
                studioBuilderChrome ? 'text-zinc-900 placeholder-zinc-400' : 'text-zinc-100 placeholder-zinc-600'
              }`}
              style={{ minHeight: `${MIN_INPUT_HEIGHT}px`, maxHeight: `${MAX_INPUT_HEIGHT}px` }}
            />
            {mentionAt !== null && textareaRef.current && (
              <IdeMentionMenu
                items={filteredIdeMentions}
                selectedIndex={mentionSelected}
                onSelect={applyIdeMention}
                onClose={() => {
                  setMentionAt(null);
                  mentionQueryPrevRef.current = '';
                }}
                anchorRect={textareaRef.current.getBoundingClientRect()}
                emptyHint={
                  filteredIdeMentions.length > 0
                    ? undefined
                    : ideMentionCatalog.length === 0
                      ? 'No IDE connected — use + IDE in the toolbar'
                      : 'No matching IDE — try all, vscode, cursor…'
                }
              />
            )}

            {/* Bottom toolbar */}
            <div className="flex items-center justify-between px-3 pb-2.5">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-800/80 hover:text-zinc-300"
                  title="Attach files"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <ModeSelector />
                {roundtablePeers.length > 0 && (
                  <button
                    onClick={() => setDeliveryRoute(deliveryRoute === 'group' ? 'vai' : 'group')}
                    className={`flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-all ${
                      deliveryRoute === 'group'
                        ? 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30'
                        : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                    }`}
                    title={deliveryRoute === 'group' ? `Group chat • ${roundtablePeers.length} IDE${roundtablePeers.length === 1 ? '' : 's'}` : 'Click to broadcast to connected IDEs'}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>{roundtablePeers.length}</span>
                  </button>
                )}
                {onlineIdeCount > 0 && (
                  <button
                    onClick={() => {
                      const next = deliveryRoute === 'broadcast' ? 'vai' : 'broadcast';
                      setDeliveryRoute(next);
                      setBroadcastMode(next === 'broadcast');
                    }}
                    className={`flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-all ${
                      deliveryRoute === 'broadcast'
                        ? 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30'
                        : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                    }`}
                    title={deliveryRoute === 'broadcast' ? `Broadcasting to ${onlineIdeCount} IDE${onlineIdeCount === 1 ? '' : 's'}` : 'Click to broadcast to connected IDEs'}
                  >
                    {deliveryRoute === 'broadcast' ? (
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-50" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-400" />
                      </span>
                    ) : (
                      <Wifi className="h-3.5 w-3.5" />
                    )}
                    <span>{onlineIdeCount}</span>
                  </button>
                )}
                {/* IDE quick-connect dropdown */}
                {ideTargets.length > 0 && (
                  <div className="relative">
                    <button
                      ref={ideButtonRef}
                      onClick={() => setShowIdePopup(!showIdePopup)}
                      className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-all ${
                        showIdePopup
                          ? 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30'
                          : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                      }`}
                      title="Connect to IDE"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">IDE</span>
                    </button>
                    {showIdePopup && createPortal(
                      <div
                        ref={idePopupRef}
                        className="fixed z-[200] w-64 rounded-xl border border-zinc-700/60 bg-zinc-900 shadow-2xl shadow-black/40"
                        style={{
                          bottom: (ideButtonRef.current ? window.innerHeight - ideButtonRef.current.getBoundingClientRect().top + 6 : 60),
                          left: ideButtonRef.current?.getBoundingClientRect().left ?? 0,
                        }}
                      >
                        <div className="border-b border-zinc-800/60 px-3 py-2">
                          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Connect IDE</div>
                        </div>
                        <div className="max-h-60 overflow-y-auto p-1.5 combobox-scroll">
                          {ideTargets.filter((t) => t.id !== 'desktop').map((target) => {
                            const status = ideClientStatus.get(target.id);
                            const isOnline = status?.online ?? false;
                            const hasClients = (status?.clientIds?.length ?? 0) > 0;
                            const isConnected = deliveryRoute === 'broadcast' && status?.clientIds?.some((cid: string) => broadcastTargetClientIds.includes(cid));
                            return (
                              <button
                                key={target.id}
                                onClick={() => {
                                  if (isConnected) {
                                    setBroadcastMode(false);
                                    setDeliveryRoute('vai');
                                    setShowIdePopup(false);
                                    toast.success(`Disconnected from ${target.label}`);
                                  } else if (hasClients) {
                                    quickConnectIde(target.label, status!.clientIds);
                                  } else {
                                    setActivePanel('settings');
                                    setShowIdePopup(false);
                                    toast('Install the VeggaAI extension in ' + target.label);
                                  }
                                }}
                                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                                  isConnected
                                    ? 'bg-emerald-500/10 text-emerald-200 hover:bg-red-500/10 hover:text-red-200'
                                    : 'text-zinc-300 hover:bg-zinc-800'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className={`h-2 w-2 shrink-0 rounded-full ${
                                    isOnline ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                                      : hasClients ? 'bg-amber-500'
                                      : 'bg-zinc-600'
                                  }`} />
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium">{target.label}</div>
                                    <div className="text-[10px] text-zinc-500">
                                      {isConnected ? 'Connected' : isOnline ? `Active · ${status?.lastActivity}` : hasClients ? status?.lastActivity : 'Not setup'}
                                    </div>
                                  </div>
                                </div>
                                <span className={`shrink-0 text-[10px] font-medium ${
                                  isConnected ? '' : isOnline ? 'text-blue-400' : hasClients ? 'text-amber-400' : 'text-zinc-600'
                                }`}>
                                  {isConnected ? 'Disconnect' : hasClients ? 'Connect' : 'Setup'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>,
                      document.body,
                    )}
                  </div>
                )}
                {trainingWorkspace && (
                  <>
                    <div className="mx-0.5 h-4 w-px bg-zinc-800" />
                    <button
                      onClick={() => setLearningEnabled(!learningEnabled)}
                      className={`flex h-7 items-center gap-1 rounded-lg px-1.5 text-xs transition-colors ${
                        learningEnabled
                          ? 'text-emerald-400 hover:bg-emerald-900/30'
                          : 'text-zinc-600 hover:bg-zinc-800/80 hover:text-zinc-400'
                      }`}
                      title={learningEnabled ? 'Owner training armed — this chat may teach Vai' : 'Owner training blocked — this chat will not teach Vai'}
                    >
                      <Brain className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium uppercase tracking-wider">{learningEnabled ? 'train' : 'safe'}</span>
                    </button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {charCount > 0 && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-[10px] tabular-nums text-zinc-600"
                  >
                    {charCount}
                  </motion.span>
                )}
                <AnimatePresence mode="wait">
                  {isStreaming ? (
                    <motion.button
                      key="stop"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      onClick={stopStreaming}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 transition-colors hover:bg-red-600/80 hover:text-white"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      title="Stop generating"
                    >
                      <motion.div
                        animate={{ rotate: [0, 90, 180, 270, 360] }}
                        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                      >
                        <Square className="h-3.5 w-3.5 fill-current" />
                      </motion.div>
                    </motion.button>
                  ) : (
                    <motion.button
                      key="send"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      onClick={() => handleSend()}
                      disabled={!canSend}
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-white transition-all duration-200 ${
                        canSend
                          ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                          : 'bg-zinc-800 text-zinc-600'
                      }`}
                      whileHover={canSend ? { scale: 1.05 } : {}}
                      whileTap={canSend ? { scale: 0.92 } : {}}
                      title="Send message (Enter)"
                    >
                      <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>

          <p className="mt-2 text-center text-[10px] text-zinc-700/60">
            Vai can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
}
