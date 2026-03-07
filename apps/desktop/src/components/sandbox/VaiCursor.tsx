/**
 * VaiCursor — Phase 0 AI cursor with eased cubic interpolation.
 *
 * Unlike basic spring animation, this uses cubic easing for organic,
 * human-like movement. The cursor follows a smooth path with slight
 * overshoot and natural deceleration.
 *
 * Features:
 *   • Eased cubic interpolation (not spring — intentional)
 *   • Click ripple effect with scale-down feedback
 *   • Hover glow ring for focus indication
 *   • Typing indicator (pulsing dot when virtual keyboard is active)
 *   • "Vai" label badge follows cursor
 *   • Trail effect — subtle afterimage on fast moves
 */

import { useRef, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/* ── Eased cubic interpolation helper ── */
function easedCubic(t: number): number {
  // ease-in-out cubic: smooth start, smooth end
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * easedCubic(t);
}

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  clicking: boolean;
  hovering: boolean;
  typing: boolean;
  label?: string;
}

/* Default state — used by PreviewPanel to initialize cursor */
export const CURSOR_INITIAL: CursorState = {
  x: 0, y: 0, visible: false,
  clicking: false, hovering: false, typing: false,
};

interface VaiCursorProps {
  state: CursorState;
}

export function VaiCursor({ state }: VaiCursorProps) {
  const { x, y, visible, clicking, hovering, typing, label } = state;
  const posRef = useRef({ x, y });
  const animRef = useRef<number>(0);
  const [displayPos, setDisplayPos] = useState({ x, y });
  const [showTrail, setShowTrail] = useState(false);

  // Eased cubic animation loop — smoother than spring for cursor movement
  useEffect(() => {
    if (!visible) return;

    const targetX = x;
    const targetY = y;
    const startX = posRef.current.x;
    const startY = posRef.current.y;
    const distance = Math.hypot(targetX - startX, targetY - startY);

    // Show trail on large moves
    if (distance > 100) setShowTrail(true);

    const duration = Math.min(600, Math.max(200, distance * 1.5)); // ms
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);

      const cx = lerp(startX, targetX, t);
      const cy = lerp(startY, targetY, t);
      posRef.current = { x: cx, y: cy };
      setDisplayPos({ x: cx, y: cy });

      if (t < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        setShowTrail(false);
      }
    };

    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animRef.current);
  }, [x, y, visible]);

  if (!visible) return null;

  return (
    <>
      {/* Trail — afterimage on fast moves */}
      <AnimatePresence>
        {showTrail && (
          <motion.div
            className="pointer-events-none absolute z-[61]"
            style={{ left: displayPos.x, top: displayPos.y }}
            initial={{ opacity: 0.4, scale: 1 }}
            animate={{ opacity: 0, scale: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="opacity-40">
              <path d="M5 3L19 12L12 13L9 20L5 3Z" fill="#8B5CF6" />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main cursor */}
      <div
        className="pointer-events-none absolute z-[62]"
        style={{
          left: displayPos.x,
          top: displayPos.y,
          transform: clicking ? 'scale(0.85)' : 'scale(1)',
          transition: 'transform 0.1s ease-out',
        }}
      >
        {/* Hover glow ring */}
        {hovering && (
          <motion.div
            className="absolute -left-5 -top-5 h-16 w-16 rounded-full"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              background: 'radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)',
            }}
          />
        )}

        {/* Cursor SVG — large, visible, with glow */}
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="drop-shadow-[0_0_8px_rgba(139,92,246,0.6)]">
          <path
            d="M5 3L19 12L12 13L9 20L5 3Z"
            fill="#8B5CF6"
            stroke="#C4B5FD"
            strokeWidth="1.5"
          />
        </svg>

        {/* Click ripple */}
        <AnimatePresence>
          {clicking && (
            <motion.div
              key="ripple"
              className="absolute left-0 top-0 h-8 w-8 rounded-full border-2 border-violet-400"
              initial={{ scale: 0.5, opacity: 1 }}
              animate={{ scale: 4, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>

        {/* Typing indicator */}
        {typing && (
          <motion.div
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-blue-400"
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
            transition={{ duration: 0.8, repeat: Infinity }}
          />
        )}

        {/* Label badge */}
        <div className="absolute left-7 top-6 whitespace-nowrap rounded-full bg-violet-600 px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-lg shadow-violet-500/40">
          {label || 'Vai'}
        </div>
      </div>
    </>
  );
}
