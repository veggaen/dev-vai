/**
 * Pulsing circular Vai mark for the empty chat state — futuristic welcome hero.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { VaiMark } from '../brand/VaiMark.js';

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
        <VaiMark size={icon} animated className="vai-welcome-glyph" />
      </motion.div>
    </div>
  );
}
