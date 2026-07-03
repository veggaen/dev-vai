import { useEffect, useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { VaiNode, type VaiNodeProps } from '../brand/VaiNode.js';
import type { useComposerActivity } from '../../hooks/useComposerActivity.js';
import { useAnimatedEllipsis } from '../../hooks/useAnimatedEllipsis.js';

export interface ComposerProcessStripProps {
  readonly activity: ReturnType<typeof useComposerActivity>;
  readonly expanded: boolean;
  readonly onExpandedChange: (open: boolean) => void;
  readonly studioChrome?: boolean;
}

function toneForStage(stage: string): VaiNodeProps['tone'] {
  if (stage.startsWith('tool')) return 'verify';
  if (stage.startsWith('council')) return 'route';
  if (stage === 'search' || stage === 'research') return 'evidence';
  if (stage === 'vai-draft' || stage === 'vai-redraft') return 'compose';
  if (stage.startsWith('build')) return 'compose';
  return 'accent';
}

const stripEase = [0.25, 0.1, 0.25, 1] as const;

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

/**
 * VS Code / Cursor-style todo strip above the composer.
 * Header carries the live headline + (done/total) count; the drawer lists every step as a
 * three-state todo (done / active / pending) with the active row highlighted and kept in view.
 */
export function ComposerProcessStrip({
  activity,
  expanded,
  onExpandedChange,
  studioChrome = false,
}: ComposerProcessStripProps) {
  const shell = studioChrome
    ? 'border-zinc-200 bg-zinc-50 text-zinc-800'
    : 'border-zinc-700/50 bg-zinc-900/90 text-zinc-200';
  const isRunning = activity.queue.some((q) => q.status === 'running');
  const headline = useAnimatedEllipsis(isRunning, activity.headline);
  const subActivityAnimated = useAnimatedEllipsis(isRunning && Boolean(activity.subActivity), activity.subActivity ?? '');
  const activeRowRef = useRef<HTMLLIElement | null>(null);
  const activeId = activity.queue.find((q) => q.status === 'running')?.id;

  // Keep the active todo visible as the list scrolls past its max height.
  useEffect(() => {
    if (!expanded || !activeId) return;
    activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [expanded, activeId]);

  return (
    <AnimatePresence initial={false}>
      {!activity.isIdle && (
        <motion.div
          key="composer-process-strip"
          data-testid="composer-process-strip"
          className={`composer-process-strip overflow-hidden rounded-lg border ${shell}`}
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.22, ease: stripEase }}
        >
          <button
            type="button"
            onClick={() => onExpandedChange(!expanded)}
            aria-expanded={expanded}
            className="composer-process-strip__bar flex w-full items-center gap-2 px-3 py-2 text-left"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 opacity-50 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
              aria-hidden="true"
            />
            <VaiNode
              state={isRunning ? 'thinking' : 'done'}
              size={8}
              tone={toneForStage(activity.activeStage)}
            />
            <span className="min-w-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={activity.headline}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.16, ease: stripEase }}
                  className="composer-process-strip__label block truncate font-mono text-[11px]"
                >
                  {headline}
                </motion.span>
              </AnimatePresence>
              {activity.subActivity && (
                <span className="composer-process-strip__sub block truncate font-mono text-[10px] opacity-55">
                  {subActivityAnimated}
                </span>
              )}
            </span>
            {activity.totalCount > 0 && (
              <span className="composer-process-strip__count shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                {activity.doneCount}/{activity.totalCount}
              </span>
            )}
            <span className="composer-process-strip__meta shrink-0 font-mono text-[10px] tabular-nums opacity-60">
              {isRunning && activity.stepElapsed && `${activity.stepElapsed} · `}{activity.elapsed}
            </span>
          </button>

          <motion.div
            className="overflow-hidden border-t border-inherit"
            initial={false}
            animate={{
              height: expanded && activity.queue.length > 0 ? 'auto' : 0,
              opacity: expanded && activity.queue.length > 0 ? 1 : 0,
            }}
            transition={{ duration: 0.2, ease: stripEase }}
          >
            <ol className="composer-activity-queue px-2 py-1.5" aria-label="Turn steps">
              {activity.queue.map((item) => (
                <li
                  key={item.id}
                  ref={item.status === 'running' ? activeRowRef : undefined}
                  className={`composer-activity-queue__item flex items-center gap-2 rounded-md px-1.5 py-1 font-mono text-[10px] ${
                    item.status === 'running' ? 'composer-activity-queue__item--active' : ''
                  } ${item.status === 'pending' ? 'composer-activity-queue__item--pending' : ''}`}
                >
                  <StepGlyph status={item.status} />
                  <span
                    className={`truncate ${
                      item.status === 'running'
                        ? 'text-[color:var(--chat-strong)]'
                        : 'text-[color:var(--chat-muted)]'
                    }`}
                  >
                    {item.shortLabel}
                  </span>
                </li>
              ))}
            </ol>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ComposerProcessStrip;
