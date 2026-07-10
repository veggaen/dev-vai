/**
 * Unified IDE workspace — local folder + sandbox proposals + diff review.
 * One active workspace per session; bound to the active conversation when attached.
 */

import { create } from 'zustand';
import type { IdeEvent } from '@vai/api-types/ide-ws';
import { makeProposal, withStatus, type FileEditProposal } from '@vai/core/browser';
import {
  applyApprovedProposals,
  createWorkspaceCheckpoint,
  folderName,
  listWorkspace,
  proposeCouncil,
  probeLocalPort,
  readWorkspaceFile,
  runTypecheckGate,
  runWorkspaceCommand,
  spawnDevServer,
  stopDevServerProcess,
  tailDevLog,
  type WorkspaceEntry,
} from '../lib/ide/workspace-client.js';
import {
  detectDevServerPlan,
  parsePortsFromLog,
  probeFirstLivePort,
} from '../lib/ide/local-dev-server.js';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api.js';
import { useLayoutStore } from './layoutStore.js';
import { useSandboxStore } from './sandboxStore.js';
// NOTE: chatStore also imports this module — the cycle is safe because both
// sides only call getState() inside function bodies, never at module eval.
import { useChatStore } from './chatStore.js';
import { mergeUniqueProposals, proposalStorageScope } from '../lib/proposal-staging.js';

export type WorkspaceKind = 'none' | 'local' | 'sandbox';
/** 'detected' = council found a runnable app and is waiting for the user's go-ahead. */
export type DevServerStatus = 'idle' | 'detected' | 'starting' | 'running' | 'failed';

/** Per-project auto-run grants — 'always' skips the ask on every future attach. */
const RUN_PERMISSION_KEY = 'vai-run-permission-by-root';

function normRoot(p: string): string {
  return p.trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

function loadRunPermission(root: string): 'always' | null {
  try {
    const raw = localStorage.getItem(RUN_PERMISSION_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[normRoot(root)] === 'always' ? 'always' : null;
  } catch {
    return null;
  }
}

function saveRunPermission(root: string, grant: 'always' | null): void {
  try {
    const raw = localStorage.getItem(RUN_PERMISSION_KEY);
    const map = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
    if (grant) map[normRoot(root)] = grant;
    else delete map[normRoot(root)];
    localStorage.setItem(RUN_PERMISSION_KEY, JSON.stringify(map));
  } catch { /* non-fatal */ }
}

export interface EditorTab {
  readonly path: string;
  original: string;
  draft: string;
}

const STORAGE_KEY = 'vai-workspace-by-conversation';
const PROPOSALS_STORAGE_PREFIX = 'vai-workspace-pending-proposals:';
const COUNCIL_ROLES = ['coder', 'frontend', 'backend', 'human-sim'] as const;

function proposalStorageKey(scope: string): string {
  return `${PROPOSALS_STORAGE_PREFIX}${encodeURIComponent(scope)}`;
}

function loadStoredProposals(scope: string | null): FileEditProposal[] {
  if (!scope) return [];
  try {
    const raw = localStorage.getItem(proposalStorageKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as FileEditProposal[] : [];
  } catch {
    return [];
  }
}

function saveStoredProposals(scope: string | null, proposals: readonly FileEditProposal[]): void {
  if (!scope) return;
  try {
    const key = proposalStorageKey(scope);
    if (proposals.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(proposals));
  } catch {
    // non-fatal; diff review still works in the current window
  }
}

function currentProposalScope(state: Pick<WorkspaceState, 'conversationId' | 'localRoot'>): string | null {
  return proposalStorageScope({
    conversationId: state.conversationId,
    localRoot: state.localRoot,
    sandboxProjectId: useSandboxStore.getState().projectId,
  });
}

function saveCurrentProposals(
  state: Pick<WorkspaceState, 'conversationId' | 'localRoot'>,
  proposals: readonly FileEditProposal[],
): void {
  saveStoredProposals(currentProposalScope(state), proposals);
}

function loadBinding(conversationId: string | null): string | null {
  if (!conversationId) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return typeof map[conversationId] === 'string' ? map[conversationId] : null;
  } catch {
    return null;
  }
}

function saveBinding(conversationId: string | null, root: string | null): void {
  if (!conversationId) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const map = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
    if (root) map[conversationId] = root;
    else delete map[conversationId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch { /* non-fatal */ }
}

/**
 * Other conversations bound to the same workspace folder — the "colleagues on
 * this build site". Path comparison is separator/case-insensitive to match the
 * server-side coordinator's normalization.
 */
export function siblingWorkspaceConversationIds(
  root: string | null,
  excludeConversationId: string | null,
): string[] {
  if (!root) return [];
  const norm = (p: string) => p.trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  const target = norm(root);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, string>;
    return Object.entries(map)
      .filter(([id, path]) => id !== excludeConversationId && typeof path === 'string' && norm(path) === target)
      .map(([id]) => id);
  } catch {
    return [];
  }
}

function enterIdeLayout(): void {
  const layout = useLayoutStore.getState();
  // NEVER change the user's chosen layout mode here — attaching a project must
  // not feel like the app redecorated itself (live complaint: opening a folder
  // silently flipped the shell to the odyssey/open layout).
  layout.expandBuilder();
  if (!layout.showFileExplorer) layout.toggleFileExplorer();
}

function emitIdeEvent(event: IdeEvent): void {
  window.dispatchEvent(new CustomEvent('vai:ide-event', { detail: event }));
}

function activeTabFrom(state: { tabs: EditorTab[]; activeTabPath: string | null }): EditorTab | null {
  if (!state.activeTabPath) return null;
  return state.tabs.find((t) => t.path === state.activeTabPath) ?? null;
}

interface WorkspaceState {
  kind: WorkspaceKind;
  localRoot: string | null;
  localName: string | null;
  conversationId: string | null;
  tree: WorkspaceEntry[];
  proposals: FileEditProposal[];
  tabs: EditorTab[];
  activeTabPath: string | null;
  /** @deprecated synced from active tab — use tabs */
  openRel: string | null;
  editorOriginal: string;
  editorDraft: string;
  showDiffPanel: boolean;
  requireDiffApproval: boolean;
  lastCheckpointId: string | null;
  terminalLines: string[];
  terminalBusy: boolean;
  councilBusy: boolean;
  judgeNote: string | null;
  devServerStatus: DevServerStatus;
  devServerUrl: string | null;
  devServerPort: number | null;
  devServerLabel: string | null;
  devServerLogPath: string | null;
  devServerError: string | null;
  /** Detected-but-not-yet-approved run plan (dev script + framework label). */
  detectedRunCommand: string | null;
  busy: boolean;
  error: string | null;

  bindConversation: (conversationId: string | null) => Promise<void>;
  attachLocal: (path: string, conversationId?: string | null) => Promise<void>;
  detach: () => void;
  refreshTree: () => Promise<void>;
  openFile: (rel: string) => Promise<void>;
  closeTab: (rel: string) => void;
  setActiveTab: (rel: string) => void;
  setEditorDraft: (draft: string) => void;
  proposeManualEdit: () => void;
  runCouncilEdit: (task: string, relOverride?: string) => Promise<void>;
  addExtractedProposals: (files: readonly { path: string; content: string }[]) => Promise<void>;
  setProposalStatus: (id: string, status: 'approved' | 'rejected') => void;
  approveAllPending: () => void;
  applyApproved: () => Promise<void>;
  toggleDiffPanel: () => void;
  setShowDiffPanel: (show: boolean) => void;
  pendingCount: () => number;
  runTerminalCommand: (command: string) => Promise<void>;
  appendTerminalLine: (line: string) => void;
  clearTerminal: () => void;
  handleIdeEvent: (event: IdeEvent) => void;
  /** Detect a runnable app; launch immediately only with an 'always' grant, else ask. */
  detectDevServer: () => Promise<void>;
  /** User's answer to the council's run ask. 'always' persists for this project. */
  approveDevServer: (grant: 'once' | 'always') => Promise<void>;
  declineDevServer: () => void;
  autoLaunchDevServer: () => Promise<void>;
  stopDevServer: () => Promise<void>;
  refreshDevProbe: () => Promise<void>;
}

/**
 * Ports that can NEVER be the attached project's app while this Vai instance is
 * alive: the runtime's own port, and (in browser dev) the port serving Vai's own
 * UI. Probing them made the App window proudly display Vai inside Vai ("dev-dev")
 * when the project's real server wasn't up. If those ports are listening, they're
 * ours — a project Vite would have auto-bumped past the conflict anyway.
 */
function vaiOwnPorts(): Set<number> {
  const own = new Set([3006]);
  const uiPort = typeof window !== 'undefined' ? Number(window.location.port) : NaN;
  if (Number.isFinite(uiPort) && uiPort > 0) own.add(uiPort);
  return own;
}

function excludeVaiPorts(ports: readonly number[]): number[] {
  const own = vaiOwnPorts();
  return ports.filter((p) => !own.has(p));
}

/** Lockfile evidence for the package manager (bun projects rarely set packageManager). */
function lockfilePmHint(tree: readonly WorkspaceEntry[]): 'pnpm' | 'npm' | 'bun' | undefined {
  // Root-level entries only — a vendored sub-package's lockfile must not win.
  const names = new Set(
    tree.filter((e) => !e.dir && !/[\\/]/.test(e.path)).map((e) => e.path.toLowerCase()),
  );
  if (names.has('bun.lock') || names.has('bun.lockb')) return 'bun';
  if (names.has('pnpm-lock.yaml')) return 'pnpm';
  if (names.has('package-lock.json')) return 'npm';
  return undefined;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  kind: 'none',
  localRoot: null,
  localName: null,
  conversationId: null,
  tree: [],
  proposals: [],
  tabs: [],
  activeTabPath: null,
  openRel: null,
  editorOriginal: '',
  editorDraft: '',
  showDiffPanel: false,
  requireDiffApproval: true,
  lastCheckpointId: null,
  terminalLines: [],
  terminalBusy: false,
  councilBusy: false,
  judgeNote: null,
  devServerStatus: 'idle',
  devServerUrl: null,
  devServerPort: null,
  devServerLabel: null,
  devServerLogPath: null,
  devServerError: null,
  detectedRunCommand: null,
  busy: false,
  error: null,

  bindConversation: async (conversationId) => {
    const prev = get().conversationId;
    if (prev === conversationId) return;
    set({ conversationId, proposals: [], showDiffPanel: false });
    const saved = loadBinding(conversationId)
      // Chats ARE projects: the binding follows the conversation server-side, so a
      // chat attached on one machine reopens its workspace on any other client.
      ?? useChatStore.getState().conversations.find((c) => c.id === conversationId)?.workspaceRoot
      ?? null;
    if (saved) {
      await get().attachLocal(saved, conversationId);
    } else if (get().localRoot) {
      set({
        kind: 'none', localRoot: null, localName: null, tree: [], tabs: [],
        activeTabPath: null, openRel: null, proposals: [],
      });
    } else {
      const scope = proposalStorageScope({
        conversationId,
        sandboxProjectId: useSandboxStore.getState().projectId,
      });
      const proposals = loadStoredProposals(scope);
      set({ proposals, showDiffPanel: proposals.length > 0 });
    }
  },

  attachLocal: async (path, conversationId) => {
    const root = path.trim();
    if (!root) return;
    const convId = conversationId ?? get().conversationId;
    set({ busy: true, error: null });
    try {
      const entries = await listWorkspace(root);
      const name = folderName(root);
      const workspace = {
        id: `ws-${Date.now()}`,
        path: root,
        name,
        attachedAt: new Date().toISOString(),
      };
      const scope = proposalStorageScope({
        conversationId: convId,
        localRoot: root,
        sandboxProjectId: useSandboxStore.getState().projectId,
      });
      const proposals = loadStoredProposals(scope);
      set({
        kind: 'local',
        localRoot: root,
        localName: name,
        conversationId: convId,
        tree: entries,
        tabs: [],
        activeTabPath: null,
        openRel: null,
        proposals,
        editorOriginal: '',
        editorDraft: '',
        showDiffPanel: proposals.length > 0,
        terminalLines: [`📁 Attached workspace: ${name}`],
      });
      saveBinding(convId, root);
      // Persist on the conversation itself (best-effort) — the workspace follows
      // the chat to every client, not just this machine's localStorage.
      if (convId) {
        void apiFetch(`/api/conversations/${convId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceRoot: root }),
        }).catch(() => { /* offline runtime must not break attach */ });
      }
      enterIdeLayout();
      useLayoutStore.getState().setActivePanel('chats');
      useLayoutStore.getState().setSidebarState('expanded');
      emitIdeEvent({ type: 'ide.workspace.attached', workspace });
      window.dispatchEvent(new CustomEvent('vai:workspace-attached', { detail: { path: root, name } }));
      void get().detectDevServer();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: false });
    }
  },

  detach: () => {
    void get().stopDevServer();
    const convId = get().conversationId;
    saveBinding(convId, null);
    saveCurrentProposals(get(), []);
    if (convId) {
      void apiFetch(`/api/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceRoot: null }),
      }).catch(() => { /* best-effort */ });
    }
    set({
      kind: 'none',
      localRoot: null,
      localName: null,
      tree: [],
      tabs: [],
      activeTabPath: null,
      proposals: [],
      openRel: null,
      editorOriginal: '',
      editorDraft: '',
      showDiffPanel: false,
      terminalLines: [],
      judgeNote: null,
      devServerStatus: 'idle',
      devServerUrl: null,
      devServerPort: null,
      devServerLabel: null,
      devServerLogPath: null,
      devServerError: null,
      detectedRunCommand: null,
      error: null,
    });
    emitIdeEvent({ type: 'ide.workspace.detached' });
    window.dispatchEvent(new CustomEvent('vai:workspace-detached'));
  },

  refreshTree: async () => {
    const root = get().localRoot;
    if (!root) return;
    try {
      set({ tree: await listWorkspace(root) });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  openFile: async (rel) => {
    const root = get().localRoot;
    if (!root) return;
    const existing = get().tabs.find((t) => t.path === rel);
    if (existing) {
      set({
        activeTabPath: rel,
        openRel: rel,
        editorOriginal: existing.original,
        editorDraft: existing.draft,
      });
      return;
    }
    set({ busy: true, error: null });
    try {
      const content = await readWorkspaceFile(root, rel);
      const tab: EditorTab = { path: rel, original: content, draft: content };
      set({
        tabs: [...get().tabs, tab],
        activeTabPath: rel,
        openRel: rel,
        editorOriginal: content,
        editorDraft: content,
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: false });
    }
  },

  closeTab: (rel) => {
    const tabs = get().tabs.filter((t) => t.path !== rel);
    const wasActive = get().activeTabPath === rel;
    const next = wasActive ? (tabs[tabs.length - 1]?.path ?? null) : get().activeTabPath;
    const active = tabs.find((t) => t.path === next) ?? null;
    set({
      tabs,
      activeTabPath: next,
      openRel: next,
      editorOriginal: active?.original ?? '',
      editorDraft: active?.draft ?? '',
    });
  },

  setActiveTab: (rel) => {
    const tab = get().tabs.find((t) => t.path === rel);
    if (!tab) return;
    set({
      activeTabPath: rel,
      openRel: rel,
      editorOriginal: tab.original,
      editorDraft: tab.draft,
    });
  },

  setEditorDraft: (draft) => {
    const path = get().activeTabPath;
    if (!path) return;
    set({
      editorDraft: draft,
      tabs: get().tabs.map((t) => (t.path === path ? { ...t, draft } : t)),
    });
  },

  proposeManualEdit: () => {
    const tab = activeTabFrom(get());
    if (!tab) return;
    const p = makeProposal(tab.path, tab.original, tab.draft, {
      summary: 'Manual edit',
      author: { memberId: 'you' },
    });
    if (!p) {
      set({ error: 'No changes to propose.' });
      return;
    }
    const proposals = [...get().proposals, p];
    saveCurrentProposals(get(), proposals);
    set({ proposals, showDiffPanel: true, error: null });
    emitIdeEvent({ type: 'ide.proposal.created', proposals: [p] });
  },

  runCouncilEdit: async (task, relOverride) => {
    const root = get().localRoot;
    if (!root || !task.trim()) return;
    // Explicit file target (chat-driven edits) wins over the open tab; the tab
    // remains the default for the classic editor-panel flow.
    const tab = activeTabFrom(get());
    let rel = relOverride ?? tab?.path ?? null;
    let original = relOverride ? null : tab?.original ?? null;
    if (!rel) return;
    if (original === null) {
      try {
        original = await readWorkspaceFile(root, rel);
      } catch (e) {
        set({ error: `Cannot read ${rel}: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
    }
    set({ councilBusy: true, error: null, judgeNote: null });
    get().appendTerminalLine(`🛠 Council editing ${rel} — “${task.trim().slice(0, 80)}”`);
    try {
      const result = await proposeCouncil(root, rel, original, task.trim(), [...COUNCIL_ROLES]);
      if (result.proposals.length === 0) {
        set({ error: 'Council produced no edits.' });
        return;
      }
      const proposals = [...get().proposals, ...result.proposals];
      saveCurrentProposals(get(), proposals);
      set({
        proposals,
        showDiffPanel: true,
        judgeNote: result.judgeRole
          ? `Judge picked ${result.judgeRole}: ${result.rationale}`
          : result.rationale,
      });
      emitIdeEvent({ type: 'ide.proposal.created', proposals: result.proposals });
      useLayoutStore.getState().setActivePanel('chats');
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ councilBusy: false });
    }
  },

  addExtractedProposals: async (files) => {
    const created: FileEditProposal[] = [];
    for (const f of files) {
      let before: string | null = null;
      try {
        const localRoot = get().localRoot;
        const projectId = useSandboxStore.getState().projectId;
        if (localRoot) {
          before = await readWorkspaceFile(localRoot, f.path);
        } else if (projectId) {
          const response = await apiFetch(`/api/sandbox/${projectId}/file?path=${encodeURIComponent(f.path)}`);
          if (response.ok) {
            const payload = await response.json() as { content?: string };
            before = typeof payload.content === 'string' ? payload.content : null;
          } else if (response.status !== 404) {
            throw new Error(`Unable to read ${f.path} before staging (HTTP ${response.status})`);
          }
        }
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        return;
      }

      const p = makeProposal(f.path, before, f.content, {
        summary: 'AI-generated change',
        author: { memberId: 'vai', role: 'builder' },
      });
      if (p) created.push(p);
    }
    if (created.length > 0) {
      const next = mergeUniqueProposals(get().proposals, created);
      saveCurrentProposals(get(), next);
      set({ proposals: next, showDiffPanel: true, kind: get().kind === 'local' ? 'local' : 'sandbox' });
      emitIdeEvent({ type: 'ide.proposal.created', proposals: created });
      enterIdeLayout();
      useLayoutStore.getState().setActivePanel('chats');
      useLayoutStore.getState().setSidebarState('expanded');
    }
  },

  setProposalStatus: (id, status) => {
    const proposals = get().proposals.map((p) => (p.id === id ? withStatus(p, status) : p));
    saveCurrentProposals(get(), proposals);
    set({
      proposals,
    });
    emitIdeEvent({ type: 'ide.proposal.updated', id, status });
  },

  approveAllPending: () => {
    const proposals = get().proposals.map((p) =>
      p.status === 'pending' ? withStatus(p, 'approved') : p);
    saveCurrentProposals(get(), proposals);
    set({
      proposals,
    });
  },

  applyApproved: async () => {
    const { localRoot, proposals } = get();
    const approved = proposals.filter((p) => p.status === 'approved');
    if (approved.length === 0) return;

    emitIdeEvent({ type: 'ide.apply.started', proposalIds: approved.map((p) => p.id) });

    if (localRoot) {
      set({ busy: true, error: null });
      try {
        const gate = await runTypecheckGate(localRoot);
        emitIdeEvent({
          type: 'ide.gate.result',
          gate: 'tsc',
          pass: gate.pass,
          detail: gate.detail.slice(0, 500),
        });
        if (!gate.pass) {
          set({ error: 'Typecheck failed — fix errors or reject proposals before applying.' });
          get().appendTerminalLine(`✗ Typecheck gate failed:\n${gate.detail.slice(0, 2000)}`);
          return;
        }

        const checkpointId = await createWorkspaceCheckpoint(localRoot);
        set({ lastCheckpointId: checkpointId });
        emitIdeEvent({ type: 'ide.checkpoint.created', id: checkpointId, label: 'Pre-apply snapshot' });

        await applyApprovedProposals(localRoot, approved);
        const appliedIds = new Set(approved.map((p) => p.id));
        const openRel = get().activeTabPath;
        const remainingProposals = get().proposals.filter((p) => !appliedIds.has(p.id));
        saveCurrentProposals(get(), remainingProposals);
        set({
          proposals: remainingProposals,
          showDiffPanel: remainingProposals.some((p) => p.status === 'pending'),
        });
        await get().refreshTree();

        const updatedTabs = get().tabs.map((t) => {
          const applied = approved.find((p) => p.path === t.path && p.after !== null);
          if (!applied?.after) return t;
          return { ...t, original: applied.after, draft: applied.after };
        });
        set({ tabs: updatedTabs });
        const last = approved.find((p) => p.path === openRel && p.after !== null);
        if (last?.after != null) {
          set({ editorOriginal: last.after, editorDraft: last.after });
        }

        emitIdeEvent({ type: 'ide.apply.done', applied: approved.map((p) => p.id), failed: [] });
        get().appendTerminalLine(`✓ Applied ${approved.length} change${approved.length === 1 ? '' : 's'} (checkpoint ${checkpointId})`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ error: msg });
        emitIdeEvent({
          type: 'ide.apply.done',
          applied: [],
          failed: approved.map((p) => ({ id: p.id, error: msg })),
        });
      } finally {
        set({ busy: false });
        emitIdeEvent({ type: 'ide.turn.quiescent' });
      }
      return;
    }

    const toWrite = approved
      .filter((p) => p.after !== null)
      .map((p) => ({ path: p.path, content: p.after as string }));
    if (toWrite.length > 0) {
      set({ busy: true, error: null });
      try {
        const sandbox = useSandboxStore.getState();
        await sandbox.writeFiles(toWrite);
        if (toWrite.some((file) => file.path.replace(/\\/g, '/').toLowerCase() === 'package.json')) {
          if (useSandboxStore.getState().devPort) await useSandboxStore.getState().stopDev();
          const installed = await useSandboxStore.getState().installDeps();
          if (!installed) throw new Error(useSandboxStore.getState().error ?? 'Dependency installation failed');
          const port = await useSandboxStore.getState().startDev();
          if (!port) throw new Error(useSandboxStore.getState().error ?? 'Dev server did not restart');
        }
        const appliedIds = new Set(approved.map((p) => p.id));
        const remainingProposals = get().proposals.filter((p) => !appliedIds.has(p.id));
        saveCurrentProposals(get(), remainingProposals);
        set({
          proposals: remainingProposals,
          showDiffPanel: false,
        });
        emitIdeEvent({ type: 'ide.apply.done', applied: approved.map((p) => p.id), failed: [] });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ error: msg });
        emitIdeEvent({
          type: 'ide.apply.done',
          applied: [],
          failed: approved.map((p) => ({ id: p.id, error: msg })),
        });
      } finally {
        set({ busy: false });
        emitIdeEvent({ type: 'ide.turn.quiescent' });
      }
    }
  },

  toggleDiffPanel: () => set({ showDiffPanel: !get().showDiffPanel }),
  setShowDiffPanel: (show) => set({ showDiffPanel: show }),
  pendingCount: () => get().proposals.filter((p) => p.status === 'pending').length,

  runTerminalCommand: async (command) => {
    const root = get().localRoot;
    if (!root) return;
    set({ terminalBusy: true });
    get().appendTerminalLine(`$ ${command}`);
    try {
      const out = await runWorkspaceCommand(root, command);
      if (out.trim()) get().appendTerminalLine(out.trimEnd());
      else get().appendTerminalLine('(no output)');
    } catch (e) {
      get().appendTerminalLine(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      set({ terminalBusy: false });
    }
  },

  appendTerminalLine: (line) => {
    set({ terminalLines: [...get().terminalLines, line] });
  },

  clearTerminal: () => set({ terminalLines: [] }),

  detectDevServer: async () => {
    const root = get().localRoot;
    if (!root) return;
    if (get().devServerStatus === 'starting' || get().devServerStatus === 'running') return;

    let plan = null;
    try {
      const pkg = await readWorkspaceFile(root, 'package.json');
      plan = detectDevServerPlan(pkg, lockfilePmHint(get().tree));
    } catch {
      plan = null;
    }
    if (!plan) return; // Nothing runnable — stay quiet, the terminal is still there.

    // Standing 'always' grant for this project → no ask, straight to launch.
    if (loadRunPermission(root) === 'always') {
      get().appendTerminalLine(`⚡ Auto-run approved for this project — starting ${plan.label}.`);
      await get().autoLaunchDevServer();
      return;
    }

    set({
      devServerStatus: 'detected',
      devServerLabel: plan.label,
      detectedRunCommand: plan.command,
      devServerError: null,
    });
    get().appendTerminalLine(`🔍 Council: detected a ${plan.label} app (${plan.command}) — waiting for your go-ahead to run it.`);
  },

  approveDevServer: async (grant) => {
    const root = get().localRoot;
    if (!root) return;
    if (grant === 'always') {
      saveRunPermission(root, 'always');
      get().appendTerminalLine('✓ Auto-run enabled for this project — future attaches start the app without asking.');
    }
    await get().autoLaunchDevServer();
  },

  declineDevServer: () => {
    saveRunPermission(get().localRoot ?? '', null);
    set({ devServerStatus: 'idle', detectedRunCommand: null });
    get().appendTerminalLine('– Not running the app now. Use the Play button whenever you’re ready.');
  },

  autoLaunchDevServer: async () => {
    const root = get().localRoot;
    if (!root) return;
    if (get().devServerStatus === 'starting') return;

    set({ devServerStatus: 'starting', devServerError: null, devServerUrl: null, devServerPort: null, detectedRunCommand: null });
    get().appendTerminalLine('🔍 Council: detecting dev server for this project…');

    try {
      let plan = null;
      try {
        const pkg = await readWorkspaceFile(root, 'package.json');
        plan = detectDevServerPlan(pkg, lockfilePmHint(get().tree));
      } catch {
        plan = null;
      }

      if (!plan) {
        set({ devServerStatus: 'failed', devServerError: 'No package.json dev script found.' });
        get().appendTerminalLine('✗ No dev script in package.json — use the terminal to run manually.');
        return;
      }

      set({ devServerLabel: plan.label });
      get().appendTerminalLine(`▶ Starting ${plan.label}: ${plan.command}`);

      const logPath = await spawnDevServer(root, plan.command);
      set({ devServerLogPath: logPath });

      // Log-parsed ports are authoritative (the project's own output) — they go
      // FIRST. Static plan ports are guesses and never include Vai's own ports.
      const ports = excludeVaiPorts(plan.ports);
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        if (get().devServerLogPath) {
          try {
            const log = await tailDevLog(get().devServerLogPath!);
            for (const p of excludeVaiPorts(parsePortsFromLog(log))) {
              if (!ports.includes(p)) ports.unshift(p);
            }
          } catch { /* log not ready */ }
        }
        const live = await probeFirstLivePort(ports, probeLocalPort);
        if (live) {
          const url = `http://127.0.0.1:${live}`;
          set({
            devServerStatus: 'running',
            devServerPort: live,
            devServerUrl: url,
            devServerError: null,
          });
          get().appendTerminalLine(`✓ Preview live at ${url}`);
          toast.success(`${plan.label} running — preview ready`);
          useLayoutStore.getState().expandBuilder();
          return;
        }
      }

      let logHint = '';
      if (logPath) {
        try {
          const log = await tailDevLog(logPath, 4000);
          const tail = log.trim().split('\n').slice(-6).join('\n');
          if (tail) logHint = `\n\nLast log lines:\n${tail}`;
        } catch { /* ignore */ }
      }
      const errMsg = `Started ${plan.command} but no live port found within 90s. Check the terminal.${logHint}`;
      set({
        devServerStatus: 'failed',
        devServerError: errMsg,
      });
      get().appendTerminalLine('✗ Dev server started but preview URL not detected yet — try Refresh or check terminal output.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ devServerStatus: 'failed', devServerErr