/**
 * Council-IDE — the "review every diff" panel (Layer 1 UI).
 *
 * Purely presentational and self-contained: it renders a set of proposed file changes
 * (each authored by a council member/role) and calls back when the user approves or
 * rejects one. It does NOT read or write files itself — the wiring layer maps approved
 * proposals to Tauri file writes. Keeping it decoupled means it can't break the app build
 * until it's deliberately imported, and it's trivial to unit-test.
 *
 * The `DiffLine[]`/stats shapes mirror `@vai/core` `ide/workspace-edit` so the wiring layer
 * passes them straight through.
 */

import { Check, X, FilePlus2, Trash2, FileEdit } from 'lucide-react';

export interface ReviewDiffLine {
  readonly kind: 'context' | 'add' | 'remove';
  readonly text: string;
}

export interface ReviewProposal {
  readonly id: string;
  /** Path relative to the attached workspace root. */
  readonly path: string;
  /** Member/role that authored this change, e.g. "coder · backend". */
  readonly author: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly isNew: boolean;
  readonly isDelete: boolean;
  readonly added: number;
  readonly removed: number;
  readonly diff: readonly ReviewDiffLine[];
}

interface DiffReviewProps {
  readonly proposals: readonly ReviewProposal[];
  readonly onApprove: (id: string) => void;
  readonly onReject: (id: string) => void;
  /** Approve/reject everything still pending. */
  readonly onApproveAll?: () => void;
}

function KindIcon({ isNew, isDelete }: { isNew: boolean; isDelete: boolean }) {
  if (isNew) return <FilePlus2 size={13} className="text-emerald-400" aria-label="New file" />;
  if (isDelete) return <Trash2 size={13} className="text-red-400" aria-label="Delete file" />;
  return <FileEdit size={13} className="text-[color:var(--chat-muted)]" aria-label="Edit file" />;
}

export function DiffReview({ proposals, onApprove, onReject, onApproveAll }: DiffReviewProps) {
  if (proposals.length === 0) return null;
  const pending = proposals.filter((p) => p.status === 'pending').length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[color:var(--chat-body)]">
          Proposed changes · {proposals.length} file{proposals.length === 1 ? '' : 's'}
        </span>
        {onApproveAll && pending > 0 && (
          <button
            type="button"
            onClick={onApproveAll}
            className="rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25"
          >
            Approve all ({pending})
          </button>
        )}
      </div>

      {proposals.map((p) => (
        <div key={p.id} className="overflow-hidden rounded-lg border border-white/[0.06]">
          <div className="flex items-center gap-2 bg-white/[0.03] px-3 py-2">
            <KindIcon isNew={p.isNew} isDelete={p.isDelete} />
            <span className="truncate font-mono text-[11px] text-[color:var(--chat-body)]" title={p.path}>
              {p.path}
            </span>
            <span className="ml-1 shrink-0 font-mono text-[10px] tabular-nums">
              <span className="text-emerald-400">+{p.added}</span>{' '}
              <span className="text-red-400">-{p.removed}</span>
            </span>
            <span className="ml-auto shrink-0 text-[10px] text-[color:var(--chat-muted)]">{p.author}</span>
            {p.status === 'pending' ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onApprove(p.id)}
                  title="Approve"
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-300 transition-colors hover:bg-emerald-500/30"
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => onReject(p.id)}
                  title="Reject"
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/15 text-red-300 transition-colors hover:bg-red-500/30"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  p.status === 'approved'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-red-500/15 text-red-300'
                }`}
              >
                {p.status}
              </span>
            )}
          </div>

          {!p.isDelete && (
            <pre className="max-h-72 overflow-auto bg-black/30 px-3 py-2 text-[11px] leading-relaxed">
              {p.diff.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.kind === 'add'
                      ? 'bg-emerald-500/10 text-emerald-200'
                      : line.kind === 'remove'
                        ? 'bg-red-500/10 text-red-200'
                        : 'text-[color:var(--chat-muted)]'
                  }
                >
                  <span className="select-none opacity-60">
                    {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
                  </span>
                  {line.text || ' '}
                </div>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

export default DiffReview;
