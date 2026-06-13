/**
 * ChatEmptyState — minimal first-viewport hero for a fresh chat.
 * Pulsing Vai mark + get-started prompt (no headline greeting).
 */

import { motion, useReducedMotion } from 'framer-motion';
import { VaiWelcomeMark } from './VaiWelcomeMark.js';

interface ChatEmptyStateProps {
  /** @deprecated Kept for API compatibility — settings are in the sidebar rail. */
  onOpenSettings?: () => void;
  onPrompt?: (prompt: string) => void;
}

export function ChatEmptyState(_props: ChatEmptyStateProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
      className="relative z-[1] flex min-h-full min-w-0 flex-col items-center justify-center px-6 py-12"
      data-clean-empty-state="v6"
    >
      <div className="relative mx-auto flex w-full max-w-2xl min-w-0 flex-col items-center text-center">
        <VaiWelcomeMark size="lg" />

        <motion.p
          initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.45 }}
          className="mt-8 max-w-md text-[15px] font-medium leading-6 tracking-[-0.01em] text-[color:var(--shell-text-muted)]"
        >
          Get started
        </motion.p>

        <motion.p
          initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.45 }}
          className="mt-2 max-w-sm text-[13px] leading-6 text-[color:var(--chat-muted)]"
        >
          Send a message to begin.
        </motion.p>
      </div>
    </motion.div>
  );
}
