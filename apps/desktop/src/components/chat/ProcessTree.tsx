import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, Copy } from 'lucide-react';
import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import { useProcessChildReveal } from '../../hooks/useProcessChildReveal.js';
import { useAnimatedEllipsis } from '../../hooks/useAnimatedEllipsis.js';
import { VaiNode, type VaiNodeProps } from '../brand/VaiNode.js';
import { buildProcessTree, buildTimeSpectrum, isExpandable, shouldAutoExpand, resolveDwellCollapse, planStaggeredReveal, activeRevealIndex, type ProcessNode, type ProcessTone, type SpectrumSegment } from './ProcessTree.logic.js';
import { ProcessTreeCopyActions } from './ProcessTreeCopyActions.js';
import { copyProcessText } from './ProcessTree.copy.js';
import { humanizeLiveTail } from './process-humanize.js';

/**
 * ProcessTree — top-down live trace that collapses in place when the turn settles.
 *
 * LIVE: rows append downward; completed steps compact; running step may expand.
 * SETTLING: expanded tree fades/shrinks (~320ms) — no pop-out remount.
 * SETTLED: one quiet summary line; click to re-open the same tree.
 */

interface ProcessTreeProps {
  readonly steps: readonly ChatProgressStep[];
  readonly council?: CouncilThinkingUI | null;
  readonly live?: boolean;
  readonly imageSteps?: readonly { phase: string; label: string; flaws?: string[] }[];
  readonly vaiProposedDraft?: string;
  readonly durationMs?: number;
  /** Steps the backend sent but the drip reveal has not shown yet. */
  readonly pendingStepCount?: number;
}

type TreePhase = 'live' | 'settling' | 'settled';

const ease = [0.25, 0.1, 0.25, 1] as const;
const SETTLE_MS = 340;

/** Tone → phase color variable (same palette as the thinking-phase fills). */
const SPECTRUM_TONE_VAR: Record<ProcessTone, string> = {
  default: 'var(--phase-read)',
  tool: 'var(--phase-read)',
  search: 'var(--phase-evidence)',
  council: 'var(--phase-route)',
  image: 'var(--phase-route)',
  compose: 'var(--phase-compose)',
  build: 'var(--phase-compose)',
  verify: 'var(--phase-verify)',
};

/**
 * TimeSpectrum — the settled summary's "where did the time go" strip.
 * Proportional segments, phase-colored, each hoverable for the exact step +
 * duration. Pure presentation of buildTimeSpectrum's data — no animation, no
 * gradient, one quiet instrument.
 */
function TimeSpectrum({ segments }: { segments: readonly SpectrumSegment[] }) {
  if (segments.length < 2) return null;
  return (
    <span
      className="mx-1 inline-flex h-[3px] w-24 shrink-0 items-stretch gap-px overflow-hidden rounded-full opacity-80 transition-opacity group-hover:opacity-100"
      role="img"
      aria-label={`Time by phase: ${segments.map((s) => s.label).join(', ')}`}
    >
      {segments.map((seg, i) => (
        <span
          key={`${seg.stage}-${i}`}
          title={seg.label}
          style={{
            width: `${Math.max(2, seg.share * 100)}%`,
            background: `color-mix(in oklab, ${SPECTRUM_TONE_VAR[seg.tone]} 78%, transparent)`,
          }}
        />
      ))}
    </span>
  );
}

function nodeTone(tone: ProcessTone | undefined): VaiNodeProps['tone'] {
  switch (tone) {
    case 'search': return 'evidence';
    case 'council': return 'route';
    case 'verify': return 'verify';
    case 'build': return 'compose';
    case 'compose': return 'compose';
    case 'tool': return 'verify';
    case 'image': return 'route';
    default: return 'accent';
  }
}

export function ProcessTree({ steps, council, live = false, imageSteps, vaiProposedDraft, durationMs, pendingStepCount = 0 }: ProcessTreeProps) {
  const nodes = buildProcessTree(steps, council ?? undefined, imageSteps, vaiProposedDraft, live, !live);
  const hasNodes = nodes.length > 0;
  const showLiveTail = live;
  // Name what Vai is doing right now instead of a bare "Working…". Derived from the
  // last running step (and the council member in flight, when there is one).
  const tailLabel = live ? deriveLiveTailLabel(steps) : 'Working';
  const summaryDuration = durationMs !== undefined && durationMs >= 500 ? durationMs : undefined;
  const [phase, setPhase] = useState<TreePhase>(live ? 'live' : 'settled');
  const [open, setOpen] = useState(false);
  const wasLiveRef = useRef(live);

  useEffect(() => {
    if (live) {
      setPhase('live');
      wasLiveRef.current = true;
      return;
    }
    if (!wasLiveRef.current) {
      setPhase('settled');
      return;
    }
    wasLiveRef.current = false;
    setPhase('settling');
    setOpen(false);
    const id = window.setTimeout(() => setPhase('settled'), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [live]);

  if (!hasNodes && phase === 'settled') return null;

  const summary = buildSummaryLine(nodes, durationMs);
  const spectrum = buildTimeSpectrum(steps);
  const showExpandedTree = phase === 'live' || phase === 'settling' || (phase === 'settled' && open);
  const treeLive = phase === 'live';
  const settledExpanded = phase === 'settled' && open;

  return (
    <div className="mb-3 text-[12px]" data-testid="process-tree" data-live={treeLive ? '1' : '0'} data-phase={phase}>
      <AnimatePresence initial={false}>
        {(phase === 'settled' || phase === 'settling') && (
          <motion.button
            key="summary"
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: phase === 'settling' ? 0.92 : 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: phase === 'settling' ? SETTLE_MS / 1000 : 0.24, ease }}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="group mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[color:var(--chat-muted)] transition-colors thinking-hover hover:text-[color:var(--chat-body)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
          >
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
            <VaiNode state="done" size={9} />
            <span className="min-w-0 flex-1 truncate text-[11px]">{summary}</span>
            <TimeSpectrum segments={spectrum} />
            {summaryDuration !== undefined && (
              <span className="shrink-0 tabular-nums text-[10px] text-[color:var(--chat-muted)]">{formatMs(summaryDuration)}</span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {showExpandedTree && (
          settledExpanded ? (
            <div key="tree-body-settled" className="mt-0.5 pl-1" data-testid="process-tree-body">
              <TimelineList nodes={nodes} allNodes={nodes} live={false} expandAll showLiveTail={false} />
            </div>
          ) : (
          <motion.div
            key="tree-body"
            className={treeLive || phase === 'settling' ? 'process-tree__flat' : 'mt-0.5 pl-1'}
            initial={false}
            animate={{
              opacity: phase === 'settling' ? 0 : 1,
              height: phase === 'settling' ? 0 : 'auto',
            }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: phase === 'settling' ? SETTLE_MS / 1000 : 0.22, ease }}
            style={{ overflow: 'hidden' }}
          >
            {treeLive && !hasNodes && (
              <div className="flex items-center gap-2 px-1 py-1 text-[color:var(--chat-body)]">
                <VaiNode state="thinking" size={10} />
                <span className="vai-process-shimmer">Thinking…</span>
              </div>
            )}
            <TimelineList nodes={nodes} allNodes={nodes} live={treeLive} showLiveTail={showLiveTail} tailLabel={tailLabel} pendingCount={pendingStepCount} />
          </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Build the live-tail label ("Consulting DeepSeek on first-principles reasoning…")
 * from the last running step. Falls back to a stage-derived phrase, then a generic
 * "Thinking it through…". Pure read of the steps the component already has.
 */
function deriveLiveTailLabel(steps: readonly ChatProgressStep[]): string {
  const active = [...steps].reverse().find((s) => s.status === 'running') ?? steps[steps.length - 1];
  if (!active) return 'Thinking it through…';
  const inFlight = active.councilMembers?.find((m) => m.pending)
    ?? (active.councilMembers?.length ? active.councilMembers[active.councilMembers.length - 1] : undefined);
  return humanizeLiveTail({
    stage: active.stage,
    memberInFlight: inFlight?.pending ? inFlight.name : undefined,
    memberTopic: inFlight?.topic,
  });
}

/**
 * Render a step label with `backticked` fragments as quiet monospace tokens — the
 * Copilot-timeline idiom for exact things (queries, paths, symbols). Plain text
 * otherwise; no markdown engine needed for one delimiter.
 */
function LabelText({ text }: { text: string }) {
  if (!text.includes('`')) return <>{text}</>;
  const parts = text.split(/`([^`]+)`/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <code key={i} className="process-code">{part}</code> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

/**
 * Ghost rows for steps the backend has announced but the reveal hasn't shown yet —
 * content arrives INTO a placeholder instead of pushing layout around. Width varies
 * per row so the ghosts read organic, not mechanical.
 */
function SkeletonRows({ count }: { count: number }) {
  if (count <= 0) return null;
  const rows = Math.min(count, 3);
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <li key={`skel-${i}`} className="process-skel" aria-hidden>
          <span className="process-skel__dot" />
          <span className="process-skel__bar" style={{ width: `${46 - i * 9}%`, opacity: 1 - i * 0.28 }} />
        </li>
      ))}
    </>
  );
}

function ProcessLiveTail({ label }: { label: string }) {
  const animated = useAnimatedEllipsis(true, label);
  return (
    <li
      className="process-tree__tail process-tree__step--last flex items-center gap-2 px-1.5 py-1"
      aria-live="polite"
    >
      <span className="flex h-3.5 w-3 shrink-0 items-center justify-center">
        <VaiNode state="thinking" size={7} tone="accent" />
      </span>
      <span className="vai-process-shimmer text-[11px] text-[color:var(--chat-muted)]">{animated}</span>
    </li>
  );
}

function TimelineList({
  nodes,
  allNodes,
  live,
  expandAll = false,
  showLiveTail = false,
  tailLabel = 'Working',
  pendingCount = 0,
}: {
  nodes: readonly ProcessNode[];
  allNodes: readonly ProcessNode[];
  live: boolean;
  expandAll?: boolean;
  showLiveTail?: boolean;
  tailLabel?: string;
  pendingCount?: number;
}) {
  // Staggered reveal: when a turn bursts many steps in one tick, play the timeline FORWARD —
  // append rows one read-window at a time instead of dumping all at once — so a fast turn is
  // still legible. Once revealed a row stays (we only gate the FRONTIER, never hide history).
  const revealedThrough = useStaggeredReveal(nodes.length, live);
  const visibleNodes = live ? nodes.slice(0, revealedThrough + 1) : nodes;
  const lastIndex = visibleNodes.length - 1;
  // The live tail keeps pulsing until the whole burst has been revealed.
  const tailVisible = showLiveTail || (live && revealedThrough < nodes.length - 1);
  // Ghost rows = steps we KNOW are coming (reveal backlog + backend-announced pending).
  const skeletonCount = live ? (nodes.length - visibleNodes.length) + pendingCount : 0;
  return (
    <ol className="process-tree__timeline space-y-0">
      <AnimatePresence initial={false}>
        {visibleNodes.map((node, index) => (
          <StepRow
            key={node.id}
            node={node}
            allNodes={allNodes}
            live={live}
            expandAll={expandAll}
            isLast={index === lastIndex && !tailVisible}
            enterAnimate={live && index === lastIndex}
            showTreeCopy={index === 0}
          />
        ))}
        {tailVisible && <ProcessLiveTail key="live-tail" label={tailLabel} />}
      </AnimatePresence>
      <SkeletonRows count={skeletonCount} />
    </ol>
  );
}

/**
 * Drive the staggered reveal frontier: returns the highest node index revealed so far. New
 * nodes that arrive in a burst are revealed one read-window apart (planStaggeredReveal); when
 * not live, everything is revealed immediately. Self-contained — a single interval, no
 * per-row timers. Pure scheduling math lives in ProcessTree.logic.ts (unit-tested).
 */
function useStaggeredReveal(count: number, live: boolean): number {
  const [revealed, setRevealed] = useState(count - 1);
  const startRef = useRef(Date.now());
  const planRef = useRef(planStaggeredReveal(count));
  useEffect(() => {
    if (!live) { setRevealed(count - 1); return; }
    planRef.current = planStaggeredReveal(count);
    startRef.current = Date.now();
    const tick = () => {
      const idx = activeRevealIndex(planRef.current, Date.now() - startRef.current);
      setRevealed((prev) => (idx > prev ? idx : prev)); // monotonic — never un-reveal
    };
    tick();
    const id = window.setInterval(tick, 120);
    return () => window.clearInterval(id);
  }, [count, live]);
  return Math.min(revealed, count - 1);
}

function StepRow({
  node,
  allNodes,
  live,
  expandAll = false,
  isLast,
  enterAnimate = false,
  showTreeCopy = false,
}: {
  node: ProcessNode;
  allNodes: readonly ProcessNode[];
  live: boolean;
  expandAll?: boolean;
  isLast: boolean;
  enterAnimate?: boolean;
  showTreeCopy?: boolean;
}) {
  const expandable = isExpandable(node);
  const running = node.status === 'running';
  const userToggledRef = useRef(false);
  const [open, setOpen] = useState(false);
  const childCount = node.children.length;
  // Stream the ACTIVE step open, whatever it is — not just council. The latest running
  // step auto-expands so the user watches its detail arrive live instead of clicking
  // each node to see its final element. A user toggle always wins, and a step
  // collapses itself once it completes (keeping the finished trace quiet). Council
  // still gets the slower drip-reveal of its member notes for readability.
  const autoExpandRunning = live && running && expandable;
  const streamChildren = autoExpandRunning && open;
  const visibleChildCount = useProcessChildReveal(childCount, streamChildren);
  const visibleChildren = node.children.slice(0, visibleChildCount);
  // When this row auto-opened, so we can hold it open for a human-readable dwell
  // before it folds — instead of flashing open and collapsing in the same frame on
  // a fast/bursted turn. Cleared once collapsed so a later re-open re-arms the dwell.
  const openedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (userToggledRef.current) return; // user owns the state once they click
    const next = shouldAutoExpand({ live, expandable, status: node.status, expandAll, userToggled: false });

    // Opening (or staying open while running): record when it opened, arm dwell.
    if (next === true) {
      if (openedAtRef.current === null) openedAtRef.current = Date.now();
      setOpen(true);
      return;
    }
    // A completed step wants to fold — but only after it has dwelled long enough
    // for the user to actually read it. Re-check on a timer if we're still early.
    if (next === false) {
      const dwell = resolveDwellCollapse({
        live, status: node.status, openedAt: openedAtRef.current, now: Date.now(),
        userToggled: false,
      });
      if (dwell === null) { setOpen(false); openedAtRef.current = null; return; }
      if (!dwell.open) { setOpen(false); openedAtRef.current = null; return; }
      setOpen(true); // hold through the remaining dwell window
      const id = window.setTimeout(() => {
        if (!userToggledRef.current) { setOpen(false); openedAtRef.current = null; }
      }, dwell.recheckInMs);
      return () => window.clearTimeout(id);
    }
    // next === null → leave as-is.
  }, [expandAll, expandable, live, node.status, childCount]);

  const toggle = () => {
    if (!expandable) return;
    userToggledRef.current = true;
    setOpen((v) => !v);
  };

  const displayLabel = live && node.tone === 'council'
    ? (node.shortLabel ?? node.label)
    : node.label;

  return (
    <motion.li
      layout="position"
      className={`process-tree__step group/process-row ${isLast ? 'process-tree__step--last' : ''}`}
      initial={enterAnimate ? { opacity: 0, y: 3 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease }}
    >
      <div className="process-tree__row-wrap flex items-start gap-0.5">
      <button
        type="button"
        disabled={!expandable}
        onClick={toggle}
        aria-expanded={expandable ? open : undefined}
        className={`process-tree__row ${running ? 'process-tree__row--running' : ''} ${running && live ? 'process-tree__row--focused' : ''} min-w-0 flex-1 flex items-start gap-2 px-1.5 py-1 text-left ${expandable ? '' : 'cursor-default'}`}
      >
        <span className="process-tree__chevron mt-px flex h-3.5 w-3 shrink-0 items-center justify-center">
          {expandable && (
            <ChevronRight className={`h-3 w-3 text-[color:var(--chat-muted)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
          )}
        </span>
        <StepGlyph node={node} livePulse={running && live} />
        <span className="min-w-0 flex-1">
          <span className={running ? 'text-[color:var(--chat-strong)] font-medium' : 'text-[color:var(--chat-muted)]'}>
            <LabelText text={displayLabel} />
          </span>
        {childCount > 0 && (
            <span className="ml-1.5 text-[10px] text-[color:var(--chat-muted)] opacity-70" title="Expand for in/out details">
              {childCount} detail{childCount === 1 ? '' : 's'}
            </span>
          )}
          {node.detail && (
            <span className="ml-1.5 text-[11px] text-[color:var(--chat-muted)] opacity-80">{node.detail}</span>
          )}
        </span>
        {running && live && (
          // ml-2 guarantees a gap so the timer never glues to the label (the "answer11s" bug).
          <LiveElapsed className="ml-2 shrink-0 tabular-nums text-[10px] text-[color:var(--chat-muted)] opacity-70" />
        )}
      </button>
      <ProcessTreeCopyActions
        node={node}
        allNodes={allNodes}
        showTreeCopy={showTreeCopy}
        compact
      />
      </div>

      {expandable && (
        <motion.div
          className="process-tree__children ml-[1.05rem] pl-3"
          initial={false}
          animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
          transition={{ duration: 0.2, ease }}
          style={{ overflow: 'hidden' }}
        >
          {node.note && node.children.length === 0 && (
            node.kind === 'reasoning'
              ? <ReasoningStreamPanel body={node.note} />
              : <ProcessNotePanel label={node.label} body={node.note} />
          )}
          {node.children.length > 0 && (
            <ol className="space-y-0">
              <AnimatePresence initial={false}>
                {visibleChildren.map((child) => (
                  <ChildRow key={child.id} node={child} allNodes={allNodes} live={live} parentRunning={running} expandAll={expandAll} />
                ))}
              </AnimatePresence>
            </ol>
          )}
        </motion.div>
      )}
    </motion.li>
  );
}

function ChildRow({
  node,
  allNodes,
  live = false,
  parentRunning = false,
  expandAll = false,
}: {
  node: ProcessNode;
  allNodes: readonly ProcessNode[];
  live?: boolean;
  parentRunning?: boolean;
  expandAll?: boolean;
}) {
  const expandable = isExpandable(node);
  const running = node.status === 'running';
  const userToggledRef = useRef(false);
  const [open, setOpen] = useState(expandAll && expandable);
  const streamChildren = live && (running || parentRunning);
  const visibleChildCount = useProcessChildReveal(node.children.length, streamChildren);
  const visibleChildren = node.children.slice(0, visibleChildCount);
  useEffect(() => {
    // Reveal the deepest ACTIVE element: a running child auto-opens while live so the
    // user sees the latest detail without drilling in; it collapses once it completes.
    const next = shouldAutoExpand({ live, expandable, status: node.status, expandAll, userToggled: userToggledRef.current });
    if (next !== null) setOpen(next);
  }, [expandAll, expandable, live, node.status]);
  return (
    <li className="group/process-row">
      <div className="process-tree__row-wrap flex items-start gap-0.5">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => { if (expandable) { userToggledRef.current = true; setOpen((v) => !v); } }}
        aria-expanded={expandable ? open : undefined}
        className={`process-tree__row min-w-0 flex-1 flex items-start gap-2 px-1 py-0.5 text-left ${expandable ? '' : 'cursor-default'} ${running ? 'process-tree__row--running' : ''}`}
      >
        <span className="mt-px flex h-3.5 w-3 shrink-0 items-center justify-center">
          {expandable && (
            <ChevronRight className={`h-3 w-3 text-[color:var(--chat-muted)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
          )}
        </span>
        <StepGlyph node={node} small livePulse={running && live} />
        <span className="min-w-0 flex-1 text-[11px]">
          <span className={running ? 'text-[color:var(--chat-strong)]' : 'text-[color:var(--chat-body)]'}>
            {node.label}
          </span>
          {node.children.length > 0 && (
            <span className="ml-1.5 text-[10px] text-[color:var(--chat-muted)] opacity-70">{node.children.length}</span>
          )}
          {node.detail && <span className="ml-1.5 text-[color:var(--chat-muted)] opacity-80">{node.detail}</span>}
        </span>
      </button>
      <ProcessTreeCopyActions node={node} allNodes={allNodes} compact />
      </div>
      {expandable && (
        <motion.div
          className="process-tree__children ml-[1.05rem] pl-3"
          initial={false}
          animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
          transition={{ duration: 0.2, ease }}
          style={{ overflow: 'hidden' }}
        >
          {node.note && node.children.length === 0 && (
            node.kind === 'reasoning'
              ? <ReasoningStreamPanel body={node.note} />
              : <ProcessNotePanel label={node.label} body={node.note} />
          )}
          {node.note && node.children.length > 0 && (
            <ProcessNotePanel label="Summary" body={node.note} />
          )}
          {node.children.length > 0 && (
            <ol className="space-y-0">
              <AnimatePresence initial={false}>
                {visibleChildren.map((child) => (
                  <ChildRow key={child.id} node={child} allNodes={allNodes} live={live} parentRunning={running || parentRunning} expandAll={expandAll} />
                ))}
              </AnimatePresence>
            </ol>
          )}
        </motion.div>
      )}
    </li>
  );
}

/**
 * Live reasoning stream — a council member "thinking out loud". Shows only the last few
 * lines of the rolling preview, monospace and quiet, auto-scrolled to the newest text. The
 * point is presence: the user sees the model actually working, not a static "qwen is working".
 * Animates opacity only (UI rubric); the content updates in place as deltas arrive.
 */
function ReasoningStreamPanel({ body }: { body: string }) {
  const scrollRef = useRef<HTMLPreElement>(null);
  const lines = body.split('\n').filter((l) => l.trim().length > 0);
  const tail = lines.slice(-6).join('\n');
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);
  return (
    <div className="process-tree__panel py-1">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-[color:var(--chat-muted)] opacity-70">
        <span className="vai-process-shimmer">Thinking out loud</span>
      </div>
      <pre
        ref={scrollRef}
        className="process-tree__panel-body process-tree__reasoning m-0 max-h-24 overflow-hidden whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[color:var(--chat-muted)]"
      >
        {tail}
      </pre>
    </div>
  );
}

function ProcessNotePanel({ label, body }: { label: string; body: string }) {
  const ioLabel = processPanelDisplayLabel(label);
  const [copied, setCopied] = useState(false);
  const copyBody = useCallback(async () => {
    const ok = await copyProcessText(body);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }, [body]);

  return (
    <div className="process-tree__panel group/panel relative py-1">
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <div className="process-tree__panel-label text-[10px] text-[color:var(--chat-muted)] opacity-70">
          {ioLabel}
        </div>
        <button
          type="button"
          className="process-tree__copy-btn process-tree__copy-btn--sm process-tree__copy-btn--panel"
          title="Copy panel text"
          aria-label="Copy panel text"
          onClick={() => { void copyBody(); }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <pre className="process-tree__panel-body m-0 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[color:var(--chat-body)]">
        {body}
      </pre>
    </div>
  );
}

function processPanelDisplayLabel(label: string): string {
  const normalized = label.trim();
  if (/^(In|Out|Input|Output|Request|Response|Result|Details|Summary)$/i.test(normalized)) return normalized;
  if (/^(Thought|Read|Action|Event|Show|Artifact|Feedback|Verdict)$/i.test(normalized)) return normalized;
  if (/^Tool (request|event|response|call)$/i.test(normalized)) return normalized;
  if (/^(Step context|Quality contract|Route hints|Risk flags|Retrieval hints|Advisor confidence)$/i.test(normalized)) return normalized;
  return 'Details';
}

function StepGlyph({ node, small, livePulse = false }: { node: ProcessNode; small?: boolean; livePulse?: boolean }) {
  const px = small ? 12 : 14;
  if (node.status === 'done') {
    return <Check className="mt-px shrink-0 text-[color:var(--phase-verify)]" style={{ width: px, height: px }} aria-hidden="true" />;
  }
  if (node.status === 'running' && !livePulse) {
    return (
      <span className="mt-0.5 flex shrink-0 items-center justify-center" style={{ width: px, height: px }}>
        <VaiNode state="done" size={small ? 7 : 9} tone={nodeTone(node.tone)} />
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex shrink-0 items-center justify-center" style={{ width: px, height: px }}>
      <VaiNode state={node.status === 'bad' ? 'error' : 'thinking'} size={small ? 7 : 9} tone={nodeTone(node.tone)} />
    </span>
  );
}

function buildSummaryLine(nodes: readonly ProcessNode[], durationMs?: number): string {
  const labels = nodes
    .filter((n) => n.kind !== 'activity-map')
    .map((n) => n.shortLabel ?? n.label);
  if (labels.length === 0) return durationMs !== undefined ? `Worked for ${formatMs(durationMs)}` : 'Answered';
  if (labels.length <= 3) return labels.join(' · ');
  return `${labels.slice(0, 2).join(' · ')} · +${labels.length - 2} more`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

/**
 * Self-ticking elapsed timer (pattern borrowed from t3code's WorkingTimer): updates the
 * span's textContent via a ref on a 1s interval, so a running row's clock advances WITHOUT
 * re-rendering the row (and its children) every tick. Mounts when the row goes running and
 * resets its start each mount.
 */
function LiveElapsed({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const startRef = useRef(Date.now());
  useEffect(() => {
    startRef.current = Date.now();
    const tick = () => {
      if (ref.current) ref.current.textContent = formatMs(Date.now() - startRef.current);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span ref={ref} className={className}>0ms</span>;
}

export default ProcessTree;
