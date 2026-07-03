import { motion } from 'framer-motion';
import HeroScene from './HeroScene';
import { Magnetic } from './primitives';

const HEADLINE = 'Orchestrate intelligence.';

export default function Hero({ warp }: { warp: boolean }) {
  return (
    <section id="hero" className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      <div className="grid-bg absolute inset-0" aria-hidden />
      <HeroScene warp={warp} />

      <div className="pointer-events-none relative z-10 flex flex-col items-center px-6 text-center">
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.7 }}
          className="mb-5 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.25em] text-pulse-400"
        >
          {warp ? '⚡ hyperdrive engaged' : 'the intelligence layer'}
        </motion.p>

        <h1 className="font-display max-w-5xl text-5xl font-bold leading-[1.05] text-white sm:text-7xl lg:text-8xl" aria-label={HEADLINE}>
          {HEADLINE.split('').map((ch, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 40, rotateX: 90 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              transition={{ delay: 0.45 + i * 0.028, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className={ch === ' ' ? 'inline-block w-[0.28em]' : 'inline-block'}
            >
              {ch === ' ' ? '\u00A0' : ch}
            </motion.span>
          ))}
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.35, duration: 0.8 }}
          className="mt-6 max-w-xl text-base text-zinc-400 sm:text-lg"
        >
          One deterministic core. A council of models. Every capability in orbit —
          routed, grounded, verified before it ever reaches you.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.55, duration: 0.8 }}
          className="pointer-events-auto mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <Magnetic>
            <a
              href="#features"
              data-testid="cta-primary"
              className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-aura-500 to-pulse-500 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-aura-500/25 transition-shadow hover:shadow-aura-500/50"
            >
              Enter the system
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </a>
          </Magnetic>
          <Magnetic>
            <a
              href="#pipeline"
              className="shimmer-border inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-7 py-3 text-sm font-medium text-zinc-200 backdrop-blur transition-colors hover:bg-white/10"
            >
              Meet the council
            </a>
          </Magnetic>
        </motion.div>
      </div>

      <motion.a
        href="#features"
        aria-label="Scroll down"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.2 }}
        className="absolute bottom-8 z-10 flex flex-col items-center gap-2 text-zinc-500"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]">scroll</span>
        <motion.span
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
          className="block h-8 w-px bg-gradient-to-b from-zinc-500 to-transparent"
        />
      </motion.a>
    </section>
  );
}
