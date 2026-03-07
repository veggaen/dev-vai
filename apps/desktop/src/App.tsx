import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { AnimatePresence, motion } from 'framer-motion';
import { ActivityRail } from './components/ActivityRail.js';
import { SidebarPanel } from './components/SidebarPanel.js';
import { QuickSwitch } from './components/QuickSwitch.js';
import { ChatWindow } from './components/ChatWindow.js';
import { PreviewPanel } from './components/PreviewPanel.js';
import { DebugConsole } from './components/DebugConsole.js';
import { SessionViewer } from './components/SessionViewer.js';
import { KnowledgePanel } from './components/KnowledgePanel.js';
import { VaiGym } from './components/VaiGym.js';
import { ThorsenPanel } from './components/ThorsenPanel.js';
import { useEngineStore } from './stores/engineStore.js';
import { useLayoutStore } from './stores/layoutStore.js';
import { useSandboxStore } from './stores/sandboxStore.js';
import { useSettingsStore } from './stores/settingsStore.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { useAutoSandbox } from './hooks/useAutoSandbox.js';
import { FileExplorer } from './components/FileExplorer.js';
import { VaiOverlaySystem } from './components/VaiOverlaySystem.js';
import { LayoutModeToggle } from './components/LayoutModeToggle.js';
import { CursorFocusBox } from './components/CursorFocusBox.js';

/* ── Boot screen — shown only on first ever connection ── */
function BootScreen() {
  const { status, error, retry } = useEngineStore();

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <div className="text-center">
        <div className="relative mx-auto mb-4 h-16 w-16">
          <div className="absolute inset-0 animate-ping rounded-full bg-violet-500/20" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-blue-600 shadow-lg shadow-violet-500/25">
            <span className="text-2xl font-bold text-white">V</span>
          </div>
        </div>
        <h1 className="mb-1 text-3xl font-bold text-zinc-100">VeggaAI</h1>
        <p className="mb-6 text-sm text-zinc-500">Type. Create. Ship.</p>

        {(status === 'starting' || status === 'idle') && (
          <div className="space-y-3">
            <div className="mx-auto h-1 w-48 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full animate-[shimmer_1.5s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-violet-500 via-blue-500 to-violet-500 bg-[length:200%_100%]" />
            </div>
            <p className="text-xs text-zinc-500">Warming up the engine...</p>
          </div>
        )}

        {(status === 'error' || status === 'offline') && (
          <div className="space-y-3">
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-zinc-500">
              Run <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">pnpm dev:web</code> to start
            </p>
            <button
              onClick={retry}
              className="mt-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-all hover:border-violet-500/50 hover:bg-zinc-800 hover:shadow-lg hover:shadow-violet-500/10"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Resize handle — subtle 1px border between panels ── */
function ResizeHandle({ direction = 'vertical' }: { direction?: 'vertical' | 'horizontal' }) {
  const isVertical = direction === 'vertical';
  return (
    <Separator
      className={`group relative flex items-center justify-center ${
        isVertical
          ? 'w-[3px] cursor-col-resize'
          : 'h-[3px] cursor-row-resize'
      } transition-colors`}
    >
      <div
        className={`transition-colors bg-zinc-800 group-hover:bg-violet-500/50 group-active:bg-violet-400/60 ${
          isVertical ? 'h-full w-px' : 'w-full h-px'
        }`}
      />
    </Separator>
  );
}

/* PanelControls removed — toggles moved to ActivityRail + PreviewPanel toolbar */

/* ── Main app ── */
export function App() {
  const { status, hasEverConnected, startPolling } = useEngineStore();
  const {
    showDebugConsole, showFileExplorer, showBuilderPanel,
    sidebarState, focusMode, previewExpanded, expandBuilder, view, activePanel,
    layoutMode, updateScreenClass,
  } = useLayoutStore();
  const { projectId, deployPhase } = useSandboxStore();

  useEffect(() => { startPolling(); }, [startPolling]);
  useEffect(() => { useSettingsStore.getState().fetchModels(); }, []);
  useKeyboardShortcuts();
  useAutoSandbox();

  // Listen for viewport resize / orientation changes
  useEffect(() => {
    const handler = () => updateScreenClass();
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    // Also listen to matchMedia for more precise breakpoints
    const mq = window.matchMedia('(min-width: 3000px)');
    mq.addEventListener('change', handler);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
      mq.removeEventListener('change', handler);
    };
  }, [updateScreenClass]);

  const hasActiveSandbox = projectId !== null;

  // Auto-expand builder when a deploy starts
  useEffect(() => {
    if (deployPhase === 'deploying' || deployPhase === 'ready') {
      expandBuilder();
    }
  }, [deployPhase, expandBuilder]);

  // Only show full-screen boot if we've NEVER connected before
  if (!hasEverConnected && status !== 'ready') {
    return <BootScreen />;
  }

  const isReconnecting = status === 'reconnecting' || status === 'offline';
  const showRail = sidebarState !== 'hidden' && !focusMode && !previewExpanded;
  const showPanel = sidebarState === 'expanded' && !focusMode && !previewExpanded;

  // DevLogs view — activated when sidebar panel is 'devlogs'
  const isDevLogsView = view === 'devlogs' || activePanel === 'devlogs';

  return (
    <>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          className: 'bg-zinc-900/95 border-zinc-800 text-zinc-100 backdrop-blur-md',
        }}
      />

      {/* Quick Switch overlay */}
      <QuickSwitch />

      {/* Vai AI cursor + overlays — covers entire viewport */}
      <VaiOverlaySystem />

      {/* Cursor focus box — follows mouse, highlights interactive elements */}
      <CursorFocusBox />

      {/* Layout mode toggle — rendered inside ChatWindow toolbar */}

      <div
        id="layout-root"
        data-layout-mode={layoutMode}
        className="flex h-screen flex-col bg-zinc-950"
        style={{
          padding: 'var(--layout-margin)',
          paddingTop: `calc(var(--layout-margin) + var(--safe-top))`,
          paddingBottom: `calc(var(--layout-margin) + var(--safe-bottom))`,
          paddingLeft: `calc(var(--layout-margin) + var(--safe-left))`,
          paddingRight: `calc(var(--layout-margin) + var(--safe-right))`,
          height: `calc(100vh - var(--safe-top) - var(--safe-bottom))`,
        }}
      >
        {/* Reconnecting bar */}
        <AnimatePresence>
          {isReconnecting && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex items-center justify-center gap-2 overflow-hidden bg-amber-900/20 px-3 py-1 text-xs text-amber-300 border-b border-amber-800/30"
            >
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              Reconnecting to AI engine...
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-1 min-h-0" style={{ gap: 'var(--layout-gap)' }}>
          {/* Activity Rail — always visible unless hidden/focus */}
          {showRail && (
            <div className="layout-panel">
              <ActivityRail />
            </div>
          )}

          {/* Sidebar Panel — only in expanded state */}
          <AnimatePresence mode="popLayout">
            {showPanel && (
              <div className="layout-panel" key="sidebar-panel-wrap">
                <SidebarPanel key="sidebar-panel" />
              </div>
            )}
          </AnimatePresence>

          {/* Main content area */}
          {isDevLogsView && showPanel ? (
            /* Dev Logs: session viewer fills the main area */
            <div className="layout-panel flex-1 min-w-0">
              <SessionViewer />
            </div>
          ) : activePanel === 'knowledge' && showPanel ? (
            /* Knowledge Base: full view fills main area */
            <div className="layout-panel flex-1 min-w-0">
              <KnowledgePanel onClose={() => useLayoutStore.getState().setActivePanel('chats')} />
            </div>
          ) : view === 'vaigym' ? (
            /* Vai Training Gymnasium: fills entire main area */
            <div className="layout-panel flex-1 min-w-0">
              <VaiGym />
            </div>
          ) : view === 'thorsen' ? (
            /* Thorsen Wormhole: intent → artifact pipeline */
            <div className="layout-panel flex-1 min-w-0">
              <ThorsenPanel />
            </div>
          ) : (
            <div className="layout-panel relative flex-1 min-w-0">

              <Group id="vai-main-layout" orientation="horizontal">
                {/* ── Chat panel — hidden when preview is expanded ── */}
                {!previewExpanded && (
                <Panel
                  id="chat"
                  defaultSize={showBuilderPanel ? '55' : '100'}
                  minSize="30"
                >
                  <ChatWindow />
                </Panel>
                )}

                {/* ── Builder panel — collapsible right side, or full width when expanded ── */}
                {showBuilderPanel && (
                  <>
                    {!previewExpanded && <ResizeHandle direction="vertical" />}
                    <Panel
                      id="builder"
                      defaultSize={previewExpanded ? '100' : '45'}
                      minSize={previewExpanded ? '100' : '25'}
                      collapsible={!previewExpanded}
                    >
                      <Group id="vai-builder-layout" orientation="vertical">
                        {/* File explorer — top section when active */}
                        {hasActiveSandbox && showFileExplorer && (
                          <>
                            <Panel
                              id="files"
                              defaultSize="25"
                              minSize="10"
                              collapsible
                            >
                              <FileExplorer />
                            </Panel>
                            <ResizeHandle direction="horizontal" />
                          </>
                        )}

                        {/* Preview — main section */}
                        <Panel id="preview" defaultSize={hasActiveSandbox && showDebugConsole ? '55' : '100'} minSize="20">
                          <PreviewPanel />
                        </Panel>

                        {/* Console — bottom section when active */}
                        {hasActiveSandbox && showDebugConsole && (
                          <>
                            <ResizeHandle direction="horizontal" />
                            <Panel
                              id="console"
                              defaultSize="30"
                              minSize="10"
                              collapsible
                            >
                              <DebugConsole />
                            </Panel>
                          </>
                        )}
                      </Group>
                    </Panel>
                  </>
                )}
              </Group>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
