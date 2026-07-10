import { create } from 'zustand';
import type { ProjectHandoffConsumeResponse } from '@vai/api-types/project-responses';
import { apiFetch } from '../lib/api.js';
import { useLayoutStore } from './layoutStore.js';

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

/** Live activity feed (Base44-style "Wrote …" lines) — capped to avoid unbounded growth */
export interface BuildActivityItem {
  id: string;
  kind: 'wrote';
  detail: string;
  at: number;
}

/** True per-file diff stats from a recorded revision (server-computed). */
export interface SandboxFileDiff {
  path: string;
  changeType: 'create' | 'update' | 'delete';
  added: number;
  removed: number;
}

/** One-shot script run state (build / lint / test) mirrored from the runtime. */
export interface CommandRunInfo {
  script: string;
  status: 'running' | 'done' | 'failed';
  exitCode: number | null;
  tail?: string[];
}

export type EnvLane = 'dev' | 'preview' | 'production';

export interface LaneStateInfo {
  lane: EnvLane;
  status: 'switching' | 'ready' | 'failed';
  stage: string | null;
  error: string | null;
}

const MAX_BUILD_ACTIVITY = 120;
const MAX_CLIENT_LOG_ENTRIES = 500;

function derivePreviewFailureMessage(logs: string[], devStderr: string[] = []): string {
  const lines = [...devStderr, ...logs].filter(Boolean).slice(-80).reverse();
  const missingEnv = lines.find((line) => /Missing VITE_[A-Z0-9_]+/i.test(line));
  if (missingEnv) return missingEnv.trim().replace(/^cause:\s*/i, '');
  const health = lines.find((line) => /Preview health check failed/i.test(line));
  if (health) return health.replace(/^.*?Preview health check failed:/i, 'Preview failed:').trim();
  const serverError = lines.find((line) => /(HTTPError|Internal Server Error|Dev server exited|Dev server error)/i.test(line));
  return serverError?.trim() ?? 'Preview failed after starting. Check the project console for details.';
}

interface OpenLocalFolderResponse {
  id?: string;
  name?: string;
  rootDir?: string;
  version?: number;
  status?: SandboxStatus;
  devPort?: number | null;
  live?: boolean;
  envLane?: EnvLane;
  laneState?: LaneStateInfo | null;
  error?: string;
  profile?: {
    framework: string;
    frameworkLabel: string;
    scripts: Record<string, string>;
    hasPackageJson: boolean;
    hasNodeModules: boolean;
  };
}

/** Reopening an already-live local project is an attach, not a restart. */
export function reusableLocalProjectPort(data: OpenLocalFolderResponse): number | null {
  return data.live === true && Number.isInteger(data.devPort) && (data.devPort ?? 0) > 0
    ? data.devPort as number
    : null;
}

export interface DeployStepState {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  message?: string;
  elapsed?: number;
}

const FULL_DEPLOY_STEPS: DeployStepState[] = [
  { id: 'scaffold', label: 'Scaffolding project', status: 'pending' },
  { id: 'install', label: 'Installing packages', status: 'pending' },
  { id: 'build', label: 'Building application', status: 'pending' },
  { id: 'docker', label: 'Docker verification', status: 'pending' },
  { id: 'test', label: 'Running tests', status: 'pending' },
  { id: 'start', label: 'Starting dev server', status: 'pending' },
  { id: 'verify', label: 'Health check', status: 'pending' },
];

const QUICK_STARTER_STEPS: DeployStepState[] = [
  { id: 'scaffold', label: 'Creating app', status: 'pending' },
  { id: 'install', label: 'Preparing packages', status: 'pending' },
  { id: 'start', label: 'Launching dev server', status: 'pending' },
  { id: 'verify', label: 'Opening live preview', status: 'pending' },
];

function getInitialDeploySteps(stackId: string, tier: string): DeployStepState[] {
  if (stackId === 'nextjs' && tier === 'basic') {
    return QUICK_STARTER_STEPS.map((step) => ({ ...step }));
  }
  return FULL_DEPLOY_STEPS.map((step) => ({ ...step }));
}

interface SandboxState {
  projectId: string | null;
  persistentProjectId: string | null;
  projectName: string | null;
  projectVersion: number | null;
  status: SandboxStatus;
  devPort: number | null;
  previewReady: boolean;
  previewLoadCount: number;
  lastPreviewPort: number | null;
  files: string[];
  logs: string[];
  /** File writes and similar steps shown in the builder chat sidebar */
  buildActivity: BuildActivityItem[];
  /** Most recent write revision id — lets the chat fetch its diff + offer revert. */
  lastRevisionId: string | null;
  /** Per-file diff stats for the latest revision (true +added/−removed). */
  lastDiff: SandboxFileDiff[];
  error: string | null;
  templates: SandboxTemplateInfo[];

  /** External (user-opened) local folder state */
  external: boolean;
  framework: string | null;
  rootDir: string | null;
  availableScripts: string[];
  commandRun: CommandRunInfo | null;
  /** Which lane the app is serving (dev = hot reload; preview/production = built output). */
  envLane: EnvLane;
  laneState: LaneStateInfo | null;

  /** Deploy pipeline state */
  deployPhase: DeployPhase;
  deploySteps: DeployStepState[];
  deployStartTime: number;
  deployStackName: string;
  deployTierName: string;

  createProject: (name: string) => Promise<string>;
  writeFiles: (files: SandboxFile[]) => Promise<void>;
  replaceText: (action: {
    query: string;
    replacement: string;
    paths: string[];
    expectedReplacements: number;
  }) => Promise<{ filesChanged: number; replacements: number; revisionId: string | null }>;
  installDeps: () => Promise<boolean>;
  startDev: () => Promise<number | null>;
  stopDev: () => Promise<void>;
  fetchLogs: () => Promise<void>;
  fetchFiles: () => Promise<void>;
  fetchTemplates: () => Promise<void>;
  destroyProject: () => Promise<void>;
  cancelDeploy: () => void;
  reset: () => void;
  attachProject: (sandboxProjectId: string) => Promise<void>;
  /** Open an existing local folder (e.g. C:\Users\you\Documents\my-app): scan → install if needed → dev server → preview. */
  openLocalFolder: (path: string) => Promise<{ id: string; framework: string; port: number | null }>;
  /** Run a package.json script (build / lint / test …) and poll until it finishes. */
  runScript: (script: string) => Promise<boolean>;
  /** Blue-green lane switch: dev | preview | production. Old server keeps serving until the new lane is ready. */
  switchLane: (lane: EnvLane) => Promise<boolean>;
  pollDesktopHandoff: (signal?: AbortSignal) => Promise<boolean>;
  markPreviewLoading: (port: number | null) => void;
  markPreviewReady: (port: number | null) => void;
  clearBuildActivity: () => void;
  /** Fetch true per-file +added/−removed for a revision (defaults to the last write). */
  fetchRevisionDiff: (revisionId?: string) => Promise<SandboxFileDiff[]>;
  /** Revert a revision to its pre-write content (the FileChangesBar "Discard"). */
  revertRevision: (revisionId?: string) => Promise<boolean>;

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
        useSandboxStore.setState({ logs: [...state.logs, line].slice(-MAX_CLIENT_LOG_ENTRIES) });
      }
      return;
    }
    if (event.data?.type === 'vai-sandbox-action' && event.data.action === 'prefill-chat') {
      const prompt = typeof event.data.prompt === 'string' ? event.data.prompt.trim() : '';
      if (!prompt) return;
      window.dispatchEvent(new CustomEvent('vai:prefill-chat', { detail: { prompt } }));
    }
  });
}

// Module-level AbortController for deploy cancellation
let deployAbortController: AbortController | null = null;

/** Monotonic token so only the most recent attachProject call wins. */
let attachProjectToken = 0;

export const useSandboxStore = create<SandboxState>((set, get) => ({
  projectId: null,
  persistentProjectId: null,
  projectName: null,
  projectVersion: null,
  status: 'idle',

  deployPhase: 'idle' as DeployPhase,
  deploySteps: [] as DeployStepState[],
  deployStartTime: 0,
  deployStackName: '',
  deployTierName: '',
  devPort: null,
  previewReady: false,
  previewLoadCount: 0,
  lastPreviewPort: null,
  files: [],
  logs: [],
  buildActivity: [],
  lastRevisionId: null,
  lastDiff: [],
  error: null,
  templates: [],
  external: false,
  framework: null,
  rootDir: null,
  availableScripts: [],
  commandRun: null,
  envLane: 'dev' as EnvLane,
  laneState: null,

  clearBuildActivity: () => set({ buildActivity: [], lastRevisionId: null, lastDiff: [] }),

  createProject: async (name: string) => {
    set({ status: 'creating', error: null, buildActivity: [] });
    try {
      const res = await apiFetch('/api/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json() as { id: string; name: string; version?: number };
      set({ projectId: data.id, persistentProjectId: null, projectName: data.name, projectVersion: data.version ?? 0 });
      return data.id;
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message });
      throw err;
    }
  },

  writeFiles: async (files: SandboxFile[]) => {
    const { projectId, projectVersion } = get();
    if (!projectId) throw new Error('No project');
    set({ status: 'writing' });
    try {
      const res = await apiFetch(`/api/sandbox/${projectId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, baseVersion: projectVersion ?? undefined }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Unable to write files');
      }
      const data = await res.json() as { version?: number; revisionId?: string | null };
      await get().fetchFiles();
      const now = Date.now();
      set((state) => ({
        projectVersion: data.version ?? state.projectVersion,
        lastRevisionId: data.revisionId ?? state.lastRevisionId,
        buildActivity: [
          ...state.buildActivity,
          ...files.map((f, i) => ({
            id: `${now}-${i}-${Math.random().toString(36).slice(2, 9)}`,
            kind: 'wrote' as const,
            detail: f.path,
            at: now,
          })),
        ].slice(-MAX_BUILD_ACTIVITY),
      }));
      // Fetch true diff stats for this write so the FileChangesBar shows real +/−.
      if (data.revisionId) {
        void get().fetchRevisionDiff(data.revisionId);
      }
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message });
      throw err;
    }
  },

  replaceText: async (action) => {
    const { projectId, devPort } = get();
    if (!projectId) throw new Error('No project');
    set({ status: 'writing', error: null });
    try {
      const res = await apiFetch(`/api/sandbox/${projectId}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: action.query,
          replacement: action.replacement,
          paths: action.paths,
          caseSensitive: true,
          regex: false,
          expectedReplacements: action.expectedReplacements,
        }),
      });
      const data = await res.json().catch(() => null) as {
        error?: string;
        filesChanged?: number;
        replacements?: number;
        version?: number;
        revisionId?: string | null;
      } | null;
      if (!res.ok) throw new Error(data?.error ?? 'Unable to apply exact text edit');
      if (data?.replacements !== action.expectedReplacements || data.filesChanged !== 1) {
        throw new Error(`Exact edit was not applied safely (expected 1 match, changed ${data?.replacements ?? 0}).`);
      }

      await get().fetchFiles();
      const now = Date.now();
      set((state) => ({
        status: devPort ? 'running' : 'idle',
        projectVersion: data.version ?? state.projectVersion,
        lastRevisionId: data.revisionId ?? state.lastRevisionId,
        buildActivity: [
          ...state.buildActivity,
          {
            id: `${now}-replace-${Math.random().toString(36).slice(2, 9)}`,
            kind: 'wrote' as const,
            detail: action.paths[0],
            at: now,
          },
        ].slice(-MAX_BUILD_ACTIVITY),
      }));
      if (data.revisionId) void get().fetchRevisionDiff(data.revisionId);
      return {
        filesChanged: data.filesChanged,
        replacements: data.replacements,
        revisionId: data.revisionId ?? null,
      };
    } catch (error) {
      set({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  fetchRevisionDiff: async (revisionId?: string) => {
    const { projectId, lastRevisionId } = get();
    const id = revisionId ?? lastRevisionId;
    if (!projectId || !id) return [];
    try {
      const res = await apiFetch(`/api/sandbox/${projectId}/revisions/${id}/diff`);
      if (!res.ok) return [];
      const data = await res.json() as { files?: SandboxFileDiff[] };
      const diff = data.files ?? [];
      set({ lastDiff: diff });
      return diff;
    } catch {
      return [];
    }
  },

  revertRevision: async (revisionId?: string) => {
    const { projectId, lastRevisionId } = get();
    const id = revisionId ?? lastRevisionId;
    if (!projectId || !id) return false;
    try {
      const res = await apiFetch(`/api/sandbox/${projectId}/revisions/${id}/revert`, { method: 'POST' });
      if (!res.ok) return false;
      const data = await res.json() as { version?: number };
      await get().fetchFiles();
      set((state) => ({
        projectVersion: data.version ?? state.projectVersion,
        // The reverted write is undone — clear its activity + diff from the bar.
        buildActivity: [],
        lastRevisionId: null,
        lastDiff: [],
      }));
      return true;
    } catch {
      return false;
    }
  },

  installDeps: async () => {
    const { projectId } = get();
    if (!projectId) return false;
    set({ status: 'installing' });
    try {
      const res = await apiFetch(`/api/sandbox/${projectId}/install`, { method: 'POST' });
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
      const res = await apiFetch(`/api/sandbox/${projectId}/start`, { method: 'POST' });
      const data = await res.json() as { port: number };
      set({ devPort: data.port, status: 'running', previewReady: false, lastPreviewPort: data.port });

      let resolvedPort = data.port;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        try {
          const projectRes = await apiFetch(`/api/sandbox/${projectId}`);
          const projectData = await projectRes.json() as {
            id: string;
            name: string;
            status: SandboxStatus;
            devPort: number | null;
            version?: number;
            files: string[];
            logs: string[];
            devStderr?: string[];
            persistentProjectId: string | null;
          };

          resolvedPort = projectData.devPort ?? resolvedPort;
          const previewError = projectData.status === 'failed'
            ? derivePreviewFailureMessage(projectData.logs, projectData.devStderr)
            : null;
          set({
            projectId: projectData.id,
            persistentProjectId: projectData.persistentProjectId,
            projectName: projectData.name,
            projectVersion: projectData.version ?? get().projectVersion,
            status: projectData.status,
            devPort: projectData.devPort,
            previewReady: projectData.status === 'running' && get().previewReady && get().lastPreviewPort === projectData.devPort,
            lastPreviewPort: projectData.devPort,
            files: projectData.files,
            logs: projectData.logs,
            error: previewError,
          });

          if (projectData.status === 'running' && (projectData.devPort !== data.port || attempt >= 2)) {
            return resolvedPort;
          }
        } catch {
          // Keep the initial port if the follow-up status sync fails.
        }
      }

      return resolvedPort;
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message });
      return null;
    }
  },

  stopDev: async () => {
    const { projectId } = get();
    if (!projectId) return;
    await apiFetch(`/api/sandbox/${projectId}/stop`, { method: 'POST' });
    set({ devPort: null, status: 'idle', previewReady: false, lastPreviewPort: null });
  },

  fetchLogs: async () => {
    const { projectId } = get();
    if (!projectId) return;
    try {
      const res = await apiFetch(`/api/sandbox/${projectId}/logs`);
      const data = await res.json() as { logs: string[] };
      set({ logs: data.logs.slice(-MAX_CLIENT_LOG_ENTRIES) });
    } catch { /* ok */ }
  },

  fetchFiles: async () => {
    const { projectId } = get();
    if (!projectId) return;
    try {
      const res = await apiFetch(`/api/sandbox/${projectId}/files`);
      const data = await res.json() as { files: string[] };
      set({ files: data.files });
    } catch { /* ok */ }
  },

  fetchTemplates: async () => {
    try {
      const res = await apiFetch('/api/sandbox/templates');
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
      await apiFetch(`/api/sandbox/${projectId}`, { method: 'DELETE' }).catch(() => {});
    }
    set({
      projectId: null, persistentProjectId: null, projectName: null, projectVersion: null, status: 'idle', devPort: null,
      previewReady: false, lastPreviewPort: null, files: [], logs: [], buildActivity: [], error: null,
      deployPhase: 'idle', deploySteps: [], deployStartTime: 0,
      deployStackName: '', deployTierName: '',
    });
    useLayoutStore.getState().setBuildStatus({ step: 'idle' });
  },

  cancelDeploy: () => {
    if (deployAbortController) {
      deployAbortController.abort();
      deployAbortController = null;
    }
    set({
      deployPhase: 'idle', deploySteps: [], deployStartTime: 0,
      deployStackName: '', deployTierName: '',
      status: 'idle', error: null, projectId: null, persistentProjectId: null, projectName: null, projectVersion: null,
      devPort: null, previewReady: false, lastPreviewPort: null, files: [], logs: [], buildActivity: [],
    });
    useLayoutStore.getState().setBuildStatus({ step: 'idle' });
  },

  reset: () => {
    if (deployAbortController) {
      deployAbortController.abort();
      deployAbortController = null;
    }
    set({
      projectId: null, persistentProjectId: null, projectName: null, projectVersion: null, status: 'idle', devPort: null,
      previewReady: false, lastPreviewPort: null, files: [], logs: [], buildActivity: [], error: null,
      deployPhase: 'idle', deploySteps: [], deployStartTime: 0,
      deployStackName: '', deployTierName: '',
      external: false, framework: null, rootDir: null, availableScripts: [], commandRun: null,
      envLane: 'dev', laneState: null,
    });
    useLayoutStore.getState().setBuildStatus({ step: 'idle' });
  },

  openLocalFolder: async (path: string) => {
    set({
      status: 'creating', error: null, buildActivity: [], logs: [],
      external: false, framework: null, rootDir: null, availableScripts: [], commandRun: null,
    });
    const res = await apiFetch('/api/sandbox/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const data = await res.json().catch(() => null) as OpenLocalFolderResponse | null;
    if (!res.ok || !data?.id) {
      const message = data?.error ?? 'Unable to open folder';
      set({ status: 'failed', error: message });
      throw new Error(message);
    }

    const reusablePort = reusableLocalProjectPort(data);
    set({
      projectId: data.id,
      persistentProjectId: null,
      projectName: data.name ?? null,
      projectVersion: data.version ?? 0,
      status: reusablePort ? 'running' : 'idle',
      devPort: reusablePort,
      previewReady: false,
      lastPreviewPort: reusablePort,
      external: true,
      framework: data.profile?.framework ?? null,
      rootDir: data.rootDir ?? null,
      availableScripts: Object.keys(data.profile?.scripts ?? {}),
      envLane: data.envLane ?? 'dev',
      laneState: data.laneState ?? null,
    });
    void get().fetchFiles();

    // The runtime already owns a healthy dev/preview/production process for
    // this exact folder. Preserve it and merely remount the App iframe. Starting
    // another Next process here races .next locks and needlessly burns a port.
    if (reusablePort) {
      useLayoutStore.getState().setBuildStatus({ step: 'idle' });
      return { id: data.id, framework: data.profile?.framework ?? 'unknown', port: reusablePort };
    }

    // Install first when node_modules is missing — then bring the dev server up.
    if (data.profile?.hasPackageJson && !data.profile.hasNodeModules) {
      useLayoutStore.getState().setBuildStatus({ step: 'building', message: 'Installing dependencies…' });
      const ok = await get().installDeps();
      if (!ok) throw new Error('Dependency install failed — check the console');
    }
    useLayoutStore.getState().setBuildStatus({ step: 'building', message: 'Starting dev server…' });
    const port = await get().startDev();
    useLayoutStore.getState().setBuildStatus({ step: 'idle' });
    return { id: data.id, framework: data.profile?.framework ?? 'unknown', port };
  },

  runScript: async (script: string) => {
    const { projectId } = get();
    if (!projectId) return false;
    const res = await apiFetch(`/api/sandbox/${projectId}/run-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null;
      set({ error: payload?.error ?? `Unable to run ${script}` });
      return false;
    }
    set({ commandRun: { script, status: 'running', exitCode: null } });

    // Poll logs + command state until the run settles (max ~10.5 min, matches server kill timer).
    for (let attempt = 0; attempt < 630; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (get().projectId !== projectId) return false; // project switched mid-run
      await get().fetchLogs();
      try {
        const statusRes = await apiFetch(`/api/sandbox/${projectId}`);
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json() as { commandRun?: CommandRunInfo | null };
        if (statusData.commandRun) {
          set({ commandRun: statusData.commandRun });
          if (statusData.commandRun.status !== 'running') {
            return statusData.commandRun.status === 'done';
          }
        }
      } catch { /* transient poll failure — keep going */ }
    }
    return false;
  },

  switchLane: async (lane: EnvLane) => {
    const { projectId, envLane } = get();
    if (!projectId || envLane === lane) return envLane === lane;
    const res = await apiFetch(`/api/sandbox/${projectId}/switch-lane`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lane }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null;
      set({ error: payload?.error ?? `Unable to switch to ${lane}` });
      return false;
    }
    set({ laneState: { lane, status: 'switching', stage: 'preparing', error: null } });

    // Poll until the lane settles. Gates + build can take minutes on big apps.
    for (let attempt = 0; attempt < 900; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (get().projectId !== projectId) return false;
      await get().fetchLogs();
      try {
        const statusRes = await apiFetch(`/api/sandbox/${projectId}`);
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json() as {
          envLane?: EnvLane;
          laneState?: LaneStateInfo | null;
          devPort?: number | null;
          status?: SandboxStatus;
        };
        if (statusData.laneState) set({ laneState: statusData.laneState });
        if (statusData.laneState && statusData.laneState.status !== 'switching') {
          const ready = statusData.laneState.status === 'ready';
          set({
            envLane: statusData.envLane ?? (ready ? lane : get().envLane),
            devPort: statusData.devPort ?? get().devPort,
            status: statusData.status ?? get().status,
            previewReady: false, // remount the iframe onto the new lane's port
            lastPreviewPort: statusData.devPort ?? get().lastPreviewPort,
            error: ready ? null : statusData.laneState.error,
          });
          return ready;
        }
      } catch { /* transient poll failure — keep going */ }
    }
    return false;
  },

  attachProject: async (sandboxProjectId: string) => {
    // Last attach wins: when two attaches race (fast conversation switches),
    // a stale response must never overwrite the newer project binding.
    const token = ++attachProjectToken;
    const switchingProject = get().projectId !== null && get().projectId !== sandboxProjectId;
    set((state) => ({
      ...state,
      // Switching to a DIFFERENT project: immediately drop the previous project's
      // view state so the old chat's files/preview/diff never flash during the
      // async fetch below. Re-attaching the same project keeps its files in place.
      ...(switchingProject
        ? { projectId: null, files: [], devPort: null, previewReady: false, lastPreviewPort: null, lastRevisionId: null, lastDiff: [], status: 'idle' as SandboxStatus }
        : {}),
      buildActivity: [],
      error: null,
    }));
    useLayoutStore.getState().setBuildStatus({ step: 'idle' });
    const res = await apiFetch(`/api/sandbox/${sandboxProjectId}`);
    if (token !== attachProjectToken) return;
    if (!res.ok) {
      const message = res.status === 404
        ? 'Sandbox project no longer exists'
        : res.status === 401 || res.status === 403
          ? 'Sandbox project is not accessible from this session'
          : 'Unable to attach sandbox project';
      set({ status: 'failed', error: message });
      throw new Error(message);
    }
    const data = await res.json() as {
      id: string;
      name: string;
      status: SandboxStatus;
      devPort: number | null;
      version?: number;
      hasNodeModules?: boolean;
      files: string[];
      logs: string[];
      persistentProjectId: string | null;
      external?: boolean;
      framework?: string | null;
      scripts?: string[];
      commandRun?: CommandRunInfo | null;
      envLane?: EnvLane;
      laneState?: LaneStateInfo | null;
    };
    if (token !== attachProjectToken) return;

    set({
      projectId: data.id,
      persistentProjectId: data.persistentProjectId,
      projectName: data.name,
      projectVersion: data.version ?? 0,
      status: data.status,
      devPort: data.devPort,
      previewReady: false,
      lastPreviewPort: data.devPort,
      files: data.files,
      logs: data.logs,
      buildActivity: [],
      error: null,
      external: data.external ?? false,
      framework: data.framework ?? null,
      availableScripts: data.scripts ?? [],
      commandRun: data.commandRun ?? null,
      envLane: data.envLane ?? 'dev',
      laneState: data.laneState ?? null,
    });
    // Auto-restart dev server if node_modules exist but server isn't running
    // (happens after runtime restarts — deps are already installed, just need to start)
    if (data.hasNodeModules && !data.devPort && data.status !== 'building' && token === attachProjectToken) {
      useLayoutStore.getState().setBuildStatus({ step: 'building', message: 'Restarting dev server...' });
      await get().startDev();
    }
  },

  pollDesktopHandoff: async (signal?: AbortSignal) => {
    const res = await apiFetch('/api/projects/handoff/poll-consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'desktop' }),
      signal,
    });

    if (res.status === 204) {
      return false;
    }

    if (!res.ok) {
      return false;
    }

    const payload = await res.json() as ProjectHandoffConsumeResponse;

    await get().attachProject(payload.sandboxProjectId);
    return true;
  },

  markPreviewLoading: (port) => set({
    previewReady: false,
    lastPreviewPort: port,
  }),

  markPreviewReady: (port) => set((state) => {
    if (!port || state.lastPreviewPort !== port) {
      return state;
    }
    return {
      previewReady: true,
      previewLoadCount: state.previewLoadCount + 1,
    };
  }),

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
      const res = await apiFetch('/api/sandbox/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, name }),
      });
      const data = await res.json() as { id: string; name: string; version?: number; files: string[]; depsInstalled?: boolean };
      set({ projectId: data.id, persistentProjectId: null, projectName: data.name, projectVersion: data.version ?? 0, files: data.files });

      // Skip install if CLI already installed deps (e.g. create-next-app)
      if (!data.depsInstalled) {
        const ok = await get().installDeps();
        if (!ok) return;
      }

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
      deploySteps: getInitialDeploySteps(stackId, tier),
      deployStartTime: Date.now(),
      deployStackName: stackName || stackId.toUpperCase(),
      deployTierName: tierName || tier,
      error: null,
      projectId: null,
      persistentProjectId: null,
      projectName: null,
      projectVersion: null,
      devPort: null,
    });

    try {
      const res = await apiFetch('/api/sandbox/deploy', {
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
              set({ projectId: event.projectId, persistentProjectId: null, projectName: stackName || stackId, projectVersion: null });
            }
            if (event.port) {
              set({ devPort: event.port });
            }

            // Transition status incrementally so the UI doesn't stay stuck
            // if the stream-close signal is delayed by the webview
            if (event.step === 'start' && event.status === 'done' && event.port) {
              set({ status: 'running' });
            }
            if (event.step === 'verify' && event.status === 'done') {
              set({ deployPhase: 'ready', status: 'running' });
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
    