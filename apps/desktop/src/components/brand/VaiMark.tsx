/**
 * VaiMark — the canonical Vai brand mark.
 *
 * Concept: a V whose right arm is broken open at the top, completed by a
 * floating node — the dot of the "i" in Vai and the spark of intelligence
 * sitting in the negative space. One asymmetric, ownable shape instead of a
 * letter in a circle. Strokes use round caps so the mark stays crisp from
 * 12px favicons up to hero size.
 *
 * Variants:
 *  - gradient (default): brand gradient stroke — accent → accent-deep.
 *  - mono: currentColor, for places that tint via text color.
 *  - onAccent: solid contrast stroke for use on accent-filled chips.
 */

import { useId } from 'react';

export interface VaiMarkProps {
  /** Rendered square size in px. */
  readonly size?: number;
  readonly variant?: 'gradient' | 'mono' | 'onAccent';
  /** Pulse the intelligence node (respects prefers-reduced-motion via CSS). */
  readonly animated?: boolean;
  readonly className?: string;
  /** Accessible name; omit to keep the mark decorative. */
  readonly title?: string;
}

export function VaiMark({ size = 24, variant = 'gradient', animated = false, className, title }: VaiMarkProps) {
  const gradientId = useId();
  const stroke = variant === 'gradient'
    ? `url(#${gradientId})`
    : variant === 'onAccent'
      ? 'var(--bg, #fff)'
      : 'currentColor';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {variant === 'gradient' && (
        <defs>
          <linearGradient id={gradientId} x1="12" y1="12" x2="52" y2="54" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--brand-color, #7c3aed)" />
            <stop offset="1" stopColor="color-mix(in oklab, var(--brand-color, #7c3aed) 60%, var(--fg, #38bdf8))" />
          </linearGradient>
        </defs>
      )}
      {/* Left arm — full diagonal, the body of the V */}
      <path
        d="M14 13 L32 51"
        stroke={stroke}
        strokeWidth="10"
        strokeLinecap="round"
      />
      {/* Right arm — rises from the vertex but stops short, opening the form */}
      <path
        d="M32 51 L46 23"
        stroke={stroke}
        strokeWidth="10"
        strokeLinecap="round"
      />
      {/* The intelligence node — the dot of the "i", completing the arm */}
      <circle
        cx="51.5"
        cy="12.5"
        r="6"
        fill={stroke}
        className={animated ? 'vai-mark-node' : undefined}
      />
    </svg>
  );
}
