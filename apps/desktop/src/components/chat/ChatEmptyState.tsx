/**
 * ChatEmptyState — first-viewport hero for a fresh chat.
 *
 * Deliberately minimal: the Vai planet mark (logo + halo + orbiting particles) and one short line.
 * Nothing else — no brand label, headline, lede, workflow table, or suggestion deck. The composer
 * at the bottom is the primary action.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { VaiPlanetMark } from './VaiPlanetMark.js';
import { SelfImprovements } from './SelfImprovements.js';
import { useLayoutStore } from '../../stores/layoutStore.js';

interface ChatEmptyStateProps {
  /** @deprecated Kept for API compatibility — settings are in the sidebar rail. */
  onOpenSettings?: () => void;
  /** @deprecated No longer renders a suggestion deck; kept for API compatibility. */
  onPrompt?: (prompt: string) => void;
}

export function ChatEmptyState(_props: ChatEmptyStateProps) {
  const prefersReducedMotion = useReducedMotion();
  const mode = useLayoutStore((s) => s.mode);
  const isBuild = mode === 'builder' || mode === 'agent';

  const line = isBuild ? 'From intent to running software.' : 'Ask Vai anything.';

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
      className="vai-launchpad relative z-[1] flex min-h-full min-w-0 flex-col items-center justify-center px-5 pb-56 pt-10 sm:px-8 md:pb-52"
      data-clean-empty-state="v9"
    >
      <VaiPlanetMark size={132} />

      <motion.p
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="mt-2 text-center font-display text-[15px] font-medium tracking-[-0.01em] text-[color:var(--chat-muted)]"
      >
        {line}
      </motion.p>

      {/* One quiet, collapsed line: what the Council recently improved about Vai. Renders nothing
          until there is at least one entry, so the resting hero stays calm; open it to unfold the
          recent self-improvements (each already expanded) and copy any for debugging. */}
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.5 }}
        className="mt-6 w-full max-w-[30rem]"
      >
        <SelfImprovements pollMs={30000} />
      </motion.div>
    </motion.div>
  );
}
