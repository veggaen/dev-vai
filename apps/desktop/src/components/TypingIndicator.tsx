/**
 * TypingIndicator — Perplexity-inspired multi-step thinking indicator.
 *
 * Shows animated processing steps ("Understanding...", "Searching knowledge...",
 * "Generating answer...") that cycle as Vai thinks, giving the user a sense
 * of progress rather than just pulsing dots.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Search, Sparkles, Brain } from 'lucide-react';

const THINKING_STEPS = [
  { label: 'Understanding...', icon: Brain, delay: 0 },
  { label: 'Searching knowledge...', icon: Search, delay: 1200 },
  { label: 'Generating answer...', icon: Sparkles, delay: 3000 },
];

export function TypingIndicator() {
  const [activeStep, setActiveStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 200), 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const next = [...THINKING_STEPS].reverse().find((s) => elapsed >= s.delay);
    if (next) setActiveStep(THINKING_STEPS.indexOf(next));
  }, [elapsed]);

  const completedCount = activeStep;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="mb-4 flex items-start gap-3"
    >
      {/* Avatar */}
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-zinc-800/80 ring-1 ring-zinc-700/50 mt-0.5">
        <Bot className="h-3.5 w-3.5 text-zinc-400" />
      </div>

      {/* Steps indicator */}
      <div className="min-w-0 flex-1">
        <div className="inline-flex items-center gap-2 rounded-xl bg-zinc-800/40 px-3.5 py-2 ring-1 ring-zinc-700/30">
          {/* Animated spinner */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            className="h-3.5 w-3.5 rounded-full border-2 border-violet-500/30 border-t-violet-400"
          />

          {/* Step label with crossfade */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStep}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-1.5"
            >
              {(() => {
                const StepIcon = THINKING_STEPS[activeStep].icon;
                return <StepIcon className="h-3 w-3 text-violet-400/70" />;
              })()}
              <span className="text-xs text-zinc-400">
                {THINKING_STEPS[activeStep].label}
              </span>
            </motion.div>
          </AnimatePresence>

          {/* Step count badge */}
          {completedCount > 0 && (
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="rounded-full bg-violet-500/10 px-1.5 py-px text-[9px] font-medium tabular-nums text-violet-400/70"
            >
              {completedCount}/{THINKING_STEPS.length}
            </motion.span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
