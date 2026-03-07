/**
 * RecordingBadge — Visible "REC" indicator overlay.
 *
 * Shows a pulsing red dot + "REC" label + elapsed time in the top-right
 * corner of the viewport when Vai is recording the screen. This makes
 * it obvious to anyone watching that recording is active.
 *
 * Design:
 *   🔴 REC  00:15
 *   ^^^^^^^^^^^^^^^^^^
 *   Pulsing dot + label + timer
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface RecordingBadgeProps {
  /** Whether recording is active */
  active: boolean;
  /** Timestamp when recording started (Date.now()) */
  startTime: number;
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function RecordingBadge({ active, startTime }: RecordingBadgeProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active || !startTime) { setElapsed(0); return; }
    const tick = () => setElapsed(Date.now() - startTime);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, startTime]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="pointer-events-none fixed right-5 top-5 z-[55] flex items-center gap-2 rounded-full border border-red-500/30 bg-zinc-950/90 px-4 py-2 shadow-2xl shadow-red-900/30 backdrop-blur-sm"
          initial={{ opacity: 0, x: 20, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 20, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {/* Pulsing red dot */}
          <motion.div
            className="h-3 w-3 rounded-full bg-red-500 shadow-lg shadow-red-500/50"
            animate={{
              scale: [1, 1.3, 1],
              opacity: [1, 0.7, 1],
              boxShadow: [
                '0 0 4px rgba(239,68,68,0.5)',
                '0 0 12px rgba(239,68,68,0.8)',
                '0 0 4px rgba(239,68,68,0.5)',
              ],
            }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* REC label */}
          <span className="text-xs font-bold tracking-wider text-red-400">
            REC
          </span>

          {/* Elapsed time */}
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">
            {formatElapsed(elapsed)}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
