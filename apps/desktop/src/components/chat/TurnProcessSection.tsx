import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
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
}

/**
 * Single process surface for a turn — live tree morphs into settled summary in place.
 */
export function TurnProcessSection({
  isStreaming,
  steps,
  council,
  imageSteps,
  vaiProposedDraft,
  durationMs,
}: TurnProcessSectionProps) {
  const revealedCount = useProcessStepReveal(steps, isStreaming);
  // The drip can still be draining for a beat AFTER the stream ends (fast turns).
  // Treat that drain window as "live" so steps reveal sequentially and each gets its
  // human dwell, instead of snapping to the full settled tree the instant streaming
  // stops. Once every step is shown, this is false and the tree settles normally.
  const draining = !isStreaming && revealedCount < steps.length;
  const live = isStreaming || draining;
  const visibleSteps = useMemo(
    () => (live ? steps.slice(0, revealedCount) : steps),
    [live, steps, revealedCount],
  );
  const pendingStepCount = live ? Math.max(0, steps.length - revealedCount) : 0;
  const timelineView = useTimelineView();
  // ReasoningFlow settles like the ProcessTree: a live turn shows the full flow; once it settles
  // it collapses to the one-line headline, and the user re-opens it on intent. Their manual choice
  // sticks for the life of the message (no surprise re-collapse on re-render).
  const [flowCollapsed, setFlowCollapsed] = useState(!live);
  const wasLiveRef = useRef(live);
  useEffect(() => {
    if (wasLiveRef.current === live) return;
    wasLiveRef.current = live;
    setFlowCollapsed(!live);
  }, [live]);

  if (!isStreaming && steps.length === 0) return null;

  // Reasoning flow (behind the timeline flag) renders the same flat steps as a spatial
  // constellation — phases, rounds, gates, and the self-improvement ledger. Falls back to the
  // classic ProcessTree when the flag is off — fully additive, nothing else changes.
  if (timelineView) {
    return (
      <ReasoningFlow
        live={live}
        steps={visibleSteps}
        council={council}
        durationMs={durationMs}
        collapsed={!live && flowCollapsed}
        onToggleCollapsed={live ? undefined : (next) => setFlowCollapsed(next)}
      />
    );
  }

  return (
    <ProcessTree
      live={live}
      steps={visibleSteps}
      council={council}
      imageSteps={imageSt