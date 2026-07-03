import { motion, useScroll, useSpring } from 'framer-motion';
import { Magnetic } from './primitives';
import { useSectionSpy } from '../lib/hooks';

export const SECTIONS = [
  { id: 'hero', label: 'Orbit' },
  { id: 'features', label: 'Systems' },
  { id: 'pipeline', label: 'Council' },
  { id: 'showcase', label: 'Missions' },
  { id: 'stats', label: 'Telemetry' },
  { id: 'faq', label: 'Signals' },
] as const;

const IDS = SECTIONS.map((s) => s.id);

export default function Nav({ onPalette }: { onPalette: () => void }) {
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 26 });
  const active = useSectionSpy(IDS);

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="glass fixed inset-x-3 top-3 z-50 rounded-2xl sm:inset-x-6"
      data-testid="nav"
    >
      <motion.div
        className="absolute inset-x-0 top-0 h-[2px] origin-left rounded-full bg-gradient-to-r from-aura-500 via-pulse-400 to-ember-400"
        style={{ scaleX: progress }}
        data-testid="scroll-progress"
      />
      <nav className="flex items-center justify-between px-4 py-3 sm:px-6" aria-label="Primary">
        <a href="#hero" className="font-display text-sm font-bold uppercase tracking-[0.3em] text-white">
          VAI<span className="text-gradient">·ORBIT</span>
        </a>

        <ul className="hidden items-center gap-1 md:flex">
          {SECTIONS.slice(1).map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                data-nav={s.id}
                className={`relative rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors ${
                  active === s.id ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {active === s.id && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full bg-white/10"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative">{s.label}</span>
              </a>
            </li>
          ))}
        </ul>

        <Magnetic strength={0.25}>
          <button
            onClick={onPalette}
            data-testid="palette-trigger"
            className="shimmer-border flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/10"
          >
            <span className="hidden sm:inline">Command</span>
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
          </button>
        </Magnetic>
      </nav>
    </motion.header>
  );
}
