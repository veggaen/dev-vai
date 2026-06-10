/**
 * Pulsing circular Vai mark for the empty chat state — futuristic welcome hero.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { useLayoutStore } from '../../stores/layoutStore.js';

interface VaiWelcomeMarkProps {
  size?: 'md' | 'lg';
}

export function VaiWelcomeMark({ size = 'lg' }: VaiWelcomeMarkProps) {
  const prefersReducedMotion = useReducedMotion();
  const isLight = useLayoutStore((s) => s.themePreference) === 'light';
  const dim = size === 'lg' ? 88 : 64;
  const icon = size === 'lg' ? 36 : 26;

  return (
    <div
      className="vai-welcome-mark relative mx-auto flex items-center justify-center"
      style={{ width: dim, height: dim }}
      aria-hidden
    >
      {!prefersReducedMotion && (
        <>
          <span className="vai-welcome-pulse vai-welcome-pulse-a" />
          <span className="vai-welcome-pulse vai-welcome-pulse-b" />
        </>
      )}

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.88 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className={`relative flex items-center justify-center rounded-full border shadow-lg ${
          isLight
            ? 'border-[color:var(--shell-line-soft)] bg-[color:var(--shell-surface-strong)] shadow-[0_8px_32px_rgba(37,99,235,0.12)]'
            : 'border-[color:var(--shell-line-soft)] bg-[color:var(--shell-surface)] shadow-[0_8px_40px_rgba(124,58,237,0.22)]'
        }`}
        style={{ width: dim, height: dim }}
      >
        <svg
          width={icon}
          height={icon}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="vai-welcome-glyph"
        >
          <path
            d="M15 14h10l7 22 7-22h10L36 50h-8L15 14Z"
            fill="url(#vai-welcome-gradient)"
          />
          <defs>
            <linearGradient id="vai-welcome-gradient" x1="15" y1="14" x2="49" y2="50" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--brand-color)" />
              <stop offset="1" stopColor="color-mix(in srgb, var(--brand-color) 72%, var(--fg))" />
            </linearGradient>
          </defs>
        </svg>
      </motion.div>
    </div>
  );
}
