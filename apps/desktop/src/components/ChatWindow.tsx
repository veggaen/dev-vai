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
import { ComposerDock, type FileChangeEntry } from './chat/ComposerDock.js';
import { ComposerNotice } from './chat/ComposerNotice.js';
import { useBackgroundProcesses, useBackgroundTaskEvents } from '../hooks/useBackgroundProcesses.js';
import { ProcessDepthControl } from './chat/ProcessDepthControl.js';
import { CouncilSeatPicker } from './chat/CouncilSeatPicker.js';
import { MicButton } from './chat/MicButton.js';
import { MicDeviceMenu } from './chat/MicDeviceMenu.js';
import { WorkspaceChip } from './ide/WorkspaceChip.js';
import { AttachMenu } from './chat/AttachMenu.js';
import { useWorkspaceStore } from '../stores/workspaceStore.js';
import { resolveWorkspaceEditIntent } from '../lib/ide/chat-edit-intent.js';
import { useVoiceDictation } from '../hooks/useVoiceDictation.js';
import {
  COMPOSER_DICTATION_LIVE_EVENT,
  useComposerDictationLive,
  type ComposerDictationLiveEvent,
} from '../hooks/useComposerDictationLive.js';
import { detectCorrections, mishearingPrompt } from '../lib/voice/correction-detection.js';
import { confirmCorrection, learnFromEdit, loadProfile, saveProfile, type AppliedReplacement } from '../lib/voice/speech-profile.js';
import { loadMicTriggerMode, type MicTriggerMode } from '../lib/voice/mic-mode.js';
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
import { detectPastedFileExtension, shouldAttachTextPaste } from '../lib/composer-paste.js';
import { LIMITS, PERSISTED_NAMES } from '@vai/constants';

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

/** A single chat's in-progress composer contents, preserved across chat switches. */
interface ComposerDraft {
  input: string;
  pastedImage: PastedImage | null;
  attachedFiles: FileAttachment[];
  imageDescription: string;
  imageQuestion: string;
  imageMode: boolean;
}

function isDraftEmpty(d: ComposerDraft): boolean {
  return !d.input.trim()
    && !d.pastedImage
    && d.attachedFiles.length === 0
    && !d.imageDescription.trim()
    && !d.imageQuestion.trim()
    && !d.imageMode;
}

function loadComposerDrafts(): Map<string, ComposerDraft> {
  if (typeof localStorage === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem(PERSISTED_NAMES.composerDrafts);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, Partial<ComposerDraft>>;
    return new Map(Object.entries(parsed).flatMap(([id, draft]) => {
      if (!draft || typeof draft.input !== 'string') return [];
      return [[id, {
        input: draft.input.slice(0, LIMITS.composerDraftCharacters), pastedImage: null,
        attachedFiles: Array.isArray(draft.attachedFiles) ? draft.attachedFiles.slice(0, LIMITS.composerAttachmentFiles) as FileAttachment[] : [],
        imageDescription: typeof draft.imageDescription === 'string' ? draft.imageDescription : '',
        imageQuestion: typeof draft.imageQuestion === 'string' ? draft.imageQuestion : '', imageMode: Boolean(draft.imageMode),
      } satisfies ComposerDraft] as const];
    }));
  } catch { return new Map(); }
}

function saveComposerDrafts(drafts: Map<string, ComposerDraft>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const serializable = Object.fromEntries([...drafts].map(([id, draft]) => [id, {
      ...draft, pastedImage: null,
      input: draft.input.slice(0, LIMITS.composerDraftCharacters),
      attachedFiles: draft.attachedFiles.filter((file) => file.content.length <= LIMITS.composerDraftCharacters),
    }]));
    if (Object.keys(serializable).length === 0) localStorage.removeItem(PERSISTED_NAMES.composerDrafts);
    else localStorage.setItem(PERSISTED_NAMES.composerDrafts, JSON.stringify(serializable));
  } catch { /* quota or privacy mode: in-memory draft still survives chat switches */ }
}

const MIN_INPUT_HEIGHT = 44;
const MAX_INPUT_HEIGHT = 240;

/**
 * "Today" / "Yesterday" / "July 12" chip label between messages when the
 * calendar day changes — an at-a-glance timeline for long-running chats.
 * Returns null when the previous message is the same day (or no timestamp).
 */
function daySeparatorLabel(prevIso: string | undefined, iso: string | undefined): string | null {
  if (!iso) return null;
  const current = new Date(iso);
  if (Number.isNaN(current.getTime())) return null;
  if (prevIso) {
    const prev = new Date(prevIso);
    if (!Number.isNaN(prev.getTime()) && prev.toDateString() === current.toDateString()) return null;
  }
  const now = new Date();
  if (current.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (current.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return current.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    ...(current.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function ChatWindow() {
  const {
    messages,
    activeConversationId,
    conversationsHydrated,
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
  const sandboxExternal = useSandboxStore((state) => state.external);
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
  const [fileDragActive, setFileDragActive] = useState(false);
  /** Explicit "Image" output mode — when on, this turn is answered with a generated image. */
  const [imageMode, setImageMode] = useState(false);

  // ── Per-conversation composer drafts ───────────────────────────────────────
  // Each chat keeps its OWN composer contents (text, pasted image, attached
  // files) so switching between chats preserves what you were assembling in
  // each — e.g. three different images staged across three chats. Kept in an
  // local-first map: text/file drafts survive disconnects and app restarts.
  const composerDraftsRef = useRef<Map<string, ComposerDraft>>(loadComposerDrafts());
  const prevConvIdRef = useRef<string | null>(activeConversationId);
  // Latest composer values, mirrored every render so the swap effect reads fresh
  // state without re-subscribing.
  const draftValuesRef = useRef<ComposerDraft>({
    input, pastedImage, attachedFiles, imageDescription, imageQuestion, imageMode,
  });
  draftValuesRef.current = { input, pastedImage, attachedFiles, imageDescription, imageQuestion, imageMode };
  useEffect(() => {
    if (!activeConversationId) return;
    const draft = draftValuesRef.current;
    if (isDraftEmpty(draft)) composerDraftsRef.current.delete(activeConversationId);
    else composerDraftsRef.current.set(activeConversationId, { ...draft, attachedFiles: [...draft.attachedFiles] });
    saveComposerDrafts(composerDraftsRef.current);
  }, [activeConversationId, input, attachedFiles, imageDescription, imageQuestion, imageMode, pastedImage]);
  const [deliveryRoute, setDeliveryRoute] = useState<DeliveryRoute>('vai');
  const [broadcastModel, setBroadcastModel] = useState('gpt-4o');
  const [broadcastChatApp, setBroadcastChatApp] = useState('chat');
  const [broadcastSession, setBroadcastSession] = useState('new-session');
  const [perIdeConfigs, setPerIdeConfigs] = useState<PerIdeConfig[]>([]);
  const [showIdePopup, setShowIdePopup] = useState(false);
  const [isResearchRailOpen, setIsResearchRailOpen] = useState(false);
  const [isConversationSourcesOpen, setIsConversationSourcesOpen] = useState(false);
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
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [globalDictationListening, setGlobalDictationListening] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const liveDictation = useComposerDictationLive(textareaRef, setInput);
  const [mishearAsk, setMishearAsk] = useState<{ prompt: string; heard: string; corrected: string } | null>(null);
  // Chosen mic for dictation (the right-click device menu). Persisted so it survives reloads;
  // empty string = system default.
  const [micDeviceId, setMicDeviceId] = useState<string>(() => {
    try { return localStorage.getItem('vai-voice-device') ?? ''; } catch { return ''; }
  });
  const selectMicDevice = useCallback((id: string) => {
    setMicDeviceId(id);
    try { localStorage.setItem('vai-voice-device', id); } catch { /* non-fatal */ }
    window.dispatchEvent(new CustomEvent('vai:voice-device-changed', { detail: id }));
  }, []);
  useEffect(() => {
    const onVoiceDeviceChanged = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      setMicDeviceId(typeof next === 'string' ? next : '');
    };
    window.addEventListener('vai:voice-device-changed', onVoiceDeviceChanged);
    return () => window.removeEventListener('vai:voice-device-changed', onVoiceDeviceChanged);
  }, []);
  // Where (if anywhere) the right-click mic device menu is open.
  const [micMenuAt, setMicMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [micTriggerMode, setMicTriggerMode] = useState<MicTriggerMode>(loadMicTriggerMode);
  useEffect(() => {
    const onMicMode = (event: Event) => {
      const mode = (event as CustomEvent<MicTriggerMode>).detail;
      if (mode === 'hold' || mode === 'toggle') setMicTriggerMode(mode);
    };
    window.addEventListener('vai:voice-mic-mode-changed', onMicMode);
    return () => window.removeEventListener('vai:voice-mic-mode-changed', onMicMode);
  }, []);
  // Speech-profile rules that auto-applied to the last dictation — the self-heal
  // learner needs them at send time to notice when the user reverts one.
  const appliedRulesRef = useRef<readonly AppliedReplacement[]>([]);
  /** Chord releases whose final transcript has not landed yet. */
  const pendingDictationFinalsRef = useRef(0);
  /** Finals from PREVIOUS holds still owed to the current anchor — they must
   *  land BEFORE it, not consume it (duplication / lost-words fix). */
  const lateDictationFinalsRef = useRef(0);
  /** True while a global keybind hold is physically DOWN. Read inside the long-lived
   *  live-dictation listener (whose closure would otherwise capture stale React state)
   *  to tell a late final from a PREVIOUS hold apart from the current hold's own release. */
  const holdDownRef = useRef(false);
  const snapshotDictationBaseline = useCallback(() => {
    requestAnimationFrame(() => {
      dictatedBaselineRef.current = textareaRef.current?.value ?? '';
    });
  }, []);

  const insertDictated = useCallback((text: string, applied: readonly AppliedReplacement[] = []) => {
    setVoiceError(null);
    appliedRulesRef.current = applied;
    if (liveDictation.isActive()) {
      liveDictation.update(text, { asIs: true, finalize: true });
    } else {
      const ta = textareaRef.current;
      setInput((prev) => {
        const start = ta?.selectionStart ?? prev.length;
        const end = ta?.selectionEnd ?? prev.length;
        const sep = prev && start === prev.length && !/\s$/.test(prev) ? ' ' : '';
        return prev.slice(0, start) + sep + text + prev.slice(end);
      });
    }
    snapshotDictationBaseline();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [liveDictation, setInput, snapshotDictationBaseline]);

  const dictation = useVoiceDictation({
    disabled: isStreaming,
    deviceId: micDeviceId || undefined,
    // Under Tauri the Rust-side watcher owns the hold chord globally (it routes
    // back into the composer when this window is focused) — a second local listener
    // would double-start the session. The mic button press still works everywhere.
    holdChord: typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? () => false : undefined,
    keyboardHold: typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window),
    onLevel: (level) => {
      setVoiceLevel(level);
    },
    onInterim: (text) => {
      setVoiceError(null);
      liveDictation.update(text);
    },
    onFinal: (text, meta) => {
      setVoiceLevel(0);
      appliedRulesRef.current = meta?.applied ?? [];
      liveDictation.update(text, { asIs: true, finalize: true });
      snapshotDictationBaseline();
    },
    onPolishUpdate: (text, meta) => {
      // A NEW dictation owns the composer — a late polish from the previous one
      // must never re-insert old text or consume the fresh anchor.
      if (liveDictation.isActive()) return;
      setVoiceLevel(0);
      appliedRulesRef.current = meta?.applied ?? appliedRulesRef.current;
      liveDictation.replaceCommitted(text, { asIs: true });
      snapshotDictationBaseline();
    },
    onError: (error) => {
      setVoiceLevel(0);
      if (liveDictation.isActive()) liveDictation.cancel();
      setVoiceError(error.message);
    },
    onCancel: () => {
      setVoiceLevel(0);
      liveDictation.cancel();
    },
  });

  // The global hold shortcut streams into the composer while Vai is focused.
  useEffect(() => {
    const onLive = (e: Event) => {
      const detail = (e as CustomEvent<ComposerDictationLiveEvent>).detail;
      if (!detail) return;
      if (detail.kind === 'begin') {
        setVoiceError(null);
        holdDownRef.current = true;
        setGlobalDictationListening(true);
        setVoiceLevel(0.18);
        // Finals still in flight from earlier holds belong BEFORE this anchor.
        lateDictationFinalsRef.current = pendingDictationFinalsRef.current;
        liveDictation.begin();
        return;
      }
      if (detail.kind === 'level') {
        setGlobalDictationListening(true);
        setVoiceLevel(detail.level);
        return;
      }
      if (detail.kind === 'interim') {
        // Do NOT insert live text before release — only the mic indicator shows while
        // holding; the finalized words land ONCE, on 'groomed'. This kills the
        // pre-release flicker (interim → different final) and the double-print bug.
        setVoiceError(null);
        setGlobalDictationListening(true);
        return;
      }
      if (detail.kind === 'end') {
        // Keys released — recording is over. Drop every listening effect right
        // now; the finalized words arrive via 'groomed' a moment later.
        holdDownRef.current = false;
        pendingDictationFinalsRef.current += 1;
        setGlobalDictationListening(false);
        setVoiceLevel(0);
        return;
      }
      if (detail.kind === 'groomed') {
        pendingDictationFinalsRef.current = Math.max(0, pendingDictationFinalsRef.current - 1);
        // A groomed always carries the words of the hold that JUST finalized. Only
        // treat it as a "land before the anchor" late final when another hold is
        // physically down RIGHT NOW (globalDictationListening) — otherwise this is the
        // current hold's own release and must finalize normally. Gating on the live
        // hold (not just the counter) removes the ordering race that used to inject the
        // current hold's own text before its anchor mid-hold.
        if (holdDownRef.current && lateDictationFinalsRef.current > 0 && liveDictation.isActive()) {
          // Late final from a PREVIOUS hold while a new hold is live: slot it in
          // before the new anchor and keep listening — finalizing here used to
          // duplicate the old text and drop the new hold's words entirely.
          lateDictationFinalsRef.current -= 1;
          liveDictation.insertBeforeAnchor(detail.text);
          return;
        }
        lateDictationFinalsRef.current = 0;
        setGlobalDictationListening(false);
        setVoiceLevel(0);
        appliedRulesRef.current = detail.applied ?? [];
        liveDictation.update(detail.text, { asIs: true, finalize: true });
        snapshotDictationBaseline();
        return;
      }
      if (detail.kind === 'discard') {
        // A superseded hold will never deliver a 'groomed'. Release the slot it
        // reserved on release so the late-final routing for the next hold stays
        // accurate — otherwise the phantom pending mis-fires insertBeforeAnchor and
        // duplicates / injects text mid-hold. Clamped so an extra one is harmless.
        pendingDictationFinalsRef.current = Math.max(0, pendingDictationFinalsRef.current - 1);
        lateDictationFinalsRef.current = Math.max(0, lateDictationFinalsRef.current - 1);
        return;
      }
      if (detail.kind === 'polish') {
        // Polish only upgrades an already-committed span. If a new hold is
        // active, or the span changed, replaceCommitted's guard makes it a no-op.
        if (liveDictation.isActive()) return;
        setGlobalDictationListening(false);
        setVoiceLevel(0);
        appliedRulesRef.current = detail.applied ?? appliedRulesRef.current;
        liveDictation.replaceCommitted(detail.text, { asIs: true });
        snapshotDictationBaseline();
        return;
      }
      if (detail.kind === 'cancel') {
        holdDownRef.current = false;
        pendingDictationFinalsRef.current = 0;
        lateDictationFinalsRef.current = 0;
        setGlobalDictationListening(false);
        setVoiceLevel(0);
        liveDictation.cancel();
      }
    };
    window.addEventListener(COMPOSER_DICTATION_LIVE_EVENT, onLive);
    return () => window.removeEventListener(COMPOSER_DICTATION_LIVE_EVENT, onLive);
  }, [liveDictation, snapshotDictationBaseline]);

  // Fallback insert when global dictation uses the legacy event path.
  useEffect(() => {
    const onInsert = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string; applied?: readonly AppliedReplacement[] }>).detail;
      if (detail?.text) insertDictated(detail.text, detail.applied ?? []);
    };
    window.addEventListener('vai:dictation-insert', onInsert);
    return () => window.removeEventListener('vai:dictation-insert', onInsert);
  }, [insertDictated]);
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
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachedProjectName = useWorkspaceStore((s) => s.localName);
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
  // Swap composer drafts when the active chat changes: stash the outgoing chat's
  // contents, then restore the incoming chat's (or clear for a fresh one). This
  // is what lets each chat hold its own text and pasted/attached images.
  useEffect(() => {
    const prevId = prevConvIdRef.current;
    const nextId = activeConversationId;
    if (prevId === nextId) return;
    if (prevId) {
      const outgoing = draftValuesRef.current;
      if (isDraftEmpty(outgoing)) composerDraftsRef.current.delete(prevId);
      else composerDraftsRef.current.set(prevId, { ...outgoing, attachedFiles: [...outgoing.attachedFiles] });
      saveComposerDrafts(composerDraftsRef.current);
    }
    const incoming = nextId ? composerDraftsRef.current.get(nextId) : undefined;
    setInput(incoming?.input ?? '');
    setPastedImage(incoming?.pastedImage ?? null);
    setAttachedFiles(incoming ? [...incoming.attachedFiles] : []);
    setImageDescription(incoming?.imageDescription ?? '');
    setImageQuestion(incoming?.imageQuestion ?? '');
    setImageMode(incoming?.imageMode ?? false);
    prevConvIdRef.current = nextId;
  }, [activeConversationId]);
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
    if (text && shouldAttachTextPaste(text)) {
      e.preventDefault();
      const ext = detectPastedFileExtension(text);
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

  const attachLocalFiles = useCallback((files: readonly File[]) => {
    const available = Math.max(0, LIMITS.composerAttachmentFiles - attachedFiles.length);
    const accepted = files.slice(0, available).filter((file) => file.size <= LIMITS.composerAttachmentBytes);
    const skipped = files.length - accepted.length;
    accepted.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        const ext = file.name.split('.').pop() || detectPastedFileExtension(content);
        setAttachedFiles((prev) => [
          ...prev,
          { id: `file-${Date.now()}-${file.name}`, name: file.name, content, language: ext, sizeBytes: file.size },
        ]);
      };
      reader.readAsText(file);
    });
    if (skipped > 0) toast.warning(`${skipped} file${skipped === 1 ? '' : 's'} skipped · limit ${LIMITS.composerAttachmentFiles} files, ${Math.round(LIMITS.composerAttachmentBytes / 1024 / 1024)} MB each`);
  }, [attachedFiles.length]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    attachLocalFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [attachLocalFiles]);

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
    if (!conversationsHydrated) return;
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
        setMishearAsk({
          prompt: ask,
          heard: correction.mishearings[0].heard,
          corrected: correction.mishearings[0].corrected,
        });
      }
      // Speech-profile learning: every dictate→edit→send cycle teaches the profile.
      // New substitutions become auto-apply rules after two sightings; editing an
      // auto-applied correction BACK earns the rule a strike until it retires —
      // the learner heals itself when it guessed wrong for this user.
      try {
        saveProfile(learnFromEdit(loadProfile(), {
          insertedText: dictatedBaselineRef.current,
          sentText: text,
          applied: appliedRulesRef.current,
        }));
      } catch { /* learning must never block a send */ }
      appliedRulesRef.current = [];
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

    /* ── Workspace edit route: the ask names a real file in the attached local
       folder — the IDE council (real file access, reviewable diffs) handles it,
       not the server chat council (no local disk; would report file-not-found). ── */
    const wsForEdit = useWorkspaceStore.getState();
    if (wsForEdit.kind === 'local' && wsForEdit.localRoot && !pastedImage) {
      const fileSet = new Set(
        wsForEdit.tree.filter((e) => !e.dir).map((e) => e.path.replace(/\\/g, '/')),
      );
      const editIntent = resolveWorkspaceEditIntent(fullContent, fileSet);
      if (editIntent) {
        toast.info(`Council is editing ${editIntent.rel} — review the diff when it's ready`);
        setInput('');
        setAttachedFiles([]);
        requestAnimationFrame(() => {
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
        });
        await wsForEdit.runCouncilEdit(editIntent.task, editIntent.rel);
        return;
      }
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

      // Files CONTAINING literals the user quoted are the edit targets — path
      // heuristics can't see content. "change the 'Participate in a…' text"
      // must snapshot the file with that string, wherever it lives.
      let contentHitPaths: string[] = [];
      const quotedLiterals = [...text.matchAll(/["'“”‘’`]([^"'“”‘’`\n]{6,80})["'“”‘’`]/g)]
        .map((m) => m[1].trim())
        .filter((literal) => literal.length >= 6)
        .slice(0, 2);
      for (const literal of quotedLiterals) {
        try {
          const res = await apiFetch(`/api/sandbox/${sandboxProjectId}/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: literal, maxResults: 30 }),
          });
          if (!res.ok) continue;
          const data = await res.json() as { files?: { path: string }[] };
          contentHitPaths.push(...(data.files ?? []).map((f) => f.path));
        } catch { /* content search is best-effort context enrichment */ }
      }
      contentHitPaths = [...new Set(contentHitPaths)].slice(0, 3);

      const summaryPaths = [...new Set([...contentHitPaths, ...pickSandboxContextPaths(sandboxFiles, text, 6)])].slice(0, 6);
      const snapshotPaths = [...new Set([...contentHitPaths, ...pickSandboxContextPaths(sandboxFiles, text, 3)])].slice(0, 3);
      const fileListKey = summaryPaths.join('|');
      const contextHash = `${sandboxProjectId}:${sandboxDevPort ?? 'none'}:${fileListKey}`;
      const fileTreeUnchanged = lastSandboxContextHashRef.current === contextHash;
      lastSandboxContextHashRef.current = contextHash;

      const lines: string[] = [
        `ACTIVE SANDBOX PROJECT: "${sandboxProjectName || sandboxProjectId}" (project id: ${sandboxProjectId})`,
      ];
      if (sandboxExternal) {
        lines.push('This is an EXTERNAL local project folder owned by the user — real code with its own dependencies and conventions. Edits must respect the existing stack and style.');
      }
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
            language: detectPastedFileExtension(data.content),
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
  const canSend = conversationsHydrated && input.trim().length > 0 && !isStreaming && (!pastedImage || imageDescription.trim().length > 0);

  const shellModeLabel = `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
  const headerTitle = hasMessages ? 'Workspace' : 'Vai';
  // Files changed this turn — feeds the ComposerDock's "files" segment.
  // Server-computed diff (true +added/−removed) preferred; bare paths from
  // buildActivity when no diff yet. Empty unless the latest assistant turn
  // actually emitted file blocks (never show a husk for research/chat turns).
  const fileChangeEntries = useMemo<FileChangeEntry[]>(() => {
    const diffByPath = new Map(lastDiff.map((d) => [d.path, d]));
    const entries: FileChangeEntry[] = buildActivity
      .filter((a) => /wrote|changed|created|updated|\.(tsx?|jsx?|css|json|md|html?)$/i.test(a.detail || ''))
      .slice(-8)
      .map((a) => {
        const detail = a.detail || '';
        const path = detail.replace(/^(?:Wrote|Changed|Created|Updated)\s*/i, '').trim().split(/\s+/)[0];
        const d = diffByPath.get(path);
        return { id: a.id, path, added: d?.added, removed: d?.removed };
      })
      .filter((f) => f.path.length > 0);
    if (entries.length === 0) return [];

    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    const assistantHasFileBlocks = lastAssistant
      ? extractFilesFromMarkdown(lastAssistant.content).length > 0
      : false;
    if (!assistantHasFileBlocks || lastAssistant?.turnKind === 'research' || lastAssistant?.turnKind === 'conversational') {
      return [];
    }
    return entries;
  }, [buildActivity, lastDiff, messages]);

  const openChangedFile = useCallback((path: string) => {
    if (!path) return;
    if (!showBuilderPanel) toggleBuilderPanel();
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('vai:reveal-file', { detail: { path } }));
    });
  }, [showBuilderPanel, toggleBuilderPanel]);

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

        {/* popLayout pops the exiting hero out of flow so the send-morph (node deploys upward,
            arms snap flat) plays while the thread slides into place beneath it. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {!hasMessages && (
            /* ═══════════ WELCOME STATE ═══════════ */
            <ChatEmptyState
              key="chat-empty-state"
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
          )}
        </AnimatePresence>
        {hasMessages && (
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
                  const separatorLabel = daySeparatorLabel(messages[idx - 1]?.createdAt, msg.createdAt);
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
                    >
                      {separatorLabel && (
                        <div className="mb-6 mt-2 flex items-center gap-3" role="separator" aria-label={separatorLabel}>
                          <span className="h-px flex-1 bg-[color:var(--border)] opacity-60" />
                          <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--panel)] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[color:var(--color-muted)]">
                            {separatorLabel}
                          </span>
                          <span className="h-px flex-1 bg-[color:var(--border)] opacity-60" />
                        </div>
                      )}
                      <MessageBubble
                        role={msg.role}
                        content={msg.content}
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
                        createdAt={msg.createdAt}
                        onEdit={msg.role === 'user' ? (text) => {
                          setInput(text);
                          requestAnimationFrame(() => {
                            const ta = textareaRef.current;
                            if (ta) {
                              ta.focus();
                              ta.setSelectionRange(ta.value.length, ta.value.length);
                            }
                          });
                        } : undefined}
                        onRetry={
                          msg.role === 'assistant' && isLatestMessage && !isStreaming
                            ? () => useChatStore.getState().regenerateLastTurn()
                            : undefined
                        }
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

          {/* Attached files + project row */}
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
          {/* The ONE status surface above the input. Live turn steps, background
              processes, and files-changed all live here as text segments that
              open a single shared drawer — never parallel stacked boxes.
              Process detail lives in-bubble (ProcessTree); council in the
              right panel. Every surface shows distinct information. */}
          <ComposerDock
            activity={composerActivity}
            processes={backgroundProcesses}
            files={fileChangeEntries}
            onOpenFile={openChangedFile}
            onKeepFiles={() => clearBuildActivity()}
            onDiscardFiles={lastRevisionId ? () => { void revertRevision().then((ok) => {
              toast[ok ? 'success' : 'error'](ok ? 'Reverted this turn’s file changes' : 'Could not revert changes');
            }); } : undefined}
            workspaceSlot={<WorkspaceChip />}
            studioChrome={studioBuilderChrome}
            suppressTurnSteps={isStreaming && Boolean(messages.at(-1)?.progressSteps?.length)}
          />

          {/* The input box — glow ONLY while actively recording (mic held / mic
              button on). liveDictation.isActive() stays true through transcription
              after release and must not keep the ring lit. */}
          <motion.div
            data-dictation-active={dictation.listening || globalDictationListening ? 'true' : undefined}
            data-file-drag-active={fileDragActive ? 'true' : undefined}
            onDragEnter={(event) => {
              if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setFileDragActive(true); }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setFileDragActive(true); }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault(); setFileDragActive(false);
              attachLocalFiles(Array.from(event.dataTransfer.files));
            }}
            className={`composer-shell relative flex flex-col transition-[border-color,box-shadow] duration-200 ${
              deliveryRoute === 'broadcast' && studioBuilderChrome ? 'border-blue-200' : ''
            } ${fileDragActive ? 'border-[color:var(--accent)] ring-2 ring-[color:var(--accent-ring)]' : ''}`}
          >
            {fileDragActive && (
              <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] bg-[color:var(--panel)]/90 text-xs font-medium text-[color:var(--fg)] backdrop-blur-sm">
                Drop files into this agent input
              </div>
            )}
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

            {/* The ONE attention slot inside the shell — build-confirm, mishear,
                voice, steer/queue, queued render here by priority, one at a
                time, as the same slim row. Never a stack of styled cards. */}
            <ComposerNotice
              buildConfirm={pendingBuildConfirm ? {
                text: pendingBuildConfirm.text,
                onAnswer: () => {
                  const t = pendingBuildConfirm.text;
                  setPendingBuildConfirm(null);
                  void handleSend(t, { buildConfirmResolved: 'answer' });
                },
                onBuild: () => {
                  const t = pendingBuildConfirm.text;
                  setPendingBuildConfirm(null);
                  void handleSend(t, { buildConfirmResolved: 'build' });
                },
                onCancel: () => setPendingBuildConfirm(null),
              } : null}
              mishear={mishearAsk ? {
                prompt: mishearAsk.prompt,
                onConfirm: () => {
                  addTermToDictionary(mishearAsk.corrected);
                  try {
                    saveProfile(confirmCorrection(loadProfile(), {
                      heard: mishearAsk.heard,
                      corrected: mishearAsk.corrected,
                    }));
                  } catch { /* learning must never block the UI */ }
                  setMishearAsk(null);
                },
                onDismiss: () => setMishearAsk(null),
              } : null}
              voice={voiceError ? {
                message: voiceError,
                onCheck: () => {
                  try { sessionStorage.setItem('vai-settings-tab', 'voice'); } catch { /* non-fatal */ }
                  window.dispatchEvent(new CustomEvent('vai:open-voice-settings'));
                },
              } : null}
              steer={isStreaming && input.trim().length > 0 ? {
                onSteer: () => { void handleSteer(); },
                onQueue: handleQueue,
              } : null}
              queued={queuedMessage ? {
                text: queuedMessage,
                onCancel: () => setQueuedMessage(null),
              } : null}
            />

            <textarea
              ref={textareaRef}
              aria-live={dictation.listening || globalDictationListening || dictation.status === 'transcribing' ? 'polite' : undefined}
              data-dictation-active={dictation.listening || globalDictationListening || liveDictation.isActive() ? 'true' : undefined}
              value={input}
              disabled={!conversationsHydrated}
              onChange={(e) => {
                const v = e.target.value;
                const pos = e.target.selectionStart ?? v.length;
                setInput(v);
                if (voiceError) setVoiceError(null);
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
                !conversationsHydrated
                  ? 'Restoring your last chat...'
                  : pastedImage
                  ? 'Describe what you need help with...'
                  : deliveryRoute === 'broadcast'
                    ? `Message ${onlineIdeCount} connected IDE${onlineIdeCount === 1 ? '' : 's'}...${onlineIdeCount > 0 ? ' · @ route' : ''}`
                    : onlineIdeCount > 0
                      ? `${MODE_PLACEHOLDERS[mode]} · @ IDE`
                      : MODE_PLACEHOLDERS[mode]
              }
              rows={1}
              className={`resize-none overflow-y-auto bg-transparent px-4 pb-2.5 pt-2.5 text-sm leading-relaxed transition-shadow duration-200 focus:outline-none disabled:cursor-wait disabled:opacity-60 ${studioBuilderChrome ? 'text-zinc-900 placeholder-zinc-400' : 'text-zinc-100 placeholder-zinc-600'}`}
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
                  ref={attachButtonRef}
                  type="button"
                  onClick={() => setAttachMenuOpen((v) => !v)}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                    attachMenuOpen || attachedProjectName || attachedFiles.length > 0
                      ? 'bg-zinc-800/80 text-violet-300'
                      : 'text-zinc-600 hover:bg-zinc-800/80 hover:text-zinc-300'
                  }`}
                  title="Attach a file or open a project folder"
                  aria-expanded={attachMenuOpen}
                  aria-haspopup="menu"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <AttachMenu
                  anchorRef={attachButtonRef}
                  open={attachMenuOpen}
                  onClose={() => setAttachMenuOpen(false)}
                  onFilesAttached={(files) => setAttachedFiles((prev) => [...prev, ...files])}
                  onTriggerFileInput={() => fileInputRef.current?.click()}
                />
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
                      title="Connect to an external IDE agent"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Ext IDE</span>
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
                          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Connect external IDE</div>
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
                <div className="hidden items-center gap-2 md:flex">
                  <CouncilSeatPicker disabled={isStreaming} />
                  <ProcessDepthControl
                    value={processDepth}
                    onChange={setProcessDepth}
                    disabled={isStreaming}
                  />
                </div>
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
                    status={globalDictationListening && dictation.status === 'idle' ? 'listening' : dictation.status}
                    supported={dictation.supported}
                    mode={micTriggerMode}
                    level={voiceLevel}
                    onHoldStart={() => {
                      // A global keybind hold already owns the mic — starting the
                      // button's own STT session too would double-capture the audio
                      // and double-insert the text. Defer to the hold in progress.
                      if (globalDictationListening) return;
                      setVoiceError(null);
                      setVoiceLevel(0.18);
                      liveDictation.begin();
                      void dictation.start();
                    }}
                    onHoldEnd={() => {
                      setVoiceLevel(0);
                      void dictation.stop();
                    }}
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

    </div>
  );
}
