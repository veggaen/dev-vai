import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

const STAGES = [
  { key: 'intent', name: 'Intent', desc: 'Parse what was actually asked — not just the words.', color: '#818cf8' },
  { key: 'route', name: 'Route', desc: 'Deterministic dispatch to the strongest capability.', color: '#22d3ee' },
  { key: 'draft', name: 'Draft', desc: 'Vai writes the answer with curated knowledge first.', color: '#34d399' },
  { key: 'council', name: 'Council', desc: 'Skeptic · Pragmatist · Intent-reader interrogate the draft.', color: '#fbbf24' },
  { key: 'ground', name: 'Ground', desc: 'Every claim checked against retrieved evidence.', color: '#fb7185' },
  { key: 'ship', name: 'Ship', desc: 'Verified, sourced, streamed — with honest uncertainty.', color: '#e879f9' },
];

export default function Pipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 75%', 'end 45%'] });
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section id="pipeline" className="relative mx-auto max-w-5xl px-6 py-32">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7 }}
        className="mb-20 max-w-2xl"
      >
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-pulse-400">02 · Council</p>
        <h2 className="font-display text-4xl font-bold text-white sm:text-5xl">
          Six gates. <span className="text-gradient">Zero guesswork.</span>
        </h2>
      </motion.div>

      <div ref={ref} className="relative" data-testid="pipeline">
        {/* spine */}
        <div className="absolute left-[19px] top-2 bottom-2 w-px bg-white/8 sm:left-1/2" />
        <motion.div
          className="absolute left-[19px] top-2 bottom-2 w-px origin-top bg-gradient-to-b from-aura-400 via-pulse-400 to-ember-400 sm:left-1/2"
          style={{ scaleY: lineScale }}
        />

        <ol className="space-y-14">
          {STAGES.map((s, i) => {
            const left = i % 2 === 0;
            return (
              <motion.li
                key={s.key}
                initial={{ opacity: 0, x: left ? -36 : 36 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-90px' }}
                transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
                className={`relative flex gap-6 pl-14 sm:w-1/2 sm:pl-0 ${
                  left ? 'sm:pr-14 sm:text-right' : 'sm:ml-auto sm:pl-14'
                }`}
                data-stage={s.key}
              >
                <motion.span
                  initial={{ scale: 0 }}
                  whileInView={{ scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.15 }}
                  className={`absolute top-1 flex h-10 w-10 items-center justify-center rounded-full border font-mono text-xs font-semibold left-0 sm:left-auto ${
                    left ? 'sm:-right-5' : 'sm:-left-5'
                  }`}
                  style={{ borderColor: s.color, color: s.color, background: '#0a0a12', boxShadow: `0 0 24px ${s.color}44` }}
                >
                  {String(i + 1).padStart(2, '0')}
                </motion.span>
                <div>
                  <h3 className="font-display mb-1.5 text-xl font-semibold text-white">{s.name}</h3>
                  <p className="text-sm leading-relaxed text-zinc-400">{s.desc}</p>
                </div>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
