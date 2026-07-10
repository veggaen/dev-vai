/**
 * ComposerDock — the single calm status surface above the composer.
 *
 * Replaces four separately-boxed surfaces that used to stack above the input
 * (ComposerProcessStrip, BackgroundProcessWindow, FileChangesBar, WorkspaceChip
 * row) with ONE borderless status line whose segments open ONE shared drawer.
 *
 * The rule that keeps the composer calm: at most one boxed panel may exist
 * above the input, ever. The line itself is text-first — no borders, no fills —
 * so an idle composer renders nothing here at all.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, FileText, Terminal, Trash2, X } from 'lucide-react';
import { VaiNode, type VaiNodeProps } from '../brand/VaiNode.js';
import type { useComposerActivity } from '../../hooks/useComposerActivity.js';
import { useAnimatedEllipsis } from '../../hooks/useAnimatedEllipsis.js';
import { formatDuration } from '../../lib/formatDuration.js';
import { useBackgroundTaskStore } from '../../stores/backgroundTaskStore.js';
import type { ProcessRow } from '../../hooks/useBackgroundProcesses.js';

export interface FileChangeEntry {
  readonly id: string;
  readonly path: string;
  /** Lines added — render only when the backend reports it. */
  readonly added?: number;
  /** Lines removed — render only when the backend reports it. */
  readonly removed?: number;
}

export interface ComposerDockProps {
  readonly activity: ReturnType<typeof useComposerActivity>;
  readonly processes: readonly ProcessRow[];
  readonly files: readonly FileChangeEntry[];
  /** Open this file in the app code view (IDE). */
  readonly onOpenFile: (path: string) => void;
  /** Acknowledge the file changes and dismiss them for this turn. */
  readonly onKeepFiles: () => void;
  /** Real revert hook. Omit when no backend revert exists — the button is hidden. */
  readonly onDiscardFiles?: () => void;
  /** Slim workspace affordances (attach folder / pending diffs) — already text-level. */
  readonly workspaceSlot?: ReactNode;
  readonly studioChrome?: boolean;
  /** The live message already owns turn progress; keep this dock for workspace/process/file state only. */
  readonly suppressTurnSteps?: boolean;
}

type DockSection = 'steps' | 'processes' | 'files';

const dockEase = [0.25, 0.1, 0.25, 1] as const;

function toneForStage(stage: string): VaiNodeProps['tone'] {
  if (stage.startsWith('tool')) return 'verify';
  if (stage.startsWith('council')) return 'route';
  if (stage === 'search' || stage === 'research') return 'evidence';
  if (stage === 'vai-draft' || stage === 'vai-redraft') return 'compose';
  if (stage.startsWith('build')) return 'compose';
  return 'accent';
}

/** Three-state todo glyph: done, active (pulsing ring), pending. */
function StepGlyph({ status }: { status: 'running' | 'done' | 'pending' }) {
  if (status === 'done') {
    return (
      <span className="composer-step-glyph composer-step-glyph--done" aria-hidden="true">
        <Check className="h-2 w-2" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="composer-step-glyph composer-step-glyph--active" aria-hidden="true">
        <span className="composer-step-glyph__core" />
      </span>
    );
  }
  return <span className="composer-step-glyph composer-step-glyph--pending" aria-hidden="true" />;
}

function useNowTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function ComposerDock({
  activity,
  processes,
  files,
  onOpenFile,
  onKeepFiles,
  onDiscardFiles,
  workspaceSlot,
  studioChrome = false,
  suppressTurnSteps = false,
}: ComposerDockProps) {
  const [openSection, setOpenSection] = useState<DockSection | null>(null);
  const dismissTask = useBackgroundTaskStore((s) => s.dismissTask);
  const dismissAll = useBackgroundTaskStore((s) => s.dismissAll);
  const activeRowRef = useRef<HTMLLIElement | null>(null);

  const running = useMemo(() => processes.filter((p) => p.status === 'running'), [processes]);
  const settled = useMemo(() => processes.filter((p) => p.status !== 'running'), [processes]);
  const visibleProcesses = useMemo(
    () => [...running, ...settled.slice(0, Math.max(0, 6 - running.length))],
    [running, settled],
  );
  const now = useNowTick(running.length > 0);

  const isRunning = activity.queue.some((q) => q.status === 'running');
  const headline = useAnimatedEllipsis(isRunning, activity.headline);
  const activeStepId = activity.queue.find((q) => q.status === 'running')?.id;

  const hasSteps = !activity.isIdle && !suppressTurnSteps;
  const hasProcesses = visibleProcesses.length > 0;
  const hasFiles = files.length > 0;

  const totalAdded = files.reduce((n, f) => n + (f.added ?? 0), 0);
  const totalRemoved = files.reduce((n, f) => n + (f.removed ?? 0), 0);

  // A section that empties closes its own drawer — never leaves a husk open.
  useEffect(() => {
    if (openSection === 'steps' && !hasSteps) setOpenSection(null);
    if (openSection === 'processes' && !hasProcesses) setOpenSection(null);
    if (openSection === 'files' && !hasFiles) setOpenSection(null);
  }, [openSection, hasSteps, hasProcesses, hasFiles]);

  // Keep the active todo visible as the list scrolls past the drawer height.
  useEffect(() => {
    if (openSection !== 'steps' || !activeStepId) return;
    activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [openSection, activeStepId]);

  const anySegment = hasSteps || hasProcesses || hasFiles;
  const toggle = (section: DockSection) =>
    setOpenSection((cur) => (cur === section ? null : section));

  if (!anySegment && !workspaceSlot) return null;

  const segClass = (section: DockSection) =>
    `composer-dock-seg ${openSection === section ? 'composer-dock-seg--open' : ''}`;

  return (
    <div className="composer-dock-status" data-testid="composer-dock" data-studio={studioChrome ? 'true' : undefined}>
      {anySegment && (
        <div className="composer-dock-line flex min-h-[24px] flex-wrap items-center gap-x-3 gap-y-1 px-1.5 pb-1.5">
          {hasSteps && (
            <button
              type="button"
              onClick={() => toggle('steps')}
              aria-expanded={openSection === 'steps'}
              className={segClass('steps')}
              title={activity.subActivity ?? undefined}
            >
              <VaiNode state={isRunning ? 'thinking' : 'done'} size={8} tone={toneForStage(activity.activeStage)} />
              <span className="composer-dock-seg__label max-w-[34ch] truncate">{headline}</span>
              {activity.totalCount > 0 && (
                <span className="tabular-nums opacity-60">{activity.doneCount}/{activity.totalCount}</span>
              )}
              <span className="tabular-nums opacity-45">
                {isRunning && activity.stepElapsed ? `${activity.stepElapsed} · ` : ''}{activity.elapsed}
              </span>
            </button>
          )}

          {hasProcesses && (
            <button type="button" onClick={() => toggle('processes')} aria-expanded={openSection === 'processes'} className={segClass('processes')}>
              <Terminal className="h-3 w-3 opacity-60" aria-hidden />
              <span>
                {running.length > 0
                  ? `${running.length} running`
                  : `${visibleProcesses.length} recent`}
              </span>
            </button>
          )}

          {hasFiles && (
            <button type="button" onClick={() => toggle('files')} aria-expanded={openSection === 'files'} className={segClass('files')}>
              <FileText className="h-3 w-3 opacity-60" aria-hidden />
              <span>{files.length} file{files.length === 1 ? '' : 's'} changed</span>
              {(totalAdded > 0 || totalRemoved > 0) && (
                <span className="tabular-nums">
                  {totalAdded > 0 && <span className="text-[color:var(--phase-verify)]">+{totalAdded}</span>}
                  {totalRemoved > 0 && <span className="ml-1 text-[color:var(--tone-bad)]">−{totalRemoved}</span>}
                </span>
              )}
            </button>
          )}

          {workspaceSlot && <span className="ml-auto flex min-w-0 items-center">{workspaceSlot}</span>}
        </div>
      )}
      {!anySegment && workspaceSlot && (
        <div className="composer-dock-line flex min-h-[24px] items-center px-1.5 pb-1.5">{workspaceSlot}</div>
      )}

      <AnimatePresence initial={false}>
        {openSection && (
          <motion.div
            key={openSection}
            className="composer-dock-drawer overflow-hidden rounded-xl border border-[color:var(--panel-border-soft)] bg-[color:var(--panel-bg-inset)]"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.2, ease: dockEase }}
          >
            {openSection === 'steps' && (
              <ol className="composer-activity-queue max-h-52 overflow-y-auto px-2 py-1.5" aria-label="Turn steps">
                {activity.queue.map((item) => (
                  <li
                    key={item.id}
                    ref={item.status === 'running' ? activeRowRef : undefined}
                    className={`composer-activity-queue__item flex items-center gap-2 rounded-md px-1.5 py-1 font-mono text-[10px] ${
                      item.status === 'running' ? 'composer-activity-queue__item--active' : ''
                    } ${item.status === 'pending' ? 'composer-activity-queue__item--pending' : ''}`}
                  >
                    <StepGlyph status={item.status} />
                    <span className={`truncate ${item.status === 'running' ? 'text-[color:var(--chat-strong)]' : 'text-[color:var(--chat-muted)]'}`}>
                      {item.shortLabel}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {openSection === 'processes' && (
              <>
                <ul className="max-h-52 overflow-y-auto py-1">
                  {visibleProcesses.map((row) => {
                    const elapsed = formatDuration(now - row.startedAt);
                    const faded = row.status !== 'running';
                    return (
                      <li key={row.id} className={`group flex items-center gap-2 px-3 py-1.5 text-[12px] ${faded ? 'opacity-45' : ''}`}>
                        <Terminal className="h-3.5 w-3.5 shrink-0 text-[color:var(--chat-muted)]" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[color:var(--chat-body)]">{row.label}</span>
                        <span className="shrink-0 tabular-nums text-[11px] text-[color:var(--chat-muted)]">{elapsed}</span>
                        {row.source === 'manual' && (
                          <button
                            type="button"
                            onClick={() => dismissTask(row.id)}
                            className="rounded p-0.5 text-[color:var(--chat-muted)] opacity-0 transition-opacity hover:text-[color:var(--tone-bad)] group-hover:opacity-100"
                            aria-label={`Dismiss ${row.label}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {running.length === 0 && settled.length > 0 && (
                  <div className="flex items-center justify-end border-t border-[color:var(--panel-border-soft)] px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => { dismissAll(); setOpenSection(null); }}
                      className="text-[10px] font-medium text-[color:var(--chat-muted)] transition-colors hover:text-[color:var(--chat-strong)]"
                    >
                      Clear all
                    </button>
                  </div>
                )}
              </>
            )}

            {openSection === 'files' && (
              <>
                <ul className="max-h-52 space-y-0.5 overflow-y-auto px-2 pt-2 pb-1">
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
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2 border-t border-[color:var(--panel-border-soft)] px-3 py-2">
                  <button
                    type="button"
                    onClick={() => { onKeepFiles(); setOpenSection(null); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-softer)]"
                  >
                    <Check c