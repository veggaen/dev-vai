import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

const MISSIONS = [
  { tag: 'BUILD', title: 'Scaffold a monorepo in one prompt', body: 'Sandbox files written, preview live, deploy markers verified — before you finish your coffee.', hue: 243 },
  { tag: 'RESEARCH', title: 'Grounded answers with receipts', body: 'Sources ranked by official-domain trust. Freshness reasoned about explicitly, not assumed.', hue: 190 },
  { tag: 'VISION', title: 'Screenshot → landing page', body: 'Reference-driven workflows that honor the design you showed, not a generic template.', hue: 330 },
  { tag: 'VOICE', title: 'Local speech, both directions', body: 'Whisper in, Piper out. Conversations that never leave your machine.', hue: 150 },
  { tag: 'COUNCIL', title: 'Adversarial self-review', body: 'Drafts survive a skeptic before they reach you. Overconfidence dies in review.', hue: 45 },
];

export default function Showcase() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref });
  const x = useTransform(scrollYProgress, [0, 1], ['2%', '-68%']);

  return (
    <section id="showcase" ref={ref} className="relative h-[340vh]" data-testid="showcase">
      <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden">
        <div className="mx-auto mb-10 w-full max-w-7xl px-6">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-pulse-400">03 · Missions</p>
          <h2 className="font-display text-4xl font-bold text-white sm:text-5xl">
            Scroll <span className="text-gradient">sideways</span> through the log.
          </h2>
        </div>

        <motion.div style={{ x }} className="flex gap-6 pl-6 will-change-transform">
          {MISSIONS.map((m, i) => (
            <article
              key={m.tag}
              data-mission={m.tag}
              className="group relative flex h-[380px] w-[320px] shrink-0 flex-col justify-between overflow-hidden rounded-3xl border border-white/8 p-8 sm:w-[420px]"
              style={{
                background: `linear-gradient(160deg, hsl(${m.hue} 60% 12% / 0.9), #0a0a12 65%)`,
              }}
            >
              <div
                className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full blur-3xl transition-opacity duration-500 opacity-40 group-hover:opacity-80"
                style={{ background: `hsl(${m.hue} 80% 55% / 0.25)` }}
              />
              <div className="flex items-center justify-between">
                <span
                  className="rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em]"
                  style={{ borderColor: `hsl(${m.hue} 80% 60% / 0.5)`, color: `hsl(${m.hue} 90% 70%)` }}
                >
                  {m.tag}
                </span>
                <span className="font-mono text-xs text-zinc-600">{String(i + 1).padStart(2, '0')} / {String(MISSIONS.length).padStart(2, '0')}</span>
              </div>
              <div>
                <h3 className="font-display mb-3 text-2xl font-semibold leading-snug text-white">{m.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">{m.body}</p>
              </div>
            </article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
