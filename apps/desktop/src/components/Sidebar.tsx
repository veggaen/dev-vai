import { useEffect, useState } from 'react';
import { useChatStore } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useEngineStore } from '../stores/engineStore.js';
import { BuildStatusBadge } from './BuildStatusBadge.js';
import { SidebarSearch } from './SidebarSearch.js';
import { Search } from 'lucide-react';

export function Sidebar() {
  const {
    conversations,
    activeConversationId,
    fetchConversations,
    selectConversation,
    deleteConversation,
  } = useChatStore();

  const { models, selectedModelId, setSelectedModelId, fetchModels } =
    useSettingsStore();
  const { status: engineStatus, stats } = useEngineStore();
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    fetchModels();
    fetchConversations();
  }, []);

  // Ctrl+F in sidebar opens search
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const handleNewChat = () => {
    useChatStore.setState({ activeConversationId: null, messages: [] });
  };

  const handleSelectConversation = (id: string) => {
    selectConversation(id);
  };

  return (
    <div className="flex h-full w-64 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Header + Engine Status */}
      <div className="border-b border-zinc-800 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-zinc-100">VeggaAI</h1>
          <div className="flex items-center gap-2">
            <BuildStatusBadge />
            <div className="flex items-center space-x-1.5">
              <span className={`h-2 w-2 rounded-full ${
                engineStatus === 'ready' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]' :
                engineStatus === 'offline' ? 'bg-red-500 animate-pulse' :
                engineStatus === 'starting' ? 'bg-yellow-500 animate-pulse' :
                'bg-zinc-600'
              }`} />
              <span className={`text-xs ${
                engineStatus === 'ready' ? 'text-emerald-400' :
                engineStatus === 'offline' ? 'text-red-400' :
                engineStatus === 'starting' ? 'text-yellow-400' :
                'text-zinc-500'
              }`}>
                {engineStatus === 'ready' ? 'AI Online' :
                 engineStatus === 'offline' ? 'Offline' :
                 engineStatus === 'starting' ? 'Starting...' :
                 engineStatus === 'error' ? 'Error' : 'Idle'}
              </span>
            </div>
          </div>
        </div>
        {engineStatus === 'ready' && stats && (
          <p className="mt-1 text-xs text-zinc-500">
            {stats.vocabSize} words | {stats.knowledgeEntries} entries | {stats.documentsIndexed} docs
          </p>
        )}
        {engineStatus === 'offline' && (
          <p className="mt-1 text-xs text-red-400/70">Engine disconnected — restart with pnpm dev:web</p>
        )}
      </div>

      {/* Search + New Chat row */}
      <div className="flex items-center gap-2 p-3">
        <button
          onClick={handleNewChat}
          className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          + New Chat
        </button>
        <button
          onClick={() => setShowSearch((v) => !v)}
          className={`rounded-lg border p-2 transition-colors ${
            showSearch
              ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
              : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
          }`}
          title="Search chats (Ctrl+Shift+F)"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Search panel */}
      {showSearch && (
        <SidebarSearch
          onSelectConversation={(id) => {
            handleSelectConversation(id);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-3">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group mb-1 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              conv.id === activeConversationId
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
            onClick={() => handleSelectConversation(conv.id)}
          >
            <span className="truncate">{conv.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteConversation(conv.id);
              }}
              className="hidden text-zinc-600 hover:text-red-400 group-hover:block"
            >
              x
            </button>
          </div>
        ))}
      </div>

      {/* Model Selector */}
      <div className="border-t border-zinc-800 p-3">
        <label className="mb-1 block text-xs text-zinc-500">Model</label>
        <select
          value={selectedModelId ?? ''}
          onChange={(e) => setSelectedModelId(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
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
