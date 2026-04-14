/**
 * intentStore.ts — Adaptive intent tracking with sliding window re-evaluation.
 *
 * Tracks deploy intent signals across conversation messages and re-evaluates
 * the user's behavioral profile every N messages (default: 5).
 *
 * Key behaviors:
 *   - Maintains a rolling window of user messages for context
 *   - Calculates deploy frequency from conversation history
 *   - Re-evaluates confidence thresholds based on user patterns
 *   - Persists stats to localStorage for cross-session learning
 *   - Provides detection context to the intent detector
 */

import { create } from 'zustand';
import {
  detectDeployIntent,
  detectAllIntents,
  detectEditIntent,
  hasDeployTokens,
  getRecoveryPattern,
  type DeployIntent,
  type EditIntent,
  type DetectionContext,
  type RecoveryPattern,
} from '../lib/intent-detector.js';
import { hasFileBlocks } from '../lib/file-extractor.js';

/* ──────────────── Persistence Schema ── */

interface IntentStats {
  /** Total user messages analyzed */
  totalMessages: number;
  /** Messages that contained deploy intent */
  deployMessages: number;
  /** Successful deploys triggered from intent detection */
  deployTriggered: number;
  /** User accepted nudge/clarify prompts */
  acceptedPrompts: number;
  /** User dismissed nudge/clarify prompts */
  dismissedPrompts: number;
  /** Last updated timestamp */
  updatedAt: number;
}

const STORAGE_KEY = 'vai-intent-stats';
const LOG_STORAGE_KEY = 'vai-intent-logs';
const WINDOW_SIZE = 5;
const MAX_LOG_SIZE = 1000;

function loadStats(): IntentStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as IntentStats;
  } catch { /* corrupted data — reset */ }
  return {
    totalMessages: 0,
    deployMessages: 0,
    deployTriggered: 0,
    acceptedPrompts: 0,
    dismissedPrompts: 0,
    updatedAt: Date.now(),
  };
}

function saveStats(stats: IntentStats): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stats, updatedAt: Date.now() }));
  } catch { /* localStorage full — ignore */ }
}

/* ──────────────── Decision Audit Log ── */

export interface IntentDecisionLog {
  id: string;
  timestamp: number;
  /** User message that triggered detection */
  userMessage: string;
  /** Whether user intent was detected */
  hasIntent: boolean;
  /** Stack detected (if any) */
  stackId: string | null;
  /** Tier detected (if any) */
  tier: string | null;
  /** Raw confidence score (0–1) before adaptive boost */
  rawConfidence: number;
  /** Adjusted confidence after adaptive boost */
  adjustedConfidence: number;
  /** Current adaptive boost value */
  adaptiveBoost: number;
  /** Recovery pattern chosen */
  recovery: RecoveryPattern;
  /** Strategy that produced the result */
  strategy: 'regex-hybrid' | 'semantic-hint' | 'generic-fallback' | 'none';
  /** Whether the LLM also handled it (had deploy tokens) */
  llmHandled: boolean | null;
  /** User's response to the suggestion */
  userAction: 'accepted' | 'dismissed' | 'pending' | null;
  /** Signals that contributed to the score */
  signals: string[];
  /** Current window evaluation number */
  windowNumber: number;
}

function loadDecisionLogs(): IntentDecisionLog[] {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as IntentDecisionLog[];
  } catch { /* corrupted — reset */ }
  return [];
}

function saveDecisionLogs(logs: IntentDecisionLog[]): void {
  try {
    // Keep only the last MAX_LOG_SIZE entries
    const trimmed = logs.slice(-MAX_LOG_SIZE);
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* localStorage full — ignore */ }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Export decision logs as CSV string.
 */
export function exportDecisionLogsCSV(logs: IntentDecisionLog[]): string {
  const header = 'timestamp,userMessage,hasIntent,stackId,tier,rawConfidence,adjustedConfidence,adaptiveBoost,recovery,strategy,llmHandled,userAction,signals,windowNumber';
  const rows = logs.map((l) => {
    const ts = new Date(l.timestamp).toISOString();
    const msg = `"${l.userMessage.replace(/"/g, '""').slice(0, 100)}"`;
    const sigs = `"${l.signals.join(';')}"`;
    return `${ts},${msg},${l.hasIntent},${l.stackId ?? ''},${l.tier ?? ''},${l.rawConfidence.toFixed(3)},${l.adjustedConfidence.toFixed(3)},${l.adaptiveBoost.toFixed(3)},${l.recovery},${l.strategy},${l.llmHandled ?? ''},${l.userAction ?? ''},${sigs},${l.windowNumber}`;
  });
  return [header, ...rows].join('\n');
}

/* ─────────────── Message-Level Intent ── */

export interface MessageIntent {
  messageIndex: number;
  userContent: string;
  intent: DeployIntent | null;
  allIntents: DeployIntent[];
  /** Edit intent — set when a project is active and the user asks to modify it */
  editIntent: EditIntent | null;
  recovery: RecoveryPattern;
  /** Whether the LLM's response had deploy tokens (set after assistant replies) */
  llmHandled: boolean;
  /** Whether user acted on the suggestion (deployed, accepted nudge, etc.) */
  userActed: boolean | null;
}

/* ─────────────── Evaluation Window ── */

export interface WindowEvaluation {
  /** Window number (1-indexed) */
  windowNumber: number;
  /** Messages in this window */
  messageCount: number;
  /** Deploy intents detected in window */
  deployCount: number;
  /** Average confidence of detected intents */
  avgConfidence: number;
  /** Deploy frequency in this window (0–1) */
  windowFrequency: number;
  /** Recommended strategy adjustment */
  recommendation: 'stay' | 'boost' | 'relax';
}

/* ─────────────────── Store Shape ── */

interface IntentState {
  /** Per-message intent tracking (sparse — only assistant messages with preceding user intents) */
  intents: Map<number, MessageIntent>;
  /** Rolling window of recent user message contents */
  recentUserMessages: string[];
  /** Persisted cross-session stats */
  stats: IntentStats;
  /** Window evaluations history */
  evaluations: WindowEvaluation[];
  /** Current messages-since-last-evaluation counter */
  messagesSinceEval: number;
  /** Adaptive confidence boost/penalty from evaluations */
  adaptiveBoost: number;
  /** Whether user is in build-oriented mode */
  isBuildMode: boolean;
  /** Whether a sandbox project is currently active */
  hasActiveProject: boolean;
  /** Rolling audit log of every intent decision */
  decisionLog: IntentDecisionLog[];

  /** Core: process a new user message at index, return detection context */
  processUserMessage: (index: number, content: string) => MessageIntent;
  /** Mark that the LLM handled intent (had deploy tokens) */
  markLlmHandled: (index: number) => void;
  /** Record user action on a suggestion */
  recordUserAction: (index: number, accepted: boolean) => void;
  /** Record a successful deploy trigger */
  recordDeployTriggered: () => void;
  /** Set build mode flag */
  setBuildMode: (isBuild: boolean) => void;
  /** Update whether a sandbox project is active (called by ChatWindow) */
  setHasActiveProject: (active: boolean) => void;
  /** Get detection context for the intent detector */
  getDetectionContext: () => DetectionContext;
  /** Force a window re-evaluation */
  evaluateWindow: () => WindowEvaluation | null;
  /** Reset conversation-level state (on new conversation) */
  resetConversation: () => void;
  /** Get the deploy frequency ratio */
  getDeployFrequency: () => number;
  /** Get CSV export of all decision logs */
  exportCSV: () => string;
}

export const useIntentStore = create<IntentState>((set, get) => ({
  intents: new Map(),
  recentUserMessages: [],
  stats: loadStats(),
  evaluations: [],
  messagesSinceEval: 0,
  adaptiveBoost: 0,
  isBuildMode: false,
  hasActiveProject: false,
  decisionLog: loadDecisionLogs(),

  processUserMessage: (index: number, content: string) => {
    const state = get();

    // Add to rolling window (keep last 10)
    const recent = [content, ...state.recentUserMessages].slice(0, 10);

    // Build detection context
    const ctx: DetectionContext & { hasActiveProject: boolean } = {
      recentUserMessages: recent.slice(1), // exclude current message
      deployFrequency: state.getDeployFrequency(),
      isBuildMode: state.isBuildMode,
      hasActiveProject: state.hasActiveProject,
    };

    // Run deploy intent detection
    const intent = detectDeployIntent(content, ctx);
    const allIntents = intent ? [intent] : detectAllIntents(content, ctx);
    const confidence = intent?.confidence ?? (allIntents[0]?.confidence ?? 0);

    // Run edit intent detection (only meaningful when a project is active)
    const editIntentResult = detectEditIntent(content, ctx);

    // Apply adaptive boost
    const adjustedConfidence = Math.min(confidence + state.adaptiveBoost, 1);
    const recovery = getRecoveryPattern(adjustedConfidence);

    // If intent exists, adjust its confidence with adaptive boost
    const adjustedIntent = intent ? {
      ...intent,
      confidence: adjustedConfidence,
    } : null;

    const msgIntent: MessageIntent = {
      messageIndex: index,
      userContent: content,
      intent: adjustedIntent,
      allIntents: allIntents.map((i) => ({
        ...i,
        confidence: Math.min(i.confidence + state.adaptiveBoost, 1),
      })),
      editIntent: editIntentResult,
      recovery,
      llmHandled: false,
      userActed: null,
    };

    // Update stats
    const newStats = { ...state.stats };
    newStats.totalMessages++;
    if (intent) newStats.deployMessages++;

    // Determine detection strategy label
    const strategy: IntentDecisionLog['strategy'] = intent
      ? (intent.signals.some((s) => s.type === 'stack') ? 'regex-hybrid' :
         intent.signals.some((s) => s.type === 'context') ? 'semantic-hint' :
         'generic-fallback')
      : 'none';

    // Create decision log entry
    const logEntry: IntentDecisionLog = {
      id: generateId(),
      timestamp: Date.now(),
      userMessage: content.slice(0, 200),
      hasIntent: !!intent,
      stackId: intent?.stackId ?? null,
      tier: intent?.tier ?? null,
      rawConfidence: confidence,
      adjustedConfidence,
      adaptiveBoost: state.adaptiveBoost,
      recovery,
      strategy,
      llmHandled: false,
      userAction: null,
      signals: (intent?.signals ?? allIntents[0]?.signals ?? []).map(
        (s) => `${s.type}:${s.weight}`,
      ),
      windowNumber: state.evaluations.length + 1,
    };

    const newLog = [...state.decisionLog, logEntry].slice(-MAX_LOG_SIZE);

    const newIntents = new Map(state.intents);
    newIntents.set(index, msgIntent);

    const newMsgsSinceEval = state.messagesSinceEval + 1;

    set({
      intents: newIntents,
      recentUserMessages: recent,
      stats: newStats,
      messagesSinceEval: newMsgsSinceEval,
      decisionLog: newLog,
    });

    saveStats(newStats);
    saveDecisionLogs(newLog);

    // Auto-evaluate at window boundaries
    if (newMsgsSinceEval >= WINDOW_SIZE) {
      // Defer to avoid state conflicts
      setTimeout(() => get().evaluateWindow(), 0);
    }

    return msgIntent;
  },

  markLlmHandled: (index: number) => {
    const state = get();
    const existing = state.intents.get(index);
    if (!existing) return;

    const updated = new Map(state.intents);
    updated.set(index, { ...existing, llmHandled: true });

    // Update decision log entry
    const userContent = existing.userContent;
    const newLog = state.decisionLog.map((entry) =>
      entry.userMessage === userContent.slice(0, 200) && !entry.llmHandled
        ? { ...entry, llmHandled: true }
        : entry,
    );

    set({ intents: updated, decisionLog: newLog });
    saveDecisionLogs(newLog);
  },

  recordUserAction: (index: number, accepted: boolean) => {
    const state = get();
    const existing = state.intents.get(index);
    if (!existing) return;

    const updated = new Map(state.intents);
    updated.set(index, { ...existing, userActed: accepted });

    // Update decision log entry
    const userContent = existing.userContent;
    const newLog = state.decisionLog.map((entry) =>
      entry.userMessage === userContent.slice(0, 200) && entry.userAction === null
        ? { ...entry, userAction: (accepted ? 'accepted' : 'dismissed') as IntentDecisionLog['userAction'] }
        : entry,
    );

    const newStats = { ...state.stats };
    if (accepted) {
      newStats.acceptedPrompts++;
    } else {
      newStats.dismissedPrompts++;
    }

    set({ intents: updated, stats: newStats, decisionLog: newLog });
    saveStats(newStats);
    saveDecisionLogs(newLog);
  },

  recordDeployTriggered: () => {
    const newStats = { ...get().stats, deployTriggered: get().stats.deployTriggered + 1 };
    set({ stats: newStats });
    saveStats(newStats);
  },

  setBuildMode: (isBuild: boolean) => set({ isBuildMode: isBuild }),

  setHasActiveProject: (active: boolean) => set({ hasActiveProject: active }),

  getDetectionContext: () => {
    const state = get();
    return {
      recentUserMessages: state.recentUserMessages,
      deployFrequency: state.getDeployFrequency(),
      isBuildMode: state.isBuildMode,
    };
  },

  evaluateWindow: () => {
    const state = get();
    if (state.messagesSinceEval < WINDOW_SIZE) return null;

    // Gather intents from last WINDOW_SIZE messages
    const allIntentEntries = Array.from(state.intents.values());
    const windowIntents = allIntentEntries.slice(-WINDOW_SIZE);
    const deployCount = windowIntents.filter((i) => i.intent !== null).length;
    const avgConfidence = windowIntents
      .filter((i) => i.intent)
      .reduce((sum, i) => sum + (i.intent?.confidence ?? 0), 0) / Math.max(deployCount, 1);
    const windowFreq = deployCount / WINDOW_SIZE;

    // Determine recommendation based on patterns
    let recommendation: 'stay' | 'boost' | 'relax';
    let boostDelta = 0;

    if (windowFreq > 0.4) {
      // User deploys a lot — boost detection
      recommendation = 'boost';
      boostDelta = 0.03;
    } else if (windowFreq < 0.1 && state.stats.dismissedPrompts > state.stats.acceptedPrompts) {
      // Low deploy frequency + user dismisses prompts — relax
      recommendation = 'relax';
      boostDelta = -0.03;
    } else {
      recommendation = 'stay';
    }

    // Clamp adaptive boost to [-0.15, +0.15]
    const newBoost = Math.max(-0.15, Math.min(0.15, state.adaptiveBoost + boostDelta));

    const evaluation: WindowEvaluation = {
      windowNumber: state.evaluations.length + 1,
      messageCount: WINDOW_SIZE,
      deployCount,
      avgConfidence,
      windowFrequency: windowFreq,
      recommendation,
    };

    set({
      evaluations: [...state.evaluations, evaluation],
      messagesSinceEval: 0,
      adaptiveBoost: newBoost,
    });

    return evaluation;
  },

  resetConversation: () => {
    set({
      intents: new Map(),
      recentUserMessages: [],
      evaluations: [],
      messagesSinceEval: 0,
      // Keep adaptiveBoost and stats — they carry forward
    });
  },

  getDeployFrequency: () => {
    const { stats } = get();
    if (stats.totalMessages === 0) return 0;
    return stats.deployMessages / stats.totalMessages;
  },

  exportCSV: () => exportDecisionLogsCSV(get().decisionLog),
}));

// ── DevTools global ──────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__vaiIntentDebug = {
    get logs() { return useIntentStore.getState().decisionLog; },
    get stats() { return useIntentStore.getState().stats; },
    get boost() { return useIntentStore.getState().adaptiveBoost; },
    get evaluations() { return useIntentStore.getState().evaluations; },
    exportCSV: () => useIntentStore.getState().exportCSV(),
    clearLogs: () => {
      localStorage.removeItem(LOG_STORAGE_KEY);
      useIntentStore.setState({ decisionLog: [] });
    },
  };
}

/**
 * Helper: Given messages array, compute fallback deploy map for rendering.
 * This is the bridge between the intent store and the ChatWindow render loop.
 */
export function computeFallbackMap(
  messages: Array<{ role: string; content: string }>,
  store: IntentState,
): Map<number, { intent: DeployIntent; recovery: RecoveryPattern; allIntents: DeployIntent[] }> {
  const map = new Map<number, { intent: DeployIntent; recovery: RecoveryPattern; allIntents: DeployIntent[] }>();

  if (!store.isBuildMode) {
    return map;
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;

    // Already has actionable output — skip fallback deploy prompts.
    if (hasDeployTokens(msg.content) || hasFileBlocks(msg.content)) continue;

    // Find preceding user message
    let userMsg: typeof msg | null = null;
    let userIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (messages[j].role === 'user') {
        userMsg = messages[j];
        userIdx = j;
        break;
      }
    }
    if (!userMsg || userIdx < 0) continue;

    // Check if we already processed this user message
    const msgIntent = store.intents.get(userIdx);
    if (!msgIntent) continue;

    if (msgIntent.intent && msgIntent.recovery !== 'none') {
      map.set(i, {
        intent: msgIntent.intent,
        recovery: msgIntent.recovery,
        allIntents: msgIntent.allIntents,
      });
    }
  }

  return map;
}
