import { create } from 'zustand';
import type { AppRole } from './authStore.js';

export type ChatMode = 'chat' | 'agent' | 'builder' | 'plan' | 'debate';

export interface BuildStatus {
  step: 'idle' | 'generating' | 'writing' | 'installing' | 'building' | 'testing' | 'fixing' | 'ready' | 'failed';
  message?: string;
}

export type AppView = 'chat' | 'devlogs' | 'knowledge' | 'vaigym' | 'thorsen' | 'projects' | 'control';

/** Sidebar panel modes — which view the expanded panel shows */
export type SidebarPanel = 'chats' | 'projects' | 'devlogs' | 'knowledge' | 'search' | 'settings' | 'docker' | 'vaigym' | 'thorsen' | 'control';

/**
 * Role-gated navigation — which panels each role can access.
 * Builder: core building tools only.
 * Admin: builder + support/monitoring.
 * Owner: everything including platform tools.
 */
export const ROLE_NAV_ITEMS: Record<AppRole, SidebarPanel[]> = {
  builder: ['chats', 'projects', 'search', 'settings'],
  admin:   ['chats', 'projects', 'devlogs', 'search', 'settings', 'docker'],
  owner:   ['chats', 'projects', 'control', 'devlogs', 'knowledge', 'vaigym', 'docker', 'thorsen', 'search', 'settings'],
};

/** Three-state sidebar: rail (icons only), expanded (full panel), hidden */
export type SidebarState = 'expanded' | 'rail' | 'hidden';

/** Layout density mode: compact (VSCode-like, edge-to-edge) vs open (floating, airy) */
export type LayoutMode = 'compact' | 'open';
export type ThemePreference = 'dark' | 'light';

/**
 * Responsive breakpoints for V3gga's 3-monitor setup:
 * - Display 1: 2560×1440 landscape (main)
 * - Display 2: 1440×3440 portrait ↔ 3440×1440 ultrawide
 * - Display 3: 3440×1440 landscape ↔ 1440×2560 portrait
 */
export type ScreenClass = 'phone' | 'tablet' | 'desktop' | 'wide' | 'ultrawide';

interface LayoutState {
  mode: ChatMode;
  view: AppView;

  /** Three-state sidebar system */
  sidebarState: SidebarState;
  /** Which panel the expanded sidebar shows */
  activePanel: SidebarPanel;

  showDebugConsole: boolean;
  showFileExplorer: boolean;
  showBuilderPanel: boolean;
  /** Focus mode — chat only, everything else hidden */
  focusMode: boolean;
  /** Preview expanded — preview fills entire main area, chat hidden */
  previewExpanded: boolean;
  buildStatus: BuildStatus;
  /** Quick-switch overlay open state */
  showQuickSwitch: boolean;

  /** Layout density: compact (edge-to-edge) vs open (floating, airy) */
  layoutMode: LayoutMode;
  /** Shell appearance preference */
  themePreference: ThemePreference;
  /** Detected screen class based on viewport dimensions */
  screenClass: ScreenClass;
  /** Whether secondary sidebar is visible (ultrawide only) */
  showSecondarySidebar: boolean;

  setMode: (mode: ChatMode) => void;
  setView: (view: AppView) => void;

  /** Set sidebar state directly */
  setSidebarState: (state: SidebarState) => void;
  /** Set the active panel (auto-expands if in rail mode) */
  setActivePanel: (panel: SidebarPanel) => void;
  /** Toggle between expanded ↔ rail (never fully hides unless focus mode) */
  toggleSidebar: () => void;
  /** Cycle: expanded → rail → hidden → expanded */
  cycleSidebar: () => void;

  toggleDebugConsole: () => void;
  toggleFileExplorer: () => void;
  toggleBuilderPanel: () => void;
  toggleFocusMode: () => void;
  /** Toggle preview expanded mode (hides chat, preview fills screen) */
  togglePreviewExpanded: () => void;
  /** Expand builder (called when a sandbox deploys) */
  expandBuilder: () => void;
  /** Collapse builder and return to chat-only main view */
  collapseBuilder: () => void;
  setBuildStatus: (status: BuildStatus) => void;
  setShowQuickSwitch: (show: boolean) => void;

  /** Toggle compact ↔ open layout mode */
  toggleLayoutMode: () => void;
  setLayoutMode: (mode: LayoutMode) => void;
  toggleThemePreference: () => void;
  setThemePreference: (theme: ThemePreference) => void;
  /** Update screen class from viewport dimensions */
  updateScreenClass: () => void;
  /** Toggle secondary sidebar (ultrawide only) */
  toggleSecondarySidebar: () => void;

  /** Legacy compat — maps to sidebarState !== 'hidden' */
  showSidebar: boolean;
}

/** Detect screen class from viewport dimensions */
function detectScreenClass(): ScreenClass {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isLandscape = w > h;

  if (w >= 3000 && isLandscape) return 'ultrawide';    // 3440×1440 ultrawide
  if (w >= 1800 && isLandscape) return 'wide';          // 2560×1440 desktop
  if (w >= 1024) return 'desktop';                       // 1024-1799
  if (w >= 768) return 'tablet';                         // 768-1023 or portrait 1440
  return 'phone';                                        // < 768
}

/** Persist layout mode preference */
const LAYOUT_MODE_KEY = 'vai-layout-mode';
const savedMode = (typeof localStorage !== 'undefined'
  ? localStorage.getItem(LAYOUT_MODE_KEY) as LayoutMode | null
  : null) ?? 'compact';
const THEME_PREFERENCE_KEY = 'vai-theme-preference';
const savedThemePreference = (typeof localStorage !== 'undefined'
  ? localStorage.getItem(THEME_PREFERENCE_KEY) as ThemePreference | null
  : null) ?? 'dark';

export const useLayoutStore = create<LayoutState>((set, get) => ({
  mode: 'chat',
  view: 'chat',
  sidebarState: 'rail',
  activePanel: 'chats',
  showDebugConsole: true,
  showFileExplorer: false,
  showBuilderPanel: false,
  focusMode: false,
  previewExpanded: false,
  buildStatus: { step: 'idle' },
  showQuickSwitch: false,
  showSidebar: false,
  layoutMode: savedMode,
  themePreference: savedThemePreference,
  screenClass: typeof window !== 'undefined' ? detectScreenClass() : 'desktop',
  showSecondarySidebar: false,

  setMode: (mode) => set({ mode }),
  setView: (view) => {
    // Sync active panel when view changes
    if (view === 'devlogs') {
      set({ view, activePanel: 'devlogs', sidebarState: 'expanded', showSidebar: true });
    } else if (view === 'projects') {
      set({ view, activePanel: 'projects', sidebarState: 'expanded', showSidebar: true });
    } else if (view === 'control') {
      set({ view, activePanel: 'control', sidebarState: 'expanded', showSidebar: true });
    } else if (view === 'vaigym') {
      set({ view, activePanel: 'vaigym', sidebarState: 'rail', showSidebar: true });
    } else if (view === 'thorsen') {
      set({ view, activePanel: 'thorsen', sidebarState: 'rail', showSidebar: true });
    } else {
      set({ view, activePanel: 'chats' });
    }
  },

  setSidebarState: (sidebarState) => set({
    sidebarState,
    showSidebar: sidebarState !== 'hidden',
  }),

  setActivePanel: (panel) => {
    const { sidebarState, activePanel } = get();

    // Full-screen views — switch view but keep sidebar in rail mode (no expanded panel content)
    const FULLSCREEN_PANELS: SidebarPanel[] = ['vaigym', 'thorsen'];
    if (FULLSCREEN_PANELS.includes(panel)) {
      const view: AppView = panel as AppView;
      set({ activePanel: panel, sidebarState: 'rail', showSidebar: true, view });
      return;
    }

    // If clicking same panel while expanded → collapse to rail
    if (sidebarState === 'expanded' && activePanel === panel) {
      set({ sidebarState: 'rail', showSidebar: true });
      return;
    }
    // Otherwise expand and show that panel
    const view: AppView = panel === 'devlogs'
      ? 'devlogs'
      : panel === 'knowledge'
        ? 'knowledge'
        : panel === 'projects'
          ? 'projects'
          : panel === 'control'
            ? 'control'
            : 'chat';
    set({ activePanel: panel, sidebarState: 'expanded', showSidebar: true, view });
  },

  toggleSidebar: () => set((s) => {
    const next = s.sidebarState === 'expanded' ? 'rail' : 'expanded';
    return { sidebarState: next, showSidebar: true };
  }),

  cycleSidebar: () => set((s) => {
    const cycle: SidebarState[] = ['expanded', 'rail', 'hidden'];
    const idx = cycle.indexOf(s.sidebarState);
    const next = cycle[(idx + 1) % cycle.length];
    return { sidebarState: next, showSidebar: next !== 'hidden' };
  }),

  toggleDebugConsole: () => set((s) => ({ showDebugConsole: !s.showDebugConsole })),
  toggleFileExplorer: () => set((s) => ({ showFileExplorer: !s.showFileExplorer })),
  toggleBuilderPanel: () => set((s) => ({ showBuilderPanel: !s.showBuilderPanel, focusMode: false, previewExpanded: false })),
  toggleFocusMode: () => set((s) => {
    const entering = !s.focusMode;
    return {
      focusMode: entering,
      previewExpanded: false,
      // Focus = chat + builder only — hide sidebar/rail, keep preview as is
      sidebarState: entering ? 'hidden' : 'rail',
      showSidebar: !entering,
    };
  }),
  togglePreviewExpanded: () => set((s) => {
    const entering = !s.previewExpanded;
    return {
      previewExpanded: entering,
      showBuilderPanel: true,
      focusMode: false,
      sidebarState: entering ? 'hidden' : 'rail',
      showSidebar: !entering,
    };
  }),
  expandBuilder: () => set({ showBuilderPanel: true, focusMode: false, previewExpanded: false }),
  collapseBuilder: () => set({ showBuilderPanel: false, previewExpanded: false, focusMode: false }),
  setBuildStatus: (buildStatus) => set({ buildStatus }),
  setShowQuickSwitch: (showQuickSwitch) => set({ showQuickSwitch }),

  toggleLayoutMode: () => set((s) => {
    const next = s.layoutMode === 'compact' ? 'open' : 'compact';
    localStorage.setItem(LAYOUT_MODE_KEY, next);
    return { layoutMode: next };
  }),
  setLayoutMode: (layoutMode) => {
    localStorage.setItem(LAYOUT_MODE_KEY, layoutMode);
    set({ layoutMode });
  },
  toggleThemePreference: () => set((s) => {
    const next = s.themePreference === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_PREFERENCE_KEY, next);
    return { themePreference: next };
  }),
  setThemePreference: (themePreference) => {
    localStorage.setItem(THEME_PREFERENCE_KEY, themePreference);
    set({ themePreference });
  },
  updateScreenClass: () => set({ screenClass: detectScreenClass() }),
  toggleSecondarySidebar: () => set((s) => ({ showSecondarySidebar: !s.showSecondarySidebar })),
}));

/** Mode-specific input placeholders */
export const MODE_PLACEHOLDERS: Record<ChatMode, string> = {
  chat: 'Message VeggaAI...',
  agent: 'Vai will figure out the best approach...',
  builder: 'What would you like to change?',
  plan: 'What are you trying to accomplish?',
  debate: 'Present your idea — Vai will stress-test it...',
};

/** Mode descriptions for tooltips */
export const MODE_DESCRIPTIONS: Record<ChatMode, string> = {
  chat: 'Just chat — Vai won\'t touch project files or plans.',
  agent: 'Auto mode — Vai analyzes your message and decides what to do.',
  builder: 'Code mode — Vai writes and modifies project files with live preview.',
  plan: 'Planning mode — architecture, steps, tradeoffs, and critical thinking.',
  debate: 'Devil\'s advocate — Vai challenges ideas and finds gaps.',
};
