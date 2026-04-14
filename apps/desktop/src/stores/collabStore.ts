import { create } from 'zustand';
import { apiFetch } from '../lib/api.js';

export interface CompanionClientSummary {
  id: string;
  clientName: string;
  clientType: string;
  launchTarget: string;
  availableModels: string | null; // JSON: [{ id, family, name, vendor }]
  availableChatInfo: string | null; // JSON: { chatApps: [{ id, label }], sessions: [{ sessionId, title, lastModified, chatApp }] }
  lastSeenAt: string | null;
  lastPolledAt: string | null;
}

export interface ClaimedByUserSummary {
  id: string;
  name: string | null;
  email: string;
}

export interface ProjectPeer {
  id: string;
  projectId: string;
  peerKey: string;
  displayName: string;
  ide: string;
  model: string;
  status: 'idle' | 'invited' | 'ready' | 'active';
  launchTarget: string;
  preferredClientId: string | null;
  preferredClient: CompanionClientSummary | null;
  instructions: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditResult {
  id: string;
  auditRequestId: string;
  projectId: string;
  peerKey: string;
  status: 'pending' | 'claimed' | 'submitted';
  claimedByUserId: string | null;
  claimedByClientId: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  claimIsStale: boolean;
  claimedByUser: ClaimedByUserSummary | null;
  claimedByClient: CompanionClientSummary | null;
  verdict: string | null;
  confidence: number | null;
  rationale: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRequest {
  id: string;
  projectId: string;
  prompt: string;
  scope: string;
  status: 'pending' | 'collecting' | 'completed';
  consensusSummary: string | null;
  winningPeerKey: string | null;
  createdAt: string;
  updatedAt: string;
  results: AuditResult[];
}

interface CollabState {
  peers: ProjectPeer[];
  companionClients: CompanionClientSummary[];
  /** All companion clients for the authenticated user (no project needed) */
  globalClients: CompanionClientSummary[];
  audits: AuditRequest[];
  loading: boolean;
  error: string | null;
  fetchCompanionClients: (projectId: string | null) => Promise<void>;
  /** Fetch all companion clients for the current user (global, no project) */
  fetchGlobalClients: () => Promise<void>;
  fetchPeers: (projectId: string | null) => Promise<void>;
  savePeers: (projectId: string, peers: Array<Partial<ProjectPeer> & Pick<ProjectPeer, 'displayName' | 'ide' | 'model'>>) => Promise<void>;
  fetchAudits: (projectId: string | null) => Promise<void>;
  createAudit: (projectId: string, prompt: string, peerKeys?: string[]) => Promise<AuditRequest | null>;
}

export const useCollabStore = create<CollabState>((set) => ({
  peers: [],
  companionClients: [],
  globalClients: [],
  audits: [],
  loading: false,
  error: null,

  fetchGlobalClients: async () => {
    try {
      const res = await apiFetch('/api/companion-clients');
      if (!res.ok) return;
      const clients = await res.json() as CompanionClientSummary[];
      set({ globalClients: clients });
    } catch {
      // Silent — non-critical for settings display
    }
  },

  fetchCompanionClients: async (projectId) => {
    if (!projectId) {
      set({ companionClients: [], error: null });
      return;
    }

    set({ loading: true, error: null });
    try {
      const res = await apiFetch(`/api/projects/${projectId}/companion-clients`);
      if (!res.ok) throw new Error('Unable to load companion clients');
      const companionClients = await res.json() as CompanionClientSummary[];
      set({ companionClients, loading: false });
    } catch (error) {
      set({ companionClients: [], loading: false, error: error instanceof Error ? error.message : 'Unable to load companion clients' });
    }
  },

  fetchPeers: async (projectId) => {
    if (!projectId) {
      set({ peers: [], error: null });
      return;
    }

    set({ loading: true, error: null });
    try {
      const res = await apiFetch(`/api/projects/${projectId}/peers`);
      if (!res.ok) throw new Error('Unable to load project peers');
      const peers = await res.json() as ProjectPeer[];
      set({ peers, loading: false });
    } catch (error) {
      set({ peers: [], loading: false, error: error instanceof Error ? error.message : 'Unable to load project peers' });
    }
  },

  savePeers: async (projectId, peers) => {
    set({ loading: true, error: null });
    try {
      const res = await apiFetch(`/api/projects/${projectId}/peers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peers }),
      });
      if (!res.ok) throw new Error('Unable to save project peers');
      const nextPeers = await res.json() as ProjectPeer[];
      set({ peers: nextPeers, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Unable to save project peers' });
      throw error;
    }
  },

  fetchAudits: async (projectId) => {
    if (!projectId) {
      set({ audits: [], error: null });
      return;
    }

    set({ loading: true, error: null });
    try {
      const res = await apiFetch(`/api/projects/${projectId}/audits`);
      if (!res.ok) throw new Error('Unable to load audits');
      const audits = await res.json() as AuditRequest[];
      set({ audits, loading: false });
    } catch (error) {
      set({ audits: [], loading: false, error: error instanceof Error ? error.message : 'Unable to load audits' });
    }
  },

  createAudit: async (projectId, prompt, peerKeys) => {
    set({ loading: true, error: null });
    try {
      const res = await apiFetch(`/api/projects/${projectId}/audits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, peerKeys }),
      });
      if (!res.ok) throw new Error('Unable to request audit');
      const audit = await res.json() as AuditRequest;
      set((state) => ({ audits: [audit, ...state.audits.filter((item) => item.id !== audit.id)], loading: false }));
      return audit;
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Unable to request audit' });
      return null;
    }
  },
}));