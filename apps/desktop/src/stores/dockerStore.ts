/**
 * dockerStore.ts — Zustand store for Docker sandbox management.
 *
 * Tracks Docker daemon status, running containers, resource usage,
 * and provides actions for container lifecycle management.
 *
 * Communicates with the runtime server's /api/docker/* endpoints.
 */

import { create } from 'zustand';
import { API_BASE } from '../lib/api.js';

export type DockerDaemonStatus = 'unknown' | 'running' | 'stopped' | 'error' | 'not-installed';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'created' | 'restarting' | 'paused' | 'exited' | 'dead';
  state: string;
  created: string;
  ports: string[];
  /** Resource usage (only when running) */
  cpu?: string;
  memory?: string;
  memoryLimit?: string;
  /** Associated sandbox project ID (if any) */
  sandboxId?: string;
  /** Labels from container metadata */
  labels?: Record<string, string>;
}

export interface DockerImage {
  id: string;
  tags: string[];
  size: string;
  created: string;
}

interface DockerState {
  /** Docker daemon status */
  daemonStatus: DockerDaemonStatus;
  /** Running/stopped containers */
  containers: DockerContainer[];
  /** Local images */
  images: DockerImage[];
  /** Whether we're currently fetching */
  loading: boolean;
  /** Last error */
  error: string | null;
  /** Last refresh timestamp */
  lastRefresh: number | null;

  /** Check if Docker daemon is available */
  checkDaemon: () => Promise<void>;
  /** Refresh container list */
  refreshContainers: () => Promise<void>;
  /** Refresh images */
  refreshImages: () => Promise<void>;
  /** Start a container */
  startContainer: (id: string) => Promise<void>;
  /** Stop a container */
  stopContainer: (id: string) => Promise<void>;
  /** Restart a container */
  restartContainer: (id: string) => Promise<void>;
  /** Remove a container */
  removeContainer: (id: string) => Promise<void>;
  /** Get container logs */
  getContainerLogs: (id: string, tail?: number) => Promise<string>;
  /** Full refresh (daemon + containers + images) */
  refresh: () => Promise<void>;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`Docker API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Docker API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export const useDockerStore = create<DockerState>((set, get) => ({
  daemonStatus: 'unknown',
  containers: [],
  images: [],
  loading: false,
  error: null,
  lastRefresh: null,

  checkDaemon: async () => {
    try {
      const data = await apiGet<{ status: DockerDaemonStatus; version?: string }>('/docker/status');
      set({ daemonStatus: data.status, error: null });
    } catch {
      set({ daemonStatus: 'error', error: 'Could not reach Docker daemon' });
    }
  },

  refreshContainers: async () => {
    try {
      set({ loading: true });
      const data = await apiGet<{ containers: DockerContainer[] }>('/docker/containers');
      set({ containers: data.containers, loading: false, error: null, lastRefresh: Date.now() });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  refreshImages: async () => {
    try {
      const data = await apiGet<{ images: DockerImage[] }>('/docker/images');
      set({ images: data.images });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  startContainer: async (id) => {
    await apiPost(`/docker/containers/${id}/start`);
    await get().refreshContainers();
  },

  stopContainer: async (id) => {
    await apiPost(`/docker/containers/${id}/stop`);
    await get().refreshContainers();
  },

  restartContainer: async (id) => {
    await apiPost(`/docker/containers/${id}/restart`);
    await get().refreshContainers();
  },

  removeContainer: async (id) => {
    await apiPost(`/docker/containers/${id}/remove`);
    await get().refreshContainers();
  },

  getContainerLogs: async (id, tail = 100) => {
    const data = await apiGet<{ logs: string }>(`/docker/containers/${id}/logs?tail=${tail}`);
    return data.logs;
  },

  refresh: async () => {
    const { checkDaemon, refreshContainers, refreshImages } = get();
    await checkDaemon();
    if (get().daemonStatus === 'running') {
      await Promise.all([refreshContainers(), refreshImages()]);
    }
  },
}));
