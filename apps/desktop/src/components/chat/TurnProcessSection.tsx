import { useEffect, useMemo, useState } from 'react';
import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import { useProcessStepReveal } from '../../hooks/useProcessStepReveal.js';
import { ProcessTree } from './ProcessTree.js';
import { Timeline } from './Timeline.js';
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
  const visibleSteps = useMemo(
    () => (isStreaming ? steps.slice(0, revealedCount) : steps),
    [isStreaming, steps, revealedCount],
  );
  const pendingStepCount = isStreaming ? Math.max(0, steps.length - revealedCount) : 0;
  const timelineView = useTimelineView();

  if (!isStreaming && steps.length === 0) return null;

  // Loop-aware Timeline (behind a flag) renders the same flat steps as phases/rounds/gates. Falls
  // back to the classic ProcessTree when the flag is off — fully additive, nothing else changes.
  if (timelineView) {
    return (
      <Timeline
        live={isStreaming}
        steps={visibleSteps}
        council={council}
        durationMs={durationMs}
      />
    );
  }

  return (
    <ProcessTree
      live={isStreaming}
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
