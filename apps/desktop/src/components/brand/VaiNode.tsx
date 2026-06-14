/**
 * VaiNode — the intelligence-node motif, lifted straight out of {@link VaiMark}.
 *
 * In the logo, the node is the floating dot that completes the broken-open V —
 * the "dot of the i" and the spark of intelligence in the negative space. On its
 * own it becomes Vai's signature status glyph: a small luminous disc that
 * BREATHES while Vai is thinking and settles to a solid accent dot when done.
 *
 * This is deliberate brand integration: every live process step pulses the same
 * shape that defines the mark, so watching Vai work literally reads as Vai's mind
 * ticking — not a generic library spinner. Built on tokens so it is correct in
 * both themes and silenced under prefers-reduced-motion (see .vai-node-* in
 * index.css).
 */

export type VaiNodeState = 'thinking' | 'done' | 'error';

export interface VaiNodeProps {
  readonly state?: VaiNodeState;
  /** Diameter in px. 10 reads well inline next to 11–12px text. */
  readonly size?: number;
  /**
   * Phase tone token suffix — maps to the pipeline palette already used by the
   * ThinkingPanel (`read|route|evidence|compose|verify`) plus a few process
   * aliases. Drives the node's hue so search/council/verify read at a glance.
   */
  readonly tone?: 'accent' | 'read' | 'route' | 'evidence' | 'compose' | 'verify';
  readonly className?: string;
}

const TONE_VAR: Record<NonNullable<VaiNodeProps['tone']>, string> = {
  accent: 'var(--accent)',
  read: 'var(--phase-read)',
  route: 'var(--phase-route)',
  evidence: 'var(--phase-evidence)',
  compose: 'var(--phase-compose)',
  verify: 'var(--phase-verify)',
};

export function VaiNode({ state = 'thinking', size = 10, tone = 'accent', className }: VaiNodeProps) {
  const hue = state === 'error' ? 'var(--tone-bad)' : state === 'done' ? 'var(--phase-verify)' : TONE_VAR[tone];

  return (
    <span
      aria-hidden="true"
      data-vai-node={state}
      className={`vai-node ${state === 'thinking' ? 'vai-node--thinking' : ''} ${className ?? ''}`}
      style={{ width: size, height: size, ['--vai-node-hue' as string]: hue }}
    />
  );
}

export default VaiNode;
