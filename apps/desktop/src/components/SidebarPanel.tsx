import { useCallback, useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, Clock, MessageSquare, ChevronLeft,
  BookOpen, Globe, Search as SearchIcon, ExternalLink,
  Bot, GitBranch, CheckCircle2, Laptop2, UserRound, Trophy, FolderKanban, FolderOpenDot, Shield,
  Send, Wifi, WifiOff,
} from 'lucide-react';
import { useChatStore } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useEngineStore } from '../stores/engineStore.js';
import { useLayoutStore, type SidebarPanel as PanelType } from '../stores/layoutStore.js';
import { useVinextStore, type VinextState } from '../stores/vinextStore.js';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { useCollabStore } from '../stores/collabStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { SidebarSearch } from './SidebarSearch.js';
import { SessionList } from './SessionList.js';
import { BuildStatusBadge } from './BuildStatusBadge.js';
import { DockerPanel } from './DockerPanel.js';
import { API_BASE, apiFetch } from '../lib/api.js';
import { MODE_DESCRIPTIONS } from '../stores/layoutStore.js';
import { toast } from 'sonner';

/* ── Helpers ───────────────────────────────────────────────────── */

function formatRelative(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(date).toLocaleDateString();
}

function formatActivity(lastSeenAt: string | null, lastPolledAt: string | null): string {
  if (lastPolledAt) return `polled ${formatRelative(lastPolledAt)}`;
  if (lastSeenAt) return `seen ${formatRelative(lastSeenAt)}`;
  return 'never seen';
}

function auditStatusTone(status: 'pending' | 'claimed' | 'submitted', claimIsStale: boolean): string {
  if (status === 'submitted') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'claimed' && claimIsStale) return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'claimed') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  return 'border-zinc-700 bg-zinc-900 text-zinc-500';
}

function auditStatusLabel(status: 'pending' | 'claimed' | 'submitted', claimIsStale: boolean): string {
  if (status === 'claimed' && claimIsStale) return 'claim stale';
  return status;
}

function _getUserInitials(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name?.trim() || email?.trim() || 'V').replace(/@.*$/, '');
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function openExternalTarget(target: string): Promise<void> {
  if (isTauriApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external', { target });
    return;
  }

  window.location.assign(target);
}

const PANEL_TITLES: Record<PanelType, string> = {
  chats: 'Chat History',
  projects: 'Projects',
  devlogs: 'Dev Logs',
  knowledge: 'Knowledge Base',
  docker: 'Docker Sandboxes',
  search: 'Search',
  settings: 'Settings',
  vaigym: 'Vai Gymnasium',
  thorsen: 'Thorsen Wormhole',
  control: 'Control',
};

interface SandboxProjectSummary {
  id: string;
  name: string;
  status: string;
  devPort: number | null;
  createdAt: string;
  owned: boolean;
}

/* ── Main Panel ────────────────────────────────────────────────── */

export function SidebarPanel() {
  const { activePanel, toggleSidebar } = useLayoutStore();

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 'var(--layout-sidebar-effective-width)', opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="flex h-full min-w-0 flex-shrink-0 flex-col overflow-hidden border-r border-zinc-800/60 bg-zinc-950"
      style={{ width: 'var(--layout-sidebar-effective-width)', maxWidth: '100%' }}
    >
      {/* Panel header */}
      <div className="flex h-10 items-center justify-between border-b border-zinc-800/40 px-3">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          {PANEL_TITLES[activePanel]}
        </span>
        <button
          onClick={toggleSidebar}
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="Collapse sidebar"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        {activePanel === 'chats' && <ChatsPanel />}
        {activePanel === 'projects' && <ProjectsPanel />}
        {activePanel === 'devlogs' && <DevLogsPanel />}
        {activePanel === 'knowledge' && <KnowledgeSidePanel />}
        {activePanel === 'docker' && <DockerPanel />}
        {activePanel === 'search' && <SearchPanel />}
        {activePanel === 'settings' && <SettingsPanel />}
        {activePanel === 'control' && <ControlPanel />}
      </div>
    </motion.div>
  );
}

/* ── Chats Panel ───────────────────────────────────────────────── */

function ChatsPanel() {
  const {
    conversations,
    activeConversationId,
    fetchConversations,
    selectConversation,
    deleteConversation,
    startNewChat,
  } = useChatStore();

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleNewChat = () => {
    startNewChat();
  };

  // Group conversations by time buckets
  const grouped = useMemo(() => {
    const now = Date.now();
    const today: typeof conversations = [];
    const yesterday: typeof conversations = [];
    const thisWeek: typeof conversations = [];
    const older: typeof conversations = [];

    for (const conv of conversations) {
      const age = now - new Date(conv.updatedAt).getTime();
      if (age < 86_400_000) today.push(conv);
      else if (age < 172_800_000) yesterday.push(conv);
      else if (age < 604_800_000) thisWeek.push(conv);
      else older.push(conv);
    }

    return [
      { label: 'Today', items: today },
      { label: 'Yesterday', items: yesterday },
      { label: 'This Week', items: thisWeek },
      { label: 'Older', items: older },
    ].filter((g) => g.items.length > 0);
  }, [conversations]);

  return (
    <div className="flex flex-col">
      {/* New Chat button */}
      <div className="p-2">
        <button
          onClick={handleNewChat}
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </button>
      </div>

      {/* Grouped conversation list */}
      <div className="px-1.5 pb-2">
        {grouped.map((group) => (
          <div key={group.label}>
            <div className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              {group.label}
            </div>
            {group.items.map((conv) => (
              <div
                key={conv.id}
                className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${conv.id === activeConversationId
                  ? 'bg-zinc-800/80 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                  }`}
                onClick={() => selectConversation(conv.id)}
              >
                <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-zinc-600" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm leading-tight">{conv.title}</div>
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
                    <Clock className="h-2.5 w-2.5" />
                    {formatRelative(conv.updatedAt)}
                    {conv.projectName && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <FolderOpenDot className="h-2.5 w-2.5" />
                        <span className="max-w-[8rem] truncate">{conv.projectName}</span>
                      </>
                    )}
                    {conv.mode && conv.mode !== 'chat' && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <span className="rounded-full border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                          {conv.mode}
                        </span>
                      </>
                    )}
                    {conv.modelId && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <span className="truncate">{conv.modelId.split('/').pop()}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-zinc-700 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ))}

        {conversations.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-zinc-600">
            No conversations yet
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Dev Logs Panel ────────────────────────────────────────────── */

function DevLogsPanel() {
  return <SessionList />;
}

function ProjectsPanel() {
  const projectId = useSandboxStore((state) => state.projectId);
  const projectName = useSandboxStore((state) => state.projectName);
  const persistentProjectId = useSandboxStore((state) => state.persistentProjectId);
  const status = useSandboxStore((state) => state.status);
  const devPort = useSandboxStore((state) => state.devPort);
  const attachProject = useSandboxStore((state) => state.attachProject);
  const conversations = useChatStore((state) => state.conversations);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const fetchConversations = useChatStore((state) => state.fetchConversations);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const createConversation = useChatStore((state) => state.createConversation);
  const selectedModelId = useSettingsStore((state) => state.selectedModelId);
  const setActivePanel = useLayoutStore((state) => state.setActivePanel);
  const [projects, setProjects] = useState<SandboxProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  const linkedConversationCounts = useMemo(() => {
    return conversations.reduce<Record<string, number>>((counts, conversation) => {
      if (!conversation.sandboxProjectId) return counts;
      counts[conversation.sandboxProjectId] = (counts[conversation.sandboxProjectId] ?? 0) + 1;
      return counts;
    }, {});
  }, [conversations]);

  const currentProjectConversations = useMemo(() => {
    if (!projectId) return [];

    return conversations
      .filter((conversation) => conversation.sandboxProjectId === projectId)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 4);
  }, [conversations, projectId]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/sandbox');
      if (!response.ok) {
        throw new Error('Unable to load projects');
      }

      const payload = await response.json() as SandboxProjectSummary[];
      setProjects(payload.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  const handleAttach = async (sandboxProjectId: string) => {
    setAttachingId(sandboxProjectId);
    try {
      await attachProject(sandboxProjectId);
      toast.success('Project opened');
      setActivePanel('chats');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to open project');
    } finally {
      setAttachingId(null);
      void loadProjects();
    }
  };

  const handleOpenConversation = (conversationId: string) => {
    void selectConversation(conversationId);
    setActivePanel('chats');
  };

  const handleNewProjectChat = async () => {
    if (!projectId) return;

    try {
      await createConversation(selectedModelId ?? 'vai:v0', 'chat', {
        sandboxProjectId: projectId,
      });
      setActivePanel('chats');
      toast.success('Opened a new chat in this project');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to open a new project chat');
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Current project</div>
            <div className="mt-1 text-sm font-medium text-zinc-100">{projectName ?? 'No project open'}</div>
            <div className="mt-1 text-xs text-zinc-500">
              {projectId
                ? `${status}${devPort ? ` • localhost:${devPort}` : ''}${persistentProjectId ? ' • synced to project' : ''}`
                : 'Chat with Vai to get started, then your project will appear here.'}
            </div>
          </div>
          {projectId && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setActivePanel('chats')}
                className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
              >
                Open chat
              </button>
              <button
                onClick={() => void handleNewProjectChat()}
                className="rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-100 transition-colors hover:border-violet-500/30 hover:bg-violet-500/15"
              >
                New project chat
              </button>
            </div>
          )}
        </div>

        {projectId && (
          <div className="mt-3 border-t border-zinc-800/80 pt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Project chats</div>
              <div className="text-[11px] text-zinc-600">
                {currentProjectConversations.length > 0
                  ? `${linkedConversationCounts[projectId] ?? currentProjectConversations.length} linked`
                  : 'No linked chats yet'}
              </div>
            </div>

            {currentProjectConversations.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {currentProjectConversations.map((conversation) => {
                  const isActiveConversation = conversation.id === activeConversationId;
                  return (
                    <button
                      key={conversation.id}
                      onClick={() => handleOpenConversation(conversation.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${isActiveConversation
                        ? 'border-violet-500/30 bg-violet-500/10'
                        : 'border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-900/80'
                        }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-zinc-100">{conversation.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                          <span>{formatRelative(conversation.updatedAt)}</span>
                          {conversation.mode && conversation.mode !== 'chat' && (
                            <span className="rounded-full border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                              {conversation.mode}
                            </span>
                          )}
                        </div>
                      </div>
                      {isActiveConversation && (
                        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-violet-200">
                          active
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-dashed border-zinc-800/80 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-500">
                New chats will stay linked to this project automatically.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Your projects</div>
        <button
          onClick={() => void loadProjects()}
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {projects.map((project) => {
          const isCurrent = project.id === projectId;
          const linkedConversationCount = linkedConversationCounts[project.id] ?? 0;
          return (
            <button
              key={project.id}
              onClick={() => void handleAttach(project.id)}
              disabled={attachingId === project.id}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${isCurrent
                ? 'border-violet-500/30 bg-violet-500/10'
                : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
                } disabled:cursor-wait disabled:opacity-70`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                    <FolderKanban className="h-4 w-4 text-zinc-500" />
                    <span className="truncate">{project.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    <span>{project.status}</span>
                    {project.devPort && <span>localhost:{project.devPort}</span>}
                    <span>{formatRelative(project.createdAt)}</span>
                    {project.owned && <span>owned</span>}
                    {linkedConversationCount > 0 && (
                      <span>{linkedConversationCount} chat{linkedConversationCount === 1 ? '' : 's'}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {isCurrent && <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-violet-200">live</span>}
                  <FolderOpenDot className="h-4 w-4 text-zinc-500" />
                </div>
              </div>
            </button>
          );
        })}

        {!loading && projects.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-center text-sm text-zinc-500">
            <div>No projects yet.</div>
            <div className="mt-2 text-xs text-zinc-600">Chat with Vai to get started.</div>
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-center text-sm text-zinc-500">
            Loading projects...
          </div>
        )}
      </div>
    </div>
  );
}

function ControlPanel() {
  const isOwner = useAuthStore((state) => state.isOwner);
  const ownerFeaturesHidden = useAuthStore((state) => state.ownerFeaturesHidden);
  const setOwnerFeaturesHidden = useAuthStore((state) => state.setOwnerFeaturesHidden);
  const user = useAuthStore((state) => state.user);
  const setActivePanel = useLayoutStore((state) => state.setActivePanel);
  const { status, stats } = useEngineStore();
  const startOwnerTrainingSession = useChatStore((state) => state.startOwnerTrainingSession);
  const [startingTraining, setStartingTraining] = useState(false);

  if (!isOwner || ownerFeaturesHidden) {
    return (
      <div className="p-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-400">
          Control is reserved for the owner account and is hidden in user-view mode.
        </div>
      </div>
    );
  }

  const handleStartTraining = async () => {
    setStartingTraining(true);
    try {
      await startOwnerTrainingSession('vai:v0', 'plan');
      setActivePanel('chats');
      toast.success('Owner training chat opened');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to open training chat');
    } finally {
      setStartingTraining(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <Shield className="h-4 w-4 text-violet-300" />
          Owner control surface
        </div>
        <div className="mt-2 text-xs text-zinc-300">
          Signed in as {user?.email ?? 'owner'}.
        </div>
        <div className="mt-1 text-xs text-zinc-400">
          Keep the main shell consistent, then layer owner-only workflow and runtime tools on top.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <button
          onClick={() => setOwnerFeaturesHidden(true)}
          className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-left transition-colors hover:bg-amber-500/20"
        >
          <div className="text-sm text-zinc-100">Hide owner features</div>
          <div className="mt-1 text-xs text-zinc-500">Collapse admin-only UI so the shell behaves like a regular user session.</div>
        </button>
        <button
          onClick={() => void handleStartTraining()}
          disabled={startingTraining}
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-left transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-70"
        >
          <div className="text-sm text-zinc-100">Training chat</div>
          <div className="mt-1 text-xs text-zinc-500">Open the isolated owner workspace for curating what is allowed to teach Vai.</div>
        </button>
        <button
          onClick={() => setActivePanel('projects')}
          className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
        >
          <div className="text-sm text-zinc-100">Projects</div>
          <div className="mt-1 text-xs text-zinc-500">Jump into saved workspaces and current sandbox context.</div>
        </button>
        <button
          onClick={() => setActivePanel('devlogs')}
          className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
        >
          <div className="text-sm text-zinc-100">Dev logs</div>
          <div className="mt-1 text-xs text-zinc-500">Inspect session capture and conversation history.</div>
        </button>
        <button
          onClick={() => setActivePanel('settings')}
          className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
        >
          <div className="text-sm text-zinc-100">Group Chat and settings</div>
          <div className="mt-1 text-xs text-zinc-500">Manage IDE peers, audits, models, and runtime defaults.</div>
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
        <div className="font-medium uppercase tracking-[0.18em] text-zinc-500">Runtime</div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span>Status</span>
          <span className="text-zinc-200">{status}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span>Indexed documents</span>
          <span className="text-zinc-200">{stats?.documentsIndexed ?? 0}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Search Panel ──────────────────────────────────────────────── */

function SearchPanel() {
  const [_selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <SidebarSearch
      onSelectConversation={(id) => {
        setSelectedId(id);
        useChatStore.getState().selectConversation(id);
      }}
      onClose={() => {
        // In panel mode, search stays open — just clear selection
        setSelectedId(null);
      }}
    />
  );
}

/* ── Settings Panel ────────────────────────────────────────────── */

function SettingsPanel() {
  const isOwner = useAuthStore((state) => state.isOwner);
  const ownerFeaturesHidden = useAuthStore((state) => state.ownerFeaturesHidden);
  const setOwnerFeaturesHidden = useAuthStore((state) => state.setOwnerFeaturesHidden);
  const showOwnerFeatures = isOwner && !ownerFeaturesHidden;
  const {
    models,
    selectedModelId,
    setSelectedModelId,
    fetchBootstrap,
    frontends,
    ideTargets,
    selectedFrontendId,
    setSelectedFrontendId,
    workflowModes,
    defaultConversationMode,
  } =
    useSettingsStore();
  const projectId = useSandboxStore((state) => state.projectId);
  const persistentProjectId = useSandboxStore((state) => state.persistentProjectId);
  const attachProject = useSandboxStore((state) => state.attachProject);
  const peers = useCollabStore((state) => state.peers);
  const companionClients = useCollabStore((state) => state.companionClients);
  const globalClients = useCollabStore((state) => state.globalClients);
  const audits = useCollabStore((state) => state.audits);
  const collabLoading = useCollabStore((state) => state.loading);
  const fetchCompanionClients = useCollabStore((state) => state.fetchCompanionClients);
  const fetchGlobalClients = useCollabStore((state) => state.fetchGlobalClients);
  const fetchPeers = useCollabStore((state) => state.fetchPeers);
  const savePeers = useCollabStore((state) => state.savePeers);
  const fetchAudits = useCollabStore((state) => state.fetchAudits);
  const createAudit = useCollabStore((state) => state.createAudit);
  const { status: engineStatus, stats } = useEngineStore();
  const activeMode = useLayoutStore((state) => state.mode);
  const setActivePanel = useLayoutStore((state) => state.setActivePanel);
  const broadcastMode = useChatStore((state) => state.broadcastMode);
  const broadcastTargetClientIds = useChatStore((state) => state.broadcastTargetClientIds);
  const syncState = useVinextStore((state: VinextState) => state.syncState);
  const latencyMs = useVinextStore((state: VinextState) => state.latencyMs);
  const motionBudget = useVinextStore((state: VinextState) => state.motionBudget);
  const trustLevel = useVinextStore((state: VinextState) => state.trustLevel);
  const [auditPrompt, setAuditPrompt] = useState('Audit this project for correctness, regressions, and architecture risks.');
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [launchingTargetId, setLaunchingTargetId] = useState<string | null>(null);


  useEffect(() => {
    fetchBootstrap();
    void fetchGlobalClients();
  }, [fetchBootstrap, fetchGlobalClients]);

  useEffect(() => {
    if (!persistentProjectId) return;
    void fetchCompanionClients(persistentProjectId);
    void fetchPeers(persistentProjectId);
    void fetchAudits(persistentProjectId);
  }, [persistentProjectId, fetchAudits, fetchCompanionClients, fetchPeers]);

  // Determine which IDE targets have online companion clients
  const ideClientStatus = useMemo(() => {
    const ONLINE_THRESHOLD = 30 * 60_000; // 30 minutes
    const now = Date.now();
    const statusMap = new Map<string, { online: boolean; clientIds: string[]; lastActivity: string }>();

    for (const target of ideTargets) {
      const matchingClients = globalClients.filter((c) =>
        c.launchTarget === target.id || c.clientType === target.id,
      );
      const onlineClients = matchingClients.filter((c) => {
        const lastActivity = Math.max(
          c.lastPolledAt ? new Date(c.lastPolledAt).getTime() : 0,
          c.lastSeenAt ? new Date(c.lastSeenAt).getTime() : 0,
        );
        return now - lastActivity < ONLINE_THRESHOLD;
      });

      const latestActivity = matchingClients.reduce((latest, c) => {
        const t = Math.max(
          c.lastPolledAt ? new Date(c.lastPolledAt).getTime() : 0,
          c.lastSeenAt ? new Date(c.lastSeenAt).getTime() : 0,
        );
        return t > latest ? t : latest;
      }, 0);

      statusMap.set(target.id, {
        online: onlineClients.length > 0,
        clientIds: matchingClients.map((c) => c.id),
        lastActivity: latestActivity > 0 ? formatRelative(new Date(latestActivity).toISOString()) : 'Never connected',
      });
    }
    return statusMap;
  }, [ideTargets, globalClients]);

  const compatibleClientsByPeerKey = useMemo(() => {
    return new Map(peers.map((peer) => [
      peer.peerKey,
      companionClients
        .filter((client) => client.launchTarget === peer.launchTarget)
        .sort((left, right) => {
          const leftBound = left.id === peer.preferredClientId ? 1 : 0;
          const rightBound = right.id === peer.preferredClientId ? 1 : 0;
          return rightBound - leftBound;
        }),
    ]));
  }, [companionClients, peers]);

  const visibleAudits = useMemo(() => {
    return audits.slice(0, 3).map((audit) => {
      const submittedCount = audit.results.filter((result) => result.status === 'submitted').length;
      const claimedCount = audit.results.filter((result) => result.status === 'claimed' && !result.claimIsStale).length;
      const staleCount = audit.results.filter((result) => result.status === 'claimed' && result.claimIsStale).length;
      const pendingCount = audit.results.filter((result) => result.status === 'pending').length;
      const sortedResults = [...audit.results].sort((left, right) => {
        const leftWinner = left.peerKey === audit.winningPeerKey ? 1 : 0;
        const rightWinner = right.peerKey === audit.winningPeerKey ? 1 : 0;
        if (rightWinner !== leftWinner) return rightWinner - leftWinner;

        const leftSubmitted = left.status === 'submitted' ? 1 : 0;
        const rightSubmitted = right.status === 'submitted' ? 1 : 0;
        if (rightSubmitted !== leftSubmitted) return rightSubmitted - leftSubmitted;

        return (right.confidence ?? -1) - (left.confidence ?? -1);
      });

      return {
        ...audit,
        submittedCount,
        claimedCount,
        staleCount,
        pendingCount,
        sortedResults,
      };
    });
  }, [audits]);

  const invitePreset = async (targetId: string, preset: { peerKey: string; displayName: string; model: string }) => {
    if (!persistentProjectId) {
      toast.error('Open a project before inviting IDE peers');
      return;
    }

    const nextPeers = [
      ...peers.filter((peer) => peer.peerKey !== preset.peerKey),
      {
        peerKey: preset.peerKey,
        displayName: preset.displayName,
        ide: targetId,
        model: preset.model,
        status: 'invited' as const,
        launchTarget: targetId,
        preferredClientId: null,
        instructions: null,
      },
    ];

    try {
      await savePeers(persistentProjectId, nextPeers);
      toast.success(`${preset.displayName} joined the project roster`);
    } catch {
      toast.error('Unable to update the project roster');
    }
  };

  const handleAudit = async () => {
    if (!persistentProjectId) {
      toast.error('Open a project before requesting an audit');
      return;
    }
    const audit = await createAudit(persistentProjectId, auditPrompt, peers.map((peer) => peer.peerKey));
    if (audit) {
      toast.success(`Audit fanout started for ${audit.results.length} peer${audit.results.length === 1 ? '' : 's'}`);
    } else {
      toast.error('Unable to create audit request');
    }
  };

  const handlePreferredClientChange = async (peerKey: string, preferredClientId: string) => {
    if (!persistentProjectId) return;

    const nextPeers = peers.map((peer) => ({
      peerKey: peer.peerKey,
      displayName: peer.displayName,
      ide: peer.ide,
      model: peer.model,
      status: peer.status,
      launchTarget: peer.launchTarget,
      preferredClientId: peer.peerKey === peerKey ? (preferredClientId || null) : peer.preferredClientId,
      instructions: peer.instructions,
    }));

    try {
      await savePeers(persistentProjectId, nextPeers);
      toast.success('Peer routing updated');
    } catch {
      toast.error('Unable to update peer routing');
    }
  };

  const createHandoffIntent = async (targetId: string) => {
    if (!persistentProjectId) {
      toast.error('Open a project before launching a companion IDE');
      return null;
    }

    const response = await apiFetch(`/api/projects/${persistentProjectId}/handoff-intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        target: targetId,
        clientInfo: 'VeggaAI desktop shell',
      }),
    });

    const payload = await response.json().catch(() => null) as {
      error?: string;
      launchUrl?: string | null;
      token?: string;
    } | null;

    if (!response.ok || !payload?.token) {
      throw new Error(payload?.error ?? 'Unable to create project handoff');
    }

    return payload;
  };

  const handleLaunchTarget = async (targetId: string, targetLabel: string) => {
    setLaunchingTargetId(targetId);
    try {
      const handoff = await createHandoffIntent(targetId);
      if (!handoff?.launchUrl) {
        throw new Error(`${targetLabel} does not provide a direct launch link yet`);
      }

      await openExternalTarget(handoff.launchUrl);
      toast.success(`Opening ${targetLabel} for this project`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to open ${targetLabel}`);
    } finally {
      setLaunchingTargetId(null);
    }
  };

  const handleCopyHandoffLink = async (targetId: string, targetLabel: string) => {
    setLaunchingTargetId(targetId);
    try {
      const handoff = await createHandoffIntent(targetId);
      if (!handoff?.launchUrl) {
        throw new Error(`${targetLabel} does not provide a launch link yet`);
      }
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is not available in this shell');
      }

      await navigator.clipboard.writeText(handoff.launchUrl);
      toast.success(`${targetLabel} handoff link copied to clipboard`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to copy handoff link');
    } finally {
      setLaunchingTargetId(null);
    }
  };

  const handleAttachCurrentSandbox = async () => {
    if (!projectId) {
      toast.error('Create or open a sandbox project first');
      return;
    }

    try {
      await attachProject(projectId);
      toast.success('Group chat attached to the current sandbox');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to attach the current sandbox');
    }
  };

  const startCollabChat = async (label: string, targetClientIds?: string[]) => {
    try {
      if (!useChatStore.getState().activeConversationId) {
        await useChatStore.getState().createConversation(
          selectedModelId ?? models[0]?.id ?? 'vai:v0',
          'chat',
          { sandboxProjectId: projectId ?? null },
        );
      }
      useChatStore.getState().setBroadcastMode(true, targetClientIds);
      setActivePanel('chats');
      toast.success(`Connected to ${label} — type your message`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to connect');
    }
  };

  const disconnectBroadcast = () => {
    useChatStore.getState().setBroadcastMode(false);
    toast.success('Disconnected from broadcast');
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* ── Section: Preferences ── */}
      {isOwner && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Preferences</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-zinc-200">Owner view</div>
              <div className="text-[10px] text-zinc-500">{ownerFeaturesHidden ? 'Showing user experience' : 'Showing owner tools'}</div>
            </div>
            <button
              role="switch"
              aria-checked={!ownerFeaturesHidden}
              onClick={() => setOwnerFeaturesHidden(!ownerFeaturesHidden)}
              className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${!ownerFeaturesHidden ? 'bg-amber-500' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${!ownerFeaturesHidden ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      )}

      {/* ── Section: Workspace ── */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Workspace</div>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Model</label>
            <select
              value={selectedModelId ?? ''}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 transition-colors focus:border-violet-500/50 focus:outline-none"
            >
              {models.length === 0 && <option value="">No models available</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName} · {m.provider}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Frontend shell</label>
            <select
              value={selectedFrontendId ?? ''}
              onChange={(e) => setSelectedFrontendId(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 transition-colors focus:border-violet-500/50 focus:outline-none"
            >
              {frontends.length === 0 && <option value="">No frontend shells available</option>}
              {frontends.map((frontend) => (
                <option key={frontend.id} value={frontend.id}>{frontend.framework} · {frontend.role}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Section: Engine (owner only) ── */}
      {showOwnerFeatures && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Engine</div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Status</span>
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${
                engineStatus === 'ready' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                  : engineStatus === 'offline' ? 'bg-red-500 animate-pulse'
                  : engineStatus === 'starting' ? 'bg-yellow-500 animate-pulse'
                  : 'bg-zinc-600'
              }`} />
              <span className={`text-xs ${
                engineStatus === 'ready' ? 'text-emerald-400'
                  : engineStatus === 'offline' ? 'text-red-400'
                  : 'text-zinc-500'
              }`}>
                {engineStatus === 'ready' ? 'Online' : engineStatus === 'offline' ? 'Offline' : engineStatus === 'starting' ? 'Starting...' : 'Idle'}
              </span>
            </div>
          </div>
          {engineStatus === 'ready' && stats && (
            <div className="space-y-1 text-xs text-zinc-600">
              <div className="flex justify-between"><span>Vocabulary</span><span className="text-zinc-400">{stats.vocabSize.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Knowledge</span><span className="text-zinc-400">{stats.knowledgeEntries.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Documents</span><span className="text-zinc-400">{stats.documentsIndexed.toLocaleString()}</span></div>
            </div>
          )}
          {engineStatus === 'offline' && (
            <p className="text-[10px] text-red-400/70">Run <code className="rounded bg-zinc-800 px-1 text-zinc-300">pnpm dev:web</code></p>
          )}
          <div className="mt-3 border-t border-zinc-800/40 pt-3">
            <div className="mb-2 text-xs font-medium text-zinc-400">Build</div>
            <BuildStatusBadge />
          </div>
        </div>
      )}

      {/* ── Section: Workflow (owner only) ── */}
      {showOwnerFeatures && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Workflow</div>
          <div className="mb-2 text-[11px] text-zinc-500">
            Runtime default: <span className="text-zinc-300">{defaultConversationMode}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {workflowModes.map((workflowMode) => (
              <span
                key={workflowMode}
                title={MODE_DESCRIPTIONS[workflowMode]}
                className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-wide ${
                  workflowMode === activeMode
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-300'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-500'
                }`}
              >
                {workflowMode}
              </span>
            ))}
          </div>
          <div className="mt-3 border-t border-zinc-800/40 pt-3">
            <div className="mb-2 text-xs font-medium text-zinc-400">Vinext Envelope</div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
              <div>Sync<div className="mt-0.5 text-zinc-300">{syncState}</div></div>
              <div>Trust<div className="mt-0.5 text-zinc-300">{trustLevel}</div></div>
              <div>Motion<div className="mt-0.5 text-zinc-300">{motionBudget}</div></div>
              <div>Latency<div className="mt-0.5 text-zinc-300">{latencyMs === null ? 'offline' : `${Math.round(latencyMs)}ms`}</div></div>
            </div>
          </div>
        </div>
      )}

      {/* ── Section: IDE Connections ── */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            <Bot className="h-3.5 w-3.5" />
            IDE Connections
          </div>
          <button
            onClick={() => void fetchGlobalClients()}
            className="text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
          >
            Refresh
          </button>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
          Send messages to your connected IDE extensions directly from the desktop app.
        </p>

        <div className="space-y-1.5">
          {ideTargets.filter((t) => t.id !== 'desktop').map((target) => {
            const status = ideClientStatus.get(target.id);
            const isOnline = status?.online ?? false;
            return (
              <div
                key={target.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/50 bg-zinc-950/60 px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${
                    isOnline
                      ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                      : 'bg-zinc-600'
                  }`} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-200">{target.label}</div>
                    <div className="text-[10px] text-zinc-500">
                      {isOnline ? `Active · ${status?.lastActivity}` : status?.lastActivity ?? 'Not connected'}
                    </div>
                  </div>
                </div>
                {(() => {
                  const isConnected = broadcastMode && status?.clientIds?.some((cid: string) => broadcastTargetClientIds.includes(cid));
                  if (isConnected) {
                    return (
                      <button
                        onClick={disconnectBroadcast}
                        className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-medium text-emerald-200 transition-colors hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-200"
                      >
                        <Wifi className="h-3 w-3" />
                        Connected
                      </button>
                    );
                  }
                  return (
                    <button
                      onClick={() => void startCollabChat(target.label, status?.clientIds)}
                      disabled={!status?.clientIds?.length}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-colors ${
                        isOnline
                          ? 'border border-blue-500/30 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20'
                          : status?.clientIds?.length
                            ? 'border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                            : 'border border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed'
                      }`}
                    >
                      {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                      {status?.clientIds?.length ? 'Connect' : 'Setup'}
                    </button>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {globalClients.length === 0 && (
          <div className="mt-3 rounded-xl border border-zinc-800/40 bg-zinc-950/50 px-3 py-2.5 text-center">
            <div className="text-[11px] text-zinc-500">No IDE extensions connected yet</div>
            <div className="mt-1 text-[10px] text-zinc-600">
              Install the VeggaAI extension in VS Code, Cursor, or Antigravity and sign in
            </div>
          </div>
        )}
      </div>

      {/* ── Section: Project Collaboration (owner, project-attached) ── */}
      {showOwnerFeatures && persistentProjectId && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Project Collaboration</div>

          <div className="rounded-md border border-zinc-800/50 bg-zinc-950/60 p-2">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-zinc-300">
              <GitBranch className="h-3.5 w-3.5" />
              Active Peer Roster
            </div>
            <div className="space-y-1.5">
              {peers.length === 0 && (
                <div className="text-[11px] text-zinc-500">No peers invited yet.</div>
              )}
              {peers.map((peer) => (
                <div key={peer.peerKey} className="rounded-md border border-zinc-800/40 px-2 py-2 text-[11px]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-zinc-200">{peer.displayName}</div>
                      <div className="text-[10px] text-zinc-500">{peer.ide} · {peer.model}</div>
                    </div>
                    <span className="rounded-full border border-zinc-700/50 px-2 py-0.5 text-[10px] text-zinc-400">{peer.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-md border border-zinc-800/50 bg-zinc-950/60 p-2">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-zinc-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Audit Fanout
            </div>
            <textarea
              value={auditPrompt}
              onChange={(event) => setAuditPrompt(event.target.value)}
              className="min-h-20 w-full rounded-md border border-zinc-800/50 bg-zinc-950 px-2.5 py-2 text-[11px] text-zinc-200 outline-none transition-colors focus:border-blue-500/50"
            />
            <button
              onClick={() => void handleAudit()}
              disabled={collabLoading || peers.length === 0}
              className="mt-2 w-full rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[11px] font-medium text-blue-200 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:border-zinc-800/50 disabled:bg-zinc-900 disabled:text-zinc-600"
            >
              Run audit with {peers.length} peer{peers.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Knowledge Side Panel (compact sidebar view) ───────────────── */

interface KBSource {
  id: string;
  url: string;
  title: string;
  sourceType: string;
  capturedAt: string;
}

function KnowledgeSidePanel() {
  const { stats } = useEngineStore();
  const [sources, setSources] = useState<KBSource[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ text: string; source: string; score: number }[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/sources`)
      .then((r) => r.ok ? r.json() : [])
      .then(setSources)
      .catch(() => { });
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=5`);
      if (res.ok) setResults(await res.json());
    } catch { /* offline */ }
    setSearching(false);
  };

  const typeCounts = useMemo(() => {
    const counts = { web: 0, youtube: 0, file: 0 };
    for (const s of sources) {
      if (s.sourceType === 'youtube') counts.youtube++;
      else if (s.sourceType === 'file') counts.file++;
      else counts.web++;
    }
    return counts;
  }, [sources]);

  return (
    <div className="flex flex-col gap-3 p-2">
      {/* Stats overview */}
      {stats && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
          <div className="mb-2 flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-xs font-medium text-zinc-300">Engine Stats</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            <div className="rounded bg-zinc-800/60 px-2 py-1">
              <div className="text-zinc-500">Vocab</div>
              <div className="text-sm font-medium text-zinc-200">{stats.vocabSize.toLocaleString()}</div>
            </div>
            <div className="rounded bg-zinc-800/60 px-2 py-1">
              <div className="text-zinc-500">Knowledge</div>
              <div className="text-sm font-medium text-zinc-200">{stats.knowledgeEntries.toLocaleString()}</div>
            </div>
            <div className="rounded bg-zinc-800/60 px-2 py-1">
              <div className="text-zinc-500">Documents</div>
              <div className="text-sm font-medium text-zinc-200">{stats.documentsIndexed.toLocaleString()}</div>
            </div>
            <div className="rounded bg-zinc-800/60 px-2 py-1">
              <div className="text-zinc-500">Sources</div>
              <div className="text-sm font-medium text-zinc-200">{sources.length}</div>
            </div>
          </div>
        </div>
      )}

      {/* Quick search */}
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search knowledge..."
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={searching}
          className="rounded-md bg-violet-600/80 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
        >
          <SearchIcon className="h-3 w-3" />
        </button>
      </div>

      {/* Search results */}
      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map((r, i) => (
            <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
              <p className="text-[11px] leading-snug text-zinc-300 line-clamp-3">{r.text.slice(0, 200)}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="truncate text-[9px] text-zinc-600">{r.source}</span>
                <span className="ml-1 shrink-0 text-[9px] text-zinc-600">{r.score.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Source type breakdown */}
      <div className="flex flex-wrap gap-1.5">
        {typeCounts.web > 0 && (
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
            <Globe className="mr-0.5 inline h-2.5 w-2.5" /> {typeCounts.web} web
          </span>
        )}
        {typeCounts.youtube > 0 && (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
            ▶ {typeCounts.youtube} videos
          </span>
        )}
        {typeCounts.file > 0 && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
            {typeCounts.file} files
          </span>
        )}
      </div>

      {/* Recent sources — show 25 with scroll */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Recent Sources ({sources.length})
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto">
          {sources.slice(0, 25).map((s) => (
            <div
              key={s.id}
              className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/40 hover:text-zinc-200"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.sourceType === 'youtube' ? 'bg-red-500' :
                s.sourceType === 'file' ? 'bg-amber-500' : 'bg-blue-500'
                }`} />
              <span className="min-w-0 flex-1 truncate">{s.title || s.url}</span>
              {s.url && (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-2.5 w-2.5 text-zinc-600" />
                </a>
              )}
            </div>
          ))}
          {sources.length === 0 && (
            <p className="py-4 text-center text-[10px] text-zinc-600">No sources yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
