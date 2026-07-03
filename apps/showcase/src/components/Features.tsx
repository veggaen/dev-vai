import { motion } from 'framer-motion';
import { TiltCard } from './primitives';

const FEATURES = [
  {
    icon: '◈',
    title: 'Deterministic core',
    body: 'Intent, routing, curated facts and safety run first — every time. No dice rolls on the critical path.',
    accent: 'from-aura-500/20',
  },
  {
    icon: '⬡',
    title: 'Consensus council',
    body: 'A skeptic, a pragmatist and an intent-reader review every substantive draft before it ships.',
    accent: 'from-pulse-500/20',
  },
  {
    icon: '◎',
    title: 'Grounded answers',
    body: 'Claims are checked against retrieved evidence. Uncertainty is stated, never smoothed over.',
    accent: 'from-ember-500/20',
  },
  {
    icon: '⌘',
    title: 'Command everything',
    body: 'Palette-first UX. Every surface reachable in two keystrokes — try it right now.',
    accent: 'from-aura-500/20',
  },
  {
    icon: '⚡',
    title: 'Local-first speed',
    body: 'Open-weight models on your machine. Zero API cost, zero data leaving the building.',
    accent: 'from-pulse-500/20',
  },
  {
    icon: '∞',
    title: 'Capability orbit',
    body: 'Voice, vision, code, robotics — pluggable modules that dock when the core calls for them.',
    accent: 'from-ember-500/20',
  },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09 } },
};
const item = {
  hidden: { opacity: 0, y: 42, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-7xl px-6 py-32">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7 }}
        className="mb-16 max-w-2xl"
      >
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-pulse-400">01 · Systems</p>
        <h2 className="font-display text-4xl font-bold text-white sm:text-5xl">
          Everything in <span className="text-gradient">orbit</span>, nothing in the way.
        </h2>
      </motion.div>

      <motion.div
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-60px' }}
        className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="feature-grid"
      >
        {FEATURES.map((f) => (
          <motion.div key={f.title} variants={item}>
            <TiltCard className="group relative h-full overflow-hidden rounded-2xl border border-white/8 bg-haze/60 p-7 transition-colors duration-300 hover:border-white/20">
              <div className={`pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full bg-gradient-to-br ${f.accent} to-transparent blur-3xl transition-opacity duration-500 opacity-0 group-hover:opacity-100`} />
              <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xl text-pulse-400">
                {f.icon}
              </span>
              <h3 className="font-display mb-2 text-lg font-semibold text-white">{f.title}</h3>
              <p className="text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </TiltCard>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
