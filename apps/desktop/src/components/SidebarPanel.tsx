import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, ChevronLeft, ChevronRight,
  FolderKanban, Shield, Search, Pin, PinOff, Code2,
} from 'lucide-react';
import { useChatStore } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useEngineStore } from '../stores/engineStore.js';
import { useLayoutStore, type SidebarPanel as PanelType } from '../stores/layoutStore.js';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { apiFetch } from '../lib/api.js';
import { toast } from 'sonner';

const SidebarSearch = lazy(async () => ({ default: (await import('./SidebarSearch.js')).SidebarSearch }));
const SessionList = lazy(async () => ({ default: (await import('./SessionList.js')).SessionList }));
const DockerPanel = lazy(async () => ({ default: (await import('./DockerPanel.js')).DockerPanel }));
const KnowledgeSidePanel = lazy(async () => ({ default: (await import('./panels/KnowledgeSidePanel.js')).KnowledgeSidePanel }));

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
  chats: 'Workspace',
  projects: 'Projects',
  devlogs: 'Dev Logs',
  knowledge: 'Knowledge Base',
  docker: 'Docker Sandboxes',
  search: 'Search',
  settings: 'Settings',
  vaigym: 'Vai Gymnasium',
  thorsen: 'Thorsen Wormhole',
  control: 'Control',
  council: 'Council Progress',
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
const CHAT_PINNED_STORAGE_KEY = 'vai-sidebar-pinned-chats';
const PROJECT_LIST_PAGE_SIZE = 12;

function loadPinnedChats(): Set<string> {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(CHAT_PINNED_STORAGE_KEY) : null;
    return new Set(raw ? JSON.parse(raw) as string[] : []);
  } catch {
    return new Set();
  }
}

function savePinnedChats(ids: Set<string>): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CHAT_PINNED_STORAGE_KEY, JSON.stringify([...ids]));
    }
  } catch {
    // ignore local persistence failures
  }
}

/** Date bucket — Today, Yesterday, Older. */
function dateBucket(updatedAt: string): { key: string; label: string; order: number } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const updated = new Date(updatedAt).getTime();
  if (updated >= startOfToday) return { key: 'bucket:today', label: 'Today', order: 0 };
  if (updated >= startOfToday - 86_400_000) return { key: 'bucket:yesterday', label: 'Yesterday', order: 1 };
  return { key: 'bucket:older', label: 'Older', order: 2 };
}

function isCodeConversation(conv: { mode?: string; sandboxProjectId?: string | null }): boolean {
  return conv.mode === 'builder' || conv.mode === 'agent' || Boolean(conv.sandboxProjectId);
}

export const FOCUS_CHAT_SEARCH_EVENT = 'vai:focus-chat-search';

function PanelLoading() {
  return <div className="p-4 text-xs text-zinc-600">Loading panel...</div>;
}

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
  const { activePanel, toggleSidebar, themePreference, layoutMode } = useLayoutStore();
  const isLight = themePreference === 'light';
  const isOdyssey = layoutMode === 'odyssey';

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 'var(--layout-sidebar-effective-width)', opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className={`sidebar-panel-shell flex h-full min-w-0 flex-shrink-0 flex-col overflow-hidden bg-[color:var(--sidebar-surface)] ${
        isOdyssey
          ? 'rounded-[var(--layout-radius)] border border-[color:var(--border)] shadow-[var(--layout-shadow)]'
          : 'border-r border-[color:var(--shell-line-soft)]'
      }`}
      style={{ width: 'var(--layout-sidebar-effective-width)', maxWidth: '100%' }}
    >
      {/* Panel header — slim and quiet */}
      <div className="flex h-11 flex-shrink-0 items-center justify-between px-4">
        <div className="min-w-0">
          <span className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isLight ? 'text-zinc-600' : 'text-zinc-400'}`}>
            {PANEL_TITLES[activePanel]}
          </span>
        </div>
        <button
          onClick={toggleSidebar}
          className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
            isLight ? 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
          }`}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={<PanelLoading />}>
          {activePanel === 'chats' && <ChatsPanel />}
          {activePanel === 'devlogs' && <DevLogsPanel />}
          {activePanel === 'knowledge' && <KnowledgeSidePanel />}
          {activePanel === 'docker' && <DockerPanel />}
          {activePanel === 'control' && <ControlPanel />}
        </Suspense>
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
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadPinnedChats());
  const [manualOrder, setManualOrder] = useState<string[]>(() => loadConversationOrder());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [draggedConversationId, setDraggedConversationId] = useState<string | null>(null);
  const [dragOverConversationId, setDragOverConversationId] = useState<string | null>(null);
  const suppressSelectUntilRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener(FOCUS_CHAT_SEARCH_EVENT, focusSearch);
    return () => window.removeEventListener(FOCUS_CHAT_SEARCH_EVENT, focusSearch);
  }, []);

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

  const togglePinned = useCallback((conversationId: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      savePinnedChats(next);
      return next;
    });
  }, []);

  // Pinned first, then chronological Today / Yesterday / Older for all chats.
  const grouped = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      label: string;
      projectId: string | null;
      order: number;
      items: typeof filteredConversations;
    }>();
    for (const conv of filteredConversations) {
      let key: string;
      let label: string;
      let order: number;
      if (pinnedIds.has(conv.id)) {
        key = 'pinned';
        label = 'Pinned';
        order = -1;
      } else {
        const bucket = dateBucket(conv.updatedAt);
        key = bucket.key;
        label = bucket.label;
        order = bucket.order;
      }
      const existing = groups.get(key);
      if (existing) existing.items.push(conv);
      else groups.set(key, { key, label, projectId: null, order, items: [conv] });
    }

    const sorted = [...groups.values()].sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.label.localeCompare(right.label);
    });
    for (const group of sorted) {
      group.items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return sorted;
  }, [filteredConversations, pinnedIds]);

  const visibleGroups = useMemo(() => {
    if (!query.trim()) return grouped;
    if (filteredConversations.length === 0) return [];
    return [{
      key: 'search-results',
      label: 'Matches',
      projectId: null,
      order: 0,
      items: filteredConversations,
    }];
  }, [grouped, query, filteredConversations]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex-shrink-0 px-3 pb-2 pt-2">
        <button
          onClick={handleNewChat}
          className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors ${
            isLight
              ? 'text-zinc-800 hover:bg-zinc-200/70'
              : 'text-zinc-200 hover:bg-white/[0.05]'
          }`}
        >
          <span className={`flex h-6 w-6 items-center justify-center rounded-md ${isLight ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-950'}`}>
            <Plus className="h-3.5 w-3.5" />
          </span>
          New Chat
          <span className={`ml-auto text-[10px] ${isLight ? 'text-zinc-400' : 'text-zinc-600'}`}>Ctrl+N</span>
        </button>
        <div className="relative">
          <Search
            className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${
              isLight ? 'text-zinc-400' : 'text-zinc-600'
            }`}
          />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className={`w-full rounded-md py-1.5 pl-8 pr-3 text-sm outline-none transition-colors ${
              isLight
                ? 'bg-zinc-200/55 text-zinc-900 placeholder-zinc-400 focus:bg-white focus:ring-1 focus:ring-zinc-300'
                : 'bg-white/[0.035] text-zinc-100 placeholder-zinc-600 focus:bg-white/[0.055] focus:ring-1 focus:ring-white/10'
            }`}
          />
        </div>
      </div>

      {/* Grouped conversation list */}
      <div className="px-1.5 pb-2">
        {visibleGroups.map((group) => {
          const collapsed = collapsedGroups.has(group.key);
          return (
          <div key={group.key} className="mt-2">
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                isLight ? 'text-zinc-600 hover:bg-zinc-200/60' : 'text-zinc-400 hover:bg-white/[0.035]'
              }`}
              aria-expanded={!collapsed}
            >
              <ChevronRight className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
              {group.key === 'pinned'
                ? <Pin className="h-3 w-3 shrink-0 text-[color:var(--accent-text)]" />
                : null}
              <span className={`min-w-0 flex-1 truncate text-[11px] font-semibold ${group.key.startsWith('bucket:') || group.key === 'search-results' ? 'uppercase tracking-[0.14em] opacity-80' : ''}`}>{group.label}</span>
              <span className={`text-[10px] tabular-nums ${isLight ? 'text-zinc-400' : 'text-zinc-600'}`}>{group.items.length}</span>
            </button>
            {!collapsed && group.items.map((conv) => (
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
                className={`group relative ml-3 flex items-center gap-2 rounded-md px-2 py-1.5 transition-all duration-150 hover:translate-x-0.5 ${draggedConversationId === conv.id ? 'cursor-grabbing opacity-80' : 'cursor-grab'} ${conv.id === activeConversationId
                  ? isLight
                    ? 'bg-white text-zinc-950 shadow-sm'
                    : 'bg-white/[0.065] text-zinc-100'
                  : isLight
                    ? 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                    : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
                  } ${dragOverConversationId === conv.id ? 'bg-[color:var(--accent-soft)]' : ''}`}
                title={conv.title}
                onClick={() => {
                  if (Date.now() < suppressSelectUntilRef.current) return;
                  void selectConversation(conv.id);
                }}
              >
                {conv.id === activeConversationId && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[color:var(--accent)]"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {isCodeConversation(conv) && (
                      <Code2
                        aria-hidden
                        className={`h-3 w-3 shrink-0 ${isLight ? 'text-blue-600' : 'text-violet-400'}`}
                        title="Code / build chat"
                      />
                    )}
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] leading-tight">{conv.title}</span>
                      <span className={`flex-shrink-0 text-[10px] tabular-nums ${isLight ? 'text-zinc-400' : 'text-zinc-600'}`}>
                        {formatRelative(conv.updatedAt)}
                      </span>
                    </div>
                  </div>
                  {conv.projectName && (
                    <div className={`mt-0.5 truncate text-[10px] ${isLight ? 'text-zinc-500' : 'text-zinc-500'}`}>
                      {conv.projectName}
                    </div>
                  )}
                  {conv.mode && conv.mode !== 'chat' && !isCodeConversation(conv) && (
                    <div className={`mt-0.5 flex items-center gap-1.5 text-[10px] ${isLight ? 'text-zinc-500' : 'text-zinc-500'}`}>
                      <span className="flex-shrink-0 text-[9px] font-medium uppercase tracking-[0.12em]">
                        {conv.mode}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinned(conv.id);
                  }}
                  draggable={false}
                  aria-label={pinnedIds.has(conv.id) ? `Unpin ${conv.title}` : `Pin ${conv.title}`}
                  title={pinnedIds.has(conv.id) ? 'Unpin' : 'Pin to top'}
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-all ${
                    pinnedIds.has(conv.id)
                      ? 'text-[color:var(--accent-text)] opacity-100'
                      : `opacity-0 group-hover:opacity-100 ${
                        isLight ? 'text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700' : 'text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-300'
                      }`
                  }`}
                >
                  {pinnedIds.has(conv.id) ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                  draggable={false}
                  aria-label={`Delete ${conv.title}`}
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded opacity-0 transition-all group-hover:opacity-100 ${
                    isLight ? 'text-zinc-400 hover:bg-red-50 hover:text-red-500' : 'text-zinc-600 hover:bg-red-500/10 hover:text-red-400'
                  }`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          );
        })}

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
  const [projectQuery, setProjectQuery] = useState('');
  const [showRepeatedProjects, setShowRepeatedProjects] = useState(false);
  const [visibleProjectLimit, setVisibleProjectLimit] = useState(PROJECT_LIST_PAGE_SIZE);
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

  const projectNameCounts = useMemo(() => {
    return projects.reduce<Record<string, number>>((counts, project) => {
      const key = project.name.trim().toLowerCase();
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
  }, [projects]);

  const listedProjects = useMemo(() => {
    if (showRepeatedProjects) return projects;

    const seen = new Set<string>();
    return projects.filter((project) => {
      const key = project.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [projects, showRepeatedProjects]);

  const repeatedProjectCount = projects.length - Object.keys(projectNameCounts).length;

  const filteredProjects = useMemo(() => {
    const needle = projectQuery.trim().toLowerCase();
    if (!needle) return listedProjects;
    return listedProjects.filter((project) => (
      project.name.toLowerCase().includes(needle)
      || project.status.toLowerCase().includes(needle)
    ));
  }, [listedProjects, projectQuery]);

  const visibleProjects = useMemo(
    () => filteredProjects.slice(0, visibleProjectLimit),
    [filteredProjects, visibleProjectLimit],
  );

  useEffect(() => {
    setVisibleProjectLimit(PROJECT_LIST_PAGE_SIZE);
  }, [projectQuery]);

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
      <div className="px-1 pb-3">
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
                className="rounded-md px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
              >
                Open chat
              </button>
              <button
                onClick={() => void handleNewProjectChat()}
                className="rounded-md bg-[color:var(--accent-softer)] px-2.5 py-1.5 text-xs text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-soft)]"
              >
                New project chat
              </button>
            </div>
          )}
        </div>

        {projectId && (
          <div className="mt-4">
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
                      className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors ${isActiveConversation
                        ? 'bg-white/[0.065]'
                        : 'hover:bg-white/[0.035]'
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
                        <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-[color:var(--accent-text)]">
                          active
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-2 px-2 py-2 text-xs text-zinc-500">
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
          className="touch-manipulation rounded text-xs text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
        >
          Refresh
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" aria-hidden="true" />
        <input
          value={projectQuery}
          onChange={(event) => setProjectQuery(event.target.value)}
          placeholder="Filter projects"
          aria-label="Filter projects"
          className="w-full rounded-md bg-white/[0.035] py-1.5 pl-8 pr-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:bg-white/[0.055] focus:ring-1 focus:ring-white/10"
        />
      </div>

      {repeatedProjectCount > 0 && (
        <button
          onClick={() => setShowRepeatedProjects((current) => !current)}
          className="touch-manipulation self-start rounded text-xs text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
        >
          {showRepeatedProjects ? 'Hide repeated build names' : `Show ${repeatedProjectCount} repeated build names`}
        </button>
      )}

      <div className="space-y-2">
        {visibleProjects.map((project) => {
          const isCurrent = project.id === projectId;
          const linkedConversationCount = linkedConversationCounts[project.id] ?? 0;
          return (
            <button
              key={project.id}
              onClick={() => void handleAttach(project.id)}
              disabled={attachingId === project.id}
              className={`touch-manipulation w-full rounded-md px-2 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] ${isCurrent
                ? 'bg-white/[0.065]'
                : 'hover:bg-white/[0.035]'
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
                    {!showRepeatedProjects && projectNameCounts[project.name.trim().toLowerCase()] > 1 && (
                      <span className="whitespace-nowrap">
                        {projectNameCounts[project.name.trim().toLowerCase()]} builds
                      </span>
                    )}
                    {linkedConversationCount > 0 && (
                      <span className="whitespace-nowrap">{linkedConversationCount} chat{linkedConversationCount === 1 ? '' : 's'}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {isCurrent && <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-[color:var(--accent-text)]">live</span>}
                  <FolderOpenDot className="h-4 w-4 text-zinc-500" />
                </div>
              </div>
            </button>
          );
        })}

        {!loading && filteredProjects.length === 0 && (
          <div className="p-4 text-center text-sm text-zinc-500">
            <div>{projectQuery.trim() ? 'No projects match that filter.' : 'No projects yet.'}</div>
            {!projectQuery.trim() && <div className="mt-2 text-xs text-zinc-600">Chat with Vai to get started.</div>}
          </div>
        )}

        {visibleProjects.length < filteredProjects.length && (
          <button
            onClick={() => setVisibleProjectLimit((limit) => limit + PROJECT_LIST_PAGE_SIZE)}
            className="touch-manipulation w-full rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/[0.035] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
          >
            Show {Math.min(PROJECT_LIST_PAGE_SIZE, filteredProjects.length - visibleProjects.length)} more
          </button>
        )}

        {loading && (
          <div className="p-4 text-center text-sm text-zinc-500">
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
  const [scaleRuns, setScaleRuns] = useState<Array<{
    id: string;
    manifest?: {
      status?: string;
      startedAt?: string;
      finishedAt?: string | null;
      config?: { n?: number; builderRate?: number; dryRun?: boolean };
    } | null;
    summary?: { summary?: { total?: number; failed?: number }; total?: number; failed?: number } | null;
    auditBytes?: number;
    responseBytes?: number;
  }>>([]);

  useEffect(() => {
    if (!isOwner || ownerFeaturesHidden) return;
    let cancelled = false;
    void apiFetch('/api/scale-eval/runs')
      .then(async (res) => (res.ok ? res.json() : { runs: [] }))
      .then((data: { runs?: typeof scaleRuns }) => {
        if (!cancelled) setScaleRuns((data.runs ?? []).slice(0, 5));
      })
      .catch(() => {
        if (!cancelled) setScaleRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner, ownerFeaturesHidden]);

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
      <div className="rounded-xl border border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <Shield className="h-4 w-4 text-[color:var(--accent-text)]" />
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
          onClick={() => setActivePanel('chats')}
          className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
        >
          <div className="text-sm text-zinc-100">Chat history</div>
          <div className="mt-1 text-xs text-zinc-500">Browse code and build chats alongside regular conversations.</div>
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

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Scale eval</div>
          <span className="text-[11px] text-zinc-500">{scaleRuns.length} recent</span>
        </div>
        <div className="mt-3 space-y-2">
          {scaleRuns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-500">
              No scale-eval artifacts found yet. Run `pnpm vai:scale:eval --dry-run` to create a smoke artifact.
            </div>
          ) : scaleRuns.map((run) => {
            const config = run.manifest?.config;
            const total = run.summary?.summary?.total ?? run.summary?.total ?? config?.n ?? 0;
            const failed = run.summary?.summary?.failed ?? run.summary?.failed ?? 0;
            return (
              <div key={run.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="truncate text-xs font-medium text-zinc-200">{run.id}</div>
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                    {run.manifest?.status ?? 'unknown'}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {total} conversations · {failed} failed · builder {Math.round((config?.builderRate ?? 0) * 100)}%
                  {config?.dryRun ? ' · dry run' : ''}
                </div>
              </div>
            );
          })}
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

