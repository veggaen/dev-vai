import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

/** Boot preloader: counts to 100 with a wordmark draw, exits with a clip wipe. */
export default function Preloader({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    let raf: number;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1150);
      // ease-out so the last digits feel deliberate
      setN(Math.round(100 * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setTimeout(onDone, 260);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  return (
    <motion.div
      data-testid="preloader"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-void"
      exit={{ clipPath: 'inset(0 0 100% 0)' }}
      transition={{ duration: 0.7, ease: [0.83, 0, 0.17, 1] }}
    >
      <div className="flex flex-col items-center gap-6">
        <motion.span
          initial={{ opacity: 0, letterSpacing: '0.6em' }}
          animate={{ opacity: 1, letterSpacing: '0.28em' }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          className="font-display text-2xl font-semibold uppercase text-gradient"
        >
          Vai Orbit
        </motion.span>
        <div className="h-px w-48 overflow-hidden bg-white/10">
          <motion.div
            className="h-full bg-gradient-to-r from-aura-500 to-pulse-400"
            style={{ width: `${n}%` }}
          />
        </div>
        <span className="font-mono text-xs tabular-nums text-zinc-500">{n.toString().padStart(3, '0')} / 100</span>
      </div>
    </motion.div>
  );
}
