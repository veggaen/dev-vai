import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight } from 'lucide-react';
import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import { VaiNode, type VaiNodeProps } from '../brand/VaiNode.js';
import { buildProcessTree, isExpandable, type ProcessNode, type ProcessTone } from './ProcessTree.logic.js';

/**
 * ProcessTree — the single, brand-native process view for a turn.
 *
 * One component, two states:
 *   • LIVE (streaming): rows animate in; the running step's glyph is the breathing
 *     intelligence node from the Vai mark, so the surface reads as Vai's mind
 *     ticking — not a generic spinner. Auto-expanded so the user can watch + steer.
 *   • SETTLED (after the turn): collapses to a quiet one-line summary; click to
 *     re-open the same tree.
 *
 * Two-level nesting: a top step with sub-work (council members, image steps) gets
 * its own chevron and expands IN PLACE under a connector rail. Everything rides
 * the design tokens (--chat-*, --panel-*, --accent, phase tones) and the
 * .process-tree / .vai-node CSS, so it is correct in both themes and silenced
 * under prefers-reduced-motion.
 */

interface ProcessTreeProps {
  readonly steps: readonly ChatProgressStep[];
  readonly council?: CouncilThinkingUI | null;
  /** When true the turn is in flight: auto-expanded, node breathing, no collapse line. */
  readonly live?: boolean;
  readonly imageSteps?: readonly { phase: string; label: string; flaws?: string[] }[];
  /** Process-only draft from thinking — shown when council escalated away from vai:v0. */
  readonly vaiProposedDraft?: string;
  /** Total elapsed for the settled summary line. */
  readonly durationMs?: number;
}

/** Map the tree's process tones onto the brand node's phase-tone vocabulary. */
function nodeTone(tone: ProcessTone | undefined): VaiNodeProps['tone'] {
  switch (tone) {
    case 'search': return 'evidence';
    case 'council': return 'route';
    case 'verify': return 'verify';
    case 'build': return 'compose';
    case 'compose': return 'compose';
    case 'image': return 'route';
    default: return 'accent';
  }
}

export function ProcessTree({ steps, council, live = false, imageSteps, vaiProposedDraft, durationMs }: ProcessTreeProps) {
  const nodes = buildProcessTree(steps, council ?? undefined, imageSteps, vaiProposedDraft);
  const hasNodes = nodes.length > 0;
  const [open, setOpen] = useState(live);
  const expanded = live || open;

  if (!hasNodes && !live) return null;

  const summary = live ? 'Working…' : buildSummaryLine(nodes, durationMs);

  return (
    <div className="mb-3 text-[12px]" data-testid="process-tree" data-live={live ? '1' : '0'}>
      {/* Settled summary / toggle — one quiet line, brand node + verified check. */}
      {!live && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={expanded}
          className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[color:var(--chat-muted)] transition-colors thinking-hover hover:text-[color:var(--chat-body)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
        >
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
          <VaiNode state="done" size={9} />
          <span className="min-w-0 flex-1 truncate text-[11px]">{summary}</span>
          {durationMs !== undefined && (
            <span className="shrink-0 tabular-nums text-[10px] text-[color:var(--chat-muted)]">{formatMs(durationMs)}</span>
          )}
        </button>
      )}

      {expanded && (
        <div className={live ? 'process-tree__flat' : 'mt-0.5 pl-1'}>
          {live && !hasNodes && (
            <div className="flex items-center gap-2 px-1 py-1 text-[color:var(--chat-body)]">
              <VaiNode state="thinking" size={10} />
              <span className="vai-process-shimmer">Thinking…</span>
            </div>
          )}
          <ol className="space-y-0">
            <AnimatePresence initial={false}>
              {nodes.map((node) => (
                <StepRow key={node.id} node={node} live={live} />
              ))}
            </AnimatePresence>
          </ol>
        </div>
      )}
    </div>
  );
}

/** One top-level step. Expandable when it has structured children OR a longer
 *  note body — click reveals "what actually happened" (results, output, debate). */
function StepRow({ node, live }: { node: ProcessNode; live: boolean }) {
  const expandable = isExpandable(node);
  const [open, setOpen] = useState(live && node.status === 'running' && node.children.length > 0);
  const running = node.status === 'running';

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <button
        type="button"
        disabled={!expandable}
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        className={`process-tree__row ${running ? 'process-tree__row--running' : ''} flex w-full items-start gap-2 px-1.5 py-1 text-left ${expandable ? '' : 'cursor-default'}`}
      >
        {/* chevron slot — drawn whenever there's something deeper to reveal */}
        <span className="mt-px flex h-3.5 w-3 shrink-0 items-center justify-center">
          {expandable && (
            <ChevronRight className={`h-3 w-3 text-[color:var(--chat-muted)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
          )}
        </span>
        <StepGlyph node={node} />
        <span className="min-w-0 flex-1">
          <span className={running ? 'text-[color:var(--chat-strong)]' : 'text-[color:var(--chat-muted)]'}>{node.label}</span>
          {node.children.length > 0 && (
            <span className="ml-1.5 text-[10px] text-[color:var(--chat-muted)] opacity-70">{node.children.length}</span>
          )}
          {node.detail && <span className="ml-1.5 text-[11px] text-[color:var(--chat-muted)] opacity-80">{node.detail}</span>}
        </span>
      </button>

      {expandable && open && (
        <div className="process-tree__children ml-[1.05rem] pl-3">
          {/* Leaf note — the "what happened" body for a step with no structured children. */}
          {node.note && node.children.length === 0 && (
            <p className="py-1 text-[11px] leading-relaxed text-[color:var(--chat-muted)]">{node.note}</p>
          )}
          {/* Structured children (council members, image steps), each itself expandable. */}
          {node.children.length > 0 && (
            <ol className="space-y-0">
              {node.children.map((child) => (
                <ChildRow key={child.id} node={child} />
              ))}
            </ol>
          )}
        </div>
      )}
    </motion.li>
  );
}

/** A second-level row (e.g. a council member). Expands to its own note body. */
function ChildRow({ node }: { node: ProcessNode }) {
  const expandable = isExpandable(node);
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        className={`process-tree__row flex w-full items-start gap-2 px-1 py-0.5 text-left ${expandable ? '' : 'cursor-default'}`}
      >
        <span className="mt-px flex h-3.5 w-3 shrink-0 items-center justify-center">
          {expandable && (
            <ChevronRight className={`h-3 w-3 text-[color:var(--chat-muted)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
          )}
        </span>
        <StepGlyph node={node} small />
        <span className="min-w-0 flex-1 text-[11px]">
          <span className="text-[color:var(--chat-body)]">{node.label}</span>
          {node.detail && <span className="ml-1.5 text-[color:var(--chat-muted)] opacity-80">{node.detail}</span>}
        </span>
      </button>
      {expandable && open && node.note && (
        <p className="ml-[1.05rem] border-l border-[color:var(--panel-border-soft)] py-1 pl-3 text-[11px] leading-relaxed text-[color:var(--chat-muted)]">
          {node.note}
        </p>
      )}
    </li>
  );
}

/**
 * The status glyph. Done → a crisp check; error → the node in error tone; running
 * → the breathing intelligence node tinted by the step's phase. This is where the
 * brand lives: the live indicator IS the logo's spark.
 */
function StepGlyph({ node, small }: { node: ProcessNode; small?: boolean }) {
  const px = small ? 12 : 14;
  if (node.status === 'done') {
    return <Check className="mt-px shrink-0 text-[color:var(--phase-verify)]" style={{ width: px, height: px }} aria-hidden="true" />;
  }
  return (
    <span className="mt-0.5 flex shrink-0 items-center justify-center" style={{ width: px, height: px }}>
      <VaiNode state={node.status === 'bad' ? 'error' : 'thinking'} size={small ? 7 : 9} tone={nodeTone(node.tone)} />
    </span>
  );
}

function buildSummaryLine(nodes: readonly ProcessNode[], durationMs?: number): string {
  const labels = nodes.map((n) => n.shortLabel ?? n.label);
  if (labels.length === 0) return durationMs !== undefined ? `Worked for ${formatMs(durationMs)}` : 'Answered';
  if (labels.length <= 3) return labels.join(' · ');
  return `${labels.slice(0, 2).join(' · ')} · +${labels.length - 2} more`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

export default ProcessTree;
