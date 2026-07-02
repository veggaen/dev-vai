import { useMemo, useState } from 'react';
import { X, MoreHorizontal } from 'lucide-react';
import type { CouncilThinkingUI } from '../../stores/chatStore.js';
import { buildReasoningPanelModel, type MemberRow } from './CouncilProgressPanel.logic.js';

/**
 * Right "Reasoning" panel — the quiet, actionable review surface for one turn.
 *
 * Resting surface: an outcome sentence, compact reviewer rows, and two collapsed
 * sections (lessons, gaps). Density is revealed on click: rows expand to the full
 * note, sections open on intent. Tokens only; no pills, badges or uppercase labels.
 *
 * File/export names keep "Council" to avoid churn — display strings read as
 * "Reasoning"/"reviewers" by owner decision.
 */

interface Props {
  council?: CouncilThinkingUI | null;
  onApplyLesson?: (lesson: string) => void;
  onReconvene?: () => void;
  onDesignMode?: () => void;
  onExportVisualPlan?: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

const TONE_VAR: Record<string, string> = {
  good: 'var(--tone-good)',
  warn: 'var(--tone-warn)',
  bad: 'var(--tone-bad)',
  info: 'var(--tone-info)',
  silent: 'var(--chat-muted)',
};

export function CouncilProgressPanel({
  council,
  onApplyLesson,
  onReconvene,
  onDesignMode,
  onExportVisualPlan,
  isOpen = true,
  onClose,
}: Props) {
  const model = useMemo(() => (council ? buildReasoningPanelModel(council) : null), [council]);

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-[min(20rem,90vw)] flex-col border-l border-[color:var(--border)] bg-[color:var(--sidebar-surface)] text-xs text-[color:var(--fg)]">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--sidebar-surface)] px-3.5 py-2.5">
        <span className="font-medium text-[color:var(--chat-strong)]">Reasoning</span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[color:var(--chat-muted)] transition-colors hover:text-[color:var(--chat-strong)]"
            aria-label="Close reasoning panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!model ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[color:var(--chat-muted)]">
          <p className="text-[11px] leading-relaxed">
            Nothing under review right now. Substantive turns show the reviewers, their
            positions and lessons here.
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-5 overflow-y-auto px-3.5 py-4">
          <div>
            <div className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: TONE_VAR[model.outcome.tone] }}
              />
              <p className="min-w-0 text-[12px] leading-snug text-[color:var(--chat-strong)]">
                {model.outcome.sentence}
                <span className="ml-1.5 whitespace-nowrap text-[10px] font-normal text-[color:var(--chat-muted)]">{model.outcome.suffix}</span>
              </p>
            </div>
            {model.readAs && (
              <p className="mt-1.5 pl-3.5 text-[10px] leading-snug text-[color:var(--chat-muted)]">
                Read as: {model.readAs}
              </p>
            )}
          </div>

          {!model.noResponders && (
            <div className="space-y-0.5">
              {model.members.map((row, idx) => (
                <MemberRowView key={`${row.name}-${idx}`} row={row} />
              ))}
            </div>
          )}

          {model.lessons.length > 0 && (
            <Section title={model.lessons.length === 1 ? '1 lesson' : `${model.lessons.length} lessons`}>
              <ul className="space-y-2">
                {model.lessons.map((lesson, i) => (
                  <li key={i} className="text-[10px] leading-snug text-[color:var(--chat-muted)]">
                    <span className="text-[color:var(--fg)]">{lesson}</span>
                    {onApplyLesson && (
                      <button
                        onClick={() => onApplyLesson(lesson)}
                        className="mt-0.5 block text-[10px] text-[color:var(--accent-text)] transition-opacity hover:opacity-80"
                      >
                        Apply to next turn
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {model.gaps.length > 0 && (
            <Section title={model.gaps.length === 1 ? '1 gap' : `${model.gaps.length} gaps`}>
              <ul className="space-y-1.5">
                {model.gaps.map((gap, i) => (
                  <li key={i} className="text-[10px] leading-snug text-[color:var(--chat-muted)]">
                    {gap}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      {model && (
        <Footer onReconvene={onReconvene} onDesignMode={onDesignMode} onExportVisualPlan={onExportVisualPlan} />
      )}
    </div>
  );
}

function MemberRowView({ row }: { row: MemberRow }) {
  const [expanded, setExpanded] = useState(false);
  const expandable = row.fullNote.length > 0;
  return (
    <div>
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? expanded : undefined}
        onClick={() => expandable && setExpanded((v) => !v)}
        className={`flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left ${
          expandable ? 'cursor-pointer transition-colors hover:bg-[color:var(--panel)]' : 'cursor-default'
        } ${row.stance === 'silent' ? 'opacity-60' : ''}`}
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
          style={{ background: TONE_VAR[row.stance] }}
        />
        <span className="shrink-0 font-medium text-[color:var(--chat-strong)]">{row.name}</span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-[color:var(--chat-muted)]">
          {row.position}
        </span>
      </button>
      {expanded && row.fullNote && (
        <p className="mb-1 ml-5 whitespace-pre-wrap border-l border-[color:var(--border)] pl-2 text-[10px] leading-snug text-[color:var(--chat-muted)]">
          {row.fullNote}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-[10px] text-[color:var(--chat-muted)] transition-colors hover:text-[color:var(--chat-strong)]"
      >
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
        {title}
      </button>
      {open && <div className="mt-2 pl-3.5">{children}</div>}
    </div>
  );
}

function Footer({
  onReconvene,
  onDesignMode,
  onExportVisualPlan,
}: Pick<Props, 'onReconvene' | 'onDesignMode' | 'onExportVisualPlan'>) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="relative flex items-center gap-1.5 border-t border-[color:var(--border)] px-3.5 py-2.5">
      {onReconvene && (
        <button
          onClick={onReconvene}
          className="flex-1 rounded-md border border-[color:var(--border)] py-1.5 text-[10px] text-[color:var(--fg)] transition-colors hover:bg-[color:var(--panel)]"
        >
          Run another round
        </button>
      )}
      {(onDesignMode || onExportVisualPlan) && (
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="More actions"
          className="rounded-md border border-[color:var(--border)] p-1.5 text-[color:var(--chat-muted)] transition-colors hover:bg-[color:var(--panel)] hover:text-[color:var(--chat-strong)]"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      )}
      {menuOpen && (
        <div className="absolute bottom-full right-3.5 mb-1 w-52 rounded-md border border-[color:var(--border)] bg-[color:var(--sidebar-surface)] py-1 shadow-lg">
          {onDesignMode && (
            <button
              onClick={() => { setMenuOpen(false); onDesignMode(); }}
              className="block w-full px-3 py-1.5 text-left text-[10px] text-[color:var(--fg)] transition-colors hover:bg-[color:var(--panel)]"
            >
              Annotate this panel in design mode
            </button>
          )}
          {onExportVisualPlan && (
            <button
              onClick={() => { setMenuOpen(false); onExportVisualPlan(); }}
              className="block w-full px-3 py-1.5 text-left text-[10px] text-[color:var(--fg)] transition-colors hover:bg-[color:var(--panel)]"
            >
              Export this review as a plan
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default CouncilProgressPanel;
