/**
 * FileChangesBar — the "what changed this turn" action strip above the composer.
 *
 * When a coding/project chat mutates files, this surfaces them as a compact,
 * premium overview: per-file rows with +added/-removed stats (shown only when the
 * backend actually reports them — never fabricated), a one-click open into the app
 * code view, and turn-level actions.
 *
 * Honest scope: today the runtime has no diff/revert endpoint, so "Keep" dismisses
 * the strip for this turn and "Discard" is presented only when a real revert hook
 * is supplied. Counts render only when present. This keeps the affordance truthful
 * while leaving a clean seam for a versioned-diff backend later.
 */

import { useState } from 'react';
import { FileText, ChevronRight, Check } from 'lucide-react';

export interface FileChangeEntry {
  readonly id: string;
  readonly path: string;
  /** Lines added — render only when the backend reports it. */
  readonly added?: number;
  /** Lines removed — render only when the backend reports it. */
  readonly removed?: number;
}

interface FileChangesBarProps {
  readonly files: readonly FileChangeEntry[];
  readonly studioChrome: boolean;
  /** Open this file in the app code view (IDE). */
  readonly onOpenFile: (path: string) => void;
  /** Acknowledge the changes and dismiss the strip for this turn. */
  readonly onKeep: () => void;
  /** Real revert hook. Omit when no backend revert exists — the button is hidden. */
  readonly onDiscard?: () => void;
}

export function FileChangesBar({ files, studioChrome, onOpenFile, onKeep, onDiscard }: FileChangesBarProps) {
  const [collapsed, setCollapsed] = useState(false);
  if (files.length === 0) return null;

  const totalAdded = files.reduce((n, f) => n + (f.added ?? 0), 0);
  const totalRemoved = files.reduce((n, f) => n + (f.removed ?? 0), 0);
  const hasStats = totalAdded > 0 || totalRemoved > 0;

  return (
    <div className="mb-2 overflow-hidden rounded-2xl border border-[color:var(--panel-border-soft)] bg-[color:var(--panel-bg-inset)]">
      {/* Header — title + aggregate stat + collapse */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-[color:var(--panel-bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[color:var(--chat-muted)] transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--chat-eyebrow)]">
          {files.length} file{files.length === 1 ? '' : 's'} changed
        </span>
        {hasStats && (
          <span className="flex items-center gap-1.5 text-[11px] tabular-nums">
            {totalAdded > 0 && <span className="text-[color:var(--phase-verify)]">+{totalAdded}</span>}
            {totalRemoved > 0 && <span className="text-[color:var(--tone-bad)]">−{totalRemoved}</span>}
          </span>
        )}
        <span className="ml-auto text-[10px] text-[color:var(--chat-muted)]">{collapsed ? 'show' : 'hide'}</span>
      </button>

      {!collapsed && (
        <>
          <ul className="space-y-0.5 px-2 pb-2">
            {files.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onOpenFile(f.path)}
                  className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-[color:var(--accent-soft)]"
                  title={`Open ${f.path} in the code view`}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-[color:var(--chat-muted)] transition-colors group-hover:text-[color:var(--accent-text)]" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[color:var(--chat-body)]">{f.path}</span>
                  {(f.added !== undefined || f.removed !== undefined) && (
                    <span className="shrink-0 tabular-nums text-[10px]">
                      {f.added !== undefined && f.added > 0 && <span className="text-[color:var(--phase-verify)]">+{f.added}</span>}
                      {f.removed !== undefined && f.removed > 0 && <span className="ml-1 text-[color:var(--tone-bad)]">−{f.removed}</span>}
                    </span>
                  )}
                  <span className="shrink-0 text-[10px] text-[color:var(--chat-muted)] opacity-0 transition-opacity group-hover:opacity-100">
                    open →
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Turn-level actions */}
          <div className="flex items-center gap-2 border-t border-[color:var(--panel-border-soft)] px-3 py-2">
            <button
              type="button"
              onClick={onKeep}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-softer)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
            >
              <Check className="h-3 w-3" /> Keep
            </button>
            {onDiscard && (
              <button
                type="button"
                onClick={onDiscard}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--panel-border-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--chat-muted)] transition-colors hover:border-[color:var(--tone-bad)] hover:text-[color:var(--tone-bad)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
              >
                Discard
              </button>
            )}
            <span className="ml-auto text-[10px] text-[color:var(--chat-muted)]">
              {studioChrome ? 'Click a file to open it in the code view' : 'Click a file → opens in the app code view'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default FileChangesBar;
