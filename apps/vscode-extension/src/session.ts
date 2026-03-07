/**
 * VeggaAI Session Manager
 *
 * Manages session lifecycle: create, push events, flush, end.
 * Event buffer with configurable flush interval for zero-lag capture.
 *
 * SESSION PERSISTENCE:
 * - Session ID persisted in workspace state — survives VS Code reload
 * - On activation, auto-restores session if still active on server
 * - Ending requires explicit confirmation (prevents accidental clicks)
 * - Deactivation does NOT end session — just stops local tracking
 *
 * UNIFIED SESSIONS (.vai-session):
 * - When an agent (Copilot/Claude) creates a session via session-bridge.mjs,
 *   a `.vai-session` file is written to the workspace root.
 * - The extension watches for this file and attaches to the agent's session
 *   instead of creating a separate one. This ensures all events (workspace
 *   activity + agent reasoning) flow into ONE session.
 */

import * as vscode from 'vscode';
import { apiCall, isServerHealthy } from './api.js';

/* ── Types ─────────────────────────────────────────────────────── */

export interface VaiEvent {
  type: string;
  content: string;
  meta: Record<string, unknown>;
  timestamp?: number;
}

export interface ActiveSession {
  id: string;
  title: string;
  eventBuffer: VaiEvent[];
  eventCount: number;
  flushTimer: ReturnType<typeof setInterval> | null;
  createdAt: number;
}

/* ── Session State ─────────────────────────────────────────────── */

const SESSION_STATE_KEY = 'vai.activeSessionId';
const SESSION_TITLE_KEY = 'vai.activeSessionTitle';

let activeSession: ActiveSession | null = null;
let _flushing = false;
let _extensionContext: vscode.ExtensionContext | null = null;

const _onSessionChange = new vscode.EventEmitter<ActiveSession | null>();
export const onSessionChange = _onSessionChange.event;

const _onEventPushed = new vscode.EventEmitter<VaiEvent>();
export const onEventPushed = _onEventPushed.event;

export function getActiveSession(): ActiveSession | null {
  return activeSession;
}

/** Must be called once on extension activation to enable persistence */
export function initSessionManager(context: vscode.ExtensionContext): void {
  _extensionContext = context;
}

/* ── Persist / Restore ─────────────────────────────────────────── */

function persistSession(id: string, title: string): void {
  _extensionContext?.workspaceState.update(SESSION_STATE_KEY, id);
  _extensionContext?.workspaceState.update(SESSION_TITLE_KEY, title);
}

function clearPersistedSession(): void {
  _extensionContext?.workspaceState.update(SESSION_STATE_KEY, undefined);
  _extensionContext?.workspaceState.update(SESSION_TITLE_KEY, undefined);
}

/**
 * Try to restore a previously persisted session (after VS Code reload).
 * Returns the session ID if successfully restored, null otherwise.
 */
export async function restoreSession(): Promise<string | null> {
  if (activeSession) return activeSession.id; // Already active
  if (!_extensionContext) return null;

  const id = _extensionContext.workspaceState.get<string>(SESSION_STATE_KEY);
  const title = _extensionContext.workspaceState.get<string>(SESSION_TITLE_KEY);
  if (!id || !title) return null;

  // Verify session is still active on server
  const healthy = await isServerHealthy();
  if (!healthy) return null;

  try {
    const data = await apiCall(`/api/sessions/${id}`) as { session: { status: string } };
    if (data.session?.status !== 'active') {
      clearPersistedSession();
      return null;
    }
  } catch {
    clearPersistedSession();
    return null;
  }

  // Session is still alive — reattach locally
  const flushMs = vscode.workspace.getConfiguration('vai').get('flushIntervalMs', 500);
  activeSession = {
    id,
    title,
    eventBuffer: [],
    eventCount: 0,
    flushTimer: null,
    createdAt: Date.now(),
  };
  activeSession.flushTimer = setInterval(() => void flushEvents(), flushMs);

  _onSessionChange.fire(activeSession);
  console.log(`[vai] Restored session: ${title} (${id})`);
  return id;
}

/* ── Attach to Agent Session (.vai-session) ─────────────────── */

/**
 * Attach to an externally-created session (from session-bridge.mjs).
 * If we already have an active session, end it silently first.
 * Returns true if successfully attached.
 */
export async function attachToSession(
  id: string,
  title: string,
): Promise<boolean> {
  // Don't re-attach to the same session
  if (activeSession?.id === id) return true;

  // Detach from existing session locally — do NOT end it on the server.
  // The agent manages its own session lifecycle via session-bridge.mjs.
  if (activeSession) {
    await flushEvents(); // flush buffered events first
    if (activeSession.flushTimer) {
      clearInterval(activeSession.flushTimer);
    }
    activeSession = null;
  }

  const healthy = await isServerHealthy();
  if (!healthy) return false;

  // Verify the session exists on the server
  try {
    const data = (await apiCall(`/api/sessions/${id}`)) as {
      session: { status: string };
    };
    if (data.session?.status !== 'active') return false;
  } catch {
    return false;
  }

  const flushMs = vscode.workspace
    .getConfiguration('vai')
    .get('flushIntervalMs', 500);

  activeSession = {
    id,
    title,
    eventBuffer: [],
    eventCount: 0,
    flushTimer: null,
    createdAt: Date.now(),
  };
  activeSession.flushTimer = setInterval(() => void flushEvents(), flushMs);

  persistSession(id, title);
  _onSessionChange.fire(activeSession);
  console.log(`[vai] Attached to agent session: ${title} (${id})`);
  return true;
}

/* ── Create Session ────────────────────────────────────────────── */

export async function createSession(title: string): Promise<string> {
  if (activeSession) {
    // End existing session first (programmatic — no confirmation needed)
    await endSession(true);
  }

  const healthy = await isServerHealthy();
  if (!healthy) {
    throw new Error('VeggaAI runtime server is not reachable');
  }

  const session = await apiCall('/api/sessions', 'POST', {
    title: deriveTitle(title),
    agentName: 'VS Code Activity',
    modelId: 'auto-capture',
    tags: ['vscode-extension', 'auto-capture'],
  });

  const flushMs = vscode.workspace.getConfiguration('vai').get('flushIntervalMs', 500);

  activeSession = {
    id: session.id,
    title: session.title,
    eventBuffer: [],
    eventCount: 0,
    flushTimer: null,
    createdAt: Date.now(),
  };

  // Persist for survival across reloads
  persistSession(session.id, session.title);

  // High-frequency flush for near-realtime capture
  activeSession.flushTimer = setInterval(() => void flushEvents(), flushMs);

  _onSessionChange.fire(activeSession);
  return session.id;
}

/* ── End Session ───────────────────────────────────────────────── */

/**
 * End the active session.
 * @param skipConfirmation - If true, skips the confirmation dialog (for programmatic calls)
 */
export async function endSession(skipConfirmation = false): Promise<void> {
  if (!activeSession) return;

  // Require confirmation for user-initiated end
  if (!skipConfirmation) {
    const choice = await vscode.window.showWarningMessage(
      `End session "${activeSession.title}" (${activeSession.eventCount} events)?`,
      { modal: false },
      'End Session',
      'Cancel',
    );
    if (choice !== 'End Session') return;
  }

  // Final flush
  await flushEvents();

  if (activeSession.flushTimer) {
    clearInterval(activeSession.flushTimer);
  }

  try {
    await apiCall(`/api/sessions/${activeSession.id}/end`, 'POST', { status: 'completed' });
  } catch {
    // Server might be down — that's okay
  }

  clearPersistedSession();
  activeSession = null;
  _onSessionChange.fire(null);
}

/* ── Push Events ───────────────────────────────────────────────── */

export function pushEvent(type: string, content: string, meta: Record<string, unknown> = {}): void {
  if (!activeSession) return;

  const event: VaiEvent = {
    type,
    content,
    meta: { eventType: type, ...meta },
    timestamp: Date.now(),
  };

  activeSession.eventBuffer.push(event);
  activeSession.eventCount++;
  _onEventPushed.fire(event);
}

/* ── Flush Buffer ──────────────────────────────────────────────── */

export async function flushEvents(): Promise<void> {
  if (!activeSession || activeSession.eventBuffer.length === 0 || _flushing) return;

  _flushing = true;
  const events = [...activeSession.eventBuffer];
  activeSession.eventBuffer = [];

  try {
    await apiCall(`/api/sessions/${activeSession.id}/events`, 'POST', {
      events: events.map((e) => ({
        type: e.type,
        content: e.content,
        meta: e.meta,
        timestamp: e.timestamp ?? Date.now(),
      })),
    });
  } catch (err) {
    // Put events back on failure
    if (activeSession) {
      activeSession.eventBuffer.unshift(...events);
    }
    console.error('[vai] flush failed:', err);
  } finally {
    _flushing = false;
  }
}

/* ── Helpers ───────────────────────────────────────────────────── */

export function deriveTitle(content: string): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/\[.*?\]\(.*?\)/g, '')
    .replace(/[#*_`~]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= 60) return cleaned || 'VS Code Session';
  const truncated = cleaned.slice(0, 60);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

export function dispose(): void {
  _onSessionChange.dispose();
  _onEventPushed.dispose();
}
