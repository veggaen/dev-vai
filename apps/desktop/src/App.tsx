import { lazy, Suspense, useEffect, useRef } from 'react';
import { Toaster } from 'sonner';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { AnimatePresence, motion } from 'framer-motion';
import { ActivityRail } from './components/ActivityRail.js';
import { SidebarPanel } from './components/SidebarPanel.js';
import { QuickSwitch } from './components/QuickSwitch.js';
import { ChatWindow } from './components/ChatWindow.js';
import { useEngineStore } from './stores/engineStore.js';
import { useAuthStore } from './stores/authStore.js';
import { useChatStore } from './stores/chatStore.js';
import { useLayoutStore } from './stores/layoutStore.js';
import { useSandboxStore } from './stores/sandboxStore.js';
import { useSettingsStore } from './stores/settingsStore.js';
import { useVinextStore } from './stores/vinextStore.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { useAutoSandbox } from './hooks/useAutoSandbox.js';
import { VaiOverlaySystem } from './components/VaiOverlaySystem.js';
import { CursorFocusBox } from './components/CursorFocusBox.js';
import { SettingsDrawer } from './components/panels/SettingsDrawer.js';
import { AuthGate } from './components/AuthGate.js';
import { toast } from 'sonner';
import { isDevAuthBypassEnabled } from './lib/dev-auth-bypass.js';
import { applyThemePreference } from './lib/odysseus-theme.js';

const DebugConsole = lazy(async () => ({ default: (await import('./components/DebugConsole.js')).DebugConsole }));
const FileExplorer = lazy(async () => ({ default: (await import('./components/FileExplorer.js')).FileExplorer }));
const KnowledgePanel = lazy(async () => ({ default: (await import('./components/KnowledgePanel.js')).KnowledgePanel }));
const PreviewPanel = lazy(async () => ({ default: (await import('./components/PreviewPanel.js')).PreviewPanel }));
const SessionViewer = lazy(async () => ({ default: (await import('./components/SessionViewer.js')).SessionViewer }));
const ThorsenPanel = lazy(async () => ({ default: (await import('./components/ThorsenPanel.js')).ThorsenPanel }));
const VaiGym = lazy(async () => ({ default: (await import('./components/VaiGym.js')).VaiGym }));

/* ── Boot screen — shown only on first ever connection ── */
function BootScreen() {
  const { status, error, retry } = useEngineStore();

  return (
    <div className="flex min-h-0 items-center justify-center overflow-hidden bg-zinc-950" style={{ height: '100dvh' }}>
      <div className="text-center">
        <div className="relative mx-auto mb-4 h-16 w-16">
          <div className="absolute inset-0 animate-ping rounded-full bg-violet-500/20" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-blue-600 shadow-lg shadow-violet-500/25">
            <span className="text-2xl font-bold text-white">V</span>
          </div>
        </div>
        <h1 className="mb-1 font-display text-3xl font-bold text-zinc-100">Vai</h1>
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
              className="mt-2 touch-manipulation rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-violet-500/50 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
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

function PanelLoading() {
  return (
    <div className="layout-panel flex min-h-0 flex-1 items-center justify-center bg-[var(--shell-bg)] text-sm text-zinc-500">
      Loading workspace panel...
    </div>
  );
}

/* PanelControls removed — toggles moved to ActivityRail + PreviewPanel toolbar */

/* ── Main app ── */
export function App() {
  const { status, hasEverConnected, startPolling } = useEngineStore();
  const authEnabled = useAuthStore((state) => state.enabled);
  const authStatus = useAuthStore((state) => state.status);
  const isOwner = useAuthStore((state) => state.isOwner);
  const ownerFeaturesHidden = useAuthStore((state) => state.ownerFeaturesHidden);
  const bootstrap = useSettingsStore((state) => state.bootstrap);
  const models = useSettingsStore((state) => state.models);
  const frontends = useSettingsStore((state) => state.frontends);
  const startVinextPolling = useVinextStore((state) => state.startPolling);
  const stopVinextPolling = useVinextStore((state) => state.stopPolling);
  const syncState = useVinextStore((state) => state.syncState);
  const motionBudget = useVinextStore((state) => state.motionBudget);
  const trustLevel = useVinextStore((state) => state.trustLevel);
  const {
    showDebugConsole, showFileExplorer, showBuilderPanel,
    sidebarState, focusMode, previewExpanded, expandBuilder, view, activePanel,
    layoutMode, themePreference, updateScreenClass, screenClass,
  } = useLayoutStore();
  const { projectId, deployPhase, status: sandboxStatus } = useSandboxStore();
  const showOwnerFeatures = isOwner && !ownerFeaturesHidden;
  const devAuthBypassEnabled = isDevAuthBypassEnabled();
  const prevRevealPreviewRef = useRef(
    deployPhase === 'deploying'
      || sandboxStatus === 'creating'
      || sandboxStatus === 'writing'
      || sandboxStatus === 'installing'
      || sandboxStatus === 'building'
      || sandboxStatus === 'running',
  );

  useEffect(() => { startPolling(); }, [startPolling]);
  useEffect(() => {
    startVinextPolling();
    return () => stopVinextPolling();
  }, [startVinextPolling, stopVinextPolling]);
  useEffect(() => {
    void useSettingsStore.getState().fetchBootstrap().then((bootstrap) => {
      useAuthStore.getState().syncBootstrap(bootstrap?.auth);
      const defaultMode = useSettingsStore.getState().defaultConversationMode;
      useLayoutStore.getState().setMode(defaultMode);
      return useAuthStore.getState().fetchSession();
    });
  }, []);
  useEffect(() => {
    if (status !== 'ready') return;
    if (bootstrap && models.length > 0 && frontends.length > 0) return;

    void useSettingsStore.getState().fetchBootstrap().then((nextBootstrap) => {
      useAuthStore.getState().syncBootstrap(nextBootstrap?.auth);
      return useAuthStore.getState().fetchSession();
    });
  }, [bootstrap, frontends.length, models.length, status]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

    const seenVersionKey = 'vai-last-seen-app-version';
    void import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((version) => {
        const previousVersion = localStorage.getItem(seenVersionKey);
        if (previousVersion && previousVersion !== version) {
          toast.success(`VeggaAI updated to ${version}`);
        }
        localStorage.setItem(seenVersionKey, version);
      })
      .catch(() => {
        /* native version lookup is best effort */
      });
  }, []);
  useKeyboardShortcuts();
  useAutoSandbox();

  // URL-param QA trigger: ?qa=build | ?qa=run | ?qa=verify
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qaMode = params.get('qa');
    if (!qaMode) return;
    // Wait for app to settle, then trigger
    const timer = setTimeout(() => {
      const globals = window as unknown as Record<string, unknown>;
      const loadAutomation = globals.__vai_load_automation as (() => Promise<void>) | undefined;
      void loadAutomation?.().then(() => {
        const qa = globals.__vai_qa as
          { run?: () => unknown; build?: () => unknown; verify?: () => unknown } | undefined;
        if (!qa) return;
        if (qaMode === 'build' && qa.build) qa.build();
        else if (qaMode === 'verify' && qa.verify) qa.verify();
        else if (qa.run) qa.run();
        // Clean URL param so it doesn't re-trigger on HMR
        const url = new URL(window.location.href);
        url.searchParams.delete('qa');
        window.history.replaceState({}, '', url.toString());
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

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

  const themeSwitchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousTheme = useRef(themePreference);
  useEffect(() => {
    // Cross-fade colors during a theme flip (see [data-theme-switching] in index.css).
    applyThemePreference(themePreference);
    if (previousTheme.current !== themePreference) {
      previousTheme.current = themePreference;
      document.documentElement.setAttribute('data-theme-switching', 'true');
      if (themeSwitchTimer.current) clearTimeout(themeSwitchTimer.current);
      themeSwitchTimer.current = setTimeout(() => {
        document.documentElement.removeAttribute('data-theme-switching');
      }, 350);
    }
  }, [themePreference]);

  const hasActiveSandbox = projectId !== null;
  const canShowConsole = hasActiveSandbox || sandboxStatus === 'failed';

  useEffect(() => {
    const previewActive = deployPhase === 'deploying'
      || deployPhase === 'ready'
      || sandboxStatus === 'creating'
      || sandboxStatus === 'writing'
      || sandboxStatus === 'installing'
      || sandboxStatus === 'building'
      || sandboxStatus === 'running';

    prevRevealPreviewRef.current = previewActive;
  }, [deployPhase, sandboxStatus]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    let cancelled = false;
    const poll = async () => {
      try {
        const opened = await useSandboxStore.getState().pollDesktopHandoff();
        if (opened && !cancelled) {
          toast.success('Opened project from web handoff intent');
        }
      } catch {
        /* best effort */
      }
    };

    void poll();
    const interval = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authStatus]);

  useEffect(() => {
    const privilegedPanels = new Set(['control', 'devlogs', 'knowledge', 'vaigym', 'thorsen']);

    if (privilegedPanels.has(activePanel) && !showOwnerFeatures) {
      useLayoutStore.getState().setActivePanel('settings');
      return;
    }

    if (!isOwner || !ownerFeaturesHidden) {
      return;
    }

    if (activePanel === 'control') {
      useLayoutStore.getState().setActivePanel('settings');
    }

    const chatState = useChatStore.getState();
    if (chatState.trainingWorkspace || chatState.learningEnabled) {
      chatState.setLearningEnabled(false);
      chatState.setTrainingWorkspace(false);
    }
  }, [activePanel, isOwner, ownerFeaturesHidden, showOwnerFeatures]);

  // Only show full-screen boot if we've NEVER connected before
  if (!hasEverConnected && status !== 'ready') {
    return <BootScreen />;
  }

  if (authEnabled && authStatus !== 'authenticated' && !devAuthBypassEnabled) {
    return <AuthGate />;
  }

  const isReconnecting = status === 'reconnecting' || status === 'offline';
  const isPhoneViewport = screenClass === 'phone';
  const showRail = !isPhoneViewport && sidebarState !== 'hidden' && !focusMode && !previewExpanded;
  const showPanel = !isPhoneViewport && sidebarState === 'expanded' && !focusMode && !previewExpanded;
  const showBuilderWorkspace = showBuilderPanel && (!isPhoneViewport || previewExpanded);

  // DevLogs view — activated when sidebar panel is 'devlogs'
  const isDevLogsView = view === 'devlogs' || activePanel === 'devlogs';
  const isSettingsOpen = activePanel === 'settings';

  return (
    <>
      <Toaster
        position="bottom-right"
        theme={themePreference === 'light' ? 'light' : 'dark'}
        toastOptions={{
          className: themePreference === 'light'
            ? 'bg-white/95 border-zinc-200 text-zinc-900 backdrop-blur-md'
            : 'bg-zinc-900/95 border-zinc-800 text-zinc-100 backdrop-blur-md',
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
        data-theme={themePreference}
        data-thorsen-sync={syncState}
        data-vinext-motion={motionBudget}
        data-vinext-trust={trustLevel}
        className="relative isolate flex min-h-0 min-w-0 flex-col overflow-hidden bg-[color:var(--app-chrome-background)]"
        style={{
          padding: 'var(--layout-margin)',
          paddingTop: `calc(var(--layout-margin) + var(--safe-top))`,
          paddingBottom: `calc(var(--layout-margin) + var(--safe-bottom))`,
          paddingLeft: `calc(var(--layout-margin) + var(--safe-left))`,
          paddingRight: `calc(var(--layout-margin) + var(--safe-right))`,
          height: `calc(100dvh - var(--safe-top) - var(--safe-bottom))`,
        }}
      >
        <div aria-hidden className="shell-atmosphere" />

        <div className="builder-shell-surface relative z-[1] flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Reconnecting bar */}
          <AnimatePresence>
            {isReconnecting && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-b border-amber-800/30 bg-amber-900/20 px-3 py-1 text-xs text-amber-300"
              >
                <div className="flex items-center justify-center gap-2 overflow-hidden">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                  Reconnecting to AI engine...
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" style={{ gap: 'var(--layout-gap)' }}>
          {/* Activity Rail — always visible unless hidden/focus */}
          {showRail && (
            <div className="layout-panel layout-panel--rail">
              <ActivityRail />
            </div>
          )}

          {/* Settings drawer — ~80% width + click-outside backdrop */}
          <AnimatePresence mode="popLayout">
            {isSettingsOpen && (
              <div className="layout-panel flex min-h-0 min-w-0 flex-1 overflow-hidden" key="settings-drawer-wrap">
                <SettingsDrawer />
              </div>
            )}
          </AnimatePresence>

          {/* Sidebar Panel — only in expanded state (not for settings) */}
          <AnimatePresence mode="popLayout">
            {showPanel && !isSettingsOpen && (
              <div className="layout-panel" key="sidebar-panel-wrap">
                <SidebarPanel key="sidebar-panel" />
              </div>
            )}
          </AnimatePresence>

          {/* Main content area — hidden while settings drawer is open */}
          <Suspense fallback={<PanelLoading />}>
          {!isSettingsOpen && (isDevLogsView && showPanel ? (
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
                  defaultSize={showBuilderWorkspace ? '55' : '100'}
                  minSize="30"
                >
                  <ChatWindow />
                </Panel>
                )}

                {/* ── Builder panel — collapsible right side, or full width when expanded ── */}
                {showBuilderWorkspace && (
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
                        <Panel id="preview" defaultSize={canShowConsole && showDebugConsole ? '55' : '100'} minSize="20">
                          <PreviewPanel />
                        </Panel>

                        {/* Console — bottom section when active */}
                        {canShowConsole && showDebugConsole && (
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
          ))}
          </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}
