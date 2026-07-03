import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const QA = [
  { q: 'Is this yet another LLM wrapper?', a: 'No. Vai is a deterministic orchestration engine. Language models are staff it consults — the core routes, grounds, and verifies every answer itself. The curated path always wins first.' },
  { q: 'What does the council actually do?', a: 'On substantive turns, a panel of local models (skeptic, pragmatist, intent-reader) critiques the draft\u2019s intent and method. Vai owns every user-facing fact; drafts get redrafted until the council is satisfied.' },
  { q: 'Does my data leave the machine?', a: 'Not by default. Reasoning, speech, and vision run on open-weight local models. Cloud providers are optional accelerators — off unless explicitly enabled.' },
  { q: 'What is hyperdrive?', a: 'Try the Konami code — ↑↑↓↓←→←→BA — and find out. Some features are earned, not documented.' },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="relative mx-auto max-w-3xl px-6 py-32">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7 }}
        className="mb-14"
      >
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-pulse-400">05 · Signals</p>
        <h2 className="font-display text-4xl font-bold text-white sm:text-5xl">
          Asked & <span className="text-gradient">answered.</span>
        </h2>
      </motion.div>

      <div className="space-y-3" data-testid="faq">
        {QA.map((item, i) => {
          const isOpen = open === i;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ delay: i * 0.06, duration: 0.5 }}
              className={`overflow-hidden rounded-2xl border transition-colors duration-300 ${
                isOpen ? 'border-aura-500/40 bg-haze/80' : 'border-white/8 bg-haze/40 hover:border-white/20'
              }`}
            >
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                data-faq={i}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="font-display text-base font-medium text-white sm:text-lg">{item.q}</span>
                <motion.span
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="shrink-0 text-xl text-pulse-400"
                >
                  +
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <p className="px-6 pb-6 text-sm leading-relaxed text-zinc-400">{item.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
