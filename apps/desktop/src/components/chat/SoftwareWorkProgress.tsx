import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  CircleDot,
  FileCode2,
  Hammer,
  Search,
  ShieldCheck,
  TerminalSquare,
  Waypoints,
  Wrench,
} from 'lucide-react';
import type { ChatProgressStep } from '../../stores/chatStore.js';
import {
  buildSoftwareWorkView,
  formatWorkDuration,
  type SoftwarePhaseStatus,
  type WorkJournalKind,
} from './SoftwareWorkProgress.logic.js';

interface SoftwareWorkProgressProps {
  readonly live: boolean;
  readonly steps: readonly ChatProgressStep[];
  readonly durationMs?: number;
  readonly outputFileCount?: number;
}

function PhaseGlyph({ status }: { status: SoftwarePhaseStatus }) {
  if (status === 'done') return <Check className="h-3 w-3" aria-hidden="true" />;
  if (status === 'attention') return <AlertCircle className="h-3 w-3" aria-hidden="true" />;
  return <span className="software-work-phase-dot" aria-hidden="true" />;
}

function JournalGlyph({ kind }: { kind: WorkJournalKind }) {
  const className = 'h-3.5 w-3.5';
  if (kind === 'evidence') return <Search className={className} aria-hidden="true" />;
  if (kind === 'decision') return <Waypoints className={className} aria-hidden="true" />;
  if (kind === 'build') return <Hammer className={className} aria-hidden="true" />;
  if (kind === 'artifact') return <FileCode2 className={className} aria-hidden="true" />;
  if (kind === 'review') return <ShieldCheck className={className} aria-hidden="true" />;
  if (kind === 'check') return <Check className={className} aria-hidden="true" />;
  if (kind === 'repair') return <Wrench className={className} aria-hidden="true" />;
  if (kind === 'tool') return <TerminalSquare className={className} aria-hidden="true" />;
  return <CircleDot className={className} aria-hidden="true" />;
}

export function SoftwareWorkProgress({ live, steps, durationMs, outputFileCount }: SoftwareWorkProgressProps) {
  const view = useMemo(
    () => buildSoftwareWorkView({ steps, live, durationMs, outputFileCount }),
    [steps, live, durationMs, outputFileCount],
  );
  const [expanded, setExpanded] = useState(live);

  useEffect(() => {
    setExpanded(live);
  }, [live]);

  return (
    <section
      className="software-work-progress mb-3"
      data-testid="software-work-progress"
      data-live={live ? '1' : '0'}
      data-expanded={expanded ? '1' : '0'}
      data-outcome={view.withheld ? 'withheld' : live ? 'working' : 'complete'}
      aria-label="Software work progress"
      aria-live={live ? 'polite' : undefined}
    >
      {live ? (
        <div className="software-work-customer-status">
          <div className="software-work-status-line">
            <span className="software-work-active-mark" aria-hidden="true" />
            <span className="software-work-status-kicker">Now</span>
            <span className="min-w-0 flex-1 text-[color:var(--chat-strong)]">{view.activeTitle}</span>
            <span className="shrink-0 tabular-nums text-[color:var(--chat-muted)]">
              {view.observableActionCount} action{view.observableActionCount === 1 ? '' : 's'}
            </span>
          </div>
          <p className="software-work-purpose"><span>Why</span>{view.activePurpose}</p>
          {view.activeDetail !== view.activeTitle && <p className="software-work-detail"><span>Evidence</span>{view.activeDetail}</p>}
        </div>
      ) : (
        <button
          type="button"
          className="software-work-summary"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          {view.withheld
            ? <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            : <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate">{view.summary}</span>
          <span className="software-work-summary-action">{expanded ? 'Hide journal' : 'Show work journal'}</span>
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
        </button>
      )}

      {expanded && (
        <div className="software-work-body">
          <ol className="software-work-phases" aria-label="Software work stages">
            {view.phases.map((phase) => (
              <li
                key={phase.id}
                className="software-work-phase"
                data-status={phase.status}
                title={`${phase.purpose} ${phase.detail}`}
              >
                <span className="software-work-phase-glyph"><PhaseGlyph status={phase.status} /></span>
                <span className="truncate">{phase.label}</span>
              </li>
            ))}
          </ol>

          <div className="software-work-journal-head">
            <div>
              <p>Work journal</p>
              <span>Observable actions and evidence, in the order they happened.</span>
            </div>
            <span>{view.observableActionCount} recorded</span>
          </div>

          <ol className="software-work-journal" data-testid="software-work-journal" aria-label="Observable work journal">
            {view.journal.map((item) => (
              <li key={item.id} className="software-work-journal-item" data-status={item.status}>
                <span className="software-work-journal-rail" aria-hidden="true"><JournalGlyph kind={item.kind} /></span>
                <div className="software-work-journal-content">
                  <div className="software-work-journal-title">
                    <span className="software-work-journal-phase">{item.phaseLabel}</span>
                    <span>{item.label}</span>
                    {item.durationMs !== undefined && <time>{formatWorkDuration(item.durationMs)}</time>}
                  </div>
                  {item.detail && <p>{item.detail}</p>}
                  {item.notes.length > 0 && (
                    <ul className="software-work-journal-notes">
                      {item.notes.map((note, noteIndex) => (
                        <li key={`${item.id}-note-${noteIndex}`} data-status={note.status ?? 'done'}>
                          <span aria-hidden="true"><JournalGlyph kind={note.kind} /></span>
                          <div>
                            <strong>{note.label}</strong>
                            {note.body && <p>{note.body}</p>}
                          </div>
                          {note.durationMs !== undefined && <time>{formatWorkDuration(note.durationMs)}</time>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

export default SoftwareWorkProgress;
