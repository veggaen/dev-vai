/**
 * ArrowKeys — Visual arrow key pad overlay.
 *
 * Shows a compact 4-key arrow pad that lights up as Vai presses
 * arrow keys. This makes keyboard navigation visible for verification.
 *
 * Layout:
 *       [  ↑  ]
 *    [← ] [↓ ] [→ ]
 *
 * Appears near the cursor when any arrow key is active.
 */

import { AnimatePresence, motion } from 'framer-motion';

const _ARROW_KEYS = [
  { key: 'ArrowUp',    symbol: '↑', row: 0, col: 1 },
  { key: 'ArrowLeft',  symbol: '←', row: 1, col: 0 },
  { key: 'ArrowDown',  symbol: '↓', row: 1, col: 1 },
  { key: 'ArrowRight', symbol: '→', row: 1, col: 2 },
] as const;

interface ArrowKeysProps {
  /** Currently active arrow key or null */
  activeKey: string | null;
  /** Anchor position (cursor position) */
  anchorX: number;
  anchorY: number;
  /** Container dimensions for smart positioning */
  containerWidth?: number;
  containerHeight?: number;
}

export function ArrowKeys({
  activeKey, anchorX, anchorY,
  containerWidth = 1200, containerHeight = 800,
}: ArrowKeysProps) {
  const isVisible = !!activeKey;

  // Position: bottom-right of cursor, clamped to viewport
  const padW = 110;
  const padH = 80;
  let left = anchorX + 50;
  let top = anchorY + 50;
  if (left + padW > containerWidth - 8) left = anchorX - padW - 20;
  if (top + padH > containerHeight - 8) top = anchorY - padH - 20;
  left = Math.max(8, left);
  top = Math.max(8, top);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="pointer-events-none absolute z-[63]"
          style={{ left, top }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.12 }}
        >
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/90 p-2 shadow-2xl shadow-black/40 backdrop-blur-lg">
            {/* Top row — just Up arrow centered */}
            <div className="flex justify-center gap-[3px] mb-[3px]">
              {/* Empty space for left alignment */}
              <div className="w-8 h-8" />
              <ArrowKey
                symbol="↑"
                active={activeKey === 'ArrowUp'}
              />
              <div className="w-8 h-8" />
            </div>
            {/* Bottom row — Left, Down, Right */}
            <div className="flex justify-center gap-[3px]">
              <ArrowKey
                symbol="←"
                active={activeKey === 'ArrowLeft'}
              />
              <ArrowKey
                symbol="↓"
                active={activeKey === 'ArrowDown'}
              />
              <ArrowKey
                symbol="→"
                active={activeKey === 'ArrowRight'}
              />
            </div>
            {/* Label */}
            <div className="mt-1 text-center text-[7px] text-zinc-600">
              Arrow keys
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ArrowKey({ symbol, active }: { symbol: string; active: boolean }) {
  return (
    <motion.div
      className={`flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold transition-colors ${
        active
          ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/40'
          : 'bg-zinc-800/60 text-zinc-500'
      }`}
      animate={active ? { scale: [1, 0.82, 1] } : { scale: 1 }}
      transition={{ duration: 0.12 }}
    >
      {symbol}
    </motion.div>
  );
}
