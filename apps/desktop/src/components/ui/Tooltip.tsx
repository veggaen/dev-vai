/**
 * Tooltip — Vai's standard hover/focus tip. Part of the craft layer: every hint in the app
 * should feel the same, and feel intentional.
 *
 * Details that make it feel world-class:
 *  • soft spring in, instant out; a short open-delay so it never flickers on pass-through;
 *  • portalled to <body> so it is NEVER clipped by an overflow:hidden panel;
 *  • edge-aware — auto-flips top↔bottom near the viewport edge;
 *  • keyboard-accessible (shows on focus, hides on Escape, role="tooltip");
 *  • optional keyboard shortcut chip, so hovering also teaches the hotkey.
 *
 * A thin inline-flex wrapper carries the hover/focus handlers — deliberately avoiding
 * cloneElement so it can't trip React 19's stricter element typings.
 *
 * Usage:  <Tooltip label="Dictate" shortcut="Ctrl+Shift+Space"><button …/></Tooltip>
 */

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

type Placement = 'top' | 'bottom';

interface TooltipProps {
  readonly label: ReactNode;
  readonly shortcut?: string;
  readonly placement?: Placement;
  readonly delay?: number;
  readonly children: ReactNode;
}

interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly place: Placement;
}

const GAP = 9;
const SPRING = { type: 'spring', stiffness: 500, damping: 32 } as const;

export function Tooltip({ label, shortcut, placement = 'top', delay = 340, children }: TooltipProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const timer = useRef(0);
  const id = useId();

  const open = useCallback((el: HTMLElement) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      const place: Placement = placement === 'top' && r.top < 64 ? 'bottom'
        : placement === 'bottom' && window.innerHeight - r.bottom < 64 ? 'top'
        : placement;
      setAnchor({ x: r.left + r.width / 2, y: place === 'top' ? r.top - GAP : r.bottom + GAP, place });
    }, delay);
  }, [delay, placement]);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setAnchor(null);
  }, []);

  return (
    <>
      <span
        className="inline-flex"
        aria-describedby={anchor ? id : undefined}
        onMouseEnter={(e) => open(e.currentTarget)}
        onMouseLeave={close}
        onFocus={(e) => open(e.currentTarget)}
        onBlur={close}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      >
        {children}
      </span>
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {anchor && (
            <motion.div
              id={id}
              role="tooltip"
              className="pointer-events-none fixed z-[999]"
              style={{ left: anchor.x, top: anchor.y }}
              initial={{ opacity: 0, scale: 0.94, y: anchor.place === 'top' ? 4 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: anchor.place === 'top' ? 3 : -3 }}
              transition={SPRING}
            >
              <div
                className={`flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-white/10 bg-[#181c23]/95 px-2.5 py-1.5 text-[11.5px] font-medium text-[color:var(--chat-body,#EAECEF)] shadow-[0_10px_30px_rgba(0,0,0,.45)] backdrop-blur-md ${anchor.place === 'top' ? '-translate-y-full' : ''}`}
              >
                <span>{label}</span>
                {shortcut && (
                  <kbd className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--chat-muted,#9AA0AA)]">
                    {shortcut}
                  </kbd>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

export default Tooltip;
