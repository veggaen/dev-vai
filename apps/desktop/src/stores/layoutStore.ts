import { create } from 'zustand';

export type LayoutView = 'chat' | 'builder';
export type ChatMode = 'chat' | 'agent' | 'builder' | 'plan' | 'debate';

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

  enterBuilder: () => void;
  exitBuilder: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  view: 'chat',
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
      set((s) => ({
        mode,
        view: s.view === 'builder' ? 'chat' : s.view,
        ...(s.view === 'builder' ? { showDebugConsole: false } : {}),
      }));
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
  chat: 'Message VeggaAI...',
  agent: 'Vai will figure out the best approach...',
  builder: 'Tell Vai what to build or change...',
  plan: 'What are you trying to accomplish?',
  debate: 'Present your idea — Vai will stress-test it...',
};

/** Mode descriptions for tooltips */
export const MODE_DESCRIPTIONS: Record<ChatMode, string> = {
  chat: 'Simple conversation — just chat with Vai, no special behavior.',
  agent: 'Auto mode — Vai analyzes your messages and decides what action to take.',
  builder: 'Code mode — Vai writes and modifies project files with a live preview.',
  plan: 'Planning mode — Vai helps you think through architecture, steps, and tradeoffs.',
  debate: 'Devil\'s advocate — Vai challenges your ideas and finds gaps in your reasoning.',
};

/** Mode-specific system prompts (prepended to user message context) */
export const MODE_SYSTEM_PROMPTS: Record<ChatMode, string> = {
  chat: '',
  agent: 'You are in Agent mode. Analyze the user\'s message to determine intent — whether they need code, explanation, debugging, planning, or something else. Adapt your response style and depth to match. If the user seems to want code changes, generate them. If they want explanation, be thorough. If unclear, ask a focused clarifying question.',
  builder: 'You are in Builder mode. The user expects you to make changes to their project. Generate complete, runnable code. Extract all code into files with clear paths. When creating a new project, scaffold the full directory structure. Generate test files alongside components. Every response should contain actionable file changes.',
  plan: 'You are in Plan mode. Help the user think through what they\'re building before writing code. Structure responses as numbered steps with clear decisions, verification criteria, and "watch out for" notes. Present ranked alternatives when uncertain. Share your critical thinking — explain WHY you recommend each choice, not just WHAT. Surface hidden complexity early.',
  debate: 'You are in Debate mode. Your job is to stress-test the user\'s ideas. Present at least 2 opposing perspectives with evidence. Challenge assumptions explicitly. Play devil\'s advocate — push back on weak points, ask "what if" questions, and surface edge cases. Agree to disagree when positions are genuinely valid but defer judgment for future reconsideration. Label what you know from data vs. inference.',
};
