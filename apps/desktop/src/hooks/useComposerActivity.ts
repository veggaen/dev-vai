import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatProgressStep } from '../stores/chatStore.js';
import {
  compactStepLabel,
  deriveActiveSubActivity,
} from '../components/chat/ProcessTree.logic.js';
import { useProcessStepReveal } from './useProcessStepReveal.js';

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms / 100) * 100)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function useElapsed(active: boolean) {
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    startRef.current = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - startRef.current), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return elapsed;
}

/** Elapsed since the active step started (resets when stage changes). */
function useActiveStepElapsed(steps: readonly ChatProgressStep[], isStreaming: boolean) {
  const activeStage = useMemo(() => {
    const running = [...steps].reverse().find((s) => s.status === 'running');
    return running?.stage ?? steps[steps.length - 1]?.stage ?? '';
  }, [steps]);

  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isStreaming || !activeStage) {
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - startRef.current), 250);
    return () => window.clearInterval(id);
  }, [activeStage, isStreaming]);

  return elapsed;
}

export interface ComposerQueueItem {
  id: string;
  shortLabel: string;
  status: 'running' | 'done';
}

/** Headline + compact queue for the composer strip — never duplicates the in-message ProcessTree. */
export function useComposerActivity(steps: readonly ChatProgressStep[], isStreaming = false) {
  const revealedCount = useProcessStepReveal(steps, isStreaming);
  const visibleSteps = useMemo(
    () => steps.slice(0, revealedCount),
    [steps, revealedCount],
  );
  const turnElapsed = useElapsed(steps.length > 0);
  const stepElapsed = useActiveStepElapsed(steps, isStreaming);

  // Headline always reflects REAL backend state, not stagger lag.
  const activeStep = useMemo(() => {
    const running = [...steps].reverse().find((s) => s.status === 'running');
    return running ?? steps[steps.length - 1];
  }, [steps]);

  const headline = activeStep?.label ?? (steps.length === 0 ? 'Connecting…' : 'Starting…');
  const subActivity = deriveActiveSubActivity(activeStep);
  const activeStage = activeStep?.stage ?? 'reason';

  const queue: ComposerQueueItem[] = visibleSteps.map((step, index) => ({
    id: `${step.stage}-${index}`,
    shortLabel: compactStepLabel(step),
    status: step.status === 'running' ? 'running' : 'done',
  }));

  const stepProgress = steps.length > 0
    ? `${Math.min(revealedCount, steps.length)}/${steps.length}`
    : '';

  return {
    headline,
    subActivity,
    queue,
    activeStage,
    stepProgress,
    elapsed: formatElapsed(turnElapsed),
    stepElapsed: formatElapsed(stepElapsed),
    isIdle: steps.length === 0,
  };
}
