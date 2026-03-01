import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from 'sonner';
import { Sidebar } from './components/Sidebar.js';
import { ChatWindow } from './components/ChatWindow.js';
import { KnowledgePanel } from './components/KnowledgePanel.js';
import { LandingPage } from './components/LandingPage.js';
import { BuilderLayout } from './components/BuilderLayout.js';
import { useEngineStore } from './stores/engineStore.js';
import { useLayoutStore } from './stores/layoutStore.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';

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

const pageVariants = {
  enter: { opacity: 0, y: 12 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
};

export function App() {
  const { status, startPolling } = useEngineStore();
  const { view } = useLayoutStore();

  useEffect(() => { startPolling(); }, [startPolling]);
  useKeyboardShortcuts();

  if (status !== 'ready') {
    return <BootScreen />;
  }

  return (
    <>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          className: 'bg-zinc-900 border-zinc-800 text-zinc-100',
        }}
      />

      <AnimatePresence mode="wait">
        {view === 'landing' && (
          <motion.div
            key="landing"
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
            className="h-screen"
          >
            <LandingPage />
          </motion.div>
        )}

        {view === 'chat' && (
          <motion.div
            key="chat"
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
            className="flex h-screen bg-zinc-950"
          >
            <Sidebar />
            <ChatWindow />
          </motion.div>
        )}

        {view === 'builder' && (
          <motion.div
            key="builder"
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
            className="h-screen"
          >
            <BuilderLayout />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
