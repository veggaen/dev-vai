import { lazy, Suspense, useEffect, useRef } from 'react';
import { Toaster } from 'sonner';

import { AnimatePresence, motion } from 'framer-motion';
import { ActivityRail } from './components/ActivityRail.js';
import { SidebarPanel } from './components/SidebarPanel.js';
import { QuickSwitch } from './components/QuickSwitch.js';
import { OpenFolderDialog } from './components/OpenFolderDialog.js';
import { ChatWindow } from './components/ChatWindow.js';
import { useEngineStore } from './stores/engineStore.js';
import { useAuthStore } from './stores/authStore.js';
import { useChatStore } from './stores/chatStore.js';
import { useLayoutStore } from './stores/layoutStore.js';
import { useSandboxStore } from './stores/sandboxStore.js';
import { useWorkspaceStore } from './stores/workspaceStore.js';
import { useSettingsStore } from './stores/settingsStore.js';
import { useVinextStore } from './stores/vinextStore.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { useAutoSandbox } from './hooks/useAutoSandbox.js';
import { useWorkspaceIde } from './hooks/useWorkspaceIde.js';
import { VaiOverlaySystem } from './components/VaiOverlaySystem.js';
import { GlobalDictation } from './components/chat/GlobalDictationOverlay.js';
import { IdeWorkspacePanel } from './components/ide/IdeWorkspacePanel.js';
import { CursorFocusBox } from './components/CursorFocusBox.js';
import { TitleBar } from './components/TitleBar.js';
import { KnowledgeGraphView } from './components/KnowledgeGraphView.js';
import { TopCommandBar } from './components/shell/TopCommandBar.js';
import { DockRail } from './components/shell/DockRail.js';
import { initPopoutMainWindow } from './stores/popoutStore.js';
import { SettingsDrawer } from './components/panels/SettingsDrawer.js';
import { AuthGate } from './components/AuthGate.js';
import { toast } from 'sonner';
import { isDevAuthBypassEnabled } from './lib/dev-auth-bypass.js';
import { applyThemeById, getActiveThemeId } from './lib/odysseus-theme.js';
import { VaiMark } from './components/brand/VaiMark.js';


const KnowledgePanel = lazy(async () => ({ default: (await import('./components/KnowledgePanel.js')).KnowledgePanel }));

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
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900 shadow-lg shadow-violet-500/25 ring-1 ring-white/10">
            <VaiMark size={34} animated />
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

import { ShellSidebarLayout } from './components/shell/ShellSidebarLayout.js';
import { MainWorkspaceLayout } from './components/shell/MainWorkspaceLayout.js';

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
    showBuilderPanel,
    sidebarState, focusMode, previewExpanded, view, activePanel,
    layoutMode, themePreference, updateScreenClass, screenClass,
  } = useLayoutStore();
  const { deployPhase, status: sandboxStatus } = useSandboxStore();
  const activeConversationId = useChatStore((s) => s.activeConversationId);
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
  useWorkspaceIde();

  useEffect(() => {
    void useWorkspaceStore.getState().bindConversation(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    const openVoiceSettings = () => {
      try { sessionStorage.setItem('vai-settings-tab', 'voice'); } catch { /* non-fatal */ }
      useLayoutStore.setState({
        activePanel: 'settings',
        sidebarState: 'rail',
        showSidebar: true,
        view: 'chat',
      });
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('vai:settings-open-tab', { detail: 'voice' }));
      }, 0);
    };
    window.addEventListener('vai:open-voice-settings', openVoiceSettings);
    return () => window.removeEventListener('vai:open-voice-settings', openVoiceSettings);
  }, []);

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

  // Theme switching is handled at the action source (layoutStore /
  // SettingsPanel) inside a View Transition so vars + attributes flip in one
  // visual snapshot. Here we only hydrate the persisted theme on mount.
  useEffect(() => {
    applyThemeById(getActiveThemeId());
  }, []);

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
    let idleStreak = 0;
    let timer: number | undefined;
    let abortCtrl: AbortController | null = null;

    const schedule = (ms: number) => {
      if (cancelled) return;
      timer = window.setTimeout(() => { void tick(); }, ms);
    };

    const tick = async () => {
      if (cancelled) return;
      abortCtrl?.abort();
      abortCtrl = new AbortController();
      try {
        const opened = await useSandboxStore.getState().pollDesktopHandoff(abortCtrl.signal);
        if (cancelled) return;
        if (opened) {
          idleStreak = 0;
          toast.success('Opened project from web handoff intent');
          schedule(5000);
          return;
        }
        idleStreak += 1;
        const delay = idleStreak >= 8 ? 60_000 : idleStreak >= 4 ? 30_000 : idleStreak >= 2 ? 15_000 : 8_000;
        schedule(delay);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        idleStreak += 1;
        schedule(Math.min(60_000, 8_000 * idleStreak));
      }
    };

    void tick();
    return () => {
      cancelled = true;
      abortCtrl?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [authStatus]);

  useEffect(() => {
    const privilegedPanels = new Set(['control', 'devlogs', 'knowledge', 'vaigym', 'thorsen', 'docker']);

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

  // Popout panels announce open/close over a BroadcastChannel — listen once.
  useEffect(() => {
    initPopoutMainWindow();
  }, []);

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
  const isDevLogsView = view === 'devlogs' || activePanel === 'devlogs';
  const isSettingsOpen = activePanel === 'settings';
  const showPanel = !isPhoneViewport && sidebarState === 'expanded' && !focusMode && !previewExpanded;
  const useShellSidebar = layoutMode === 'open' || layoutMode === 'odyssey';
  const shellSidebarMounted = useShellSidebar && !isPhoneViewport && sidebarState !== 'hidden' && !focusMode && !previewExpanded && !isSettingsOpen;
  const shellSidebarExpanded = sidebarState === 'expanded';
  const showBuilderWorkspace = showBuilderPanel && (!isPhoneViewport || previewExpanded);
  // Nav placement is the structural signature of each layout mode:
  // compact → left rail · open → top command bar · odyssey → bottom dock.
  const navPlacement = layoutMode === 'open' ? 'top' : layoutMode === 'odyssey' ? 'dock' : 'left';
  const showShellNav = !isPhoneViewport && !focusMode && !previewExpanded && !isSettingsOpen;

  const mainWorkspace = (
    <Suspense fallback={<PanelLoading />}>
      {!isSettingsOpen && (isDevLogsView && showPanel ? (
        <div className="layout-panel min-w-0 flex-1">
          <SessionViewer />
        </div>
      ) : activePanel === 'knowledge' && showPanel ? (
        <div className="layout-panel min-w-0 flex-1">
          <KnowledgePanel onClose={() => useLayoutStore.getState().setActivePanel('chats')} />
        </div>
      ) : view === 'vaigym' ? (
        <div className="layout-panel min-w-0 flex-1">
          <VaiGym />
        </div>
      ) : view === 'thorsen' ? (
        <div className="layout-panel min-w-0 flex-1">
          <ThorsenPanel />
        </div>
      ) : (
        <MainWorkspaceLayout
          showBuilder={showBuilderWorkspace}
          previewExpanded={previewExpanded}
          layoutMode={layoutMode}
          builder={<IdeWorkspacePanel />}
        >
          <ChatWindow />
        </MainWorkspaceLayout>
      ))}
    </Suspense>
  );

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

      {/* Open local project folder (vai:open-workspace / Ctrl+Shift+O) */}
      <OpenFolderDialog />

      {/* Vai AI cursor + overlays — covers entire viewport */}
      <VaiOverlaySystem />

      {/* Global hold-to-dictate: listening pill, pasted toast, nowhere-to-type modal */}
      <GlobalDictation />



      {/* Cursor focus box — follows mouse, highlights interactive elements */}
      <CursorFocusBox />

      {/* App-owned window chrome — renders only inside the Tauri shell */}
      <TitleBar />

      {/* Knowledge graph — full-screen map of chats/projects (toggled from the toolbar) */}
      <KnowledgeGraphView />

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
          height: `calc(100dvh - var(--safe-top) - var(--safe-bottom) - var(--titlebar-height, 0px))`,
        }}
      >
        {/* Stage rework: the odyssey starfield retired with the aurora deck —
            the atmosphere layer is now pure CSS in every mode. */}
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

          {navPlacement === 'top' && showShellNav && <TopCommandBar />}

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" style={{ gap: 'var(--layout-gap)' }}>
          {!isSettingsOpen && useShellSidebar && !isPhoneViewport && !focusMode && !previewExpanded ? (
            <ShellSidebarLayout
              showSidebar={shellSidebarMounted}
              sidebarExpanded={shellSidebarExpanded}
              layoutMode={layoutMode}
              showRail={false}
            >
              {mainWorkspace}
            </ShellSidebarLayout>
          ) : showRail && !isSettingsOpen ? (
            <>
              <div className="layout-panel layout-panel--rail h-full shrink-0 self-stretch">
                <ActivityRail />
              </div>
              <AnimatePresence mode="popLayout">
                {showPanel && (
                  <div className="layout-panel h-full shrink-0" key="sidebar-panel-wrap">
                    <SidebarPanel />
                  </div>
                )}
              </AnimatePresence>
              {mainWorkspace}
            </>
          ) : (
            !isSettingsOpen && mainWorkspace
          )}

          <AnimatePresence mode="popLayout">
            {isSettingsOpen && (
              <div className="layout-panel flex min-h-0 min-w-0 flex-1 overflow-hidden" key="settings-drawer-wrap">
                <SettingsDrawer />
              </div>
            )}
          </AnimatePresence>
          </div>

          {navPlacement === 'dock' && showShellNav && <DockRail />}
        </div>
      </div>
    </>
  );
}
   