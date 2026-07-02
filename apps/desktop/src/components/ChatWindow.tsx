/**
 * ChatWindow — chat interface.
 *
 * Layout philosophy:
 *   • When no messages: minimal centered note (or blank); input bar at bottom is primary.
 *   • Messages appear above the anchored input.
 *   • New messages push previous ones up.
 *   • Smart auto-scroll during streaming.
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
import { VaiMark } from './brand/VaiMark.js';
import { useAutoScroll } from '../hooks/useAutoScroll.js';
import { useIntentStore, computeFallbackMap } from '../stores/intentStore.js';
import { apiFetch } from '../lib/api.js';
import {
  BookOpen, MessageCircle,
  Paperclip, X, FileText, ArrowUp, Square, ImagePlus,
  Brain, Bot, Wifi, Plus, Moon, Sun,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { WorkspaceLayoutControls } from './workspace/WorkspaceLayoutControls.js';
import { BroadcastStrip } from './BroadcastStrip.js';
import type { PerIdeConfig } from './BroadcastTargetPicker.js';
import { ResearchContextRail } from './chat/ResearchContextRail.js';
import { ChatEmptyState } from './chat/ChatEmptyState.js';
import { ConversationSourcesSidebar, aggregateConversationSources } from './chat/ConversationSourcesSidebar.js';
import { FileChangesBar, type FileChangeEntry } from './chat/FileChangesBar.js';
import { BackgroundProcessWindow } from './chat/BackgroundProcessWindow.js';
import { useBackgroundProcesses, useBackgroundTaskEvents } from '../hooks/useBackgroundProcesses.js';
import { CouncilProgressPanel } from './panels/CouncilProgressPanel.js';
import { deriveLiveCouncilFromProgressSteps } from './chat/process-step-enrich.js';
import { ComposerProcessStrip } from './chat/ComposerProcessStrip.js';
import { ProcessDepthControl } from './chat/ProcessDepthControl.js';
import { MicButton } from './chat/MicButton.js';
import { MicDeviceMenu } from './chat/MicDeviceMenu.js';
import { useVoiceDictation } from '../hooks/useVoiceDictation.js';
import { detectCorrections, mishearingPrompt } from '../lib/voice/correction-detection.js';
import { useComposerActivity } from '../hooks/useComposerActivity.js';
import { resolveSendTimeWorkIntent } from '../lib/auto-sandbox-intent.js';
import { extractFilesFromMarkdown } from '../lib/file-extractor.js';
import { resolveLatestResearchContext } from '../lib/research-context.js';
import {
  buildIdeMentionItems,
  filterMentionItems,
  mentionSlugSet,
  stripLeadingIdeMentions,
  type IdeMentionItem,
} from '../lib/ideMentions.js';
import { IdeMentionMenu } from './IdeMentionMenu.js';
import { pickSandboxContextPaths, shouldAttachSandboxContext } from '../lib/sandbox-context.js';

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
  /** Set when the user answered the "build or answer?" confirm — skip the ambiguity gate. */
  buildConfirmResolved?: 'build' | 'answer';
};

function formatRelativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
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

// 10k chars ≈ a full council-built App.tsx. Edits regenerate COMPLETE files
// from these snapshots, so a tight cap here silently amputates code: the
// model rewrites what it can see and the applied file loses the rest. The
// truncation marker lets the server-side edit pipeline exclude any file that
// still overflows instead of editing it blind.
function truncateSnapshotContent(content: string, limit = 10000): string {
  if (content.length <= limit) return content;
  return `${content.slice(0, limit).trimEnd()}\n/* truncated for prompt context */`;
}

function describeSendFailure(error: unknown, fallback = 'Unable to send message. Check the local runtime and try again.'): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
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
    queuedMessage,
    setQueuedMessage,
    createConversation,
    updateConversationMode,
    learningEnabled,
    setLearningEnabled,
    trainingWorkspace,
    setTrainingWorkspace,
    processDepth,
    setProcessDepth,
  } = useChatStore();
  const { selectedModelId, selectedFrontendId, frontends, ideTargets } = useSettingsStore();
  const {
    mode,
    showBuilderPanel,
    toggleBuilderPanel,
    expandBuilder,
    setActivePanel,
    setBuildStatus,
    setMode,
    themePreference,
    toggleThemePreference,
  } = useLayoutStore();
  const { showCouncilPanel, toggleCouncilPanel } = useLayoutStore();

  // Auto-open the right Council Progress panel when a new assistant message arrives with council data.
  // This makes the "live" council review visible immediately in the UI for better transparency and steering.
  const latestAssistantWithCouncil = useMemo(() => {
    return [...messages].reverse().find(m => m.role === 'assistant' && m.thinking?.council);
  }, [messages]);

  const hasLiveCouncilStream = useMemo(() => {
    if (!isStreaming) return false;
    const steps = messages[messages.length - 1]?.progressSteps ?? [];
    return steps.some((step) => step.stage?.startsWith('council'));
  }, [isStreaming, messages]);

  useEffect(() => {
    if ((latestAssistantWithCouncil || hasLiveCouncilStream) && !showCouncilPanel) {
      toggleCouncilPanel();
    }
  }, [latestAssistantWithCouncil, hasLiveCouncilStream, showCouncilPanel, toggleCouncilPanel]);
  const studioBuilderChrome = themePreference === 'light';
  const isOwner = useAuthStore((state) => state.isOwner);
  const ownerFeaturesHidden = useAuthStore((state) => state.ownerFeaturesHidden);
  const persistentProjectId = useSandboxStore((state) => state.persistentProjectId);
  const buildActivity = useSandboxStore((state) => state.buildActivity);
  const clearBuildActivity = useSandboxStore((state) => state.clearBuildActivity);
  const lastDiff = useSandboxStore((state) => state.lastDiff);
  const lastRevisionId = useSandboxStore((state) => state.lastRevisionId);
  const revertRevision = useSandboxStore((state) => state.revertRevision);
  const sandboxStatus = useSandboxStore((state) => state.status);
  const sandboxFiles = useSandboxStore((state) => state.files);
  const sandboxProjectName = useSandboxStore((state) => state.projectName);
  const sandboxProjectId = useSandboxStore((state) => state.projectId);
  const sandboxDevPort = useSandboxStore((state) => state.devPort);
  const fetchPeers = useCollabStore((state) => state.fetchPeers);
  const peers = useCollabStore((state) => state.peers);
  const createAudit = useCollabStore((state) => state.createAudit);
  const fetchAudits = useCollabStore((state) => state.fetchAudits);
  const audits = useCollabStore((state) => state.audits);
  const globalClients = useCollabStore((state) => state.globalClients);
  const fetchGlobalClients = useCollabStore((state) => state.fetchGlobalClients);

  const [input, setInput] = useState('');
  // Agent-mode build confirm: when set, the composer asks "answer this, or build an app?" instead
  // of silently scaffolding. Holds the original text so either choice re-sends it correctly.
  const [pendingBuildConfirm, setPendingBuildConfirm] = useState<{ text: string } | null>(null);
  const [pastedImage, setPastedImage] = useState<PastedImage | null>(null);
  const [imageDescription, setImageDescription] = useState('');
  const [imageQuestion, setImageQuestion] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  /** Explicit "Image" output mode — when on, this turn is answered with a generated image. */
  const [imageMode, setImageMode] = useState(false);
  const [deliveryRoute, setDeliveryRoute] = useState<DeliveryRoute>('vai');
  const [broadcastModel, setBroadcastModel] = useState('gpt-4o');
  const [broadcastChatApp, setBroadcastChatApp] = useState('chat');
  const [broadcastSession, setBroadcastSession] = useState('new-session');
  const [perIdeConfigs, setPerIdeConfigs] = useState<PerIdeConfig[]>([]);
  const [showIdePopup, setShowIdePopup] = useState(false);
  const [isResearchRailOpen, setIsResearchRailOpen] = useState(false);
  const [isConversationSourcesOpen, setIsConversationSourcesOpen] = useState(false);
  // Collapsed by default: the strip sits above the composer and expands on
  // demand — it must never crowd the message input (direct user feedback).
  const [activityCollapsed, setActivityCollapsed] = useState(true);
  const [processStripExpanded, setProcessStripExpanded] = useState(false);
  // …but while a turn is streaming, background tasks auto-expand.
  // Composer strip stays collapsed (headline only) — full timeline lives in the message bubble.
  useEffect(() => {
    if (isStreaming) setActivityCollapsed(false);
    if (!isStreaming) setProcessStripExpanded(false);
  }, [isStreaming]);

  const streamingProgressSteps = useMemo(() => {
    if (!isStreaming) return [];
    const last = messages[messages.length - 1];
    return last?.role === 'assistant' ? (last.progressSteps ?? []) : [];
  }, [isStreaming, messages]);

  const composerActivity = useComposerActivity(streamingProgressSteps, isStreaming);

  useBackgroundTaskEvents();
  const backgroundProcesses = useBackgroundProcesses();

  useEffect(() => {
    const toggleSources = () => setIsConversationSourcesOpen((open) => !open);
    window.addEventListener('vai:toggle-sources-panel', toggleSources);
    return () => window.removeEventListener('vai:toggle-sources-panel', toggleSources);
  }, []);
  /** `@` mention: start index in `input`, or null when not in a mention token */
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSelected, setMentionSelected] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // ── Voice dictation ──────────────────────────────────────────────────────────
  // What the last dictation inserted (the baseline we compare the sent text against
  // to spot mishearings). Cleared when the user clears the composer or sends.
  const dictatedBaselineRef = useRef<string>('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [mishearAsk, setMishearAsk] = useState<{ prompt: string; term: string } | null>(null);
  // Chosen mic for dictation (the right-click device menu). Persisted so it survives reloads;
  // empty string = system default.
  const [micDeviceId, setMicDeviceId] = useState<string>(() => {
    try { return localStorage.getItem('vai-voice-device') ?? ''; } catch { return ''; }
  });
  const selectMicDevice = useCallback((id: string) => {
    setMicDeviceId(id);
    try { localStorage.setItem('vai-voice-device', id); } catch { /* non-fatal */ }
  }, []);
  // Where (if anywhere) the right-click mic device menu is open.
  const [micMenuAt, setMicMenuAt] = useState<{ x: number; y: number } | null>(null);
  const dictation = useVoiceDictation({
    disabled: isStreaming,
    deviceId: micDeviceId || undefined,
    onInterim: (text) => setInterimTranscript(text),
    onFinal: (text) => {
      setInterimTranscript('');
      // Insert at cursor (or append), then remember what we dictated so a later
      // manual edit can be detected as a correction / mishearing.
      const ta = textareaRef.current;
      setInput((prev) => {
        const start = ta?.selectionStart ?? prev.length;
        const end = ta?.selectionEnd ?? prev.length;
        const sep = prev && start === prev.length && !/\s$/.test(prev) ? ' ' : '';
        const next = prev.slice(0, start) + sep + text + prev.slice(end);
        dictatedBaselineRef.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  });
  // Personal dictionary of corrected terms. Stored locally for now (no server
  // endpoint yet); the seam is here so it can later POST to a /api/dictionary
  // route and feed the improvement loop's grounding signals.
  const addTermToDictionary = useCallback((term: string) => {
    const clean = term.trim();
    if (!clean) return;
    try {
      const key = 'vai-voice-dictionary';
      const existing = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
      if (!existing.some((t) => t.toLowerCase() === clean.toLowerCase())) {
        localStorage.setItem(key, JSON.stringify([...existing, clean]));
      }
    } catch (err) {
      console.warn('[voice] could not persist dictionary term:', err);
    }
  }, []);
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
  const latestResearchContext = useMemo(() => resolveLatestResearchContext(messages), [messages]);
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
  }, [messages.length]);  
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
  const conversationSourcesCount = useMemo(
    () => aggregateConversationSources(messages).length,
    [messages],
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

  /* ── Preview shell can push example prompts into chat ── */
  useEffect(() => {
    const onPrefill = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt?.trim();
      if (!prompt) return;
      setInput(prompt);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(prompt.length, prompt.length);
        adjustTextareaHeight();
      });
    };
    window.addEventListener('vai:prefill-chat', onPrefill);
    return () => window.removeEventListener('vai:prefill-chat', onPrefill);
  }, [adjustTextareaHeight]);

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

  /** Queue the typed text to auto-send when the current turn finishes. */
  const handleQueue = () => {
    const text = input.trim();
    if (!text || !isStreaming) return;
    setQueuedMessage(text);
    setInput('');
  };

  /** Inject the typed text as live steering for the running turn. Falls back to
   *  queueing if there's no conversation to steer (shouldn't happen mid-stream). */
  const handleSteer = async () => {
    const text = input.trim();
    if (!text || !isStreaming) return;
    if (!activeConversationId) { handleQueue(); return; }
    try {
      await useChatStore.getState().postSteer({
        conversationId: activeConversationId,
        signal: 'prefer',
        handler: 'conversation-reasoning',
        note: text,
        scope: 'conversation',
      });
      setInput('');
    } catch {
      // If steering fails, don't lose the user's text — queue it instead.
      handleQueue();
    }
  };

  const handleSend = async (overrideText?: string, options?: SendOptions) => {
    const isOverrideSend = typeof overrideText === 'string';
    const text = (overrideText ?? input).trim();
    // Mid-stream submits become a queued follow-up rather than a no-op, so the
    // Enter key still does something useful while a turn is running.
    if (isStreaming) {
      if (!isOverrideSend && text) handleQueue();
      return;
    }
    if (!text) return;
    if (!isOverrideSend && pastedImage && !imageDescription.trim()) {
      descriptionRef.current?.focus();
      return;
    }

    // Correction learning: if this turn was dictated and the user edited a word
    // before sending, that edit is a likely mishearing. Surface a gentle, NON-
    // blocking "did we mishear you?" offer to add the corrected term to the
    // dictionary — exactly the signal the user asked us to detect. We only check
    // real composer sends (not programmatic overrides) and reset the baseline.
    if (!isOverrideSend && dictatedBaselineRef.current.trim()) {
      const correction = detectCorrections(dictatedBaselineRef.current, text);
      const ask = mishearingPrompt(correction);
      if (ask && correction.mishearings[0]) {
        setMishearAsk({ prompt: ask, term: correction.mishearings[0].corrected });
      }
      dictatedBaselineRef.current = '';
    }

    const forcedMode = options?.forceMode;
    const effectiveMode = forcedMode ?? mode;

    const sendTimeWorkIntent = resolveSendTimeWorkIntent({
      userPrompt: text,
      mode: effectiveMode,
      hasActiveProject,
    });

    // Anti-hijack: agent mode saw a build-ish ask but isn't sure you want an app scaffolded.
    // Ask once instead of silently entering the builder. The choice re-sends via handleSend with
    // buildConfirmResolved set, which forces the lane and skips this gate. 'answer' stays a normal
    // chat turn; 'build' forces builder mode.
    if (sendTimeWorkIntent.needsBuildConfirm && !options?.buildConfirmResolved && !forcedMode) {
      setPendingBuildConfirm({ text });
      return;
    }
    const confirmedBuild = options?.buildConfirmResolved === 'build';

    const nextConversationMode = forcedMode
      ?? (confirmedBuild ? 'builder'
        : effectiveMode === 'chat' && sendTimeWorkIntent.shouldPrimeBuilder
        ? 'builder'
        : effectiveMode);

    let convId = activeConversationId;
    if (!convId) {
      const modelId = selectedModelId ?? 'vai:v0';
      try {
        convId = await createConversation(modelId, nextConversationMode, {
          sandboxProjectId: sandboxProjectId ?? null,
        });
      } catch (error) {
        console.error('[VAI] Failed to create conversation', error);
        toast.error(describeSendFailure(error, 'Unable to create a new chat.'));
        return;
      }
    } else if (nextConversationMode !== mode) {
      try {
        await updateConversationMode(convId, nextConversationMode);
      } catch (error) {
        console.error('[VAI] Failed to update conversation mode', error);
        toast.error(describeSendFailure(error, 'Unable to switch chat mode.'));
        return;
      }
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

    if (nextConversationMode === 'builder' || sendTimeWorkIntent.shouldPrimeBuilder || confirmedBuild) {
      expandBuilder();
      setBuildStatus({
        step: 'generating',
        message: forcedMode === 'builder'
          ? 'Turning grounded brief into runnable output...'
          : sendTimeWorkIntent.buildStatusMessage ?? (confirmedBuild ? 'Preparing a runnable preview from this request...' : undefined),
      });
    }

    const systemPrompt = selectedFrontend
      ? `The user currently prefers the ${selectedFrontend.framework} shell (${selectedFrontend.id}). When proposing app architecture, scaffold targets, or sandbox templates, bias toward that shell while keeping the shared runtime and alternate shell compatibility in mind.`
      : undefined;

    // Inject sandbox context when a project is active so Vai knows what's running.
    // Hash the file list to avoid re-sending the same blob on every message.
    const sandboxContextPrompt = await (async () => {
      if (!sandboxProjectId || (sandboxStatus !== 'running' && sandboxStatus !== 'writing' && sandboxStatus !== 'idle')) return undefined;
      if (!shouldAttachSandboxContext(text)) return undefined;

      const summaryPaths = pickSandboxContextPaths(sandboxFiles, text, 6);
      const snapshotPaths = pickSandboxContextPaths(sandboxFiles, text, 3);
      const fileListKey = summaryPaths.join('|');
      const contextHash = `${sandboxProjectId}:${sandboxDevPort ?? 'none'}:${fileListKey}`;
      const fileTreeUnchanged = lastSandboxContextHashRef.current === contextHash;
      lastSandboxContextHashRef.current = contextHash;

      const lines: string[] = [
        `ACTIVE SANDBOX PROJECT: "${sandboxProjectName || sandboxProjectId}" (project id: ${sandboxProjectId})`,
      ];
      if (sandboxDevPort) {
        lines.push(`Dev server is RUNNING at http://localhost:${sandboxDevPort}`);
      } else {
        lines.push('Dev server is NOT running yet.');
      }
      if (summaryPaths.length > 0) {
        if (!fileTreeUnchanged) {
          lines.push(`Most relevant project files (${summaryPaths.length}/${sandboxFiles.length} shown):\n  ${summaryPaths.join('\n  ')}`);
        } else {
          lines.push(`Relevant project files unchanged (${summaryPaths.length} focused files retained, list omitted to save context).`);
        }
      }

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
      lines.push('Keep the answer tied to the active project only because this turn explicitly references that project context.');
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
      }, composedSystemPrompt, { imageMode });
      clearImage();
    } else {
      sendMessage(fullContent, undefined, composedSystemPrompt, { imageMode });
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

  const charCount = input.length;
  const canSend = input.trim().length > 0 && !isStreaming && (!pastedImage || imageDescription.trim().length > 0);

  const showProjectContextStrip = Boolean(sandboxProjectId);
  const draftWouldAttachProjectContext = Boolean(sandboxProjectId && shouldAttachSandboxContext(input));
  const draftContextPaths = useMemo(
    () => (draftWouldAttachProjectContext ? pickSandboxContextPaths(sandboxFiles, input, 4) : []),
    [draftWouldAttachProjectContext, input, sandboxFiles],
  );
  const shellModeLabel = `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
  const headerTitle = hasMessages ? 'Workspace' : 'Vai';
  const composerAssistText = pastedImage
    ? 'Describe the screenshot and ask the exact question you want answered.'
    : deliveryRoute === 'broadcast'
      ? 'Send one prompt to connected IDEs and compare the answers in this thread.'
      : showProjectContextStrip && draftWouldAttachProjectContext
        ? `This turn will include the live preview and ${draftContextPaths.length || 1} focused project file${draftContextPaths.length === 1 ? '' : 's'}.`
        : showProjectContextStrip
          ? 'General questions stay detached from the active project until you reference the app, preview, or files.'
        : hasMessages
          ? 'Use a sharper follow-up to keep the thread moving.'
          : 'Type here. Workspace context (files, editor) attaches automatically on relevant questions.';
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
        label: draftWouldAttachProjectContext
          ? `Context ${draftContextPaths.length || 1} file${draftContextPaths.length === 1 ? '' : 's'}`
          : persistentProjectId
            ? 'Synced project idle'
            : 'Project attached idle',
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
    draftContextPaths.length,
    draftWouldAttachProjectContext,
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
  useEffect(() => {
    setActivityCollapsed(false);
  }, [activeConversationId]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-row overflow-hidden">
      {/* Main chat content area - takes remaining space so the right Council panel can sit beside it without crushing the chat or causing horizontal overflow */}
      <div
        data-studio-builder-chrome={studioBuilderChrome ? 'true' : undefined}
        className={`relative flex h-full min-w-0 flex-1 flex-col overflow-hidden shell-canvas`}
      >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.tsx,.ts,.js,.jsx,.json,.css,.html,.py,.sh,.yaml,.yml,.toml,.xml,.sql,.csv,.env,.log"
        onChange={handleFileUpload}
        className="hidden"
      />

      <div className="shell-header">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <h2 className={`truncate font-display text-[14px] font-semibold tracking-[-0.01em] ${studioBuilderChrome ? 'text-[color:var(--shell-text)]' : 'text-zinc-200'}`}>
                {headerTitle}
              </h2>
            </div>
            <span
              className={`shell-chip hidden rounded-md px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${
                studioBuilderChrome ? '' : 'border-zinc-800/70 bg-zinc-950 text-zinc-500'
              }`}
            >
              {shellModeLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleThemePreference}
              className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
                studioBuilderChrome
                  ? 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                  : 'border-[color:var(--shell-line-soft)] bg-[color:var(--panel)]/40 text-[color:var(--color-muted)] hover:border-[color:var(--border)] hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]'
              }`}
              title={studioBuilderChrome ? 'Switch to dark theme' : 'Switch to light theme'}
            >
              {studioBuilderChrome ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{studioBuilderChrome ? 'Dark' : 'Light'}</span>
            </button>
            <WorkspaceLayoutControls
              surface="chat"
              studio={studioBuilderChrome}
              sourcesOpen={isConversationSourcesOpen}
              sourcesCount={conversationSourcesCount}
              onToggleSources={() => setIsConversationSourcesOpen((open) => !open)}
            />
          </div>
        </div>
      </div>

      {/* ── Messages + floating composer (messages scroll behind input) ── */}
      <div
        className="composer-stack relative min-h-0 flex-1"
        data-empty-chat={!hasMessages ? 'true' : undefined}
      >
      {!hasMessages && (
        <>
          <div aria-hidden className="chat-ambient" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 bg-dither-noise bg-[length:200px_200px] opacity-[0.015] mix-blend-overlay"
          />
        </>
      )}
      <div
        ref={scrollRef}
        className="composer-scroll absolute inset-0 z-[1] overflow-y-auto overflow-x-hidden"
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
                  <div className="flex h-5 w-5 items-center justify-center">
                    <VaiMark size={15} />
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
            <div className={`rounded-2xl border p-3 backdrop-blur-sm ${studioBuilderChrome ? 'border-emerald-600/25 bg-emerald-50' : 'border-emerald-500/20 bg-emerald-500/10'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`flex items-center gap-2 text-sm font-medium ${studioBuilderChrome ? 'text-emerald-900' : 'text-zinc-100'}`}>
                    <Brain className={`h-4 w-4 ${studioBuilderChrome ? 'text-emerald-600' : 'text-emerald-300'}`} />
                    Owner training workspace
                    {trainingWorkspace && (
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${studioBuilderChrome ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
                        isolated
                      </span>
                    )}
                  </div>
                  <div className={`mt-1 text-xs ${studioBuilderChrome ? 'text-emerald-900/70' : 'text-zinc-500'}`}>
                    {trainingWorkspace
                      ? 'User chats do not train Vai. This workspace is the only place where owner-curated conversations can be marked as teachable.'
                      : 'Learning is locked off for normal chats. Start or enter an owner training workspace when you want to curate training manually.'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {showOwnerFeatures && !trainingWorkspace && (
                    <button
                      onClick={() => setTrainingWorkspace(true)}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${studioBuilderChrome ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800 hover:bg-emerald-600/20' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'}`}
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
            onOpenSettings={() => setActivePanel('settings')}
            onPrompt={(prompt) => {
              setInput(prompt);
              requestAnimationFrame(() => {
                const ta = textareaRef.current;
                if (!ta) return;
                ta.focus();
                ta.setSelectionRange(prompt.length, prompt.length);
                adjustTextareaHeight();
              });
            }}
          />
        ) : (
          /* ═══════════ MESSAGE THREAD ═══════════ */
          /* justify-end makes sparse messages sit at the bottom, above input */
          <div className={`mx-auto flex min-h-full w-full ${useResearchRailWideLayout ? 'max-w-[min(108rem,calc(100%-2rem))]' : 'max-w-[min(68rem,calc(100%-2rem))]'} flex-col px-4 py-5 md:px-5`}>
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
                  const isLatestResearch = latestResearchContext?.assistantIndex === idx;
                  const isLatestMessage = idx === messages.length - 1;
                  // Route source detail into the right-side conversation sidebar for EVERY
                  // assistant message that has sources — not just the latest — so older
                  // turns don't keep showing the giant inline "Supporting sources" block.
                  const messageHasSources = msg.role === 'assistant' && Boolean(msg.sources?.length);
                  const sourceRailHandlesSources = messageHasSources;
                  // Latest assistant message's follow-ups now render in the sidebar's Related
                  // section (only when the sidebar can actually show them, i.e. when there are
                  // sources somewhere in the conversation), so suppress the inline block.
                  const followUpsHandledBySidebar = isLatestMessage
                    && msg.role === 'assistant'
                    && Boolean(msg.followUps?.length)
                    && messages.some((m) => m.role === 'assistant' && Boolean(m.sources?.length));
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
                    >
                      <MessageBubble
                        role={msg.role}
                        content={msg.content}
                        messageId={msg.id}
                        imageId={msg.imageId}
                        imagePreview={msg.imagePreview}
                        respondingModelId={msg.respondingModelId}
                        fallback={msg.fallback}
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
                        sourcePresentation={msg.sourcePresentation}
                        turnKind={msg.turnKind}
                        followUps={msg.followUps}
                        confidence={msg.confidence}
                        groundedBuildBrief={msg.groundedBuildBrief}
                        thinking={msg.thinking}
                        researchTrace={msg.researchTrace}
                        verification={msg.verification}
                        imageGenSteps={msg.imageGenSteps}
                        progressSteps={msg.progressSteps}
                        liveDraft={msg.liveDraft}
                        infoBlocks={msg.infoBlocks}
                        feedback={msg.feedback}
                        onFeedback={(helpful) => useChatStore.getState().setFeedback(msg.id, helpful)}
                        onFollowUp={(question) => { void handleSend(question); }}
                        onGroundedExecute={(prompt) => { void handleSend(prompt, { forceMode: 'builder' }); }}
                        sender={msg.sender}
                        isAutoRepair={msg.isAutoRepair}
                        repairAttempt={msg.repairAttempt}
                        compactResearchChrome={compactResearchChrome}
                        isLatestResearchMessage={isLatestResearch}
                        sourceRailHandlesSources={sourceRailHandlesSources}
                        sourceRailOpen={sourceRailHandlesSources && isConversationSourcesOpen}
                        onOpenSources={sourceRailHandlesSources ? () => setIsConversationSourcesOpen(true) : undefined}
                        followUpsHandledBySidebar={followUpsHandledBySidebar}
                      />
                    </motion.div>
                  );
                })}

                {/* The live process view is owned by the streaming assistant bubble's
                    ProcessTree (expandable, branded, flat). The old standalone
                    TypingIndicator rendered the SAME progress steps a second time —
                    the "double box" the audit caught — so it's intentionally gone. */}

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

      <div className="composer-dock">
        <div className={`composer-dock-inner relative z-[1] mx-auto w-full ${useResearchRailWideLayout ? 'max-w-[min(108rem,calc(100%-2rem))]' : 'max-w-[min(68rem,calc(100%-2rem))]'} px-4 pb-3 pt-2 md:px-5 md:pb-4`}>

          {/* Agent-mode build confirm: don't silently scaffold an app on an ambiguous ask. */}
          {pendingBuildConfirm && (
            <div className="mb-2 rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)] px-3.5 py-3">
              <div className="text-[13px] font-medium text-[color:var(--fg)]">
                Did you want an answer, or should I build an app for this?
              </div>
              <div className="mt-1 text-[11px] leading-4 text-[color:var(--color-muted)]">
                “{pendingBuildConfirm.text.length > 90 ? `${pendingBuildConfirm.text.slice(0, 90)}…` : pendingBuildConfirm.text}”
              </div>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const t = pendingBuildConfirm.text;
                    setPendingBuildConfirm(null);
                    void handleSend(t, { buildConfirmResolved: 'answer' });
                  }}
                  className="rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--fg)] transition-colors hover:opacity-90"
                >
                  Just answer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const t = pendingBuildConfirm.text;
                    setPendingBuildConfirm(null);
                    void handleSend(t, { buildConfirmResolved: 'build' });
                  }}
                  className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/15 px-3 py-1.5 text-[12px] font-medium text-[color:var(--fg)] transition-colors hover:opacity-90"
                >
                  Build an app
                </button>
                <button
                  type="button"
                  onClick={() => setPendingBuildConfirm(null)}
                  className="ml-auto rounded-lg px-2 py-1.5 text-[11px] text-[color:var(--color-muted)] transition-colors hover:text-[color:var(--fg)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

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
          {/* File-changes action bar — files changed this turn, with diff stats
               (when the backend reports them), one-click open into the code view,
               and turn-level Keep/Discard. The ONLY surface for file mutations;
               process steps live in-bubble (ProcessTree), council in the right
               panel. Keeps every surface showing distinct information. */}
          {(() => {
            // Prefer the server-computed diff (true +added/−removed) for the latest
            // write; fall back to bare paths from buildActivity when no diff yet.
            const diffByPath = new Map(lastDiff.map((d) => [d.path, d]));
            const fileEntries: FileChangeEntry[] = buildActivity
              .filter((a) => /wrote|changed|created|updated|\.(tsx?|jsx?|css|json|md|html?)$/i.test(a.detail || ''))
              .slice(-8)
              .map((a) => {
                const detail = a.detail || '';
                const path = detail.replace(/^(?:Wrote|Changed|Created|Updated)\s*/i, '').trim().split(/\s+/)[0];
                const d = diffByPath.get(path);
                return { id: a.id, path, added: d?.added, removed: d?.removed };
              })
              .filter((f) => f.path.length > 0);
            if (fileEntries.length === 0) return null;

            const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
            const assistantHasFileBlocks = lastAssistant
              ? extractFilesFromMarkdown(lastAssistant.content).length > 0
              : false;
            if (!assistantHasFileBlocks || lastAssistant?.turnKind === 'research' || lastAssistant?.turnKind === 'conversational') {
              return null;
            }

            const openFile = (path: string) => {
              if (!path) return;
              if (!showBuilderPanel) toggleBuilderPanel();
              requestAnimationFrame(() => {
                window.dispatchEvent(new CustomEvent('vai:reveal-file', { detail: { path } }));
              });
            };

            return (
              <FileChangesBar
                files={fileEntries}
                studioChrome={studioBuilderChrome}
                onOpenFile={openFile}
                onKeep={() => clearBuildActivity()}
                onDiscard={lastRevisionId ? () => { void revertRevision().then((ok) => {
                  toast[ok ? 'success' : 'error'](ok ? 'Reverted this turn’s file changes' : 'Could not revert changes');
                }); } : undefined}
              />
            );
          })()}

          <ComposerProcessStrip
            activity={composerActivity}
            expanded={processStripExpanded}
            onExpandedChange={setProcessStripExpanded}
            studioChrome={studioBuilderChrome}
          />

          <BackgroundProcessWindow
            processes={backgroundProcesses}
            expanded={!activityCollapsed}
            onExpandedChange={(open) => setActivityCollapsed(!open)}
            studioChrome={studioBuilderChrome}
          />

          {/* The input box */}
          <motion.div
            className={`composer-shell relative flex flex-col transition-[border-color,box-shadow] duration-200 ${
              deliveryRoute === 'broadcast' && studioBuilderChrome ? 'border-blue-200' : ''
            }`}
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

            <div className="composer-toolbar flex flex-wrap items-center justify-between gap-2 px-3.5 pb-1 pt-2.5">
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
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
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
                <ProcessDepthControl
                  value={processDepth}
                  onChange={setProcessDepth}
                  disabled={isStreaming}
                />
              </div>
            </div>

            {/* While a turn streams, typed text can steer the run now or queue
                for after — instead of the Enter key silently doing nothing. */}
            {isStreaming && input.trim().length > 0 && (
              <div className="flex items-center gap-2 px-4 pt-2 text-[11px]">
                <span className="text-[color:var(--accent-text)]">Vai is working —</span>
                <button
                  type="button"
                  onClick={() => void handleSteer()}
                  className="rounded-md border border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] px-2 py-0.5 font-medium text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-softer)]"
                  title="Inject this as guidance for the current turn"
                >
                  Steer now
                </button>
                <button
                  type="button"
                  onClick={handleQueue}
                  className="rounded-md border border-zinc-700 px-2 py-0.5 font-medium text-zinc-300 transition-colors hover:bg-white/[0.05]"
                  title="Send this automatically when the current turn finishes (Enter)"
                >
                  Queue ↵
                </button>
              </div>
            )}
            {queuedMessage && (
              <div className="flex items-center gap-2 px-4 pt-2 text-[11px] text-zinc-400">
                <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-zinc-400">Queued</span>
                <span className="min-w-0 flex-1 truncate">{queuedMessage}</span>
                <button
                  type="button"
                  onClick={() => setQueuedMessage(null)}
                  className="flex-shrink-0 text-zinc-500 transition-colors hover:text-zinc-200"
                  title="Cancel queued message"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Live dictation preview — what the mic is hearing right now. */}
            {dictation.listening && interimTranscript && (
              <div className="flex items-center gap-2 px-4 pt-2 text-[11px] text-[color:var(--accent-text)]" aria-live="polite">
                <span className="rounded-full bg-[color:var(--accent-soft)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em]">Listening</span>
                <span className="min-w-0 flex-1 truncate italic">{interimTranscript}</span>
              </div>
            )}

            {/* Correction learning: "did we mishear you?" — appears after a dictated
                turn whose wording the user fixed. Non-blocking; the message already sent. */}
            {mishearAsk && (
              <div className="flex items-center gap-2 px-4 pt-2 text-[11px] text-zinc-300" aria-live="polite">
                <span className="min-w-0 flex-1 truncate">{mishearAsk.prompt}</span>
                <button
                  type="button"
                  onClick={() => { addTermToDictionary(mishearAsk.term); setMishearAsk(null); }}
                  className="flex-shrink-0 rounded-md border border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] px-2 py-0.5 font-medium text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-softer)]"
                  title="Remember this spelling for next time"
                >
                  Add to dictionary
                </button>
                <button
                  type="button"
                  onClick={() => setMishearAsk(null)}
                  className="flex-shrink-0 text-zinc-500 transition-colors hover:text-zinc-200"
                  title="Dismiss"
                >
                  No thanks
                </button>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                const v = e.target.value;
                const pos = e.target.selectionStart ?? v.length;
                setInput(v);
                // Emptying the field discards any dictation baseline so a fresh
                // typed message is never mistaken for a correction of old speech.
                if (!v.trim()) dictatedBaselineRef.current = '';
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
                <button
                  onClick={() => setImageMode((v) => !v)}
                  className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-all ${
                    imageMode
                      ? 'bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-fuchsia-500/30'
                      : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                  }`}
                  title={imageMode ? 'Image mode ON — Vai will respond with a generated image' : 'Image mode — make Vai respond with a generated image'}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  <span>Image</span>
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
                {dictation.supported && (
                  <MicButton
                    status={dictation.status}
                    supported={dictation.supported}
                    onHoldStart={() => void dictation.start()}
                    onHoldEnd={() => void dictation.stop()}
                    disabled={isStreaming}
                    onContextMenu={(at) => setMicMenuAt(at)}
                  />
                )}
                {micMenuAt && (
                  <MicDeviceMenu
                    at={micMenuAt}
                    selectedId={micDeviceId}
                    onSelect={selectMicDevice}
                    onClose={() => setMicMenuAt(null)}
                  />
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
                      className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${
                        canSend
                          ? studioBuilderChrome
                            ? 'bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_2px_10px_rgba(37,99,235,0.35)] hover:from-blue-500 hover:to-sky-400 hover:shadow-[0_4px_14px_rgba(37,99,235,0.45)]'
                            : 'bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-[0_2px_10px_rgba(139,92,246,0.4)] hover:from-violet-400 hover:to-indigo-400 hover:shadow-[0_4px_14px_rgba(139,92,246,0.5)]'
                          : studioBuilderChrome
                            ? 'bg-zinc-200 text-zinc-400'
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

          <p className="pointer-events-none mt-1.5 text-center text-[10px] text-[color:var(--chat-muted)]">
            Vai can make mistakes. Verify important information.
          </p>
        </div>
      </div>
      </div>
    </div>
    <ConversationSourcesSidebar
      messages={messages}
      isOpen={isConversationSourcesOpen}
      onClose={() => setIsConversationSourcesOpen(false)}
      relatedFollowUps={(() => {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const m = messages[i];
          if (m.role === 'assistant' && m.followUps?.length) return m.followUps;
        }
        return undefined;
      })()}
      onFollowUp={(question) => { void handleSend(question); }}
    />

    {/* Right "Reasoning" panel — review surface for the latest turn.
        Shows when user toggles or when the latest assistant turn has review data. */}
    {(showCouncilPanel || (() => {
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistant?.thinking?.council) return true;
      if (isStreaming && lastAssistant) {
        return !!deriveLiveCouncilFromProgressSteps(lastAssistant.progressSteps ?? [], true);
      }
      return false;
    })()) && (
      <div className="flex h-full flex-shrink-0 overflow-hidden">
        <CouncilProgressPanel
          council={(() => {
            const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
            return lastAssistant?.thinking?.council
              ?? deriveLiveCouncilFromProgressSteps(lastAssistant?.progressSteps ?? [], isStreaming)
              ?? null;
          })()}
          isOpen={true}
          onClose={() => toggleCouncilPanel()}
          onApplyLesson={(lesson: string) => {
            console.log('[CouncilPanel] Apply lesson:', lesson);
            // Live steering: inject as a system note and re-trigger thinking for next turn visibility
            void handleSend(`[Council live steering applied] Incorporate this method lesson: ${lesson}. Re-evaluate the previous context with this guidance.`);
          }}
          onReconvene={() => {
            console.log('[CouncilPanel] Re-convene requested');
            void handleSend('Re-run a fresh council review on the last assistant response using the current context and any previous lessons.');
          }}
          onDesignMode={() => {
            console.log('[CouncilPanel] Design Mode requested');
            // Simulate annotation: in real, this would open an overlay on the panel itself for pointing at cards/lessons
            void handleSend('Enter Design Mode for the Council panel: I want to visually annotate the member cards and lessons to refine how they are displayed and acted on.');
          }}
          onExportVisualPlan={() => {
            console.log('[CouncilPanel] Export visual plan');
            // Generate a shareable artifact of the current council state
            void handleSend('Export the current council decision as a visual plan artifact for review and sharing.');
          }}
        />
      </div>
    )}
    </div>
  );
}
