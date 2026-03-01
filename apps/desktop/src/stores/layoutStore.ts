import { create } from 'zustand';

export type ChatMode = 'chat' | 'agent' | 'builder' | 'plan' | 'debate';

export interface BuildStatus {
  step: 'idle' | 'generating' | 'writing' | 'installing' | 'building' | 'testing' | 'fixing' | 'ready' | 'failed';
  message?: string;
}

interface LayoutState {
  mode: ChatMode;
  showDebugConsole: boolean;
  showFileExplorer: boolean;
  showBuilderPanel: boolean;
  buildStatus: BuildStatus;

  setMode: (mode: ChatMode) => void;
  toggleDebugConsole: () => void;
  toggleFileExplorer: () => void;
  toggleBuilderPanel: () => void;
  setBuildStatus: (status: BuildStatus) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  mode: 'chat',
  showDebugConsole: true,
  showFileExplorer: false,
  showBuilderPanel: true,
  buildStatus: { step: 'idle' },

  setMode: (mode) => set({ mode }),
  toggleDebugConsole: () => set((s) => ({ showDebugConsole: !s.showDebugConsole })),
  toggleFileExplorer: () => set((s) => ({ showFileExplorer: !s.showFileExplorer })),
  toggleBuilderPanel: () => set((s) => ({ showBuilderPanel: !s.showBuilderPanel })),
  setBuildStatus: (buildStatus) => set({ buildStatus }),
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
export const MODE_SYSTEM_PROMPTS: Record<ChatMode, string> = {
  chat: 'You are in Chat mode. The user is having a casual conversation. Do NOT make changes to any project files, plans, or sandbox. Do NOT generate code files unless the user explicitly asks for a code snippet. Just chat naturally, answer questions, explain concepts, and be helpful. If the user seems to want code changes, suggest they switch to Builder or Agent mode.',

  agent: 'You are in Agent mode. Analyze the user\'s message to determine intent — whether they need code, explanation, debugging, planning, or something else. Adapt your response style and depth to match. If the user wants code changes, generate complete files with clear paths (e.g. ```tsx title="src/App.tsx"). If they want explanation, be thorough. If unclear, ask a focused clarifying question. When generating project code, always include a package.json with the necessary dependencies.',

  builder: 'You are in Builder mode. The user expects you to make changes to their project. Generate complete, runnable code. Structure all code output as file blocks with clear paths using the format: ```language title="path/to/file.ext". When creating a new project, scaffold the full directory structure including package.json with all dependencies, config files, and source files. Generate test files alongside components. Every response should contain actionable file changes. Always include a package.json when creating new projects.',

  plan: 'You are in Plan mode. Help the user think through what they\'re building before writing code. Structure responses as numbered steps with clear decisions, verification criteria, and "watch out for" notes. Present ranked alternatives when uncertain. Share your critical thinking — explain WHY you recommend each choice, not just WHAT. Surface hidden complexity early. When the user is satisfied with the plan, suggest they switch to Builder mode to implement it.',

  debate: 'You are in Debate mode. Your job is to stress-test the user\'s ideas. Present at least 2 opposing perspectives with evidence. Challenge assumptions explicitly. Play devil\'s advocate — push back on weak points, ask "what if" questions, and surface edge cases. Agree to disagree when positions are genuinely valid but defer judgment for future reconsideration. Label what you know from data vs. inference.',
};
