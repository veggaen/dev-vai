/**
 * ScrollToBottom — Floating action button that appears when user scrolls up.
 * Smooth-scrolls back to the latest message on click.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDown } from 'lucide-react';

interface ScrollToBottomProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottom({ visible, onClick }: ScrollToBottomProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 8 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          onClick={onClick}
          className="absolute bottom-4 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700/60 bg-zinc-900/90 text-zinc-400 shadow-lg shadow-black/30 backdrop-blur-sm transition-colors hover:border-violet-500/40 hover:bg-zinc-800 hover:text-violet-400"
          title="Scroll to bottom"
        >
          <ArrowDown className="h-4 w-4" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
