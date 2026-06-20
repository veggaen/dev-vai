/**
 * VaiPlanetMark — the empty-chat centerpiece.
 *
 * The canonical {@link VaiMark} glyph sits inside a glowing planetary body with a soft halo, two
 * tilted orbital rings, and slow-drifting particles — an "alien planet / Jupiter" feel. Built on
 * framer-motion + CSS (no Three.js: a logo halo doesn't need a WebGL context, and CSS keeps it
 * smooth, theme-token-driven, and respectful of prefers-reduced-motion). Extends the existing brand
 * mark + welcome-pulse system rather than re-skinning.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import { VaiMark } from '../brand/VaiMark.js';

interface VaiPlanetMarkProps {
  /** Diameter of the planet body in px. Particles + halo scale around it. */
  readonly size?: number;
}

/** Deterministic particle ring so the layout is stable across renders. */
function useParticles(count: number, radius: number) {
  return useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.5;
        // Vary the orbit radius a little so particles don't sit on one perfect circle.
        const r = radius * (0.82 + ((i * 37) % 100) / 100 * 0.4);
        return {
          id: i,
          x: Math.cos(angle) * r,
          y: Math.sin(angle) * r * 0.62, // squash vertically → orbital plane perspective
          delay: (i % 7) * 0.45,
          duration: 5.5 + (i % 5) * 1.1,
          dot: 1.5 + (i % 3),
        };
      }),
    [count, radius],
  );
}

export function VaiPlanetMark({ size = 132 }: VaiPlanetMarkProps) {
  const prefersReducedMotion = useReducedMotion();
  const field = size * 2.4;
  const particles = useParticles(prefersReducedMotion ? 0 : 22, size * 0.95);
  const iconSize = size * 0.5;

  return (
    <div
      className="vai-planet relative flex items-center justify-center"
      style={{ width: field, height: field }}
      aria-hidden
    >
      {/* Soft ambient glow behind everything — the planet's atmosphere */}
      <div className="vai-planet-atmosphere" />

      {/* Tilted orbital rings */}
      {!prefersReducedMotion && (
        <>
          <motion.div
            className="vai-planet-ring vai-planet-ring-a"
            style={{ width: size * 1.85, height: size * 1.85 }}
            animate={{ rotate: 360 }}
            transition={{ duration: 38, ease: 'linear', repeat: Infinity }}
          />
          <motion.div
            className="vai-planet-ring vai-planet-ring-b"
            style={{ width: size * 1.5, height: size * 1.5 }}
            animate={{ rotate: -360 }}
            transition={{ duration: 52, ease: 'linear', repeat: Infinity }}
          />
        </>
      )}

      {/* Drifting particles — soft, smooth twinkle around the orbit */}
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="vai-planet-particle"
          style={{ width: p.dot, height: p.dot, left: '50%', top: '50%', x: p.x, y: p.y }}
          animate={{ opacity: [0, 0.9, 0], scale: [0.6, 1, 0.6] }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeInOut', repeat: Infinity }}
        />
      ))}

      {/* Pulsing halo rings (reuse the welcome-pulse rhythm) */}
      {!prefersReducedMotion && (
        <>
          <span className="vai-welcome-pulse vai-welcome-pulse-a" style={{ inset: `calc(50% - ${size / 2}px - 6px)` }} />
          <span className="vai-welcome-pulse vai-welcome-pulse-b" style={{ inset: `calc(50% - ${size / 2}px - 6px)` }} />
        </>
      )}

      {/* The planet body */}
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="vai-planet-body relative flex items-center justify-center rounded-full"
        style={{ width: size, height: size }}
      >
        <VaiMark size={iconSize} animated className="vai-welcome-glyph relative z-[2]" />
      </motion.div>
    </div>
  );
}

export default VaiPlanetMark;
