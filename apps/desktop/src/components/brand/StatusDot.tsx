/**
 * StatusDot — a small luminous disc that signals a council member's live health.
 *
 * Green + breathing = seated and active. Amber = resting after a recent failure.
 * Red = down, needs attention. The presentation is computed by {@link presentStatus}
 * (pure, unit-tested) so the visual contract is locked independent of the DOM. The
 * breathing halo reuses the brand's "alive" motion language (see .status-dot in
 * index.css) and is silenced under prefers-reduced-motion.
 */

import { presentStatus, type MemberLiveStatus } from './StatusDot.logic';

export interface StatusDotProps {
  readonly status: MemberLiveStatus | string | undefined | null;
  /** Diameter in px. 8 reads well next to 10–11px chip text. */
  readonly size?: number;
  /** Override the tooltip (defaults to the status's own description). */
  readonly title?: string;
  readonly className?: string;
}

export function StatusDot({ status, size = 8, title, className }: StatusDotProps) {
  const p = presentStatus(status ?? undefined);
  return (
    <span
      role="img"
      aria-label={p.label}
      title={title ?? p.title}
      data-status={p.kind}
      className={`status-dot ${p.breathe ? 'status-dot--breathe' : ''} ${className ?? ''}`}
      style={{ width: size, height: size, ['--status-tone' as string]: `var(${p.toneVar})` }}
    />
  );
}

export default StatusDot;
