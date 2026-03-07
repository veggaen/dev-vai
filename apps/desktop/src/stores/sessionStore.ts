import { create } from 'zustand';
import { API_BASE } from '../lib/api.js';
import type {
  AgentSession,
  SessionEvent,
  SessionEventType,
  EventMeta,
  SearchResult,
  PinnedNote,
  PinnedNoteCategory,
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
  eventTypeFilter: Set<string>;
  /** Quick preset: 'all' | 'conversation' | 'message:user' | 'message:assistant' */
  filterPreset: string | null;

  /* Search */
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;

  /* Pinned */
  pinnedEvents: SessionEvent[];
  pinnedNotes: PinnedNote[];

  /* View mode */
  compactMode: boolean;

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
  setEventTypeFilter: (filter: Set<string>) => void;
  setFilterPreset: (preset: string | null) => void;
  toggleEventType: (type: string) => void;

  /* Push events + session management */
  pushEvents: (sessionId: string, events: Array<{
    type: SessionEventType;
    content: string;
    meta?: EventMeta;
  }>) => Promise<void>;
  updateTitle: (sessionId: string, title: string) => Promise<void>;
  refreshActiveSession: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;

  /* Search */
  setSearchQuery: (query: string) => void;
  searchEvents: (query: string) => Promise<void>;
  clearSearch: () => void;

  /* Pinned */
  fetchPinnedEvents: (sessionId: string) => Promise<void>;
  pinEvent: (sessionId: string, eventId: string) => Promise<void>;
  unpinEvent: (sessionId: string, eventId: string) => Promise<void>;
  fetchPinnedNotes: (sessionId: string) => Promise<void>;
  addPinnedNote: (sessionId: string, content: string, category?: PinnedNoteCategory, eventId?: string) => Promise<void>;
  resolvePinnedNote: (noteId: string) => Promise<void>;

  /* View mode */
  toggleCompactMode: () => void;
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
  eventTypeFilter: new Set<string>(),
  filterPreset: 'all',
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  pinnedEvents: [],
  pinnedNotes: [],
  compactMode: false,
  totalSessions: 0,

  fetchSessions: async () => {
    try {
      // Don't set isLoading on refresh — prevents UI flash during periodic polls
      const { statusFilter, sessions: prevSessions } = get();
      if (prevSessions.length === 0) set({ isLoading: true });

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
      // Fetch pinned data in background
      void get().fetchPinnedEvents(id);
      void get().fetchPinnedNotes(id);
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
      await fetch(`${API_BASE}/api/sessions/${id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
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
    set({ eventTypeFilter: filter, filterPreset: null });
  },

  setFilterPreset: (preset) => {
    set({ filterPreset: preset, eventTypeFilter: new Set<string>() });
  },

  toggleEventType: (type) => {
    const current = new Set(get().eventTypeFilter);
    if (current.has(type)) {
      current.delete(type);
    } else {
      current.add(type);
    }
    set({ eventTypeFilter: current, filterPreset: current.size === 0 ? 'all' : null });
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

  /* ── Refresh active session (incremental event fetch) ──── */
  refreshActiveSession: async () => {
    const { activeSessionId, events: currentEvents } = get();
    if (!activeSessionId) return;
    try {
      // Incremental: only fetch events after our last known timestamp
      const lastTs = currentEvents.length > 0
        ? currentEvents[currentEvents.length - 1].timestamp
        : 0;

      const url = lastTs
        ? `${API_BASE}/api/sessions/${activeSessionId}/events?after=${lastTs}`
        : `${API_BASE}/api/sessions/${activeSessionId}/events`;

      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;

      const newEvents = await res.json() as SessionEvent[];

      // Only update state if there are actually new events — zero-blink
      if (newEvents.length > 0) {
        set((state) => ({
          events: [...state.events, ...newEvents],
        }));
      }
    } catch {
      // Silent fail for polling — no UI changes
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

  /* ── Search ──────────────────────────────────────────────── */
  setSearchQuery: (query) => set({ searchQuery: query }),

  searchEvents: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [], isSearching: false });
      return;
    }
    try {
      set({ isSearching: true });
      const params = new URLSearchParams({ q: query, limit: '50' });
      const { activeSessionId } = get();
      if (activeSessionId) params.set('sessionId', activeSessionId);
      const res = await fetch(`${API_BASE}/api/sessions/search?${params}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json() as { results: SearchResult[] };
      set({ searchResults: data.results, isSearching: false });
    } catch (err) {
      console.error('Search failed:', err);
      set({ searchResults: [], isSearching: false });
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [] }),

  /* ── Pinned Events ──────────────────────────────────────── */
  fetchPinnedEvents: async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/pinned`);
      if (!res.ok) return;
      const data = await res.json() as { events: SessionEvent[] };
      set({ pinnedEvents: data.events });
    } catch {
      // Silent
    }
  },

  pinEvent: async (sessionId, eventId) => {
    try {
      await fetch(`${API_BASE}/api/sessions/${sessionId}/events/${eventId}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      });
      await get().fetchPinnedEvents(sessionId);
    } catch (err) {
      console.error('Failed to pin event:', err);
    }
  },

  unpinEvent: async (sessionId, eventId) => {
    try {
      await fetch(`${API_BASE}/api/sessions/${sessionId}/events/${eventId}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: false }),
      });
      await get().fetchPinnedEvents(sessionId);
    } catch (err) {
      console.error('Failed to unpin event:', err);
    }
  },

  /* ── Pinned Notes ───────────────────────────────────────── */
  fetchPinnedNotes: async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/notes`);
      if (!res.ok) return;
      const data = await res.json() as { notes: PinnedNote[] };
      set({ pinnedNotes: data.notes });
    } catch {
      // Silent
    }
  },

  addPinnedNote: async (sessionId, content, category = 'custom', eventId) => {
    try {
      await fetch(`${API_BASE}/api/sessions/${sessionId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, category, eventId }),
      });
      await get().fetchPinnedNotes(sessionId);
    } catch (err) {
      console.error('Failed to add note:', err);
    }
  },

  resolvePinnedNote: async (noteId) => {
    try {
      await fetch(`${API_BASE}/api/sessions/notes/${noteId}/resolve`, { method: 'POST' });
      const { activeSessionId } = get();
      if (activeSessionId) await get().fetchPinnedNotes(activeSessionId);
    } catch (err) {
      console.error('Failed to resolve note:', err);
    }
  },

  /* ── View Mode ──────────────────────────────────────────── */
  toggleCompactMode: () => set((s) => ({ compactMode: !s.compactMode })),
}));
