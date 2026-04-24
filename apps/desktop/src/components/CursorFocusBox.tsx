/**
 * CursorFocusBox — Ambient cursor highlight that follows the mouse.
 *
 * Renders a translucent bordered rectangle that "snaps" to the nearest
 * interactive element under the cursor. When Vai or the user hovers over
 * a button, card, dropdown, or input, the box smoothly resizes & repositions
 * to encompass that element — giving visual feedback of what's being targeted.
 *
 * When nothing interactive is nearby, it shows a compact glow dot.
 *
 * Uses requestAnimationFrame for smooth 60fps tracking.
 * Fully passive — pointer-events: none everywhere.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* ── Interactive element selectors ── */
const INTERACTIVE_SELECTOR = [
  'button', 'a[href]', 'input', 'textarea', 'select',
  '[role="button"]', '[role="tab"]', '[role="menuitem"]',
  '[data-vai-dropdown-trigger]', '[data-vai-dropdown-option]',
  '[data-panel]', '.cursor-pointer',
].join(', ');

interface FocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export function CursorFocusBox() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [focusRect, setFocusRect] = useState<FocusRect | null>(null);
  const [isOverInteractive, setIsOverInteractive] = useState(false);
  const rafRef = useRef<number>(0);
  const lastElementRef = useRef<Element | null>(null);

  const updateFocus = useCallback((mx: number, my: number) => {
    const el = document.elementFromPoint(mx, my);
    if (!el) {
      if (lastElementRef.current) {
        lastElementRef.current = null;
        setFocusRect(null);
        setIsOverInteractive(false);
      }
      return;
    }

    // Walk up the DOM to find the nearest interactive ancestor
    let interactive: Element | null = el.closest(INTERACTIVE_SELECTOR);

    // Skip if it's inside the overlay system (pointer-events: none anyway)
    if (interactive?.closest('.pointer-events-none')) {
      interactive = null;
    }

    if (interactive && interactive !== lastElementRef.current) {
      lastElementRef.current = interactive;
      const rect = interactive.getBoundingClientRect();
      const label = interactive.getAttribute('title')
        || interactive.getAttribute('aria-label')
        || interactive.textContent?.trim().substring(0, 30)
        || '';
      setFocusRect({
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        label,
      });
      setIsOverInteractive(true);
    } else if (!interactive && lastElementRef.current) {
      lastElementRef.current = null;
      setFocusRect(null);
      setIsOverInteractive(false);
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        updateFocus(e.clientX, e.clientY);
      });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, [updateFocus]);

  return (
    <>
      {/* Ambient cursor glow — small dot that follows mouse at all times */}
      <div
        className="pointer-events-none fixed z-[45] mix-blend-screen"
        style={{
          left: mousePos.x,
          top: mousePos.y,
          transform: 'translate(-50%, -50%)',
        }}
      >
        <div
          className="rounded-full transition-all duration-200"
          style={{
            width: isOverInteractive ? '40px' : '8px',
            height: isOverInteractive ? '40px' : '8px',
            background: isOverInteractive
              ? 'radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)',
            transition: 'width 0.2s ease, height 0.2s ease',
          }}
        />
      </div>

      {/* Focus box — snaps to interactive element */}
      <AnimatePresence>
        {focusRect && (
          <motion.div
            className="pointer-events-none fixed z-[44]"
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              x: focusRect.x - 4,
              y: focusRect.y - 4,
              width: focusRect.w + 8,
              height: focusRect.h + 8,
            }}
            exit={{ opacity: 0 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 35,
              mass: 0.5,
            }}
          >
            {/* Border box */}
            <div
              className="h-full w-full rounded-xl border border-violet-500/30 shadow-[0_0_15px_-3px_rgba(139,92,246,0.15)]"
              style={{
                background: 'linear-gradient(135deg, rgba(139,92,246,0.04) 0%, rgba(59,130,246,0.03) 100%)',
              }}
            />

            {/* Animated corner dots */}
            <div className="absolute -left-[2px] -top-[2px] h-1.5 w-1.5 rounded-full bg-violet-500/60" />
            <div className="absolute -right-[2px] -top-[2px] h-1.5 w-1.5 rounded-full bg-violet-500/60" />
            <div className="absolute -bottom-[2px] -left-[2px] h-1.5 w-1.5 rounded-full bg-violet-500/60" />
            <div className="absolute -bottom-[2px] -right-[2px] h-1.5 w-1.5 rounded-full bg-violet-500/60" />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
