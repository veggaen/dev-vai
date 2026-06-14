import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';
import type { ChatProgressStep } from '../../stores/chatStore.js';

/**
 * Live, IDE-style process trace shown WHILE a turn is in flight — replaces the bare spinner/glow.
 * Renders the streamed `progressSteps` as a growing checklist: each step shows a spinner while
 * running and a check when done, so the user watches real work ("Searching…", "Consulting council…",
 * "Consolidating…") instead of staring at an indeterminate animation.
 *
 * Deliberately quiet and flat (matches ThinkingPanel). Only rendered during streaming; once the
 * answer settles, the durable account lives in ThinkingPanel's evidence log.
 */

interface LiveProcessTraceProps {
  readonly steps: readonly ChatProgressStep[];
  /** Image-gen steps share the same visual treatment when an image turn is in flight. */
  readonly imageSteps?: readonly { phase: string; label: string; flaws?: string[] }[];
  /** Shown as a leading "thinking" line before any step arrives. */
  readonly idleLabel?: string;
}

export function LiveProcessTrace({ steps, imageSteps, idleLabel = 'Thinking…' }: LiveProcessTraceProps) {
  const hasSteps = steps.length > 0 || (imageSteps && imageSteps.length > 0);

  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2.5 text-[12px]">
      {!hasSteps && (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
          <span className="vai-process-shimmer">{idleLabel}</span>
        </div>
      )}
      <AnimatePresence initial={false}>
        {steps.map((step) => (
          <motion.div
            key={step.stage}
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-start gap-2 py-0.5"
          >
            <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {step.status === 'done'
                ? <Check className="h-3.5 w-3.5 text-emerald-400" />
                : <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />}
            </span>
            <div className="min-w-0">
              <span className={step.status === 'done' ? 'text-zinc-400' : 'text-zinc-200'}>{step.label}</span>
              {step.detail && <span className="ml-1.5 text-zinc-600">{step.detail}</span>}
            </div>
          </motion.div>
        ))}
        {imageSteps?.map((step, i) => (
          <motion.div
            key={`img-${i}`}
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-start gap-2 py-0.5"
          >
            <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {step.phase === 'final'
                ? <Check className="h-3.5 w-3.5 text-emerald-400" />
                : <Loader2 className="h-3.5 w-3.5 animate-spin text-fuchsia-400" />}
            </span>
            <div className="min-w-0 text-zinc-300">
              {step.label}
              {step.flaws && step.flaws.length > 0 && (
                <span className="text-zinc-600"> — fixing: {step.flaws.join(', ')}</span>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
