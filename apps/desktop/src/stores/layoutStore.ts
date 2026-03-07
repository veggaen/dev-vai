import { create } from 'zustand';

export type ChatMode = 'chat' | 'agent' | 'builder' | 'plan' | 'debate';

export interface BuildStatus {
  step: 'idle' | 'generating' | 'writing' | 'installing' | 'building' | 'testing' | 'fixing' | 'ready' | 'failed';
  message?: string;
}

export type AppView = 'chat' | 'devlogs' | 'knowledge' | 'vaigym' | 'thorsen';

/** Sidebar panel modes — which view the expanded panel shows */
export type SidebarPanel = 'chats' | 'devlogs' | 'knowledge' | 'search' | 'settings' | 'docker' | 'vaigym' | 'thorsen';

/** Three-state sidebar: rail (icons only), expanded (full panel), hidden */
export type SidebarState = 'expanded' | 'rail' | 'hidden';

/** Layout density mode: compact (VSCode-like, edge-to-edge) vs open (floating, airy) */
export type LayoutMode = 'compact' | 'open';

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
  setBuildStatus: (status: BuildStatus) => void;
  setShowQuickSwitch: (show: boolean) => void;

  /** Toggle compact ↔ open layout mode */
  toggleLayoutMode: () => void;
  setLayoutMode: (mode: LayoutMode) => void;
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
  screenClass: typeof window !== 'undefined' ? detectScreenClass() : 'desktop',
  showSecondarySidebar: false,

  setMode: (mode) => set({ mode }),
  setView: (view) => {
    // Sync active panel when view changes
    if (view === 'devlogs') {
      set({ view, activePanel: 'devlogs', sidebarState: 'expanded', showSidebar: true });
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
    // If clicking same panel while expanded → collapse to rail
    if (sidebarState === 'expanded' && activePanel === panel) {
      set({ sidebarState: 'rail', showSidebar: true });
      return;
    }
    // Otherwise expand and show that panel
    const view: AppView = panel === 'devlogs' ? 'devlogs' : panel === 'knowledge' ? 'knowledge' : panel === 'vaigym' ? 'vaigym' : panel === 'thorsen' ? 'thorsen' : 'chat';
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
  updateScreenClass: () => set({ screenClass: detectScreenClass() }),
  toggleSecondarySidebar: () => set((s) => ({ showSecondarySidebar: !s.showSecondarySidebar })),
}));

/** Mode-specific input placeholders */
export const MODE_PLACEHOLDERS: Record<ChatMode, string> = {
  chat: 'Message VeggaAI...',
  agent: 'Vai will figure out the best approach...',
  builder: 'Tell Vai what to build or change...',
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

/** Mode-specific system prompts (prepended to user message context) */

const TEMPLATE_CONTEXT = `

AVAILABLE SANDBOX TEMPLATES:
You can suggest deploying a sandbox template inline using: {{deploy:stackId:tier:Display Name}}
The user will see a clickable "Deploy" button in the chat.

Stacks & tiers:
- pern (basic|solid|battle-tested|vai) — PostgreSQL + Express + React + Node.js — Board task manager with Tailwind v4
- mern (basic|solid|battle-tested|vai) — MongoDB + Express + React + Node.js — Bookmark collection manager with Tailwind v4
- nextjs (basic|solid|battle-tested|vai) — Next.js App Router + API Routes — Notes dashboard with Tailwind v4
- t3 (basic|solid|battle-tested|vai) — tRPC + Zod + React + TypeScript — Expense tracker with Tailwind v4

Tier descriptions:
- basic: Polished app with Tailwind CSS, lucide-react icons, in-memory API
- solid: Adds Prisma ORM + Zod validation + real database
- battle-tested: Adds Docker, CI/CD, tests, PostgreSQL
- vai: Production-hardened with monitoring, error boundaries, health checks

When a user asks to "build something", "start a project", or "set up a template", suggest an appropriate template. Example: "I'll set up a board task manager for you! {{deploy:pern:basic:PERN Basic}}"
`;

export const MODE_SYSTEM_PROMPTS: Record<ChatMode, string> = {
  chat: 'You are in Chat mode. The user is having a casual conversation. Do NOT make changes to any project files, plans, or sandbox. Do NOT generate code files unless the user explicitly asks for a code snippet. Just chat naturally, answer questions, explain concepts, and be helpful. If the user seems to want code changes, suggest they switch to Builder or Agent mode.',

  agent: 'You are in Agent mode. Analyze the user\'s message to determine intent — whether they need code, explanation, debugging, planning, or something else. Adapt your response style and depth to match. If the user wants code changes, generate complete files with clear paths (e.g. ```tsx title="src/App.tsx"). If they want explanation, be thorough. If unclear, ask a focused clarifying question. When generating project code, always include a package.json with the necessary dependencies.' + TEMPLATE_CONTEXT,

  builder: 'You are in Builder mode. The user expects you to make changes to their project. Generate complete, runnable code. Structure all code output as file blocks with clear paths using the format: ```language title="path/to/file.ext". When creating a new project, scaffold the full directory structure including package.json with all dependencies, config files, and source files. Generate test files alongside components. Every response should contain actionable file changes. Always include a package.json when creating new projects.' + TEMPLATE_CONTEXT,

  plan: 'You are in Plan mode. Help the user think through what they\'re building before writing code. Structure responses as numbered steps with clear decisions, verification criteria, and "watch out for" notes. Present ranked alternatives when uncertain. Share your critical thinking — explain WHY you recommend each choice, not just WHAT. Surface hidden complexity early. When the user is satisfied with the plan, suggest they switch to Builder mode to implement it.',

  debate: 'You are in Debate mode. Your job is to stress-test the user\'s ideas. Present at least 2 opposing perspectives with evidence. Challenge assumptions explicitly. Play devil\'s advocate — push back on weak points, ask "what if" questions, and surface edge cases. Agree to disagree when positions are genuinely valid but defer judgment for future reconsideration. Label what you know from data vs. inference.',
};
