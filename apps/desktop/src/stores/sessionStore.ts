import { create } from 'zustand';
import { API_BASE } from '../lib/api.js';
import type {
  AgentSession,
  SessionEvent,
  SessionEventType,
  EventMeta,
} from '@vai/core';

/* ── Types ─────────────────────────────────────────────────────── */

interface SessionState {
  /* Data */
  sessions: AgentSession[];
  activeSessionId: string | null;
  activeSession: AgentSession | null;
  events: SessionEvent[];
  isLoading: boolean;

  /* Live polling */
  isPolling: boolean;
  pollIntervalId: ReturnType<typeof setInterval> | null;

  /* Filters */
  statusFilter: 'all' | 'active' | 'completed' | 'failed';
  eventTypeFilter: SessionEventType | 'all';

  /* Pagination */
  totalSessions: number;

  /* Actions */
  fetchSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  clearSelection: () => void;
  deleteSession: (id: string) => Promise<void>;
  createSession: (title: string, agentName: string, modelId: string) => Promise<string | null>;
  endSession: (id: string) => Promise<void>;
  exportSession: (id: string) => Promise<object | null>;
  importSession: (data: object) => Promise<string | null>;
  setStatusFilter: (filter: 'all' | 'active' | 'completed' | 'failed') => void;
  setEventTypeFilter: (filter: SessionEventType | 'all') => void;

  /* New: push events + session management */
  pushEvents: (sessionId: string, events: Array<{
    type: SessionEventType;
    content: string;
    meta?: EventMeta;
  }>) => Promise<void>;
  updateTitle: (sessionId: string, title: string) => Promise<void>;
  refreshActiveSession: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
}

/* ── Store ─────────────────────────────────────────────────────── */

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeSession: null,
  events: [],
  isLoading: false,
  isPolling: false,
  pollIntervalId: null,
  statusFilter: 'all',
  eventTypeFilter: 'all',
  totalSessions: 0,

  fetchSessions: async () => {
    try {
      set({ isLoading: true });
      const { statusFilter } = get();
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(`${API_BASE}/api/sessions?${params}`);
      if (!res.ok) throw new Error('Failed to fetch sessions');
      const data = await res.json() as { sessions: AgentSession[]; total: number };
      set({ sessions: data.sessions, totalSessions: data.total, isLoading: false });
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      set({ isLoading: false });
    }
  },

  selectSession: async (id: string) => {
    try {
      set({ isLoading: true, activeSessionId: id });
      const res = await fetch(`${API_BASE}/api/sessions/${id}`);
      if (!res.ok) throw new Error('Session not found');
      const data = await res.json() as { session: AgentSession; events: SessionEvent[] };
      set({
        activeSession: data.session,
        events: data.events,
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to load session:', err);
      set({ activeSessionId: null, activeSession: null, events: [], isLoading: false });
    }
  },

  clearSelection: () => {
    set({ activeSessionId: null, activeSession: null, events: [] });
  },

  deleteSession: async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/sessions/${id}`, { method: 'DELETE' });
      const { activeSessionId } = get();
      if (activeSessionId === id) {
        set({ activeSessionId: null, activeSession: null, events: [] });
      }
      await get().fetchSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  },

  createSession: async (title, agentName, modelId) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, agentName, modelId }),
      });
      if (!res.ok) throw new Error('Failed to create session');
      const { id } = await res.json() as { id: string };
      await get().fetchSessions();
      return id;
    } catch (err) {
      console.error('Failed to create session:', err);
      return null;
    }
  },

  endSession: async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/sessions/${id}/end`, { method: 'POST' });
      await get().fetchSessions();
      if (get().activeSessionId === id) {
        await get().selectSession(id); // refresh active session
      }
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  },

  exportSession: async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${id}/export`);
      if (!res.ok) throw new Error('Failed to export');
      return await res.json();
    } catch (err) {
      console.error('Failed to export session:', err);
      return null;
    }
  },

  importSession: async (data: object) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to import');
      const { id } = await res.json() as { id: string };
      await get().fetchSessions();
      return id;
    } catch (err) {
      console.error('Failed to import session:', err);
      return null;
    }
  },

  setStatusFilter: (filter) => {
    set({ statusFilter: filter });
    get().fetchSessions();
  },

  setEventTypeFilter: (filter) => {
    set({ eventTypeFilter: filter });
  },

  /* ── Push events to an active session ─────────────────────── */
  pushEvents: async (sessionId, events) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });
      if (!res.ok) throw new Error('Failed to push events');
      // If we're viewing this session, append the new events locally for instant UI
      const { activeSessionId } = get();
      if (activeSessionId === sessionId) {
        const data = await res.json() as { ids: string[] };
        // Re-fetch to get the full event objects with timestamps
        await get().refreshActiveSession();
        void data; // ids available if needed
      }
    } catch (err) {
      console.error('Failed to push events:', err);
    }
  },

  /* ── Update session title ─────────────────────────────────── */
  updateTitle: async (sessionId, title) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to update title');
      // Update in local state
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, title } : s
        ),
        activeSession: state.activeSession?.id === sessionId
          ? { ...state.activeSession, title }
          : state.activeSession,
      }));
    } catch (err) {
      console.error('Failed to update title:', err);
    }
  },

  /* ── Refresh active session (re-fetch events) ────────────── */
  refreshActiveSession: async () => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${activeSessionId}`);
      if (!res.ok) return;
      const data = await res.json() as { session: AgentSession; events: SessionEvent[] };
      set({
        activeSession: data.session,
        events: data.events,
      });
    } catch {
      // Silent fail for polling
    }
  },

  /* ── Live polling controls ────────────────────────────────── */
  startPolling: (intervalMs = 2000) => {
    const { pollIntervalId } = get();
    if (pollIntervalId) return; // Already polling

    const id = setInterval(() => {
      const { activeSession } = get();
      // Only poll for active sessions
      if (activeSession?.status === 'active') {
        void get().refreshActiveSession();
      }
    }, intervalMs);

    set({ isPolling: true, pollIntervalId: id });
  },

  stopPolling: () => {
    const { pollIntervalId } = get();
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
    }
    set({ isPolling: false, pollIntervalId: null });
  },
}));
