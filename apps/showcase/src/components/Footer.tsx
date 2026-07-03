import { motion } from 'framer-motion';

const WORDS = ['DETERMINISTIC', 'GROUNDED', 'LOCAL-FIRST', 'COUNCIL-REVIEWED', 'VERIFIED', 'ORCHESTRATED'];

export function Marquee() {
  const row = [...WORDS, ...WORDS];
  return (
    <div className="relative overflow-hidden border-y border-white/8 bg-ink/60 py-5" aria-hidden data-testid="marquee">
      <div className="flex w-max animate-marquee gap-12 whitespace-nowrap">
        {row.map((w, i) => (
          <span key={i} className="flex items-center gap-12 font-display text-sm font-semibold uppercase tracking-[0.35em] text-zinc-600">
            {w}
            <span className="text-pulse-400">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-white/8 bg-ink">
      <div className="mx-auto max-w-7xl px-6 pb-10 pt-20">
        <motion.p
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 0.06, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          className="font-display pointer-events-none select-none text-center text-[18vw] font-bold leading-none text-white"
          aria-hidden
        >
          ORBIT
        </motion.p>

        <div className="mt-[-4vw] flex flex-col items-center justify-between gap-6 border-t border-white/8 pt-8 sm:flex-row">
          <p className="font-mono text-xs text-zinc-500">
            VAI·ORBIT — built with Three.js, Framer Motion & Tailwind. Proven with Playwright.
          </p>
          <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
            <span>↑↑↓↓←→←→BA</span>
            <span className="text-pulse-400">·</span>
            <span>⌘K anywhere</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
