import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, Clock, MessageSquare, ChevronLeft,
  BookOpen, Globe, Search as SearchIcon, ExternalLink,
} from 'lucide-react';
import { useChatStore } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useEngineStore } from '../stores/engineStore.js';
import { useLayoutStore, type SidebarPanel as PanelType } from '../stores/layoutStore.js';
import { SidebarSearch } from './SidebarSearch.js';
import { SessionList } from './SessionList.js';
import { BuildStatusBadge } from './BuildStatusBadge.js';
import { DockerPanel } from './DockerPanel.js';
import { API_BASE } from '../lib/api.js';

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
  devlogs: 'Dev Logs',
  knowledge: 'Knowledge Base',
  docker: 'Docker Sandboxes',
  search: 'Search',
  settings: 'Settings',
  vaigym: 'Vai Gymnasium',
  thorsen: 'Thorsen Wormhole',
};

/* ── Main Panel ────────────────────────────────────────────────── */

export function SidebarPanel() {
  const { activePanel, toggleSidebar } = useLayoutStore();

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 264, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="flex h-full flex-shrink-0 flex-col overflow-hidden border-r border-zinc-800/60 bg-zinc-950"
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
        {activePanel === 'devlogs' && <DevLogsPanel />}
        {activePanel === 'knowledge' && <KnowledgeSidePanel />}
        {activePanel === 'docker' && <DockerPanel />}
        {activePanel === 'search' && <SearchPanel />}
        {activePanel === 'settings' && <SettingsPanel />}
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
  } = useChatStore();

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleNewChat = () => {
    useChatStore.setState({ activeConversationId: null, messages: [] });
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
                className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                  conv.id === activeConversationId
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
  const { models, selectedModelId, setSelectedModelId, fetchModels } =
    useSettingsStore();
  const { status: engineStatus, stats } = useEngineStore();

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* Engine status card */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">Engine</span>
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                engineStatus === 'ready'
                  ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                  : engineStatus === 'offline'
                    ? 'bg-red-500 animate-pulse'
                    : engineStatus === 'starting'
                      ? 'bg-yellow-500 animate-pulse'
                      : 'bg-zinc-600'
              }`}
            />
            <span
              className={`text-xs ${
                engineStatus === 'ready'
                  ? 'text-emerald-400'
                  : engineStatus === 'offline'
                    ? 'text-red-400'
                    : 'text-zinc-500'
              }`}
            >
              {engineStatus === 'ready'
                ? 'Online'
                : engineStatus === 'offline'
                  ? 'Offline'
                  : engineStatus === 'starting'
                    ? 'Starting...'
                    : 'Idle'}
            </span>
          </div>
        </div>
        {engineStatus === 'ready' && stats && (
          <div className="space-y-1 text-xs text-zinc-600">
            <div className="flex justify-between">
              <span>Vocabulary</span>
              <span className="text-zinc-400">{stats.vocabSize.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Knowledge</span>
              <span className="text-zinc-400">{stats.knowledgeEntries.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Documents</span>
              <span className="text-zinc-400">{stats.documentsIndexed.toLocaleString()}</span>
            </div>
          </div>
        )}
        {engineStatus === 'offline' && (
          <p className="text-[10px] text-red-400/70">
            Run <code className="rounded bg-zinc-800 px-1 text-zinc-300">pnpm dev:web</code>
          </p>
        )}
      </div>

      {/* Build status */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-2 text-xs font-medium text-zinc-400">Build</div>
        <BuildStatusBadge />
      </div>

      {/* Model selector */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">
          Model
        </label>
        <select
          value={selectedModelId ?? ''}
          onChange={(e) => setSelectedModelId(e.target.value)}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition-colors focus:border-violet-500/50 focus:outline-none"
        >
          {models.length === 0 && (
            <option value="">No models available</option>
          )}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>
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
      .catch(() => {});
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
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                s.sourceType === 'youtube' ? 'bg-red-500' :
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
