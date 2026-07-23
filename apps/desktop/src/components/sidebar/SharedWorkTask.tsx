import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, FileCode2, RotateCcw, ShieldAlert } from 'lucide-react';
import {
  buildSharedWorkContinuationPrompt,
  sharedWorkBriefPreview,
  type SharedWorkArtifact,
} from '../../lib/shared-work-artifact.js';

function shortMember(memberId: string): string {
  return memberId.replace(/^local:/, '').replace(/:latest$/, '');
}

export function SharedWorkTask({ artifact }: { readonly artifact: SharedWorkArtifact }) {
  const [expanded, setExpanded] = useState(false);
  const pending = artifact.status === 'pending';
  const blockers = artifact.validation.errors.length;
  const needsAttention = artifact.status !== 'superseded'
    && (pending || !artifact.validation.ok || blockers > 0);
  const ownerTrail = artifact.memberIds.map(shortMember).join(' → ');

  const continueTask = () => {
    window.dispatchEvent(new CustomEvent('vai:prefill-chat', {
      detail: { prompt: buildSharedWorkContinuationPrompt(artifact) },
    }));
  };

  return (
    <section aria-label="Shared work task" className="border-b border-white/[0.06] px-3 py-3">
      <div className="border-l-2 border-emerald-400/55 pl-3">
        <div className="flex items-center gap-2">
          {needsAttention
            ? <ShieldAlert size={13} className="shrink-0 text-amber-300" aria-hidden />
            : <CheckCircle2 size={13} className="shrink-0 text-emerald-300" aria-hidden />}
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--chat-muted)]">
              Shared task
            </div>
            <div className="truncate text-xs font-medium text-[color:var(--chat-body)]">{artifact.projectName}</div>
          </div>
          <span className={`text-[10px] font-medium ${needsAttention ? 'text-amber-300' : 'text-emerald-300'}`}>
            {pending
              ? 'Needs work'
              : artifact.status === 'applied' && needsAttention
                ? 'Applied with gaps'
                : artifact.status === 'applied'
                  ? 'Applied'
                  : 'Superseded'}
          </span>
        </div>

        <p className="mt-2 text-[11px] leading-4 text-[color:var(--chat-muted)]">
          {sharedWorkBriefPreview(artifact.brief)}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[color:var(--chat-muted)]">
          <span className="inline-flex items-center gap-1"><FileCode2 size={10} />{artifact.filePaths.length} file{artifact.filePaths.length === 1 ? '' : 's'}</span>
          <span className={blockers > 0 ? 'text-amber-300' : 'text-emerald-300'}>{blockers} blocker{blockers === 1 ? '' : 's'}</span>
          <span>{artifact.repairsUsed} repair{artifact.repairsUsed === 1 ? '' : 's'}</span>
        </div>

        {(blockers > 0 || artifact.filePaths.length > 0 || ownerTrail) && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-[color:var(--chat-muted)] hover:text-[color:var(--chat-body)]"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {expanded ? 'Hide evidence' : 'Inspect evidence'}
          </button>
        )}

        {expanded && (
          <div className="mt-2 space-y-2 text-[10px] leading-4 text-[color:var(--chat-muted)]">
            {ownerTrail && <p><span className="text-[color:var(--chat-body)]">Handoff:</span> {ownerTrail}</p>}
            {artifact.filePaths.length > 0 && (
              <p className="break-words"><span className="text-[color:var(--chat-body)]">Files:</span> {artifact.filePaths.join(', ')}</p>
            )}
            {artifact.validation.errors.slice(0, 3).map((error) => (
              <p key={error} className="border-l border-amber-400/40 pl-2 text-amber-100/80">{error}</p>
            ))}
          </div>
        )}

        {needsAttention && (
          <button
            type="button"
            onClick={continueTask}
            className="mt-3 inline-flex items-center gap-1.5 bg-emerald-400 px-2.5 py-1.5 text-[10px] font-semibold text-[#07110d] transition-colors hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
          >
            <RotateCcw size={11} aria-hidden />
            {pending ? 'Continue with context' : 'Fix recorded gaps'}
          </button>
        )}
      </div>
    </section>
  );
}
