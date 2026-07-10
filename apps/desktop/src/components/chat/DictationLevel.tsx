/**
 * LevelBars — a compact row of bars that bounce with live mic loudness, the
 * calm "we're listening" affordance that replaces the spinner during dictation.
 *
 * Styled with inline styles only (no Tailwind / external CSS) so it renders
 * identically in the main window AND in the standalone always-on-top bubble
 * window, which does not load the app's full stylesheet. Colour is inherited via
 * `currentColor`, so the parent sets the accent.
 */

interface LevelBarsProps {
  /** Current loudness, 0–1. */
  readonly level: number;
  /** When false, the bars rest at a low idle height (e.g. while finalizing). */
  readonly active?: boolean;
  /** Bar height in px. */
  readonly height?: number;
}

// Per-bar weighting gives an organic, non-uniform bounce instead of a flat block.
const BAR_WEIGHTS = [0.5, 0.82, 1, 0.72, 0.44] as const;

export function LevelBars({ level, active = true, height = 16 }: LevelBarsProps) {
  return (
    <span
      aria-hidden
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height, color: 'inherit' }}
    >
      {BAR_WEIGHTS.map((weight, i) => {
        // Idle floor so the bars never fully collapse; gentle gain so speech fills them.
        const scale = active ? Math.max(0.16, Math.min(1, level * weight * 1.7)) : 0.16;
        return (
          <span
            key={i}
            style={{
              width: 3,
              height,
              borderRadius: 2,
              background: 'currentColor',
              transformOrigin: 'center',
              transform: `scaleY(${scale})`,
              // Smooth the gaps between ~22fps level samples into a fluid bounce.
              transition: 'transform 90ms ease-out',
            }}
          />
        );
      })}
    </span>
  );
}

export default LevelBars;
