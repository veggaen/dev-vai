/**
 * ChatEmptyState — first-viewport hero for a fresh chat.
 *
 * Deliberately minimal: the kinetic Vai mark (wireframe monogram + tracer loop + breathing glow)
 * and one short monospace line. The composer at the bottom is the primary action.
 *
 * Enter/exit is choreographed through variant propagation ("idle" → "in" → "out"): when the first
 * message sends, ChatWindow's AnimatePresence fires "out" — the node deploys upward, the arms
 * snap flat, glow and copy fade — and the conversation slides into place beneath. Infinite loops
 * (tracers, radar, breath) live in CSS so they never fight the framer variants.
 */

import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { VaiKineticMark } from './VaiKineticMark.js';
import { SelfImprovements } from './SelfImprovements.js';
import { useLayoutStore } from '../../stores/layoutStore.js';

interface ChatEmptyStateProps {
  /** @deprecated Kept for API compatibility — settings are in the sidebar rail. */
  onOpenSettings?: () => void;
  /** @deprecated No longer renders a suggestion deck; kept for API compatibility. */
  onPrompt?: (prompt: string) => void;
}

const easeInOut = [0.45, 0, 0.55, 1] as const;

const copyVariants: Variants = {
  idle: { opacity: 0, y: 8 },
  in: { opacity: 1, y: 0, transition: { delay: 0.35, duration: 0.5 } },
  out: { opacity: 0, y: -6, transition: { duration: 0.3, ease: easeInOut } },
};

const improvementsVariants: Variants = {
  idle: { opacity: 0, y: 8 },
  in: { opacity: 1, y: 0, transition: { delay: 0.5, duration: 0.5 } },
  out: { opacity: 0, transition: { duration: 0.25, ease: easeInOut } },
};

export function ChatEmptyState(_props: ChatEmptyStateProps) {
  const prefersReducedMotion = useReducedMotion();
  const mode = useLayoutStore((s) => s.mode);
  const isBuild = mode === 'builder' || mode === 'agent';

  const line = isBuild ? 'Ask. Plan. Verify. Validate. Execute.' : 'Ask Vai anything.';

  return (
    <motion.div
      variants={{ idle: { opacity: prefersReducedMotion ? 1 : 0 }, in: { opacity: 1 }, out: { opacity: 0, transition: { duration: 0.4 } } }}
      initial="idle"
      animate="in"
      exit="out"
      transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
      className="vai-launchpad relative z-[1] flex min-h-full min-w-0 flex-col items-center justify-center px-5 pb-56 pt-10 sm:px-8 md:pb-52"
      data-clean-empty-state="v10"
    >
      <VaiKineticMark size={148} />

      <motion.p
        variants={copyVariants}
        className="vai-launchpad-line mt-2 text-center font-mono text-[13px] tracking-[0.04em]"
      >
        {line}
      </motion.p>

      {/* One quiet, collapsed line: what the Council recently improved about Vai. Renders nothing
          until there is at least one entry, so the resting hero stays calm; open it to unfold the
          recent self-improvements (each already expanded) and copy any for debugging. */}
      <motion.div variants={improvementsVariants} className="mt-6 w-full max-w-[30rem]">
        <SelfImprovements pollMs={30000} />
      </motion.div>
    </motion.div>
  );
}
