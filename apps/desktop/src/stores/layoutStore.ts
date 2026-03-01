import { create } from 'zustand';

export type LayoutView = 'landing' | 'chat' | 'builder';
export type ChatMode = 'chat' | 'builder' | 'plan' | 'debate';

export interface BuildStatus {
  step: 'idle' | 'generating' | 'writing' | 'installing' | 'building' | 'testing' | 'fixing' | 'ready' | 'failed';
  message?: string;
}

interface LayoutState {
  view: LayoutView;
  mode: ChatMode;
  showDebugConsole: boolean;
  showFileExplorer: boolean;
  buildStatus: BuildStatus;
  builderEnabled: boolean;

  setView: (view: LayoutView) => void;
  setMode: (mode: ChatMode) => void;
  toggleDebugConsole: () => void;
  toggleFileExplorer: () => void;
  setBuildStatus: (status: BuildStatus) => void;
  setBuilderEnabled: (enabled: boolean) => void;

  /** Transition to builder mode — sets view + mode together */
  enterBuilder: () => void;
  /** Transition back to chat — resets to chat view + mode */
  exitBuilder: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  view: 'landing',
  mode: 'chat',
  showDebugConsole: false,
  showFileExplorer: false,
  buildStatus: { step: 'idle' },
  builderEnabled: true,

  setView: (view) => set({ view }),
  setMode: (mode) => {
    if (mode === 'builder') {
      set({ mode, view: 'builder', showDebugConsole: true });
    } else {
      set({ mode });
    }
  },
  toggleDebugConsole: () => set((s) => ({ showDebugConsole: !s.showDebugConsole })),
  toggleFileExplorer: () => set((s) => ({ showFileExplorer: !s.showFileExplorer })),
  setBuildStatus: (buildStatus) => set({ buildStatus }),
  setBuilderEnabled: (builderEnabled) => set({ builderEnabled }),

  enterBuilder: () => set({ view: 'builder', mode: 'builder', showDebugConsole: true }),
  exitBuilder: () => set({ view: 'chat', mode: 'chat', showDebugConsole: false }),
}));

/** Mode-specific input placeholders */
export const MODE_PLACEHOLDERS: Record<ChatMode, string> = {
  chat: 'Message VeggaAI... (Ctrl+V to paste image, Shift+Enter for new line)',
  builder: 'Tell Vai what to implement next...',
  plan: 'Describe the plan, not the code...',
  debate: 'Debate mode: Vai will push back and challenge ideas...',
};

/** Mode-specific system prompts (prepended to user message context) */
export const MODE_SYSTEM_PROMPTS: Record<ChatMode, string> = {
  chat: '',
  builder: 'You are in Builder mode. Generate complete, runnable code. Extract all code into files with clear paths. Generate Playwright test files alongside components.',
  plan: 'You are in Plan mode. Structure your response as numbered steps with clear decisions, verification criteria, and "watch out for" notes per step. Present ranked alternatives when uncertain.',
  debate: 'You are in Debate mode. Present at least 2 opposing perspectives with evidence, then synthesize a conclusion. Challenge assumptions explicitly. Label what you know from data vs. inference.',
};
