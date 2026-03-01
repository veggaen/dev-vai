import { create } from 'zustand';
import { API_BASE } from '../lib/api.js';

export interface SandboxFile {
  path: string;
  content: string;
}

export type SandboxStatus = 'idle' | 'creating' | 'writing' | 'installing' | 'building' | 'running' | 'failed';

interface SandboxState {
  projectId: string | null;
  projectName: string | null;
  status: SandboxStatus;
  devPort: number | null;
  files: string[];
  logs: string[];
  error: string | null;

  createProject: (name: string) => Promise<string>;
  writeFiles: (files: SandboxFile[]) => Promise<void>;
  installDeps: () => Promise<boolean>;
  startDev: () => Promise<number | null>;
  stopDev: () => Promise<void>;
  fetchLogs: () => Promise<void>;
  fetchFiles: () => Promise<void>;
  destroyProject: () => Promise<void>;
  reset: () => void;

  /** Full pipeline: create → write files → install → start */
  scaffold: (name: string, files: SandboxFile[]) => Promise<void>;
}

export const useSandboxStore = create<SandboxState>((set, get) => ({
  projectId: null,
  projectName: null,
  status: 'idle',
  devPort: null,
  files: [],
  logs: [],
  error: null,

  createProject: async (name: string) => {
    set({ status: 'creating', error: null });
    try {
      const res = await fetch(`${API_BASE}/api/sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json() as { id: string; name: string };
      set({ projectId: data.id, projectName: data.name });
      return data.id;
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message });
      throw err;
    }
  },

  writeFiles: async (files: SandboxFile[]) => {
    const { projectId } = get();
    if (!projectId) throw new Error('No project');
    set({ status: 'writing' });
    try {
      await fetch(`${API_BASE}/api/sandbox/${projectId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      await get().fetchFiles();
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message });
    }
  },

  installDeps: async () => {
    const { projectId } = get();
    if (!projectId) return false;
    set({ status: 'installing' });
    try {
      const res = await fetch(`${API_BASE}/api/sandbox/${projectId}/install`, { method: 'POST' });
      const data = await res.json() as { success: boolean };
      if (!data.success) set({ status: 'failed', error: 'Install failed' });
      return data.success;
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message });
      return false;
    }
  },

  startDev: async () => {
    const { projectId } = get();
    if (!projectId) return null;
    set({ status: 'building' });
    try {
      const res = await fetch(`${API_BASE}/api/sandbox/${projectId}/start`, { method: 'POST' });
      const data = await res.json() as { port: number };
      set({ devPort: data.port, status: 'running' });
      return data.port;
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message });
      return null;
    }
  },

  stopDev: async () => {
    const { projectId } = get();
    if (!projectId) return;
    await fetch(`${API_BASE}/api/sandbox/${projectId}/stop`, { method: 'POST' });
    set({ devPort: null, status: 'idle' });
  },

  fetchLogs: async () => {
    const { projectId } = get();
    if (!projectId) return;
    try {
      const res = await fetch(`${API_BASE}/api/sandbox/${projectId}/logs`);
      const data = await res.json() as { logs: string[] };
      set({ logs: data.logs });
    } catch { /* ok */ }
  },

  fetchFiles: async () => {
    const { projectId } = get();
    if (!projectId) return;
    try {
      const res = await fetch(`${API_BASE}/api/sandbox/${projectId}/files`);
      const data = await res.json() as { files: string[] };
      set({ files: data.files });
    } catch { /* ok */ }
  },

  destroyProject: async () => {
    const { projectId } = get();
    if (!projectId) return;
    await fetch(`${API_BASE}/api/sandbox/${projectId}`, { method: 'DELETE' });
    set({ projectId: null, projectName: null, status: 'idle', devPort: null, files: [], logs: [], error: null });
  },

  reset: () => {
    set({ projectId: null, projectName: null, status: 'idle', devPort: null, files: [], logs: [], error: null });
  },

  scaffold: async (name: string, files: SandboxFile[]) => {
    const state = get();

    // Create project
    const id = await state.createProject(name);
    if (!id) return;

    // Write files
    await get().writeFiles(files);

    // Install if package.json exists
    const hasPkg = files.some((f) => f.path === 'package.json');
    if (hasPkg) {
      const ok = await get().installDeps();
      if (!ok) return;
    }

    // Start dev server
    await get().startDev();
  },
}));
