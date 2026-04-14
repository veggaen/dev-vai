/**
 * ScrollIndicator — Visual feedback when Vai scrolls.
 *
 * Shows a scroll direction arrow + scroll amount near the cursor position.
 * Appears briefly when Vai performs a scroll action, making scrolling visible.
 *
 * Features:
 *   • Up/down direction arrow with animated motion lines
 *   • Scroll distance label (e.g. "↓ 300px")
 *   • Position tracks where the scroll happened
 *   • Auto-fades after brief display
 */

import { AnimatePresence, motion } from 'framer-motion';

interface ScrollIndicatorProps {
  /** Whether the indicator is visible */
  active: boolean;
  /** Scroll direction: positive = down, negative = up */
  deltaY: number;
  /** Position where scroll occurred */
  x: number;
  y: number;
}

export function ScrollIndicator({ active, deltaY, x, y }: ScrollIndicatorProps) {
  const isDown = deltaY > 0;
  const amount = Math.abs(deltaY);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="pointer-events-none absolute z-[63]"
          style={{ left: x + 40, top: y - 20 }}
          initial={{ opacity: 0, y: isDown ? -10 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: isDown ? 10 : -10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <div className="flex flex-col items-center gap-1">
            {/* Direction arrow with motion lines */}
            <div className="relative flex flex-col items-center">
              {!isDown && (
                <motion.div
                  className="flex flex-col items-center gap-0.5 mb-1"
                  animate={{ y: [-2, 2, -2] }}
                  transition={{ duration: 0.6, repeat: 2 }}
                >
                  <div className="h-[2px] w-4 rounded-full bg-cyan-400/60" />
                  <div className="h-[2px] w-6 rounded-full bg-cyan-400/40" />
                  <div className="h-[2px] w-3 rounded-full bg-cyan-400/20" />
                </motion.div>
              )}

              <motion.div
                className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-900/80 text-lg font-bold text-cyan-300 shadow-lg shadow-cyan-500/20 backdrop-blur-md"
                animate={{ 
                  y: isDown ? [0, 4, 0] : [0, -4, 0],
                  scale: [1, 1.1, 1],
                }}
                transition={{ duration: 0.4 }}
              >
                {isDown ? '↓' : '↑'}
              </motion.div>

              {isDown && (
                <motion.div
                  className="flex flex-col items-center gap-0.5 mt-1"
                  animate={{ y: [2, -2, 2] }}
                  transition={{ duration: 0.6, repeat: 2 }}
                >
                  <div className="h-[2px] w-3 rounded-full bg-cyan-400/20" />
                  <div className="h-[2px] w-6 rounded-full bg-cyan-400/40" />
                  <div className="h-[2px] w-4 rounded-full bg-cyan-400/60" />
                </motion.div>
              )}
            </div>

            {/* Amount label */}
            <div className="rounded-md bg-zinc-900/90 px-2 py-0.5 text-[9px] font-semibold text-cyan-300 shadow-md backdrop-blur-md border border-cyan-500/20">
              {isDown ? '↓' : '↑'} {amount}px
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
