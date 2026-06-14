/**
 * ChatEmptyState — first-viewport hero for a fresh chat.
 *
 * The pulsing Vai mark, a short branded line with real personality, and a
 * mode-aware SuggestionDeck so the first screen demonstrates what Vai can do and
 * starts the conversation in one click — instead of a bare "send a message".
 */

import { motion, useReducedMotion } from 'framer-motion';
import { VaiWelcomeMark } from './VaiWelcomeMark.js';
import { SuggestionDeck } from './SuggestionDeck.js';
import { useLayoutStore } from '../../stores/layoutStore.js';

interface ChatEmptyStateProps {
  /** @deprecated Kept for API compatibility — settings are in the sidebar rail. */
  onOpenSettings?: () => void;
  /** Fill + send a starter prompt (wired by ChatWindow). */
  onPrompt?: (prompt: string) => void;
}

export function ChatEmptyState({ onPrompt }: ChatEmptyStateProps) {
  const prefersReducedMotion = useReducedMotion();
  const mode = useLayoutStore((s) => s.mode);
  const isBuild = mode === 'builder' || mode === 'agent';

  const lede = isBuild
    ? 'Describe what to build — Vai scaffolds, runs, and previews it live.'
    : 'Ask anything. Vai reasons, searches, and shows its work.';

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
      className="relative z-[1] flex min-h-full min-w-0 flex-col items-center justify-center px-6 py-12"
      data-clean-empty-state="v7"
    >
      <div className="relative mx-auto flex w-full max-w-2xl min-w-0 flex-col items-center text-center">
        <VaiWelcomeMark size="lg" />

        <motion.h1
          initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mt-7 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[color:var(--chat-strong)]"
        >
          What should we get into?
        </motion.h1>

        <motion.p
          initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.45 }}
          className="mt-2 max-w-md text-[13px] leading-6 text-[color:var(--chat-muted)]"
        >
          {lede}
        </motion.p>

        {onPrompt && <SuggestionDeck mode={mode} onPrompt={onPrompt} />}
      </div>
    </motion.div>
  );
}
