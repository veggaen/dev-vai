import { lazy, Suspense, useCallback, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import Preloader from './components/Preloader';
import CursorGlow from './components/CursorGlow';
import Nav from './components/Nav';
import Hero from './components/Hero';
import Features from './components/Features';
import Pipeline from './components/Pipeline';
import Stats from './components/Stats';
import Faq from './components/Faq';
import Footer, { Marquee } from './components/Footer';
import CommandPalette from './components/CommandPalette';
import { useHotkey, useKonami } from './lib/hooks';

const Showcase = lazy(() => import('./components/Showcase'));

export default function App() {
  const [booted, setBooted] = useState(false);
  const [palette, setPalette] = useState(false);
  const [warp, setWarp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const announce = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const toggleWarp = useCallback(() => {
    setWarp((w) => {
      announce(w ? 'Hyperdrive disengaged' : '⚡ Hyperdrive engaged');
      return !w;
    });
  }, [announce]);

  const shiftHue = useCallback(() => {
    const root = document.documentElement;
    const current = Number(getComputedStyle(root).getPropertyValue('--accent-hue')) || 243;
    root.style.setProperty('--accent-hue', String((current + 40) % 360));
    announce('Accent spectrum shifted');
  }, [announce]);

  useKonami(toggleWarp);
  useHotkey('k', () => setPalette((p) => !p));

  return (
    <MotionConfig reducedMotion="user">
      <div className={`noise min-h-screen ${warp ? 'hyperdrive' : ''}`} data-testid="app-root" data-warp={warp}>
        <AnimatePresence>{!booted && <Preloader onDone={() => setBooted(true)} />}</AnimatePresence>

        <CursorGlow />
        <Nav onPalette={() => setPalette(true)} />

        <main>
          <Hero warp={warp} />
          <Marquee />
          <Features />
          <Pipeline />
          <Suspense fallback={<div className="h-screen" />}>
            <Showcase />
          </Suspense>
          <Stats />
          <Faq />
        </main>
        <Footer />

        <CommandPalette
          open={palette}
          onClose={() => setPalette(false)}
          onWarp={toggleWarp}
          onHue={shiftHue}
        />

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              className="glass fixed bottom-6 left-1/2 z-[85] -translate-x-1/2 rounded-full px-5 py-2.5 font-mono text-xs text-pulse-400"
              role="status"
              data-testid="toast"
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
