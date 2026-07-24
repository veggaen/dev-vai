import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, ChevronRight, Shield, Search, Pin, PinOff, Code2,
  Pencil, Archive, ArchiveRestore, Monitor, Eye, Volume2, VolumeX,
} from 'lucide-react';
import { useVoiceOutput } from '../hooks/useVoiceOutput.js';
import { useChatStore, isConversationWorking } from '../stores/chatStore.js';
import { useLayoutStore, type SidebarPanel as PanelType } from '../stores/layoutStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useEngineStore } from '../stores/engineStore.js';
import { apiFetch } from '../lib/api.js';
import { getSidebarNavItem, getSidebarPanelTitle } from '../lib/sidebar-nav.js';
import { toast } from 'sonner';
import { SidebarPanelHeader } from './sidebar/SidebarPrimitives.js';
import { useChatMergeDrag } from './sidebar/ChatMergeDrag.js';
import { SharedWorkTask } from './sidebar/SharedWorkTask.js';
import {
  fetchLatestSharedWorkArtifact,
  type SharedWorkArtifact,
} from '../lib/shared-work-artifact.js';
import { PORTS, loopbackHttpUrl } from '@vai/constants';
import {
  improvementAdoptionBoardSchema,
  type ImprovementAdoptionBoard,
} from '@vai/contracts/improvement-adoption';
import { OwnerAdoptionBoard } from './owner/OwnerAdoptionBoard.js';

const SessionList = lazy(async () => ({ default: (await import('./SessionList.js')).SessionList }));
const DockerPanel = lazy(async () => ({ default: (await import('./DockerPanel.js')).DockerPanel }));
const KnowledgeSidePanel = lazy(async () => ({ default: (await import('./panels/KnowledgeSidePanel.js')).KnowledgeSidePanel }));
const ProjectOversightPanel = lazy(async () => ({ default: (await import('./sidebar/ProjectOversightPanel.js')).ProjectOversightPanel }));
const ProjectsHomePanel = lazy(async () => ({ default: (await import('./sidebar/ProjectsHomePanel.js')).ProjectsHomePanel }));
const OWNER_WATCH_BASE = loopbackHttpUrl(PORTS.selfImprovementWatch);

/* ── Helpers ───────────────────────────────────────────────────── */

function formatRelative(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(date).toLocaleDateString();
}


const CHAT_ORDER_STORAGE_KEY = 'vai-sidebar-chat-order';
const CHAT_PINNED_STORAGE_KEY = 'vai-sidebar-pinned-chats';
const CHAT_ARCHIVED_STORAGE_KEY = 'vai-sidebar-archived-chats';
function loadIdSet(key: string): Set<string> {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    return new Set(raw ? JSON.parse(raw) as string[] : []);
  } catch {
    return new Set();
  }
}

function saveIdSet(key: string, ids: Set<string>): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, JSON.stringify([...ids]));
    }
  } catch {
    // ignore local persistence failures
  }
}

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

const SIDEBAR_PANEL_IDS: PanelType[] = ['projects', 'chats', 'devlogs', 'knowledge', 'docker', 'control'];

function SidebarPanelBody({ panel }: { panel: PanelType }) {
  switch (panel) {
    case 'projects':
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ProjectsHomePanel />
          <ProjectOversightPanel />
        </div>
      );
    case 'chats':
      return <ChatsPanel />;
    case 'devlogs':
      return <DevLogsPanel />;
    case 'knowledge':
      return <KnowledgeSidePanel />;
    case 'docker':
      return <DockerPanel />;
    case 'control':
      return <ControlPanel />;
    default:
      return null;
  }
}

interface SidebarPanelProps {
  /** Inside Open/Odyssey resizable shell — fill host width instead of fixed px. */
  readonly embedded?: boolean;
}

export function SidebarPanel({ embedded = false }: SidebarPanelProps) {
  const { activePanel, toggleSidebar, themePreference, layoutMode } = useLayoutStore();
  const isLight = themePreference === 'light';
  const isFloatingPanel = layoutMode === 'odyssey' || layoutMode === 'open';
  const navItem = getSidebarNavItem(activePanel);
  const panelTitle = getSidebarPanelTitle(activePanel);

  if (!SIDEBAR_PANEL_IDS.includes(activePanel)) {
    return null;
  }

  return (
    <motion.aside
      initial={embedded ? { opacity: 0 } : { width: 0, opacity: 0 }}
      animate={embedded
        ? { opacity: 1 }
        : { width: 'var(--layout-sidebar-effective-width)', opacity: 1 }}
      exit={embedded ? { opacity: 0 } : { width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      aria-label={panelTitle}
      className={`sidebar-panel-shell flex h-full min-w-0 flex-col overflow-hidden bg-[color:var(--sidebar-surface)] ${
        embedded ? 'w-full' : 'w-auto flex-shrink-0'
      } ${
        isFloatingPanel
          ? 'rounded-[var(--layout-radius)] border border-[color:var(--border)] shadow-[var(--layout-shadow)]'
          : 'border-r border-[color:var(--shell-line-soft)]'
      }`}
      style={embedded ? undefined : { width: 'var(--layout-sidebar-effective-width)', maxWidth: '100%' }}
    >
      <SidebarPanelHeader
        title={panelTitle}
        subtitle={navItem?.description}
        isLight={isLight}
        onCollapse={toggleSidebar}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <Suspense fallback={<PanelLoading />}>
          <SidebarPanelBody panel={activePanel} />
        </Suspense>
      </div>
    </motion.aside>
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
    renameConversation,
    startNewChat,
  } = useChatStore();
  const themePreference = useLayoutStore((state) => state.themePreference);
  const isLight = themePreference === 'light';
  const streamingConversationId = useChatStore((state) => state.streamingConversationId);
  const messageCount = useChatStore((state) => state.messages.length);
  const [sharedTask, setSharedTask] = useState<SharedWorkArtifact | null>(null);
  const [query, setQuery] = useState('');
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadPinnedChats());
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => loadIdSet(CHAT_ARCHIVED_STORAGE_KEY));
  const [showArchived, setShowArchived] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [manualOrder, setManualOrder] = useState<string[]>(() => loadConversationOrder());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [draggedConversationId, setDraggedConversationId] = useState<string | null>(null);
  const [dragOverConversationId, setDragOverConversationId] = useState<string | null>(null);
  // Two-stage delete: first click arms, second click (within the window) deletes.
  // A single stray click can no longer permanently destroy a conversation.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressSelectUntilRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const requestDelete = useCallback((conversationId: string): boolean => {
    if (confirmDeleteTimerRef.current) {
      clearTimeout(confirmDeleteTimerRef.current);
      confirmDeleteTimerRef.current = null;
    }
    if (confirmingDeleteId === conversationId) {
      setConfirmingDeleteId(null);
      return true;
    }
    setConfirmingDeleteId(conversationId);
    confirmDeleteTimerRef.current = setTimeout(() => setConfirmingDeleteId(null), 3000);
    return false;
  }, [confirmingDeleteId]);

  useEffect(() => () => {
    if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
  }, []);

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
    const controller = new AbortController();
    if (!activeConversationId) {
      setSharedTask(null);
      return () => controller.abort();
    }

    void fetchLatestSharedWorkArtifact(activeConversationId, controller.signal)
      .then((artifact) => setSharedTask(artifact))
      .catch(() => {
        if (!controller.signal.aborted) setSharedTask(null);
      });

    return () => controller.abort();
  }, [activeConversationId, messageCount, streamingConversationId]);

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

  const toggleArchived = useCallback((conversationId: string) => {
    setArchivedIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      saveIdSet(CHAT_ARCHIVED_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const beginRename = useCallback((id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameDraft(currentTitle);
    setContextMenu(null);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId) {
      const draft = renameDraft.trim();
      if (draft) void renameConversation(renamingId, draft);
    }
    setRenamingId(null);
    setRenameDraft('');
  }, [renamingId, renameDraft, renameConversation]);

  // Close the context menu on any outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

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
      if (archivedIds.has(conv.id)) {
        key = 'archived';
        label = 'Archived';
        order = 99;
      } else if (pinnedIds.has(conv.id)) {
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
  }, [filteredConversations, pinnedIds, archivedIds]);

  const archivedCount = useMemo(
    () => filteredConversations.filter((conv) => archivedIds.has(conv.id)).length,
    [filteredConversations, archivedIds],
  );

  const visibleGroups = useMemo(() => {
    if (query.trim()) {
      if (filteredConversations.length === 0) return [];
      return [{
        key: 'search-results',
        label: 'Matches',
        projectId: null,
        order: 0,
        items: filteredConversations,
      }];
    }
    // Hide the Archived group unless the user opts to show it.
    return showArchived ? grouped : grouped.filter((group) => group.key !== 'archived');
  }, [grouped, query, filteredConversations, showArchived]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Hold-to-combine: press a chat 250ms → glowing ghost → drop on another chat/project
  // → confirm → Vai + council merge both into a new project. Quick drags still reorder.
  const merge = useChatMergeDrag(conversations);

  return (
    <nav className="flex flex-col" aria-label="Conversations">
      <div className="flex-shrink-0 px-3 pb-2 pt-2">
        <button
          onClick={handleNewChat}
          className={`vai-new-chat-btn mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors ${
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
            className={`vai-side-search w-full rounded-md py-1.5 pl-8 pr-3 text-sm outline-none transition-colors ${
              isLight
                ? 'bg-zinc-200/55 text-zinc-900 placeholder-zinc-400 focus:bg-white'
                : 'bg-white/[0.035] text-zinc-100 placeholder-zinc-600 focus:bg-white/[0.055]'
            }`}
          />
        </div>
      </div>

      {sharedTask && <SharedWorkTask artifact={sharedTask} />}

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
            {!collapsed && group.items.map((conv) => {
              // Pin "Working…" to the chat that's ACTUALLY streaming, not whichever
              // chat is currently selected — so switching chats mid-turn doesn't move
              // the badge to the wrong conversation.
              const isWorking = isConversationWorking(conv.id, streamingConversationId);
              return (
              <div
                key={conv.id}
                data-conv-id={conv.id}
                // Native HTML5 drag stays OFF: it fires `dragstart` on the first move
                // and swallows the pointermove events the merge follower needs — the
                // cause of the "won't follow until I release" feel. Merge-drag owns the
                // full-row gesture now. (The drag handlers below are kept inert; reorder
                // by drag can return later via a dedicated handle.)
                draggable={false}
                onPointerDown={(event) => merge.onRowPointerDown(conv.id, event)}
                onDragStart={(event) => {
                  if (merge.isMergeDragging) { event.preventDefault(); return; }
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
                className={`vai-side-row group relative ml-3 flex items-center gap-2 rounded-md px-2 py-1.5 ${draggedConversationId === conv.id ? 'cursor-grabbing opacity-80' : 'cursor-grab'} ${conv.id === activeConversationId
                  ? isLight
                    ? 'bg-white text-zinc-950 shadow-sm'
                    : 'bg-white/[0.065] text-zinc-100'
                  : isLight
                    ? 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                    : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
                  } ${dragOverConversationId === conv.id ? 'bg-[color:var(--accent-soft)]' : ''} ${merge.mergeTargetId === conv.id ? 'vai-merge-target' : ''} ${merge.mergeSourceId === conv.id ? 'vai-merge-source' : ''}`}
                data-active={conv.id === activeConversationId || undefined}
                data-dragging={draggedConversationId === conv.id || undefined}
                title={conv.title}
                onClick={() => {
                  if (Date.now() < suppressSelectUntilRef.current) return;
                  if (Date.now() < merge.blockClicksUntil.current) return;
                  void selectConversation(conv.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ id: conv.id, x: e.clientX, y: e.clientY });
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
                      <span title="Code / build chat">
                        <Code2
                          aria-hidden
                          className={`h-3 w-3 shrink-0 ${isLight ? 'text-blue-600' : 'text-violet-400'}`}
                        />
                      </span>
                    )}
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      {renamingId === conv.id ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                            if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); setRenameDraft(''); }
                          }}
                          className={`min-w-0 flex-1 rounded border px-1 py-0.5 text-[13px] leading-tight outline-none ${
                            isLight
                              ? 'border-zinc-300 bg-white text-zinc-900'
                              : 'border-white/15 bg-zinc-900 text-zinc-100'
                          }`}
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-[13px] leading-tight">{conv.title}</span>
                      )}
                      {isWorking ? (
                        <span className="flex flex-shrink-0 items-center gap-1 text-[10px] font-medium text-[color:var(--accent-text)]">
                          <span aria-hidden className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--accent)] opacity-70" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
                          </span>
                          Working…
                        </span>
                      ) : (
                        <span className={`flex-shrink-0 text-[10px] tabular-nums ${isLight ? 'text-zinc-400' : 'text-zinc-600'}`}>
                          {formatRelative(conv.updatedAt)}
                        </span>
                      )}
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
                    if (requestDelete(conv.id)) void deleteConversation(conv.id);
                  }}
                  onMouseLeave={() => {
                    if (confirmingDeleteId === conv.id) setConfirmingDeleteId(null);
                  }}
                  draggable={false}
                  aria-label={confirmingDeleteId === conv.id ? `Confirm delete ${conv.title}` : `Delete ${conv.title}`}
                  title={confirmingDeleteId === conv.id ? 'Click again to delete' : 'Delete'}
                  className={`flex h-5 flex-shrink-0 items-center justify-center rounded transition-all group-hover:opacity-100 ${
                    confirmingDeleteId === conv.id
                      ? `w-auto gap-1 px-1.5 opacity-100 ${isLight ? 'bg-red-50 text-red-600' : 'bg-red-500/15 text-red-400'}`
                      : `w-5 opacity-0 ${isLight ? 'text-zinc-400 hover:bg-red-50 hover:text-red-500' : 'text-zinc-600 hover:bg-red-500/10 hover:text-red-400'}`
                  }`}
                >
                  <Trash2 className="h-3 w-3" />
                  {confirmingDeleteId === conv.id && (
                    <span className="text-[10px] font-medium leading-none">Sure?</span>
                  )}
                </button>
              </div>
              );
            })}
          </div>
          );
        })}

        {!query.trim() && archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={`mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
              isLight ? 'text-zinc-500 hover:bg-zinc-200/60' : 'text-zinc-500 hover:bg-white/[0.035]'
            }`}
          >
            <Archive className="h-3 w-3" />
            {showArchived ? 'Hide archived' : `Show ${archivedCount} archived`}
          </button>
        )}

        {filteredConversations.length === 0 && (
          <p className={`px-3 py-8 text-center text-xs ${isLight ? 'text-zinc-500' : 'text-zinc-600'}`}>
            {query.trim() ? 'No chats match that search yet.' : 'No conversations yet'}
          </p>
        )}
      </div>

      {contextMenu && (() => {
        const conv = conversations.find((c) => c.id === contextMenu.id);
        if (!conv) return null;
        const isPinned = pinnedIds.has(conv.id);
        const isArchived = archivedIds.has(conv.id);
        const itemClass = `flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
          isLight ? 'text-zinc-700 hover:bg-zinc-100' : 'text-zinc-300 hover:bg-white/[0.06]'
        }`;
        // Clamp x so a menu opened near the right edge stays on screen.
        const left = Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 0) - 184);
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ top: contextMenu.y, left }}
            className="vai-context-menu fixed z-50 w-44 overflow-hidden py-1"
          >
            <button className={itemClass} onClick={() => beginRename(conv.id, conv.title)}>
              <Pencil className="h-3.5 w-3.5 opacity-70" /> Rename
            </button>
            <button className={itemClass} onClick={() => { togglePinned(conv.id); setContextMenu(null); }}>
              {isPinned ? <PinOff className="h-3.5 w-3.5 opacity-70" /> : <Pin className="h-3.5 w-3.5 opacity-70" />}
              {isPinned ? 'Unpin' : 'Pin to top'}
            </button>
            <button className={itemClass} onClick={() => { toggleArchived(conv.id); setContextMenu(null); }}>
              {isArchived ? <ArchiveRestore className="h-3.5 w-3.5 opacity-70" /> : <Archive className="h-3.5 w-3.5 opacity-70" />}
              {isArchived ? 'Unarchive' : 'Archive'}
            </button>
            <div className={`my-1 h-px ${isLight ? 'bg-zinc-200' : 'bg-white/10'}`} />
            <button
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium transition-colors ${
                confirmingDeleteId === conv.id
                  ? isLight ? 'bg-red-50 text-red-700' : 'bg-red-500/15 text-red-300'
                  : isLight ? 'text-red-600 hover:bg-red-50' : 'text-red-400 hover:bg-red-500/10'
              }`}
              onClick={() => {
                if (requestDelete(conv.id)) {
                  void deleteConversation(conv.id);
                  setContextMenu(null);
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmingDeleteId === conv.id ? 'Click again to confirm' : 'Delete'}
            </button>
          </div>
        );
      })()}
      {merge.overlay}
      {merge.dialog}
    </nav>
  );
}

/* ── Dev Logs Panel ────────────────────────────────────────────── */

function DevLogsPanel() {
  return <SessionList embedded />;
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
    <div className="flex flex-col gap-4 p-3">
      <section className="rounded-xl border border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <Shield className="h-4 w-4 text-[color:var(--accent-text)]" aria-hidden />
          Owner control
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Signed in as {user?.email ?? 'owner'}. Runtime tools and training surfaces live here.
        </p>
      </section>

      <OwnerDashboardSection />

      <section aria-label="Owner actions" className="space-y-2">
        <ControlAction
          title="Hide owner features"
          description="Switch to user-view mode and collapse admin-only navigation."
          onClick={() => setOwnerFeaturesHidden(true)}
          tone="amber"
        />
        <ControlAction
          title="Open training chat"
          description="Start an isolated owner workspace for curating what may teach Vai."
          onClick={() => void handleStartTraining()}
          disabled={startingTraining}
          tone="emerald"
        />
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3" aria-label="Browser automation">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
          <Monitor className="h-3.5 w-3.5" aria-hidden />
          Automation browser
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          A ghost <code className="text-zinc-300">about:blank</code> Chrome icon on the taskbar is usually
          Cursor&apos;s agent browser (Browser MCP), not Vai Preview. It often cannot be focused with Win+Arrow.
          Close it from Cursor or end the agent turn. Playwright audits run headless by default —
          use <code className="text-zinc-300">VAI_AUDIT_HEADED=1 pnpm audit:live</code> only when you want a visible window.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          Dev Logs: <code className="text-zinc-400">pnpm devlogs:cursor:watch</code> (live) ·{' '}
          <code className="text-zinc-400">pnpm devlogs:cursor:resync</code> (full re-import if incomplete)
        </p>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400" aria-label="Runtime status">
        <h3 className="font-medium uppercase tracking-[0.18em] text-zinc-500">Runtime</h3>
        <dl className="mt-2 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <dt>Status</dt>
            <dd className="text-zinc-200">{status}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>Indexed documents</dt>
            <dd className="text-zinc-200">{stats?.documentsIndexed ?? 0}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3" aria-label="Scale evaluation runs">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Scale eval</h3>
          <span className="text-[11px] text-zinc-500">{scaleRuns.length} recent</span>
        </div>
        <ul className="mt-3 list-none space-y-2">
          {scaleRuns.length === 0 ? (
            <li className="rounded-lg border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-500">
              No scale-eval artifacts yet. Run <code className="text-zinc-400">pnpm vai:scale:eval --dry-run</code> for a smoke artifact.
            </li>
          ) : scaleRuns.map((run) => {
            const config = run.manifest?.config;
            const total = run.summary?.summary?.total ?? run.summary?.total ?? config?.n ?? 0;
            const failed = run.summary?.summary?.failed ?? run.summary?.failed ?? 0;
            return (
              <li key={run.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-medium text-zinc-200">{run.id}</span>
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                    {run.manifest?.status ?? 'unknown'}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {total} conversations · {failed} failed · builder {Math.round((config?.builderRate ?? 0) * 100)}%
                  {config?.dryRun ? ' · dry run' : ''}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/**
 * OwnerDashboardSection — V3gga's one-stop panel: watch the self-improvement loop's LIVE VIEW,
 * toggle voice (TTS read-aloud), and the commands to run the observe + visual eyes/hands loop.
 * The live frame is served by the watch server (self-improve:watch / operator watch). No heavy
 * work runs from here — it links the safe observe+visual lane (apply stays a deliberate switch).
 */
function OwnerDashboardSection() {
  const watchBase = OWNER_WATCH_BASE;
  const [frameOk, setFrameOk] = useState(false);
  const [adoptionBoard, setAdoptionBoard] = useState<ImprovementAdoptionBoard | null>(null);
  const [adoptionUnavailable, setAdoptionUnavailable] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const tts = useVoiceOutput(readAloud);
  const [tick, setTick] = useState(0);

  // Poll the live-frame freshness so the badge reflects whether a probe is actively driving.
  useEffect(() => {
    let on = true;
    const id = window.setInterval(async () => {
      try {
        const r = await fetch(`${watchBase}/live-frame.meta`, { cache: 'no-store' });
        const j = await r.json();
        if (on) { setFrameOk(j.ageMs != null && j.ageMs < 2500); setTick((t) => t + 1); }
      } catch { if (on) setFrameOk(false); }
    }, 1000);
    return () => { on = false; window.clearInterval(id); };
  }, [watchBase]);

  useEffect(() => {
    let on = true;
    const poll = async () => {
      try {
        const response = await fetch(`${watchBase}/adoption.json`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`adoption board ${response.status}`);
        const parsed = improvementAdoptionBoardSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error('invalid adoption board response');
        if (on) {
          setAdoptionBoard(parsed.data);
          setAdoptionUnavailable(false);
        }
      } catch {
        if (on) {
          setAdoptionBoard(null);
          setAdoptionUnavailable(true);
        }
      }
    };
    void poll();
    const id = window.setInterval(() => { void poll(); }, 5000);
    return () => { on = false; window.clearInterval(id); };
  }, [watchBase]);

  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3" aria-label="Owner dashboard">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
          <Eye className="h-3.5 w-3.5" aria-hidden /> Live view
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] ${frameOk ? 'bg-emerald-500/10 text-emerald-500' : 'bg-[color:var(--bg)] text-[color:var(--color-muted)]'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${frameOk ? 'bg-emerald-400' : 'bg-[color:var(--color-muted)]'}`} />
          {frameOk ? 'live' : 'idle'}
        </span>
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)]">
        {frameOk ? (
          <img src={`${watchBase}/live-frame.jpg?t=${tick}`} alt="live probe view" className="block w-full" />
        ) : (
          <div className="px-3 py-6 text-center text-[11px] text-[color:var(--color-muted)]">
            No live frame. Start the watcher: <code className="text-[color:var(--fg)]">pnpm self-improve:watch</code><br />
            then a probe: <code className="text-[color:var(--fg)]">pnpm self-improve:visual -- --live</code>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-[color:var(--color-muted)]">Voice (read answers aloud)</span>
        <button
          type="button"
          onClick={() => { if (readAloud) tts.cancel(); setReadAloud((v) => !v); }}
          disabled={!tts.available}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40 ${readAloud ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-[color:var(--border)] text-[color:var(--fg)] hover:bg-[color:var(--bg)]'}`}
          title={tts.available ? 'Toggle text-to-speech' : 'Speech synthesis unavailable here'}
        >
          {readAloud ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          {readAloud ? 'On' : 'Off'}
        </button>
      </div>
      {readAloud && tts.available && (
        <button
          type="button"
          onClick={() => tts.speak('Voice output is on. Vai will read answers aloud.')}
          className="mt-2 w-full rounded-lg border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--fg)] hover:bg-[color:var(--bg)]"
        >
          Test voice
        </button>
      )}

      <OwnerAdoptionBoard board={adoptionBoard} unavailable={adoptionUnavailable} />

      <p className="mt-3 text-[11px] leading-relaxed text-[color:var(--color-muted)]">
        Run the self-improvement loop (safe observe + visual eyes/hands, no source edits):<br />
        <code className="text-[color:var(--fg)]">pnpm self-improve:start -- --mode observe --visual-every 1</code>
      </p>
    </section>
  );
}

function ControlAction({
  title,
  description,
  onClick,
  disabled = false,
  tone,
}: {
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  tone: 'amber' | 'emerald';
}) {
  const toneClass = tone === 'amber'
    ? 'border-amber-500/20 bg-amber-500/10 hover:bg-amber-500/20'
    : 'border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-wait disabled:opacity-70 ${toneClass}`}
    >
      <div className="text-sm text-zinc-100">{title}</div>
      <div className="mt-1 text-xs text-zinc-500">{description}</div>
    </button>
  );
}

