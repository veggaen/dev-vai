import { useEffect } from 'react';
import { useChatStore } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';

export function Sidebar() {
  const {
    conversations,
    activeConversationId,
    fetchConversations,
    createConversation,
    selectConversation,
    deleteConversation,
  } = useChatStore();

  const { models, selectedModelId, setSelectedModelId, fetchModels } =
    useSettingsStore();

  useEffect(() => {
    fetchModels();
    fetchConversations();
  }, []);

  const handleNewChat = async () => {
    if (!selectedModelId) return;
    await createConversation(selectedModelId);
  };

  return (
    <div className="flex h-full w-64 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="border-b border-zinc-800 p-4">
        <h1 className="text-lg font-bold text-zinc-100">VeggaAI</h1>
        <p className="text-xs text-zinc-500">Local-first AI assistant</p>
      </div>

      {/* New Chat */}
      <div className="p-3">
        <button
          onClick={handleNewChat}
          disabled={!selectedModelId}
          className="w-full rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          + New Chat
        </button>
      </div>

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
            onClick={() => selectConversation(conv.id)}
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
