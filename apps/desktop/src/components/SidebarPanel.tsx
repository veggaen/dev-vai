import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, Clock, MessageSquare, ChevronLeft,
  FolderKanban, FolderOpenDot, Shield,
} from 'lucide-react';
import { useChatStore } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useEngineStore } from '../stores/engineStore.js';
import { useLayoutStore, type SidebarPanel as PanelType } from '../stores/layoutStore.js';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { SidebarSearch } from './SidebarSearch.js';
import { SessionList } from './SessionList.js';
import { DockerPanel } from './DockerPanel.js';
import { apiFetch } from '../lib/api.js';
import { toast } from 'sonner';
import { KnowledgeSidePanel } from './panels/KnowledgeSidePanel.js';
import { SettingsPanel } from './panels/SettingsPanel.js';

/* ── Helpers ───────────────────────────────────────────────────── */

function formatRelative(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(date).toLocaleDateString();
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

const CHAT_ORDER_STORAGE_KEY = 'vai-sidebar-chat-order';

function loadConversationOrder(): string[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(CHAT_ORDER_STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) as string[] : [];
  } catch {
    return [];
  }
}

function saveConversationOrder(ids: string[]): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CHAT_ORDER_STORAGE_KEY, JSON.stringify(ids));
    }
  } catch {
    // ignore local persistence failures
  }
}

/* ── Main Panel ────────────────────────────────────────────────── */

export function SidebarPanel() {
  const { activePanel, toggleSidebar, themePreference } = useLayoutStore();
  const isLight = themePreference === 'light';

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 'var(--layout-sidebar-effective-width)', opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className={`flex h-full min-w-0 flex-shrink-0 flex-col overflow-hidden border-r ${
        isLight ? 'border-zinc-200 bg-white/95' : 'border-zinc-800/70 bg-zinc-950/92'
      }`}
      style={{ width: 'var(--layout-sidebar-effective-width)', maxWidth: '100%' }}
    >
      {/* Panel header */}
      <div className={`flex h-11 items-center justify-between border-b px-3 ${isLight ? 'border-zinc-200' : 'border-zinc-800/50'}`}>
        <div className="min-w-0">
          <span className={`text-xs font-medium uppercase tracking-[0.18em] ${isLight ? 'text-zinc-500' : 'text-zinc-500'}`}>
          {PANEL_TITLES[activePanel]}
          </span>
        </div>
        <button
          onClick={toggleSidebar}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
            isLight ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-900 hover:text-zinc-300'
          }`}
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
  const themePreference = useLayoutStore((state) => state.themePreference);
  const isLight = themePreference === 'light';
  const [query, setQuery] = useState('');
  const [manualOrder, setManualOrder] = useState<string[]>(() => loadConversationOrder());
  const [draggedConversationId, setDraggedConversationId] = useState<string | null>(null);
  const [dragOverConversationId, setDragOverConversationId] = useState<string | null>(null);
  const suppressSelectUntilRef = useRef(0);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    setManualOrder((previous) => {
      const liveIds = conversations.map((conversation) => conversation.id);
      const unseenIds = liveIds.filter((id) => !previous.includes(id));
      const retainedIds = previous.filter((id) => liveIds.includes(id));
      const next = [...unseenIds, ...retainedIds];
      if (next.length === previous.length && next.every((id, index) => id === previous[index])) {
        return previous;
      }
      saveConversationOrder(next);
      return next;
    });
  }, [conversations]);

  const handleNewChat = () => {
    startNewChat();
  };

  const orderedConversations = useMemo(() => {
    const orderIndex = new Map(manualOrder.map((id, index) => [id, index]));
    return [...conversations].sort((left, right) => {
      const leftIndex = orderIndex.get(left.id);
      const rightIndex = orderIndex.get(right.id);
      if (leftIndex != null && rightIndex != null) return leftIndex - rightIndex;
      if (leftIndex != null) return -1;
      if (rightIndex != null) return 1;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [conversations, manualOrder]);

  const filteredConversations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orderedConversations;

    return orderedConversations.filter((conv) => (
      conv.title.toLowerCase().includes(needle)
      || conv.projectName?.toLowerCase().includes(needle)
      || conv.modelId?.toLowerCase().includes(needle)
      || conv.mode?.toLowerCase().includes(needle)
    ));
  }, [orderedConversations, query]);

  const reorderConversation = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setManualOrder((previous) => {
      const baseOrder = previous.length > 0
        ? previous.filter((id) => conversations.some((conversation) => conversation.id === id))
        : conversations.map((conversation) => conversation.id);
      const next = [...baseOrder];
      const sourceIndex = next.indexOf(sourceId);
      const targetIndex = next.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1) return previous;
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      saveConversationOrder(next);
      return next;
    });
  }, [conversations]);

  // Group conversations by time buckets
  const grouped = useMemo(() => {
    const now = Date.now();
    const today: typeof filteredConversations = [];
    const yesterday: typeof filteredConversations = [];
    const thisWeek: typeof filteredConversations = [];
    const older: typeof filteredConversations = [];

    for (const conv of filteredConversations) {
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
  }, [filteredConversations]);

  return (
    <div className="flex flex-col">
      <div className={`border-b p-2.5 ${isLight ? 'border-zinc-200' : 'border-zinc-800/60'}`}>
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="min-w-0">
            <div className={`text-[11px] font-medium uppercase tracking-[0.18em] ${isLight ? 'text-zinc-500' : 'text-zinc-500'}`}>Threads</div>
            <div className={`text-xs ${isLight ? 'text-zinc-500' : 'text-zinc-600'}`}>
              {filteredConversations.length} shown
              {query.trim() ? ` of ${conversations.length}` : ''}
            </div>
          </div>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats, projects, models..."
          className={`mb-2 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${
            isLight
              ? 'border-zinc-200 bg-zinc-50 text-zinc-900 placeholder-zinc-400 focus:border-violet-300'
              : 'border-zinc-800/80 bg-zinc-950/78 text-zinc-100 placeholder-zinc-600 focus:border-violet-500/40'
          }`}
        />
        <button
          onClick={handleNewChat}
          className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            isLight
              ? 'border-zinc-200 bg-white text-zinc-800 hover:border-violet-200 hover:bg-violet-50'
              : 'border-zinc-800/80 bg-zinc-950/80 text-zinc-200 hover:border-violet-500/25 hover:bg-zinc-900'
          }`}
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </button>
      </div>

      {/* Grouped conversation list */}
      <div className="px-1.5 pb-2">
        {grouped.map((group) => (
          <div key={group.label}>
            <div className={`px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.18em] ${isLight ? 'text-zinc-500' : 'text-zinc-600'}`}>
              {group.label}
            </div>
            {group.items.map((conv) => (
              <div
                key={conv.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', conv.id);
                  setDraggedConversationId(conv.id);
                  setDragOverConversationId(conv.id);
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (draggedConversationId && draggedConversationId !== conv.id) {
                    setDragOverConversationId(conv.id);
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  if (draggedConversationId && draggedConversationId !== conv.id) {
                    setDragOverConversationId(conv.id);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverConversationId === conv.id) {
                    setDragOverConversationId(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = draggedConversationId || event.dataTransfer.getData('text/plain');
                  if (sourceId) {
                    reorderConversation(sourceId, conv.id);
                  }
                  suppressSelectUntilRef.current = Date.now() + 240;
                  setDraggedConversationId(null);
                  setDragOverConversationId(null);
                }}
                onDragEnd={() => {
                  suppressSelectUntilRef.current = Date.now() + 240;
                  setDraggedConversationId(null);
                  setDragOverConversationId(null);
                }}
                className={`group flex items-start gap-2 rounded-lg border px-2.5 py-2.5 transition-colors ${draggedConversationId === conv.id ? 'cursor-grabbing opacity-80' : 'cursor-grab'} ${conv.id === activeConversationId
                  ? isLight
                    ? 'border-violet-200 bg-violet-50 text-zinc-900'
                    : 'border-zinc-800/80 bg-zinc-900 text-zinc-100'
                  : isLight
                    ? 'border-transparent text-zinc-500 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900'
                    : 'border-transparent text-zinc-400 hover:border-zinc-800/60 hover:bg-zinc-900/60 hover:text-zinc-200'
                  } ${dragOverConversationId === conv.id ? (isLight ? 'border-violet-300 bg-violet-50/80' : 'border-violet-500/35 bg-zinc-900') : ''}`}
                title="Drag to reorder"
                onClick={() => {
                  if (Date.now() < suppressSelectUntilRef.current) return;
                  void selectConversation(conv.id);
                }}
              >
                <div className={`mt-0.5 flex h-8 items-start justify-center px-0.5 ${
                  conv.id === activeConversationId
                    ? isLight ? 'text-violet-600' : 'text-violet-300'
                    : isLight ? 'text-zinc-400' : 'text-zinc-600'
                }`}>
                  <MessageSquare className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate pr-2 text-sm leading-tight">{conv.title}</div>
                  <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] ${isLight ? 'text-zinc-500' : 'text-zinc-600'}`}>
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{formatRelative(conv.updatedAt)}</span>
                    </span>
                    {conv.projectName && (
                      <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap">
                        <span className={isLight ? 'text-zinc-300' : 'text-zinc-700'}>•</span>
                        <FolderOpenDot className="h-2.5 w-2.5 shrink-0" />
                        <span className="max-w-[9rem] truncate">{conv.projectName}</span>
                      </span>
                    )}
                    {conv.mode && conv.mode !== 'chat' && (
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
                        <span className={isLight ? 'text-zinc-300' : 'text-zinc-700'}>•</span>
                        <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] ${
                          isLight ? 'border-zinc-200 bg-white text-zinc-500' : 'border-zinc-800 bg-zinc-950/80 text-zinc-500'
                        }`}>
                          {conv.mode}
                        </span>
                      </span>
                    )}
                    {conv.modelId && (
                      <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap">
                        <span className={isLight ? 'text-zinc-300' : 'text-zinc-700'}>•</span>
                        <span className="max-w-[6.5rem] truncate">{conv.modelId.split('/').pop()}</span>
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                  draggable={false}
                  className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg opacity-0 transition-all group-hover:opacity-100 ${
                    isLight ? 'text-zinc-400 hover:bg-red-50 hover:text-red-500' : 'text-zinc-700 hover:bg-zinc-900 hover:text-red-400'
                  }`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ))}

        {filteredConversations.length === 0 && (
          <p className={`px-3 py-8 text-center text-xs ${isLight ? 'text-zinc-500' : 'text-zinc-600'}`}>
            {query.trim() ? 'No chats match that search yet.' : 'No conversations yet'}
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
  const startNewChat = useChatStore((state) => state.startNewChat);
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
      await fetchConversations();
      const latestConversations = useChatStore.getState().conversations;
      const linkedConversation = [...latestConversations]
        .filter((conversation) => conversation.sandboxProjectId === sandboxProjectId)
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
      const activeConversation = latestConversations.find((conversation) => conversation.id === useChatStore.getState().activeConversationId) ?? null;

      if (linkedConversation) {
        await selectConversation(linkedConversation.id);
        toast.success('Opened project and linked chat');
      } else if (activeConversation?.sandboxProjectId && activeConversation.sandboxProjectId !== sandboxProjectId) {
        startNewChat();
        toast.success('Opened project and cleared the old mismatched chat');
      } else {
        toast.success('Project opened');
      }
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
                          <span className="whitespace-nowrap">{formatRelative(conversation.updatedAt)}</span>
                          {conversation.mode && conversation.mode !== 'chat' && (
                            <span className="whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-500">
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
                    <span className="whitespace-nowrap">{project.status}</span>
                    {project.devPort && <span className="whitespace-nowrap">localhost:{project.devPort}</span>}
                    <span className="whitespace-nowrap">{formatRelative(project.createdAt)}</span>
                    {project.owned && <span className="whitespace-nowrap">owned</span>}
                    {linkedConversationCount > 0 && (
                      <span className="whitespace-nowrap">{linkedConversationCount} chat{linkedConversationCount === 1 ? '' : 's'}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {isCurrent && <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-violet-200">live</span>}
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

