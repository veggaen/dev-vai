import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { ChatWindow } from './components/ChatWindow.js';
import { KnowledgePanel } from './components/KnowledgePanel.js';
import { useEngineStore } from './stores/engineStore.js';

function BootScreen() {
  const { status, error, retry } = useEngineStore();

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <div className="text-center">
        <h1 className="mb-2 text-4xl font-bold text-zinc-100">VeggaAI</h1>
        <p className="mb-6 text-sm text-zinc-500">Local-first AI that learns from you</p>

        {status === 'starting' && (
          <div className="space-y-3">
            <div className="mx-auto h-1 w-48 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-500" />
            </div>
            <p className="text-sm text-zinc-400">Starting AI engine...</p>
          </div>
        )}

        {status === 'idle' && (
          <p className="text-sm text-zinc-400">Connecting...</p>
        )}

        {(status === 'error' || status === 'offline') && (
          <div className="space-y-3">
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-zinc-500">
              Make sure the server is running: <code className="rounded bg-zinc-800 px-1.5 py-0.5">pnpm dev:web</code>
            </p>
            <button
              onClick={retry}
              className="mt-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              Retry Connection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function App() {
  const { status, startPolling } = useEngineStore();
  const [view, setView] = useState<'chat' | 'knowledge'>('chat');

  useEffect(() => { startPolling(); }, [startPolling]);

  if (status !== 'ready') {
    return <BootScreen />;
  }

  return (
    <div className="flex h-screen bg-zinc-950">
      <Sidebar onViewChange={setView} currentView={view} />
      {view === 'chat' ? (
        <ChatWindow />
      ) : (
        <KnowledgePanel onClose={() => setView('chat')} />
      )}
    </div>
  );
}
