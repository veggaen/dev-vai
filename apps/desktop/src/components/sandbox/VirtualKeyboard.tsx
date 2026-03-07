/**
 * VirtualKeyboard — Phase 0 on-screen keyboard overlay.
 *
 * Renders a translucent keyboard overlay near the cursor position when Vai
 * is typing into a form field. Keys light up as they're "pressed" to give
 * visual feedback of AI keystroke simulation.
 *
 * Features:
 *   • Standard QWERTY layout (3 rows + space bar)
 *   • Smart positioning — stays within viewport bounds
 *   • Active key highlight with press animation
 *   • Appears/disappears with smooth AnimatePresence
 *   • Transparent backdrop — preview content still visible beneath
 */

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/* ── Keyboard layout ── */
const KB_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
] as const;

interface VirtualKeyboardProps {
  /** Whether the keyboard is visible */
  visible: boolean;
  /** Anchor position (cursor or input field location) */
  anchorX: number;
  anchorY: number;
  /** Currently pressed key (uppercase) or null */
  activeKey: string | null;
  /** Container dimensions for smart positioning */
  containerWidth?: number;
  containerHeight?: number;
}

export function VirtualKeyboard({
  visible, anchorX, anchorY, activeKey,
  containerWidth = 800, containerHeight = 600,
}: VirtualKeyboardProps) {
  // Smart positioning: keep keyboard within container bounds
  const { left, top } = useMemo(() => {
    const kbWidth = 320;
    const kbHeight = 140;
    let l = anchorX - kbWidth / 2;
    let t = anchorY + 30; // below cursor

    // Clamp to container
    l = Math.max(8, Math.min(l, containerWidth - kbWidth - 8));
    // If below cursor would overflow, place above
    if (t + kbHeight > containerHeight - 8) {
      t = anchorY - kbHeight - 20;
    }
    t = Math.max(8, t);

    return { left: l, top: t };
  }, [anchorX, anchorY, containerWidth, containerHeight]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none absolute z-25"
          style={{ left, top }}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/85 p-2 shadow-2xl shadow-black/40 backdrop-blur-lg">
            {/* Keyboard rows */}
            {KB_ROWS.map((row, ri) => (
              <div
                key={ri}
                className="flex justify-center gap-[3px]"
                style={{ marginLeft: ri === 1 ? 12 : ri === 2 ? 24 : 0 }}
              >
                {row.map((key) => {
                  const isActive = activeKey?.toUpperCase() === key;
                  return (
                    <motion.div
                      key={key}
                      className={`flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-medium transition-colors ${
                        isActive
                          ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/40'
                          : 'bg-zinc-800/60 text-zinc-500'
                      }`}
                      animate={isActive ? { scale: [1, 0.85, 1] } : { scale: 1 }}
                      transition={{ duration: 0.15 }}
                    >
                      {key}
                    </motion.div>
                  );
                })}
              </div>
            ))}

            {/* Space bar */}
            <div className="mt-[3px] flex justify-center">
              <motion.div
                className={`flex h-7 w-40 items-center justify-center rounded-md text-[9px] font-medium transition-colors ${
                  activeKey === ' '
                    ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/40'
                    : 'bg-zinc-800/60 text-zinc-600'
                }`}
                animate={activeKey === ' ' ? { scale: [1, 0.95, 1] } : { scale: 1 }}
                transition={{ duration: 0.15 }}
              >
                SPACE
              </motion.div>
            </div>

            {/* Label */}
            <div className="mt-1.5 text-center text-[8px] text-zinc-600">
              Vai is typing...
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
