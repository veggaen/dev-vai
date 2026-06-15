import { useMemo } from 'react';
import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import { useProcessStepReveal } from '../../hooks/useProcessStepReveal.js';
import { ProcessTree } from './ProcessTree.js';

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

  if (!isStreaming && steps.length === 0) return null;

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

export default TurnProcessSection;
