/**
 * TypingIndicator — Pulsing dots shown while the AI is thinking.
 * Matches Claude's 3-dot bounce with staggered animation delays.
 */

import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';

export function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="mb-4 flex items-start gap-3"
    >
      {/* Avatar */}
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700/50">
        <Bot className="h-3.5 w-3.5 text-zinc-400" />
      </div>

      {/* Dots */}
      <div className="mt-1.5 flex items-center gap-1 rounded-2xl bg-zinc-800/60 px-4 py-2.5 ring-1 ring-zinc-700/30">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot h-1.5 w-1.5 rounded-full bg-violet-400"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </div>
    </motion.div>
  );
}
