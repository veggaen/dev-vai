import { motion } from 'framer-motion';
import {
  BookOpen,
  Code,
  Globe,
  Layout,
  MessageCircle,
  Rocket,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useLayoutStore, type ChatMode } from '../../stores/layoutStore.js';

const STARTER_PROMPTS = [
  { label: 'Ship a landing page', prompt: 'Build a polished landing page for a developer tool with strong hierarchy and responsive sections.', icon: Layout, kind: 'build' },
  { label: 'Create an internal tool', prompt: 'Build an internal operations dashboard with filters, activity cards, and keyboard-friendly controls.', icon: Code, kind: 'build' },
  { label: 'Explain this repo', prompt: 'Explain this codebase architecture clearly, identify the weak spots, and tell me what to fix first.', icon: BookOpen, kind: 'chat' },
  { label: 'Debug a rough edge', prompt: 'Help me debug a rough edge in this project. Ask for the fastest high-signal context first.', icon: Shield, kind: 'chat' },
  { label: 'Research before building', prompt: 'Research the best direction first, then turn the findings into an implementation plan.', icon: Globe, kind: 'chat' },
  { label: 'Recall captured pages', prompt: 'What have I captured recently, and what should I remember from it?', icon: MessageCircle, kind: 'memory' },
];

interface ChatEmptyStateProps {
  onStartBuilding: (description: string) => void;
  onPresetClick: (label: string) => void;
  onAskMemoryQuestion: (prompt: string, options?: { forceMode?: ChatMode }) => void;
  onOpenSettings: () => void;
}

export function ChatEmptyState({
  onStartBuilding,
  onPresetClick,
  onAskMemoryQuestion,
  onOpenSettings,
}: ChatEmptyStateProps) {
  const themePreference = useLayoutStore((state) => state.themePreference);
  const isLight = themePreference === 'light';
  const memoryPrompt = 'What have I captured recently, and what should I remember from it?';
  const visibleStarters = STARTER_PROMPTS.slice(0, 4);

  const handleStarterClick = (prompt: (typeof STARTER_PROMPTS)[number]) => {
    if (prompt.kind === 'build') {
      onStartBuilding(prompt.prompt);
      return;
    }
    if (prompt.kind === 'memory') {
      onAskMemoryQuestion(prompt.prompt, { forceMode: 'chat' });
      return;
    }
    onPresetClick(prompt.prompt);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
      className="flex min-h-full flex-col items-center justify-center px-5 py-10"
    >
      <div className="mx-auto w-full max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className={`mx-auto inline-flex items-center gap-2 rounded-md border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] ${
            isLight
              ? 'border-zinc-200 bg-white text-zinc-500'
              : 'border-zinc-800/70 bg-zinc-950/70 text-zinc-400'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-300" />
          Build, Ask, Inspect
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          className={`mx-auto mt-5 max-w-3xl text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.05em] sm:text-[3.25rem] ${
            isLight ? 'text-zinc-900' : 'text-zinc-100'
          }`}
        >
          Make the first prompt count.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          className={`mx-auto mt-4 max-w-2xl text-[15px] leading-7 ${isLight ? 'text-zinc-600' : 'text-zinc-500'}`}
        >
          Start with a product idea, a bug, or a question you want sharpened. Vai is strongest when the prompt names the outcome, not just the tool.
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="mx-auto mt-8 grid w-full max-w-4xl gap-3 lg:grid-cols-3"
      >
        {[
          {
            title: 'Build live',
            detail: 'Kick straight into builder mode for runnable UI, code, and preview.',
            cta: 'Start a builder prompt',
            icon: Code,
            onClick: () => onStartBuilding('Build a polished landing page for a developer tool with a strong hero, proof section, and mobile-ready layout.'),
          },
          {
            title: 'Get a sharp answer',
            detail: 'Use chat mode for explanations, debugging, tradeoffs, and critique.',
            cta: 'Ask for clarity',
            icon: Zap,
            onClick: () => onPresetClick('Explain this codebase architecture clearly and point out the biggest UX and product risks.'),
          },
          {
            title: 'Use memory on purpose',
            detail: 'Ground the answer in pages you captured instead of vague recall.',
            cta: 'Ask from memory',
            icon: Rocket,
            onClick: () => onAskMemoryQuestion(memoryPrompt, { forceMode: 'chat' }),
          },
        ].map((lane, index) => {
          const Icon = lane.icon;
          return (
          <motion.button
            key={lane.title}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 + index * 0.04, duration: 0.3 }}
            onClick={lane.onClick}
            className={`group/lane border p-5 text-left transition-all duration-200 ${
              isLight
                ? 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
                : 'border-zinc-800/65 bg-zinc-950/58 hover:border-zinc-700 hover:bg-zinc-900/80'
            }`}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.985 }}
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
              isLight
                ? 'border-zinc-200 bg-zinc-50 text-zinc-500 group-hover/lane:text-zinc-900'
                : 'border-zinc-800/70 bg-zinc-950/80 text-zinc-300 group-hover/lane:text-white'
            }`}>
              <Icon className="h-4.5 w-4.5" />
            </div>
            <div className={`mt-4 text-[17px] font-semibold tracking-[-0.03em] ${isLight ? 'text-zinc-900' : 'text-zinc-100'}`}>{lane.title}</div>
            <p className={`mt-2 text-[13px] leading-6 ${isLight ? 'text-zinc-600' : 'text-zinc-500'}`}>{lane.detail}</p>
            <div className={`mt-4 inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
              isLight
                ? 'bg-zinc-100 text-zinc-600 group-hover/lane:bg-zinc-200 group-hover/lane:text-zinc-900'
                : 'bg-zinc-900/82 text-zinc-300 group-hover/lane:bg-zinc-800 group-hover/lane:text-white'
            }`}>
              {lane.cta}
            </div>
          </motion.button>
          );
        })}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24, duration: 0.4 }}
        className={`mx-auto mt-4 w-full max-w-4xl border px-4 py-3 text-left ${
          isLight
            ? 'border-zinc-200 bg-zinc-50/80'
            : 'border-zinc-800/70 bg-zinc-950/52'
        }`}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className={`text-[11px] font-medium uppercase tracking-[0.2em] ${isLight ? 'text-zinc-500' : 'text-emerald-300/80'}`}>Memory workflow</div>
            <div className={`mt-1 text-[14px] font-medium ${isLight ? 'text-zinc-900' : 'text-zinc-100'}`}>Captured-page recall lives here when you want grounded answers.</div>
            <div className={`mt-1 text-[12px] leading-5 ${isLight ? 'text-zinc-600' : 'text-zinc-400'}`}>Capture a page with the extension, then ask Vai to explain what mattered or what to remember.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onAskMemoryQuestion(memoryPrompt, { forceMode: 'chat' })}
              className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-[12px] font-medium transition-colors ${
                isLight
                  ? 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100'
                  : 'border-zinc-800/70 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800'
              }`}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Ask from memory
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-[12px] font-medium transition-colors ${
                isLight
                  ? 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                  : 'border-zinc-800/70 bg-zinc-950/72 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              Open capture setup
            </button>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="mx-auto mt-6 w-full max-w-4xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">Start with something concrete</div>
          <div className={`hidden text-[11px] sm:block ${isLight ? 'text-zinc-500' : 'text-zinc-600'}`}>These shortcuts send a strong first prompt instead of a vague one.</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {visibleStarters.map((starter, index) => {
            const Icon = starter.icon;
          return (
            <motion.button
              key={starter.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.34 + index * 0.03, duration: 0.3 }}
              onClick={() => handleStarterClick(starter)}
              className={`group/preset flex items-start gap-3 border px-4 py-3.5 text-left transition-all duration-200 ${
                isLight
                  ? 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
                  : 'border-zinc-800/60 bg-zinc-950/52 hover:border-zinc-700 hover:bg-zinc-900/78'
              }`}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.985 }}
            >
              <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
                isLight
                  ? 'bg-zinc-100 text-zinc-500 group-hover/preset:text-zinc-900'
                  : 'bg-zinc-950/72 text-zinc-400 group-hover/preset:text-zinc-200'
              }`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <span className={`block text-[13px] font-medium ${isLight ? 'text-zinc-800 group-hover/preset:text-zinc-900' : 'text-zinc-300 group-hover/preset:text-zinc-100'}`}>{starter.label}</span>
                <span className={`mt-0.5 block text-[11px] leading-5 ${isLight ? 'text-zinc-500 group-hover/preset:text-zinc-600' : 'text-zinc-600 group-hover/preset:text-zinc-500'}`}>{starter.prompt}</span>
              </div>
            </motion.button>
          );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
