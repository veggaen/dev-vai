import { useMemo, useState } from 'react';
import { Check, ChevronRight, RefreshCw, ShieldCheck, ShieldAlert, Lightbulb } from 'lucide-react';
import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import { VaiNode } from '../brand/VaiNode.js';
import { isExpandable, type ProcessNode } from './ProcessTree.logic.js';
import {
  buildTimelineModel,
  type TimelinePhase,
  type TimelineGate,
  type FeatureNote,
} from './Timeline.logic.js';

/**
 * Loop-aware Timeline — renders the turn as the user's mental model (the Excalidraw loop): phases,
 * deliberation rounds, approval gates, and a self-improvement lane of feature-notes. Derived purely
 * from the flat progress steps already streamed (see Timeline.logic), so it is fully additive — the
 * existing ProcessTree is untouched and this is shown behind a flag.
 */

interface TimelineProps {
  readonly steps: readonly ChatProgressStep[];
  readonly council?: CouncilThinkingUI | null;
  readonly live?: boolean;
  readonly durationMs?: number;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

export function Timeline({ steps, council, live = false, durationMs }: TimelineProps) {
  const model = useMemo(() => buildTimelineModel(steps, council ?? undefined), [steps, council]);

  // Group phases by loop round so multiple deliberation passes read as distinct rounds.
  const rounds = useMemo(() => {
    const byRound = new Map<number, TimelinePhase[]>();
    for (const phase of model.phases) {
      const bucket = byRound.get(phase.round);
      if (bucket) bucket.push(phase);
      else byRound.set(phase.round, [phase]);
    }
    return [...byRound.entries()].sort(([a], [b]) => a - b);
  }, [model.phases]);

  if (model.phases.length === 0) return null;

  const total = durationMs ?? model.totalDurationMs;

  return (
    <div className="mb-3 text-[12px]" data-testid="turn-timeline" data-live={live ? '1' : '0'}>
      <div className="mb-2 flex items-center gap-2 text-[11px] text-[color:var(--chat-muted)]">
        <VaiNode state={live ? 'thinking' : 'done'} size={10} />
        <span className="font-medium text-[color:var(--chat-body)]">Turn timeline</span>
        <span className="opacity-70">
          {model.rounds > 1 ? `${model.rounds} rounds` : '1 round'}
          {total >= 500 ? ` · ${formatMs(total)}` : ''}
        </span>
        <span className="ml-auto">
          {model.approved
            ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300"><ShieldCheck className="h-3 w-3" />approved</span>
            : <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300"><ShieldAlert className="h-3 w-3" />best-so-far</span>}
        </span>
      </div>

      <div className="space-y-2">
        {rounds.map(([round, phases]) => (
          <div key={round} className="relative">
            {model.rounds > 1 && (
              <div className="mb-1 flex items-center gap-1.5 pl-1 text-[10px] font-medium uppercase tracking-wide text-[color:var(--chat-muted)]">
                {round > 1 && <RefreshCw className="h-3 w-3" />}
                Round {round}
              </div>
            )}
            <ol className="timeline-rail space-y-1">
              {phases.map((phase) => (
                <PhaseRow key={phase.id} phase={phase} live={live} />
              ))}
            </ol>
          </div>
        ))}
      </div>

      {model.featureNotes.length > 0 && (
        <FeatureNotesLane notes={model.featureNotes} />
      )}
    </div>
  );
}

function GateBadge({ gate }: { gate: TimelineGate }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
        gate.approved ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'
      }`}
      title={gate.reason}
    >
      {gate.approved ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
      {gate.kind === 'council' ? 'Council' : gate.kind === 'quality' ? 'Verify' : 'Redraft'}
      {gate.confidence !== undefined ? ` ${Math.round(gate.confidence * 100)}%` : ''}
    </span>
  );
}

function PhaseRow({ phase, live }: { phase: TimelinePhase; live: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetail = phase.nodes.some((n) => isExpandable(n) || n.note?.trim());
  const running = phase.status === 'running';

  return (
    <li className="timeline-phase">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
          hasDetail ? 'thinking-hover' : 'cursor-default'
        }`}
      >
        <span className="mt-px flex h-3.5 w-3 shrink-0 items-center justify-center">
          {hasDetail && (
            <ChevronRight className={`h-3 w-3 text-[color:var(--chat-muted)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
          )}
        </span>
        <PhaseGlyph status={phase.status} live={live} />
        <span className="min-w-0 flex-1">
          <span className={running ? 'text-[color:var(--chat-strong)]' : 'text-[color:var(--chat-body)]'}>
            {phase.title}
          </span>
          {phase.summary && phase.summary !== phase.title && (
            <span className="ml-1.5 text-[11px] text-[color:var(--chat-muted)] opacity-80">
              {phase.summary.length > 90 ? `${phase.summary.slice(0, 90)}…` : phase.summary}
            </span>
          )}
        </span>
        {phase.gate && <GateBadge gate={phase.gate} />}
        {phase.durationMs !== undefined && phase.durationMs >= 250 && (
          <span className="shrink-0 tabular-nums text-[10px] text-[color:var(--chat-muted)] opacity-70">
            {formatMs(phase.durationMs)}
          </span>
        )}
      </button>
      {hasDetail && open && (
        <div className="ml-[1.05rem] border-l border-[color:var(--border)] pl-3">
          {phase.nodes.map((node) => (
            <NodeDetail key={node.id} node={node} />
          ))}
        </div>
      )}
    </li>
  );
}

/** Compact recursive detail render for a phase's underlying ProcessTree node. */
function NodeDetail({ node, depth = 0 }: { node: ProcessNode; depth?: number }) {
  return (
    <div className={depth > 0 ? 'pl-2' : ''}>
      {node.note?.trim() && node.children.length === 0 && (
        <pre className="m-0 whitespace-pre-wrap break-words py-1 font-mono text-[10px] leading-relaxed text-[color:var(--chat-body)]">
          {node.note.trim()}
        </pre>
      )}
      {node.children.map((child) => (
        <div key={child.id} className="py-0.5">
          <div className="flex items-start gap-1.5 text-[11px]">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[color:var(--chat-muted)] opacity-60" />
            <span className="text-[color:var(--chat-body)]">{child.label}</span>
            {child.detail && <span className="text-[color:var(--chat-muted)] opacity-80">{child.detail}</span>}
          </div>
          {(child.note?.trim() || child.children.length > 0) && (
            <div className="ml-3">
              <NodeDetail node={child} depth={depth + 1} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FeatureNotesLane({ notes }: { notes: readonly FeatureNote[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-2.5 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-[11px]"
      >
        <Lightbulb className="h-3.5 w-3.5 text-amber-300" />
        <span className="font-medium text-[color:var(--chat-body)]">
          {notes.length} note{notes.length === 1 ? '' : 's'} for improving Vai
        </span>
        <ChevronRight className={`ml-auto h-3 w-3 text-[color:var(--chat-muted)] transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1.5">
          {notes.map((note) => (
            <li key={note.id} className="text-[11px] leading-4">
              <span className={`mr-1.5 rounded px-1 py-0.5 text-[9px] uppercase tracking-wide ${
                note.kind === 'missing-capability' ? 'bg-rose-500/10 text-rose-300'
                  : note.kind === 'method-lesson' ? 'bg-sky-500/10 text-sky-300'
                  : 'bg-zinc-500/10 text-[color:var(--chat-muted)]'
              }`}>
                {note.kind === 'missing-capability' ? 'gap' : note.kind === 'method-lesson' ? 'lesson' : 'concern'}
              </span>
              <span className="text-[color:var(--chat-body)]">{note.text}</span>
              <span className="ml-1 text-[10px] text-[color:var(--chat-muted)] opacity-70">— {note.source}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PhaseGlyph({ status, live }: { status: TimelinePhase['status']; live: boolean }) {
  if (status === 'done') {
    return <Check className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--phase-verify)]" aria-hidden="true" />;
  }
  return (
    <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <VaiNode state={status === 'bad' ? 'error' : live ? 'thinking' : 'done'} size={9} tone="route" />
    </span>
  );
}

export default Timeline;
