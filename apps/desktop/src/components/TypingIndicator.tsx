/**
 * TypingIndicator — live reasoning stream.
 *
 * Renders the server's `progress` steps as they arrive (Codex-style): the
 * latest step is active with a spinner, earlier ones settle as completed and
 * dim. Flat throughout — a quiet left rail, no rounded box, no pill counter —
 * so it reads like "here's what I'm doing right now", then hands off to the
 * answer + the Thinking panel's settled narrative.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Check } from 'lucide-react';
import type { ChatProgressStep } from '../stores/chatStore.js';

export function TypingIndicator({ progressSteps = [] }: { progressSteps?: ChatProgressStep[] }) {
  const steps = progressSteps.slice(-5);
  const hasSteps = steps.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="mb-4 flex items-start gap-3"
      data-testid="typing-indicator"
    >
      {/* Avatar — brand mark with a soft breathing glow while working */}
      <div className="relative mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-blue-600">
        <span className="absolute inset-0 animate-ping rounded-full bg-violet-500/20" style={{ animationDuration: '2.4s' }} />
        <span className="relative text-[10px] font-bold text-white">V</span>
      </div>

      {/* Live steps — quiet left rail, flat rows */}
      <div className="min-w-0 flex-1 border-l border-white/10 pl-3 text-xs">
        {!hasSteps ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin text-violet-400/70" />
            <span className="thinking-sheen font-medium">Thinking…</span>
          </div>
        ) : (
          <ol className="space-y-1.5">
            <AnimatePresence initial={false}>
              {steps.map((step, index) => {
                const isActive = index === steps.length - 1 && step.status !== 'done';
                return (
                  <motion.li
                    key={step.stage}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`flex items-center gap-2 leading-5 ${isActive ? 'text-zinc-300' : 'text-zinc-600'}`}
                  >
                    {isActive ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-violet-400/80" />
                    ) : (
                      <Check className="h-3 w-3 shrink-0 text-zinc-600" />
                    )}
                    <span className={`min-w-0 truncate ${isActive ? 'thinking-sheen font-medium' : ''}`}>{step.label}</span>
                    {isActive && step.detail && (
                      <span className="hidden min-w-0 truncate text-zinc-600 sm:inline">· {step.detail}</span>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        )}
      </div>
    </motion.div>
  );
}
