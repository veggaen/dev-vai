import { Gauge, Layers, Zap } from 'lucide-react';

/**
 * ProcessDepthControl — composer segmented control for how much deliberation the user
 * wants on the next turn. Maps 1:1 to the server's `processDepth` (quick/balanced/deep):
 *
 *  - Quick    → ship the first good draft; no advisory council loop (fast).
 *  - Balanced → one council review + bounded redraft (the default).
 *  - Deep     → full multi-pass council, all seated models incl. slow thinking models;
 *               slower but most thorough.
 *
 * Accessibility: a real radiogroup (arrow-key navigable, single tab stop) with labels;
 * motion is restrained (color/opacity only). Pure-presentational — state lives in the store.
 */

export type ProcessDepth = 'quick' | 'balanced' | 'deep';

export const PROCESS_DEPTHS: ReadonlyArray<{
  value: ProcessDepth;
  label: string;
  hint: string;
  Icon: typeof Zap;
}> = [
  { value: 'quick', label: 'Quick', hint: 'Fastest — ships the first good draft, no council', Icon: Zap },
  { value: 'balanced', label: 'Balanced', hint: 'Default — one council review + a bounded revision', Icon: Gauge },
  { value: 'deep', label: 'Deep', hint: 'Most thorough — full multi-pass council incl. slow thinking models', Icon: Layers },
];

export function ProcessDepthControl({
  value,
  onChange,
  disabled = false,
}: {
  value: ProcessDepth;
  onChange: (depth: ProcessDepth) => void;
  disabled?: boolean;
}) {
  const order = PROCESS_DEPTHS.map((d) => d.value);
  const move = (dir: 1 | -1) => {
    const i = order.indexOf(value);
    const next = order[(i + dir + order.length) % order.length];
    onChange(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Process depth"
      className="process-depth inline-flex items-center gap-0.5 rounded-lg border border-[color:var(--chat-border,rgba(255,255,255,0.08))] p-0.5"
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      }}
    >
      {PROCESS_DEPTHS.map(({ value: v, label, hint, Icon }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} — ${hint}`}
            title={hint}
            disabled={disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(v)}
            className={[
              'process-depth__seg inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]',
              active
                ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]'
                : 'text-[color:var(--chat-muted)] hover:text-[color:var(--chat-body)]',
              disabled ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default ProcessDepthControl;
