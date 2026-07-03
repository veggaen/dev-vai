import { useEffect, useRef } from 'react';
import { motion, useInView, useMotionValue, useSpring, useTransform, animate } from 'framer-motion';

const STATS = [
  { label: 'unit tests green', value: 4871, suffix: '' },
  { label: 'bench accuracy', value: 99.6, suffix: '%', decimals: 1 },
  { label: 'avg answer latency', value: 1.1, suffix: 's', decimals: 1 },
  { label: 'API cost per answer', value: 0, suffix: '$' },
];

function Counter({ value, suffix = '', decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 60, damping: 20 });
  const text = useTransform(spring, (v) => `${v.toFixed(decimals)}${suffix}`);

  useEffect(() => {
    if (inView) {
      const controls = animate(mv, value, { duration: 1.6, ease: 'circOut' });
      return controls.stop;
    }
  }, [inView, mv, value]);

  return (
    <span ref={ref} className="tabular-nums">
      <motion.span>{text}</motion.span>
    </span>
  );
}

export default function Stats() {
  return (
    <section id="stats" className="relative mx-auto max-w-7xl px-6 py-32">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7 }}
        className="mb-16 max-w-2xl"
      >
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-pulse-400">04 · Telemetry</p>
        <h2 className="font-display text-4xl font-bold text-white sm:text-5xl">
          Numbers that <span className="text-gradient">survive review.</span>
        </h2>
      </motion.div>

      <div className="grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 sm:grid-cols-2 lg:grid-cols-4" data-testid="stats-grid">
        {STATS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ delay: i * 0.08, duration: 0.6 }}
            className="bg-ink p-8"
          >
            <div className="font-display text-4xl font-bold text-gradient sm:text-5xl">
              <Counter value={s.value} suffix={s.suffix} decimals={s.decimals ?? 0} />
            </div>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">{s.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
