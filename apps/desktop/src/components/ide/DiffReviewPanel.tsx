/**
 * Docked diff review — approve/reject before any disk or sandbox write.
 */

import { useMemo } from 'react';
import { X, Check, ExternalLink } from 'lucide-react';
import { DiffReview } from './DiffReview.js';
import { toReviewProposal } from '../../lib/ide/workspace-client.js';
import { useWorkspaceStore } from '../../stores/workspaceStore.js';
import { usePopoutStore } from '../../stores/popoutStore.js';
import { useSandboxStore } from '../../stores/sandboxStore.js';

export function DiffReviewPanel({ detached = false }: { detached?: boolean } = {}) {
  const show = useWorkspaceStore((s) => s.showDiffPanel);
  const rawProposals = useWorkspaceStore((s) => s.proposals);
  const proposals = useMemo(() => rawProposals.map(toReviewProposal), [rawProposals]);
  const busy = useWorkspaceStore((s) => s.busy);
  const error = useWorkspaceStore((s) => s.error);
  const setShow = useWorkspaceStore((s) => s.setShowDiffPanel);
  const setStatus = useWorkspaceStore((s) => s.setProposalStatus);
  const approveAll = useWorkspaceStore((s) => s.approveAllPending);
  const apply = useWorkspaceStore((s) => s.applyApproved);
  const openPopout = usePopoutStore((s) => s.openPopout);
  const projectId = useSandboxStore((s) => s.projectId);

  if (!detached && (!show || proposals.length === 0)) return null;

  const pending = proposals.filter((p) => p.status === 'pending').length;
  const approved = proposals.filter((p) => p.status === 'approved').length;
  const containerClass = detached
    ? 'flex h-full w-full flex-col bg-[color:var(--chat-surface,#121218)]'
    : 'absolute inset-y-0 right-0 z-20 flex w-[min(420px,92%)] flex-col border-l border-white/[0.08] bg-[color:var(--chat-surface,#121218)]/98 shadow-2xl backdrop-blur-md';

  return (
    <div className={containerClass}>
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="flex-1 text-xs font-semibold text-[color:var(--chat-body)]">
          Review changes
          {pending > 0 && <span className="ml-1.5 text-[color:var(--chat-muted)]">({pending} pending)</span>}
        </span>
        {!detached && (
          <button
            type="button"
            aria-label="Pop diff review out to another window"
            onClick={() => openPopout('diff', { projectId })}
            className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/[0.06]"
            title="Pop diff review out to another window"
          >
            <ExternalLink size={14} />
          </button>
        )}
        <button
          type="button"
          aria-label="Close diff panel"
          onClick={() => detached ? window.close() : setShow(false)}
          className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/[0.06]"
        >
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        {proposals.length > 0 ? (
          <DiffReview
            proposals={proposals}
            onApprove={(id) => setStatus(id, 'approved')}
            onReject={(id) => setStatus(id, 'rejected')}
            onApproveAll={pending > 0 ? approveAll : undefined}
          />
        ) : (
          <div className="flex h-full min-h-60 flex-col items-center justify-center rounded-xl border border-white/[0.06] px-6 text-center">
            <p className="text-sm font-medium text-[color:var(--chat-body)]">No pending diff yet</p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-[color:var(--chat-muted)]">
              When Vai proposes code changes, they will appear here for approval before anything is applied.
            </p>
          </div>
        )}
      </div>
      {approved > 0 && (
        <div className="shrink-0 border-t border-white/[0.06] p-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--accent,#7c3aed)] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Check size={14} />
            Apply {approved} approved change{approved === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </div>
  );
}

export default DiffReviewPanel;
