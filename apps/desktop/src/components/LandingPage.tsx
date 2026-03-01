import { Sparkles, Code, BookOpen, Zap, MessageCircle, Shield } from 'lucide-react';
import { motion } from 'framer-motion';
import { useChatStore } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useLayoutStore } from '../stores/layoutStore.js';
import { useState, useRef, useEffect } from 'react';

const PRESETS = [
  // Build row
  { label: 'Scaffold a Next.js app', icon: <Code className="h-4 w-4" />, category: 'build' },
  { label: 'Create a REST API', icon: <Zap className="h-4 w-4" />, category: 'build' },
  { label: 'Build a landing page', icon: <Sparkles className="h-4 w-4" />, category: 'build' },
  // Learn row
  { label: 'Explain React 19 features', icon: <BookOpen className="h-4 w-4" />, category: 'learn' },
  { label: 'OWASP Top 10 summary', icon: <Shield className="h-4 w-4" />, category: 'learn' },
  { label: 'Compare Prisma vs Drizzle', icon: <MessageCircle className="h-4 w-4" />, category: 'learn' },
];

export function LandingPage() {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { createConversation, sendMessage } = useChatStore();
  const { selectedModelId } = useSettingsStore();
  const { setView } = useLayoutStore();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = async (text: string) => {
    const content = text.trim();
    if (!content || !selectedModelId) return;

    await createConversation(selectedModelId);
    setView('chat');

    // Small delay to let conversation be created and selected
    setTimeout(() => {
      sendMessage(content);
    }, 100);
  };

  const handlePresetClick = (label: string) => {
    handleSend(label);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  const buildPresets = PRESETS.filter((p) => p.category === 'build');
  const learnPresets = PRESETS.filter((p) => p.category === 'learn');

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-6">
      {/* Logo + Tagline */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-10 text-center"
      >
        <h1 className="mb-3 text-4xl font-bold tracking-tight text-zinc-100">
          Vegga<span className="text-blue-500">AI</span>
        </h1>
        <p className="text-sm text-zinc-500">
          Describe what you want to build, learn, or explore.
        </p>
      </motion.div>

      {/* Floating Input */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="mb-8 w-full max-w-xl"
      >
        <div className="relative flex items-end rounded-2xl border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/20 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message VeggaAI..."
            rows={1}
            className="max-h-32 min-h-[48px] flex-1 resize-none bg-transparent px-5 py-3.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <div className="flex shrink-0 items-center px-3 pb-3">
            <button
              onClick={() => handleSend(input)}
              disabled={!input.trim() || !selectedModelId}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white transition-all hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
              </svg>
            </button>
          </div>
        </div>
      </motion.div>

      {/* Preset Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="w-full max-w-xl space-y-3"
      >
        {/* Build row */}
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-600">Build</p>
          <div className="flex flex-wrap gap-2">
            {buildPresets.map((p) => (
              <button
                key={p.label}
                onClick={() => handlePresetClick(p.label)}
                className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-xs text-zinc-300 transition-all hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
              >
                {p.icon}
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Learn row */}
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-600">Learn</p>
          <div className="flex flex-wrap gap-2">
            {learnPresets.map((p) => (
              <button
                key={p.label}
                onClick={() => handlePresetClick(p.label)}
                className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-xs text-zinc-300 transition-all hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
              >
                {p.icon}
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        className="mt-8 text-xs text-zinc-700"
      >
        VAI v0 — Local-first AI that learns from your data.
      </motion.p>
    </div>
  );
}
