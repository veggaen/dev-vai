import { create } from 'zustand';
import { API_BASE } from '../lib/api.js';
import type {
  AgentSession,
  SessionEvent,
  SessionEventType,
} from '@vai/core';

/* ── Types ─────────────────────────────────────────────────────── */

interface SessionState {
  /* Data */
  sessions: AgentSession[];
  activeSessionId: string | null;
  activeSession: AgentSession | null;
  events: SessionEvent[];
  isLoading: boolean;

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
}

/* ── Store ─────────────────────────────────────────────────────── */

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeSession: null,
  events: [],
  isLoading: false,
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
}));
