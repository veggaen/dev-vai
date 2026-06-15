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

/**
 * VS Code / Cursor-style status strip above the composer.
 * Headline + optional compact queue — never the full nested ProcessTree from the message.
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
        <span className="composer-process-strip__meta shrink-0 font-mono text-[10px] tabular-nums opacity-60">
          {isRunning && activity.stepElapsed && `${activity.stepElapsed} · `}
          {activity.stepProgress && `${activity.stepProgress} · `}{activity.elapsed}
        </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 opacity-50 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
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
            <ol className="composer-activity-queue px-3 py-2" aria-label="Activity queue">
              {activity.queue.map((item) => (
                <li key={item.id} className="composer-activity-queue__item flex items-center gap-2 py-0.5 font-mono text-[10px]">
                  {item.status === 'done' ? (
                    <Check className="h-3 w-3 shrink-0 text-[color:var(--phase-verify)] opacity-80" aria-hidden="true" />
                  ) : (
                    <VaiNode state="thinking" size={6} tone={toneForStage(activity.activeStage)} />
                  )}
                  <span className={`truncate ${item.status === 'running' ? 'text-[color:var(--chat-strong)]' : 'text-[color:var(--chat-muted)]'}`}>
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
