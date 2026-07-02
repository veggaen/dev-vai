import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import { useChatStore } from '../../stores/chatStore.js';
import { useProcessStepReveal } from '../../hooks/useProcessStepReveal.js';
import { ProcessTree } from './ProcessTree.js';
import { ReasoningFlow } from './ReasoningFlow.js';
import { isTimelineViewEnabled } from '../../lib/timeline-flag.js';

export interface TurnProcessSectionProps {
  readonly isStreaming: boolean;
  readonly steps: readonly ChatProgressStep[];
  readonly council?: CouncilThinkingUI | null;
  readonly imageSteps?: readonly { phase: string; label: string; attempt?: number; matchScore?: number; flaws?: string[] }[];
  readonly vaiProposedDraft?: string;
  readonly durationMs?: number;
  /** Keys per-turn expansion state in the chat store so it survives list remounts. */
  readonly messageId?: string;
}

/** Dwell before a just-finished turn collapses to its one-line rest (long enough to read the
 * final state, short enough that the surface never lingers as a block). */
const SETTLE_DWELL_MS = 1200;

/**
 * Settle detection: an explicit live → false TRANSITION starts the dwell timer; live flipping back
 * (multi-round follow-ups) cancels it. A turn that was never live in this mount (history load)
 * settles immediately — no dwell theater for old messages. Aborted/errored streams drive live
 * false and settle through the same path.
 */
function useSettled(live: boolean): boolean {
  const [settled, setSettled] = useState(!live);
  const wasLive = useRef(live);
  useEffect(() => {
    if (live) {
      wasLive.current = true;
      setSettled(false);
      return;
    }
    if (!wasLive.current) {
      setSettled(true);
      return;
    }
    const t = setTimeout(() => setSettled(true), SETTLE_DWELL_MS);
    return () => clearTimeout(t);
  }, [live]);
  return settled;
}

/**
 * Single process surface for a turn — the live flow settles into a one-line rest in place.
 */
export function TurnProcessSection({
  isStreaming,
  steps,
  council,
  imageSteps,
  vaiProposedDraft,
  durationMs,
  messageId,
}: TurnProcessSectionProps) {
  const revealedCount = useProcessStepReveal(steps, isStreaming);
  // The drip can still be draining for a beat AFTER the stream ends (fast turns).
  // Treat that drain window as "live" so steps reveal sequentially and each gets its
  // human dwell, instead of snapping to the full settled tree the instant streaming
  // stops. Once every step is shown, this is false and the tree settles normally.
  // The drain only applies to turns that actually streamed IN THIS MOUNT — a history
  // message mounting already-finished must rest immediately, not replay its reveal.
  const everStreamed = useRef(isStreaming);
  if (isStreaming) everStreamed.current = true;
  const draining = !isStreaming && everStreamed.current && revealedCount < steps.length;
  const live = isStreaming || draining;
  const visibleSteps = useMemo(
    () => (live ? steps.slice(0, revealedCount) : steps),
    [live, steps, revealedCount],
  );
  const pendingStepCount = live ? Math.max(0, steps.length - revealedCount) : 0;
  const timelineView = useTimelineView();
  const settled = useSettled(live);

  // Per-turn expansion lives in the store (survives virtualization remounts); a local fallback
  // keeps the component self-contained when no messageId is provided.
  const storeExpanded = useChatStore((s) => (messageId ? !!s.expandedProcess[messageId] : false));
  const setProcessExpanded = useChatStore((s) => s.setProcessExpanded);
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = messageId ? storeExpanded : localExpanded;

  if (!isStreaming && steps.length === 0) return null;

  // Spatial ReasoningFlow (behind the timeline flag) renders the same flat steps as a node
  // constellation of phases/rounds/gates. Falls back to the classic ProcessTree when the flag is
  // off — fully additive, nothing else changes.
  if (timelineView) {
    return (
      <ReasoningFlow
        live={live}
        steps={visibleSteps}
        council={council}
        durationMs={durationMs}
        collapsed={settled && !expanded}
        onToggleCollapsed={
          settled
            ? (nextCollapsed) =>
                messageId
                  ? setProcessExpanded(messageId, !nextCollapsed)
                  : setLocalExpanded(!nextCollapsed)
            : undefined
        }
      />
    );
  }

  return (
    <ProcessTree
      live={live}
      steps={visibleSteps}
      council={council}
      imageSteps={imageSteps}
      vaiProposedDraft={vaiProposedDraft}
      durationMs={durationMs}
      pendingStepCount={pendingStepCount}
    />
  );
}

/** Subscribe to the Timeline-view flag (same-tab + cross-tab changes). */
function useTimelineView(): boolean {
  const [enabled, setEnabled] = useState(isTimelineViewEnabled);
  useEffect(() => {
    const update = () => setEnabled(isTimelineViewEnabled());
    window.addEventListener('vai-timeline-view-change', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('vai-timeline-view-change', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return enabled;
}

export default TurnProcessSection;
