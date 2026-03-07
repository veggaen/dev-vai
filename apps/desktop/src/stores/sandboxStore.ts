import { create } from 'zustand';
import { API_BASE } from '../lib/api.js';

export interface SandboxFile {
  path: string;
  content: string;
}

export interface SandboxTemplateInfo {
  id: string;
  name: string;
  description: string;
  category: 'frontend' | 'backend' | 'fullstack';
  fileCount: number;
}

export type SandboxStatus = 'idle' | 'creating' | 'writing' | 'installing' | 'building' | 'running' | 'failed';

export type DeployPhase = 'idle' | 'deploying' | 'ready' | 'failed';

export interface DeployStepState {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  message?: string;
  elapsed?: number;
}

const INITIAL_DEPLOY_STEPS: DeployStepState[] = [
  { id: 'scaffold', label: 'Scaffolding project', status: 'pending' },
  { id: 'install', label: 'Installing packages', status: 'pending' },
  { id: 'build', label: 'Building application', status: 'pending' },
  { id: 'docker', label: 'Docker verification', status: 'pending' },
  { id: 'test', label: 'Running tests', status: 'pending' },
  { id: 'start', label: 'Starting dev server', status: 'pending' },
  { id: 'verify', label: 'Health check', status: 'pending' },
];

interface SandboxState {
  projectId: string | null;
  projectName: string | null;
  status: SandboxStatus;
  devPort: number | null;
  files: string[];
  logs: string[];
  error: string | null;
  templates: SandboxTemplateInfo[];

  /** Deploy pipeline state */
  deployPhase: DeployPhase;
  deploySteps: DeployStepState[];
  deployStartTime: number;
  deployStackName: string;
  deployTierName: string;

  createProject: (name: string) => Promise<string>;
  writeFiles: (files: SandboxFile[]) => Promise<void>;
  installDeps: () => Promise<boolean>;
  startDev: () => Promise<number | null>;
  stopDev: () => Promise<void>;
  fetchLogs: () => Promise<void>;
  fetchFiles: () => Promise<void>;
  fetchTemplates: () => Promise<void>;
  destroyProject: () => Promise<void>;
  cancelDeploy: () => void;
  reset: () => void;

  /** Full pipeline: create → write files → install → start */
  scaffold: (name: string, files: SandboxFile[]) => Promise<void>;

  /** Full pipeline from template: create from template → install → start */
  scaffoldFromTemplate: (templateId: string, name?: string) => Promise<void>;

  /** Streaming deploy from stack template with progress tracking */
  deployStack: (stackId: string, tier: string, stackName?: string, tierName?: string) => Promise<void>;
}

// Listen for console bridge messages from sandbox iframes
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'vai-sandbox-console') {
      const { method, args } = event.data as { method: string; args: string[] };
      const prefix = method === 'error' ? '✗ [browser] ' :
                     method === 'warn' ? '⚠ [browser] ' :
                     method === 'info' ? 'ℹ [browser] ' : '[browser] ';
      const line = prefix + args.join(' ');
      // Push to sandbox store logs
      const state = useSandboxStore.getState();
      if (state.projectId) {
        useSandboxStore.setState({ logs: [...state.logs, line] });
      }
    }
  });
}

// Module-level AbortController for deploy cancellation
let deployAbortController: AbortController | null = null;

export const useSandboxStore = create<SandboxState>((set, get) => ({
  projectId: null,
  projectName: null,
  status: 'idle',

  deployPhase: 'idle' as DeployPhase,
  deploySteps: [] as DeployStepState[],
  deployStartTime: 0,
  deployStackName: '',
  deployTierName: '',
  devPort: null,
  files: [],
  logs: [],
  error: null,
  templates: [],

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

  fetchTemplates: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sandbox/templates`);
      const data = await res.json() as SandboxTemplateInfo[];
      set({ templates: data });
    } catch { /* ok */ }
  },

  destroyProject: async () => {
    // Abort any in-flight deploy stream first
    if (deployAbortController) {
      deployAbortController.abort();
      deployAbortController = null;
    }
    const { projectId } = get();
    if (projectId) {
      await fetch(`${API_BASE}/api/sandbox/${projectId}`, { method: 'DELETE' }).catch(() => {});
    }
    set({
      projectId: null, projectName: null, status: 'idle', devPort: null,
      files: [], logs: [], error: null,
      deployPhase: 'idle', deploySteps: [], deployStartTime: 0,
      deployStackName: '', deployTierName: '',
    });
  },

  cancelDeploy: () => {
    if (deployAbortController) {
      deployAbortController.abort();
      deployAbortController = null;
    }
    set({
      deployPhase: 'idle', deploySteps: [], deployStartTime: 0,
      deployStackName: '', deployTierName: '',
      status: 'idle', error: null, projectId: null, projectName: null,
      devPort: null, files: [], logs: [],
    });
  },

  reset: () => {
    if (deployAbortController) {
      deployAbortController.abort();
      deployAbortController = null;
    }
    set({
      projectId: null, projectName: null, status: 'idle', devPort: null,
      files: [], logs: [], error: null,
      deployPhase: 'idle', deploySteps: [], deployStartTime: 0,
      deployStackName: '', deployTierName: '',
    });
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

  scaffoldFromTemplate: async (templateId: string, name?: string) => {
    set({ status: 'creating', error: null });
    try {
      // Create from template (writes files on server)
      const res = await fetch(`${API_BASE}/api/sandbox/from-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, name }),
      });
      const data = await res.json() as { id: string; name: string; files: string[] };
      set({ projectId: data.id, projectName: data.name, files: data.files });

      // Install deps
      const ok = await get().installDeps();
      if (!ok) return;

      // Start dev server
      await get().startDev();
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message });
    }
  },

  deployStack: async (stackId: string, tier: string, stackName?: string, tierName?: string) => {
    // Abort any previous deploy stream
    if (deployAbortController) {
      deployAbortController.abort();
    }
    const controller = new AbortController();
    deployAbortController = controller;

    set({
      deployPhase: 'deploying',
      deploySteps: INITIAL_DEPLOY_STEPS.map((s) => ({ ...s })),
      deployStartTime: Date.now(),
      deployStackName: stackName || stackId.toUpperCase(),
      deployTierName: tierName || tier,
      error: null,
      projectId: null,
      projectName: null,
      devPort: null,
    });

    try {
      const res = await fetch(`${API_BASE}/api/sandbox/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stackId, tier }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Deploy request failed' }));
        if (!controller.signal.aborted) {
          set({ deployPhase: 'failed', error: (err as { error: string }).error });
        }
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        // Check abort before each read
        if (controller.signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || controller.signal.aborted) continue;
          try {
            const event = JSON.parse(line) as {
              step: string;
              status: string;
              message?: string;
              elapsed?: number;
              projectId?: string;
              port?: number;
            };

            // Update the matching step
            set((state) => ({
              deploySteps: state.deploySteps.map((s) =>
                s.id === event.step
                  ? {
                      ...s,
                      status: event.status as DeployStepState['status'],
                      message: event.message ?? s.message,
                      elapsed: event.elapsed ?? s.elapsed,
                    }
                  : s,
              ),
            }));

            // Capture projectId and port when available
            if (event.projectId) {
              set({ projectId: event.projectId, projectName: stackName || stackId });
            }
            if (event.port) {
              set({ devPort: event.port });
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Don't update state if aborted (cancelDeploy/destroyProject already reset)
      if (controller.signal.aborted) return;

      // Determine final phase
      const { deploySteps, devPort } = get();
      const hasFailed = deploySteps.some((s) => s.status === 'failed');
      const verifyStep = deploySteps.find((s) => s.id === 'verify');
      const isReady = verifyStep?.status === 'done';

      if (isReady && devPort) {
        set({ deployPhase: 'ready', status: 'running' });
      } else if (hasFailed) {
        // Still might be usable — check if dev server started AND we have a port
        const startStep = deploySteps.find((s) => s.id === 'start');
        if (startStep?.status === 'done' && devPort) {
          set({ deployPhase: 'ready', status: 'running' });
        } else {
          const failedStep = deploySteps.find((s) => s.status === 'failed');
          set({ deployPhase: 'failed', error: failedStep?.message || 'Deployment had failures' });
        }
      } else if (devPort) {
        // Stream ended without explicit verification but we have a port
        set({ deployPhase: 'ready', status: 'running' });
      } else {
        // Stream ended, no port, no failures — something went wrong silently
        set({ deployPhase: 'failed', error: 'Deploy completed but no dev server port received' });
      }
    } catch (err) {
      // AbortError is expected when user cancels — don't overwrite the reset state
      if ((err as Error).name === 'AbortError') return;
      if (!controller.signal.aborted) {
        set({ deployPhase: 'failed', error: (err as Error).message });
      }
    } finally {
      if (deployAbortController === controller) {
        deployAbortController = null;
      }
    }
  },
}));
