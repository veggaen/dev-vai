import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import { VaiNode } from '../brand/VaiNode.js';
import { type ProcessNode } from './ProcessTree.logic.js';
import {
  buildTimelineModel,
  type TimelinePhase,
  type TimelinePhaseId,
  type FeatureNote,
} from './Timeline.logic.js';
import {
  clampPan,
  clampScale,
  fitScale,
  panBy,
  visibleWindow,
  zoomAbout,
  zoomTier,
  IDENTITY_VIEWPORT,
  type Viewport,
  type ZoomTier,
} from './ReasoningFlow.viewport.js';

/**
 * Zoom/pan viewport for the spine. Wheel (or ctrl+wheel / pinch) zooms about the cursor; drag pans.
 * All math lives in ReasoningFlow.viewport (pure, tested); this hook is just the event plumbing and
 * clamps the result against the measured content/viewport widths so nodes never fly off-screen.
 */
function useSpineViewport(reduce: boolean) {
  const [vp, setVp] = useState<Viewport>(IDENTITY_VIEWPORT);
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startPan: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const dims = () => ({
    content: contentRef.current?.scrollWidth ?? 0,
    frame: frameRef.current?.clientWidth ?? 0,
  });

  const apply = useCallback((next: Viewport) => {
    const { content, frame } = dims();
    setVp(clampPan(next, content, frame));
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (reduce) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Horizontal-intent or ctrl → pan; otherwise zoom about the cursor. This keeps normal page
    // scroll working while the pointer is merely passing over the spine (no zoom hijack unless
    // the gesture is clearly a zoom: ctrlKey, or a mostly-vertical wheel while hovering).
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      const anchorX = e.clientX - rect.left;
      const factor = Math.exp(-e.deltaY * 0.0015);
      apply(zoomAbout(vp, factor, anchorX));
    } else {
      e.preventDefault();
      apply(panBy(vp, -e.deltaX));
    }
  }, [vp, apply, reduce]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (reduce) return;
    if (e.button !== 0) return; // primary button only
    // Only start a pan on empty canvas / background drag — never on a node button or the overlay
    // controls (zoom cluster, minimap), whose clicks must not be swallowed by pointer capture.
    const t = e.target as HTMLElement;
    if (t.closest('.reasoning-node, .reasoning-zoom, .reasoning-minimap')) return;
    drag.current = { startX: e.clientX, startPan: vp.panX };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [vp.panX, reduce]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    apply({ scale: vp.scale, panX: drag.current.startPan + (e.clientX - drag.current.startX) });
  }, [vp.scale, apply]);

  const endDrag = useCallback(() => {
    drag.current = null;
    setDragging(false);
  }, []);

  const zoomByButton = useCallback((factor: number) => {
    const { frame } = dims();
    apply(zoomAbout(vp, factor, frame / 2));
  }, [vp, apply]);

  const fit = useCallback(() => {
    const { content, frame } = dims();
    const scale = fitScale(content, frame);
    apply(clampPan({ scale, panX: 0 }, content, frame));
  }, [apply]);

  // Re-clamp when the content width changes (steps stream in) so the view stays valid.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => apply(vp));
    ro.observe(el);
    return () => ro.disconnect();
  }, [vp, apply]);

  return { vp, frameRef, contentRef, dragging, onWheel, onPointerDown, onPointerMove, endDrag, zoomByButton, fit, setVp };
}

/**
 * ReasoningFlow — the award-worthy presentation of a turn.
 *
 * The backend still streams a flat list of steps; {@link buildTimelineModel} already folds that into
 * the user's real mental model (phases → rounds → approval gate → self-improvement notes). This
 * component reads THAT model and renders it as a spatial reasoning constellation instead of a list:
 *
 *   • Each phase is a luminous NODE on a horizontal connective spine (the VaiNode motif — the same
 *     breathing glyph that defines the brand mark, so watching Vai reason reads as Vai's mind ticking).
 *   • The spine FILLS left-to-right as phases complete; the live phase pulses.
 *   • Selecting a node opens a SPOTLIGHT detail sheet below the spine — detail, tokens, council
 *     members, and reasoning are revealed on intent, never cluttering the resting surface.
 *   • Council members orbit their phase as a satellite row inside the spotlight.
 *   • The self-improvement lane (feature notes) sits apart as Vai's "what I still need" ledger.
 *
 * Doctrine (Thorsen): minimal-in-feel, reveal-on-intent, tokens only (no hardcoded colors), 2D +
 * Framer Motion only (no WebGL — respects the crash-safe GPU constraint), and no pill/chip/uppercase
 * micro-labels. Motion animates transform + opacity only and is silenced under reduced-motion.
 *
 * Fully additive: presentation-only. The logic model, ProcessTree, and backend are untouched.
 */

interface ReasoningFlowProps {
  readonly steps: readonly ChatProgressStep[];
  readonly council?: CouncilThinkingUI | null;
  readonly live?: boolean;
  readonly durationMs?: number;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

/**
 * Phase → hue token. Each phase carries its OWN color through to the settled state so the
 * constellation is color-coded by MEANING (read=blue, evidence=amber, deliberate=violet,
 * compose=accent, gate/verify=green) rather than collapsing to a single done-green. This is the
 * antidote to the mode-collapse Thorsen warns about: a glance at the spine tells you the shape of
 * the turn.
 */
const PHASE_HUE: Record<TimelinePhaseId, string> = {
  intake: 'var(--phase-read)',
  understand: 'var(--phase-read)',
  gather: 'var(--phase-evidence)',
  deliberate: 'var(--phase-route)',
  // Compose = Vai writing. --phase-compose aliases the brand accent, which in this theme is RED —
  // right next to the bad-tone red it would read as a failure. Use a distinct teal so "Vai drafts"
  // is unmistakably a normal step, keeping red exclusively for genuine failure (Thorsen).
  compose: 'var(--phase-compose-node, #45c8b0)',
  gate: 'var(--phase-verify)',
  redraft: 'var(--phase-compose-node, #45c8b0)',
  build: 'var(--phase-evidence)',
  deliver: 'var(--phase-verify)',
};

export function ReasoningFlow({ steps, council, live = false, durationMs }: ReasoningFlowProps) {
  const model = useMemo(() => buildTimelineModel(steps, council ?? undefined), [steps, council]);
  const reduce = useReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const view = useSpineViewport(!!reduce);
  const tier: ZoomTier = zoomTier(view.vp.scale);

  // Selection auto-follows the live phase so the user watches the active step without clicking;
  // once the user picks a node themselves, their choice sticks (tracked by a ref-guarded default).
  const userPicked = useRef(false);
  const livePhase = live ? model.phases.find((p) => p.status === 'running') : undefined;
  const effectiveSelectedId = selectedId ?? livePhase?.id ?? null;
  const selected = model.phases.find((p) => p.id === effectiveSelectedId) ?? null;

  if (model.phases.length === 0) return null;

  const total = durationMs ?? model.totalDurationMs;
  const doneCount = model.phases.filter((p) => p.status === 'done').length;
  const progress = model.phases.length > 0 ? doneCount / model.phases.length : 0;

  const select = (id: string) => {
    userPicked.current = true;
    setSelectedId((cur) => (cur === id ? null : id));
  };

  return (
    <div className="reasoning-flow mb-3" data-testid="reasoning-flow" data-live={live ? '1' : '0'}>
      {/* Header — quiet, no pills. The verdict is a word, not a badge. Thinking is never red;
          red is reserved for a genuine "sent back / not approved" settled outcome. */}
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-[color:var(--chat-muted)]">
        <VaiNode
          state={live ? 'thinking' : model.approved ? 'done' : 'error'}
          tone={live ? 'route' : 'verify'}
          size={11}
        />
        <span className="font-medium text-[color:var(--chat-body)]">Reasoning</span>
        <span className="opacity-70">
          {model.rounds > 1 ? `${model.rounds} rounds` : `${model.phases.length} steps`}
          {total >= 500 ? ` · ${formatMs(total)}` : ''}
        </span>
        <span className="ml-auto text-[color:var(--chat-muted)]">
          {live ? 'thinking' : model.approved ? 'approved' : 'best so far'}
        </span>
      </div>

      {/* The spine — a zoomable, pannable constellation on a 2D canvas. Wheel zooms about the cursor,
          drag pans, and detail is a function of zoom depth (semantic zoom). Controls + minimap reveal
          on hover (reveal-on-intent). Under reduced-motion the whole thing degrades to a static rail. */}
      <div
        className={`reasoning-spine-frame ${view.dragging ? 'reasoning-spine-frame--dragging' : ''} reasoning-tier-${tier}`}
        data-tier={tier}
        ref={view.frameRef}
        onWheel={reduce ? undefined : view.onWheel}
        onPointerDown={reduce ? undefined : view.onPointerDown}
        onPointerMove={reduce ? undefined : view.onPointerMove}
        onPointerUp={view.endDrag}
        onPointerLeave={view.endDrag}
      >
        <div
          className="reasoning-spine"
          ref={view.contentRef}
          role="list"
          aria-label="Reasoning steps"
          style={{ transform: `translateX(${view.vp.panX}px) scale(${view.vp.scale})`, transformOrigin: 'left center' }}
        >
          {/* Base rail + progress fill sit behind the nodes. */}
          <div className="reasoning-rail" aria-hidden="true">
            <motion.div
              className="reasoning-rail-fill"
              initial={false}
              animate={{ width: `${Math.max(progress * 100, live ? 8 : progress * 100)}%` }}
              transition={reduce ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>

          {model.phases.map((phase, i) => (
            <FlowNode
              key={phase.id}
              phase={phase}
              index={i}
              selected={phase.id === effectiveSelectedId}
              live={live}
              reduce={!!reduce}
              tier={tier}
              scale={view.vp.scale}
              onSelect={() => select(phase.id)}
            />
          ))}
        </div>

        {!reduce && (
          <SpineControls
            vp={view.vp}
            onZoomIn={() => view.zoomByButton(1.3)}
            onZoomOut={() => view.zoomByButton(1 / 1.3)}
            onFit={view.fit}
          />
        )}
        {!reduce && (
          <Minimap
            phases={model.phases}
            vp={view.vp}
            frameRef={view.frameRef}
            contentRef={view.contentRef}
          />
        )}
      </div>

      {/* Spotlight — detail for the selected node, revealed on intent below the spine. */}
      <AnimatePresence initial={false} mode="wait">
        {selected && (
          <motion.div
            key={selected.id}
            className="reasoning-spotlight"
            initial={reduce ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Spotlight phase={selected} live={live} />
          </motion.div>
        )}
      </AnimatePresence>

      {model.featureNotes.length > 0 && <ImprovementLedger notes={model.featureNotes} reduce={!!reduce} />}
    </div>
  );
}

/** Best confidence signal available for a phase (gate confidence, else max council member). */
function phaseConfidence(phase: TimelinePhase): number | undefined {
  if (phase.gate?.confidence !== undefined) return phase.gate.confidence;
  const members = phase.nodes.flatMap((n) => n.children).filter((c) => c.kind === 'submodel');
  if (members.length === 0) return undefined;
  const pcts = members
    .map((m) => /(\d+)%/.exec(m.detail ?? '')?.[1])
    .filter((x): x is string => !!x)
    .map(Number);
  return pcts.length ? Math.max(...pcts) / 100 : undefined;
}

function FlowNode({
  phase,
  index,
  selected,
  live,
  reduce,
  tier,
  scale,
  onSelect,
}: {
  phase: TimelinePhase;
  index: number;
  selected: boolean;
  live: boolean;
  reduce: boolean;
  tier: ZoomTier;
  scale: number;
  onSelect: () => void;
}) {
  const running = phase.status === 'running';
  const bad = phase.status === 'bad';
  // The node owns its color: it keeps the phase hue through the settled state (not forced green),
  // so the spine is a legible color map. A gate colors by its VERDICT (passed=green, sent-back=warn)
  // — the most meaningful signal for a checkpoint. Bad phases go to the bad tone; live phases breathe.
  const hue = bad
    ? 'var(--tone-bad)'
    : phase.gate
      ? phase.gate.approved
        ? 'var(--phase-verify)'
        : 'var(--tone-warn)'
      : PHASE_HUE[phase.phase] ?? 'var(--accent)';

  const confidence = tier === 'detail' ? phaseConfidence(phase) : undefined;

  return (
    <motion.button
      type="button"
      role="listitem"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={phase.title}
      title={phase.title}
      className={`reasoning-node ${selected ? 'reasoning-node--selected' : ''} ${bad ? 'reasoning-node--bad' : ''} ${running && live ? 'reasoning-node--live' : ''}`}
      style={{ ['--node-hue' as string]: hue }}
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : { delay: Math.min(index * 0.04, 0.3), duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      whileHover={reduce ? undefined : { y: -2 }}
    >
      {/* Counter-scale the node's chrome by 1/scale so discs + labels stay a CONSTANT readable size
          while the canvas scale only spreads nodes apart. This is true semantic zoom — zooming
          reveals more room + more detail, it does not billboard the text. */}
      <span className="reasoning-node-inner" style={{ transform: `scale(${1 / scale})` }}>
        <span className="reasoning-node-glyph" aria-hidden="true">
          <span className="reasoning-node-disc" />
        </span>
        {/* Semantic zoom: label appears at rest+, metadata only in detail tier. Overview = bare dots. */}
        {tier !== 'overview' && <span className="reasoning-node-title">{phase.title}</span>}
        {tier !== 'overview' && phase.durationMs !== undefined && phase.durationMs >= 250 && (
          <span className="reasoning-node-time tabular-nums">{formatMs(phase.durationMs)}</span>
        )}
        {confidence !== undefined && (
          <span className="reasoning-node-meta tabular-nums">{Math.round(confidence * 100)}% sure</span>
        )}
      </span>
    </motion.button>
  );
}

/** Zoom controls — a small cluster that reveals on frame-hover. Reveal-on-intent. */
function SpineControls({
  vp,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  vp: Viewport;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div className="reasoning-zoom" role="group" aria-label="Zoom controls">
      <button type="button" className="reasoning-zoom-btn" onClick={onZoomOut} aria-label="Zoom out" disabled={vp.scale <= clampScale(0.46)}>
        <Minus className="h-3 w-3" />
      </button>
      <button type="button" className="reasoning-zoom-fit" onClick={onFit} aria-label="Fit to view">
        <Maximize2 className="h-3 w-3" />
        <span className="tabular-nums">{Math.round(vp.scale * 100)}%</span>
      </button>
      <button type="button" className="reasoning-zoom-btn" onClick={onZoomIn} aria-label="Zoom in" disabled={vp.scale >= clampScale(2.59)}>
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Overview minimap — the whole turn as bare dots with a window marking what's on screen. */
function Minimap({
  phases,
  vp,
  frameRef,
  contentRef,
}: {
  phases: readonly TimelinePhase[];
  vp: Viewport;
  frameRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [win, setWin] = useState({ start: 0, end: 1 });
  useEffect(() => {
    const content = contentRef.current?.scrollWidth ?? 0;
    const frame = frameRef.current?.clientWidth ?? 0;
    setWin(visibleWindow(vp, content, frame));
  }, [vp, frameRef, contentRef]);

  // Only meaningful once the window is a real sub-range (i.e., zoomed/panned in).
  if (win.end - win.start >= 0.999) return null;

  return (
    <div className="reasoning-minimap" aria-hidden="true">
      <div className="reasoning-minimap-track">
        {phases.map((p) => {
          const bad = p.status === 'bad';
          const hue = bad
            ? 'var(--tone-bad)'
            : p.gate
              ? p.gate.approved ? 'var(--phase-verify)' : 'var(--tone-warn)'
              : PHASE_HUE[p.phase] ?? 'var(--accent)';
          return <span key={p.id} className="reasoning-minimap-dot" style={{ background: hue }} />;
        })}
        <span
          className="reasoning-minimap-window"
          style={{ left: `${win.start * 100}%`, width: `${(win.end - win.start) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Spotlight({ phase, live }: { phase: TimelinePhase; live: boolean }) {
  const gate = phase.gate;
  return (
    <div className="reasoning-spotlight-inner">
      <div className="reasoning-spotlight-head">
        <span className="reasoning-spotlight-title">{phase.title}</span>
        {gate && (
          <span className={`reasoning-verdict ${gate.approved ? '' : 'reasoning-verdict--warn'}`}>
            {gate.approved ? 'passed' : 'sent back'}
            {gate.confidence !== undefined ? ` · ${Math.round(gate.confidence * 100)}%` : ''}
          </span>
        )}
      </div>

      {phase.summary && phase.summary !== phase.title && (
        <p className="reasoning-spotlight-summary">{phase.summary}</p>
      )}

      {phase.nodes.map((node) => (
        <NodeBody key={node.id} node={node} live={live} />
      ))}
    </div>
  );
}

/** Recursive, quiet detail render for a phase's underlying ProcessTree node — no chips, tokens only. */
function NodeBody({ node, depth = 0, live }: { node: ProcessNode; depth?: number; live: boolean }) {
  return (
    <div className={depth > 0 ? 'reasoning-body-child' : ''}>
      {node.note?.trim() && node.children.length === 0 && (
        <pre className="reasoning-note">{node.note.trim()}</pre>
      )}
      {node.children.map((child) => (
        <div key={child.id} className="reasoning-subrow">
          <div className="reasoning-subrow-head">
            <span
              className={`reasoning-subdot ${child.status === 'running' && live ? 'reasoning-subdot--live' : ''} ${child.status === 'bad' ? 'reasoning-subdot--bad' : ''}`}
              aria-hidden="true"
            />
            <span className="reasoning-subrow-label">{child.label}</span>
            {child.detail && <span className="reasoning-subrow-detail">{child.detail}</span>}
          </div>
          {(child.note?.trim() || child.children.length > 0) && (
            <div className="reasoning-body-indent">
              <NodeBody node={child} depth={depth + 1} live={live} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ImprovementLedger({ notes, reduce }: { notes: readonly FeatureNote[]; reduce: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="reasoning-ledger">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="reasoning-ledger-toggle"
      >
        <VaiNode state="done" tone="evidence" size={9} />
        <span className="reasoning-ledger-title">
          {notes.length} note{notes.length === 1 ? '' : 's'} to improve Vai
        </span>
        <span className={`reasoning-ledger-caret ${open ? 'reasoning-ledger-caret--open' : ''}`} aria-hidden="true">›</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            className="reasoning-ledger-list"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {notes.map((note) => (
              <li key={note.id} className="reasoning-ledger-item">
                <span className={`reasoning-ledger-kind reasoning-ledger-kind--${note.kind}`}>
                  {note.kind === 'missing-capability' ? 'gap' : note.kind === 'method-lesson' ? 'lesson' : 'concern'}
                </span>
                <span className="reasoning-ledger-text">{note.text}</span>
                <span className="reasoning-ledger-source">— {note.source}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ReasoningFlow;
