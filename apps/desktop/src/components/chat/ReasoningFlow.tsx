import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Maximize2 } from 'lucide-react';
import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import { VaiNode } from '../brand/VaiNode.js';
import { type ProcessNode } from './ProcessTree.logic.js';
import {
  buildTimelineModel,
  type TimelinePhase,
  type TimelinePhaseId,
  type FeatureNote,
} from './Timeline.logic.js';
import { ReasoningStory } from './ReasoningStory.js';
import {
  baseContentWidth,
  clampPan,
  fitViewport,
  isAtFit,
  nodeX,
  panBy,
  panToFraction,
  visibleWindow,
  zoomAbout,
  zoomToNode,
  zoomTier,
  IDENTITY_VIEWPORT,
  type Viewport,
  type ZoomTier,
} from './ReasoningFlow.viewport.js';

/**
 * Zoom/pan viewport for the spine — event plumbing over the pure position math in
 * ReasoningFlow.viewport. Interaction policy (deliberate, the previous version got this wrong):
 *
 *   • Plain wheel is NEVER intercepted — the page keeps scrolling. Only ctrl+wheel (and trackpad
 *     pinch, which browsers report as ctrl+wheel) zooms, about the cursor. The listener is attached
 *     natively with { passive: false } on the frame itself so preventDefault actually works —
 *     React's synthetic onWheel is passive at the document root and silently fails to stop the
 *     page zoom/scroll, which was the root cause of the "zoom hijacks my scroll" bug.
 *   • Drag pans. Double-click on the background fits; double-click a node jumps to its detail.
 *   • Keyboard: ←/→ pan, +/− zoom about center, 0 fits. Tab walks the node buttons natively.
 *
 * Zoom moves node POSITIONS only (translateX per node) — no canvas scale(), so text stays crisp
 * and nothing can overflow the frame by being scaled up.
 */
function useSpineViewport(count: number, reduce: boolean) {
  const [vp, setVp] = useState<Viewport>(IDENTITY_VIEWPORT);
  const [frameW, setFrameW] = useState(0);
  const [smooth, setSmooth] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startPan: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const smoothTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentWidth = baseContentWidth(count);
  const vpRef = useRef(vp);
  vpRef.current = vp;

  // Track the frame width (sidebar toggles, window resizes) and re-clamp so the view stays legal.
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    setFrameW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const apply = useCallback((next: Viewport) => {
    const frame = frameRef.current?.clientWidth ?? 0;
    setVp((cur) => {
      const clamped = clampPan(next, contentWidth, frame);
      return clamped.scale === cur.scale && clamped.panX === cur.panX ? cur : clamped;
    });
  }, [contentWidth]);

  // Programmatic jumps (fit, zoom-to-node) glide; continuous input (wheel, drag) is immediate.
  const applySmooth = useCallback((next: Viewport) => {
    setSmooth(true);
    if (smoothTimer.current) clearTimeout(smoothTimer.current);
    smoothTimer.current = setTimeout(() => setSmooth(false), 280);
    apply(next);
  }, [apply]);
  useEffect(() => () => { if (smoothTimer.current) clearTimeout(smoothTimer.current); }, []);

  // Re-clamp when the content grows (steps stream in) or the frame resizes.
  useLayoutEffect(() => { apply(vpRef.current); }, [contentWidth, frameW, apply]);

  // Native non-passive wheel listener: ONLY ctrl+wheel/pinch zooms; plain wheel scrolls the page.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || reduce) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain wheel: never hijack page scroll
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0035);
      apply(zoomAbout(vpRef.current, factor, e.clientX - rect.left));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [reduce, apply]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (reduce || e.button !== 0) return;
    // Never swallow node or minimap interactions with pointer capture.
    const t = e.target as HTMLElement;
    if (t.closest('.reasoning-node, .reasoning-minimap, .reasoning-fit')) return;
    drag.current = { startX: e.clientX, startPan: vpRef.current.panX };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [reduce]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    apply({ scale: vpRef.current.scale, panX: drag.current.startPan + (e.clientX - drag.current.startX) });
  }, [apply]);

  const endDrag = useCallback(() => {
    drag.current = null;
    setDragging(false);
  }, []);

  const fit = useCallback(() => {
    const frame = frameRef.current?.clientWidth ?? 0;
    applySmooth(fitViewport(count, frame));
  }, [count, applySmooth]);

  const jumpToNode = useCallback((index: number) => {
    const frame = frameRef.current?.clientWidth ?? 0;
    applySmooth(zoomToNode(index, count, frame));
  }, [count, applySmooth]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (reduce) return;
    const t = e.target as HTMLElement;
    if (t.closest('.reasoning-node, .reasoning-minimap, .reasoning-fit')) return;
    fit();
  }, [reduce, fit]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (reduce || e.target !== e.currentTarget) return; // node buttons keep their own keys
    const frame = frameRef.current?.clientWidth ?? 0;
    const cur = vpRef.current;
    if (e.key === 'ArrowLeft') { e.preventDefault(); apply(panBy(cur, 80)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); apply(panBy(cur, -80)); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); applySmooth(zoomAbout(cur, 1.25, frame / 2)); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); applySmooth(zoomAbout(cur, 1 / 1.25, frame / 2)); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
  }, [reduce, apply, applySmooth, fit]);

  const scrubTo = useCallback((fraction: number) => {
    const frame = frameRef.current?.clientWidth ?? 0;
    apply(panToFraction(vpRef.current, fraction, contentWidth, frame));
  }, [apply, contentWidth]);

  const zoomFromMinimap = useCallback((deltaY: number) => {
    const frame = frameRef.current?.clientWidth ?? 0;
    apply(zoomAbout(vpRef.current, Math.exp(-deltaY * 0.0035), frame / 2));
  }, [apply]);

  const atFit = isAtFit(vp, count, frameW);

  return {
    vp, frameW, contentWidth, frameRef, dragging, smooth, atFit,
    onPointerDown, onPointerMove, endDrag, onDoubleClick, onKeyDown,
    fit, jumpToNode, scrubTo, zoomFromMinimap,
  };
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
  /** Settled rest: render ONLY the one-line header; the flow body is revealed on toggle. */
  readonly collapsed?: boolean;
  /** When provided (settled turns), the header toggles the collapsed state. */
  readonly onToggleCollapsed?: (nextCollapsed: boolean) => void;
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

export function ReasoningFlow({ steps, council, live = false, durationMs, collapsed = false, onToggleCollapsed }: ReasoningFlowProps) {
  const model = useMemo(() => buildTimelineModel(steps, council ?? undefined), [steps, council]);
  const reduce = useReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const count = model.phases.length;
  const view = useSpineViewport(count, !!reduce);
  const tier: ZoomTier = zoomTier(view.vp.scale);

  // Selection auto-follows the live phase so the user watches the active step without clicking;
  // once the user picks a node themselves, their choice sticks (tracked by a ref-guarded default).
  const userPicked = useRef(false);
  const livePhase = live ? model.phases.find((p) => p.status === 'running') : undefined;
  const effectiveSelectedId = selectedId ?? livePhase?.id ?? null;
  const selected = model.phases.find((p) => p.id === effectiveSelectedId) ?? null;

  if (count === 0) return null;

  const total = durationMs ?? model.totalDurationMs;
  const doneCount = model.phases.filter((p) => p.status === 'done').length;
  const progress = count > 0 ? doneCount / count : 0;

  const select = (id: string, index: number, viaKeyboard: boolean) => {
    userPicked.current = true;
    setSelectedId((cur) => (cur === id ? null : id));
    // Keyboard activation and double-click both jump to the node's detail tier.
    if (viaKeyboard && !reduce) view.jumpToNode(index);
  };

  const railStart = nodeX(0, view.vp.scale);
  const railEnd = nodeX(count - 1, view.vp.scale);
  // Settled enrichment for the one-line rest: how often the gate sent the draft back.
  const sentBack = model.phases.filter((p) => p.gate && !p.gate.approved).length;

  const headline = (
    <>
      <VaiNode
        state={live ? 'thinking' : model.approved ? 'done' : 'error'}
        tone={live ? 'route' : 'verify'}
        size={11}
      />
      <span className="font-medium text-[color:var(--chat-body)]">Reasoning</span>
      <span className="opacity-70">
        {model.rounds > 1 ? `${model.rounds} rounds` : `${count} steps`}
        {!live && sentBack > 0 ? ` · sent back ${sentBack === 1 ? 'once' : sentBack === 2 ? 'twice' : `${sentBack} times`}` : ''}
        {total >= 500 ? ` · ${formatMs(total)}` : ''}
      </span>
      <span className="ml-auto text-[color:var(--chat-muted)]">
        {live ? 'thinking' : model.approved ? 'approved' : 'best so far'}
      </span>
    </>
  );

  return (
    <div className="reasoning-flow mb-3" data-testid="reasoning-flow" data-live={live ? '1' : '0'} data-collapsed={collapsed ? '1' : '0'}>
      {/* Header — quiet, no pills. The verdict is a word, not a badge. Thinking is never red;
          red is reserved for a genuine "sent back / not approved" settled outcome. Once the turn
          settles this line IS the resting surface: the whole flow collapses behind it. */}
      {onToggleCollapsed ? (
        <button
          type="button"
          className="reasoning-flow-headline mb-2.5 flex w-full cursor-pointer items-center gap-2 text-[11px] text-[color:var(--chat-muted)]"
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapsed(!collapsed)}
        >
          {headline}
          <span className={`reasoning-headline-caret ${collapsed ? '' : 'reasoning-headline-caret--open'}`} aria-hidden="true">›</span>
        </button>
      ) : (
        <div className="mb-2.5 flex items-center gap-2 text-[11px] text-[color:var(--chat-muted)]">
          {headline}
        </div>
      )}

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="flow-body"
            className="reasoning-flow-body"
            style={{ overflow: 'hidden' }}
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          >
      {/* The spine — a pannable, zoomable constellation. Drag pans; ctrl+wheel/pinch zooms about
          the cursor (plain wheel scrolls the page, untouched); double-click background fits;
          double-click a node jumps to its detail. Detail is a function of zoom depth (semantic
          zoom). Minimap reveals on hover/zoom and scrubs. Reduced-motion degrades to a static,
          natively scrollable rail. */}
      <div
        className={`reasoning-spine-frame ${view.dragging ? 'reasoning-spine-frame--dragging' : ''} reasoning-tier-${tier}`}
        data-tier={tier}
        data-reduce={reduce ? '1' : '0'}
        ref={view.frameRef}
        tabIndex={reduce ? undefined : 0}
        role="group"
        aria-label="Reasoning timeline. Arrow keys pan, plus and minus zoom, zero fits the view."
        onPointerDown={reduce ? undefined : view.onPointerDown}
        onPointerMove={reduce ? undefined : view.onPointerMove}
        onPointerUp={view.endDrag}
        onPointerCancel={view.endDrag}
        onPointerLeave={view.endDrag}
        onDoubleClick={reduce ? undefined : view.onDoubleClick}
        onKeyDown={reduce ? undefined : view.onKeyDown}
      >
        <div
          className={`reasoning-spine ${view.smooth ? 'reasoning-spine--smooth' : ''}`}
          role="list"
          aria-label="Reasoning steps"
          style={{
            transform: `translateX(${view.vp.panX}px)`,
            width: `${view.contentWidth * view.vp.scale}px`,
          }}
        >
          {/* Base rail + progress fill sit behind the nodes, spanning first→last node center. */}
          <div
            className="reasoning-rail"
            aria-hidden="true"
            style={{ left: `${railStart}px`, width: `${Math.max(railEnd - railStart, 0)}px` }}
          >
            <motion.div
              className="reasoning-rail-fill"
              initial={false}
              animate={{ width: `${Math.max(progress * 100, live ? 8 : progress * 100)}%` }}
              transition={reduce ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>

          {model.phases.map((phase, i) => (
            <div
              key={phase.id}
              className="reasoning-node-slot"
              style={{ transform: `translateX(${nodeX(i, view.vp.scale)}px)` }}
            >
              <FlowNode
                phase={phase}
                index={i}
                selected={phase.id === effectiveSelectedId}
                live={live}
                reduce={!!reduce}
                tier={tier}
                onSelect={(viaKeyboard) => select(phase.id, i, viaKeyboard)}
                onZoomTo={() => { if (!reduce) view.jumpToNode(i); }}
              />
            </div>
          ))}
        </div>

        {/* One quiet fit glyph, only when the view has left its fit state (reveal-on-intent). */}
        {!reduce && !view.atFit && (
          <button type="button" className="reasoning-fit" onClick={view.fit} aria-label="Fit the whole timeline">
            <Maximize2 className="h-3 w-3" />
          </button>
        )}
        {!reduce && (
          <Minimap
            phases={model.phases}
            vp={view.vp}
            contentWidth={view.contentWidth}
            frameWidth={view.frameW}
            onScrub={view.scrubTo}
            onZoom={view.zoomFromMinimap}
          />
        )}

        {/* Announce semantic-zoom tier changes to screen readers without visual noise. */}
        <span className="sr-only" aria-live="polite">
          {tier === 'overview' ? 'Overview: steps as dots' : tier === 'detail' ? 'Detail view' : ''}
        </span>
      </div>

      {/* The story — the same turn as an attributed conversation: Vai working in prose,
          each peer speaking TO Vai, the gate ruling. Streams live; collapses at rest. */}
      <ReasoningStory phases={model.phases} council={council} live={live} />

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
          </motion.div>
        )}
      </AnimatePresence>
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
  onSelect,
  onZoomTo,
}: {
  phase: TimelinePhase;
  index: number;
  selected: boolean;
  live: boolean;
  reduce: boolean;
  tier: ZoomTier;
  onSelect: (viaKeyboard: boolean) => void;
  onZoomTo: () => void;
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
      // e.detail === 0 → keyboard activation (Enter/Space): select AND zoom to the node's detail.
      onClick={(e) => onSelect(e.detail === 0)}
      onDoubleClick={(e) => { e.stopPropagation(); onZoomTo(); }}
      aria-pressed={selected}
      aria-label={phase.title}
      className={`reasoning-node ${selected ? 'reasoning-node--selected' : ''} ${bad ? 'reasoning-node--bad' : ''} ${running && live ? 'reasoning-node--live' : ''}`}
      style={{ ['--node-hue' as string]: hue }}
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : { delay: Math.min(index * 0.04, 0.3), duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      whileHover={reduce ? undefined : { y: -2 }}
    >
      {/* Glyphs and labels render at CONSTANT size — zoom spreads node positions apart instead of
          scaling this chrome, so text stays crisp and nothing can grow past the frame. */}
      <span className="reasoning-node-inner">
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

/**
 * Overview minimap — the whole turn as bare dots with a window marking what's on screen. It IS the
 * navigation instrument: drag/click scrubs the pan, wheel over it zooms. Visible whenever the view
 * shows a sub-range, or on frame hover.
 */
function Minimap({
  phases,
  vp,
  contentWidth,
  frameWidth,
  onScrub,
  onZoom,
}: {
  phases: readonly TimelinePhase[];
  vp: Viewport;
  contentWidth: number;
  frameWidth: number;
  onScrub: (fraction: number) => void;
  onZoom: (deltaY: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const win = visibleWindow(vp, contentWidth, frameWidth);
  const isSubRange = win.end - win.start < 0.999;

  const fractionAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return (clientX - rect.left) / rect.width;
  };

  // Wheel-zoom over the minimap needs preventDefault → native non-passive listener, scoped here.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onZoom(e.deltaY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onZoom]);

  if (!isSubRange) return null;

  return (
    <div className="reasoning-minimap" aria-hidden="true">
      <div
        className="reasoning-minimap-track"
        ref={trackRef}
        onPointerDown={(e) => {
          e.stopPropagation();
          scrubbing.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          onScrub(fractionAt(e.clientX));
        }}
        onPointerMove={(e) => { if (scrubbing.current) onScrub(fractionAt(e.clientX)); }}
        onPointerUp={() => { scrubbing.current = false; }}
        onPointerCancel={() => { scrubbing.current = false; }}
      >
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
