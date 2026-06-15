import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatProgressStep } from '../stores/chatStore.js';

/** Minimum steps that must be visible: all done + the active one. */
export function computeProcessRevealFloor(steps: readonly ChatProgressStep[]): number {
  const total = steps.length;
  if (total === 0) return 0;
  const doneCount = steps.filter((step) => step.status === 'done').length;
  const hasRunningTail = steps[total - 1]?.status === 'running';
  return Math.min(total, Math.max(1, doneCount + (hasRunningTail ? 1 : 0)));
}

/** Ms between each top-level row appearing — must feel sequential, not a batch. */
const STEP_DRIP_MS = 480;

/**
 * Top-level step reveal while streaming — strictly one new row per STEP_DRIP_MS,
 * even when the backend bursts several progress events in the same tick.
 */
export function useProcessStepReveal(
  steps: readonly ChatProgressStep[],
  isStreaming: boolean,
  paceMs = STEP_DRIP_MS,
): number {
  const floor = useMemo(() => computeProcessRevealFloor(steps), [steps]);
  const floorRef = useRef(floor);
  floorRef.current = floor;
  const streamStartedAtRef = useRef(0);
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (!isStreaming) {
      setRevealed(steps.length);
      streamStartedAtRef.current = 0;
      return;
    }
    if (steps.length === 0) {
      setRevealed(0);
      streamStartedAtRef.current = 0;
    } else if (streamStartedAtRef.current === 0) {
      streamStartedAtRef.current = Date.now();
      setRevealed(1);
    }
  }, [isStreaming, steps.length]);

  useEffect(() => {
    if (!isStreaming) return;
    const id = window.setInterval(() => {
      const elapsed = Date.now() - streamStartedAtRef.current;
      const timeCap = streamStartedAtRef.current
        ? Math.min(floorRef.current, 1 + Math.floor(elapsed / paceMs))
        : 0;
      setRevealed((current) => {
        const target = Math.min(floorRef.current, timeCap);
        if (current >= target) return current;
        return current + 1;
      });
    }, Math.min(paceMs, 120));
    return () => window.clearInterval(id);
  }, [isStreaming, paceMs]);

  if (!isStreaming) return steps.length;
  if (steps.length === 0) return 0;
  return Math.min(steps.length, Math.max(revealed, 1));
}

/** Nested rows drip only under an open council step while live. */
export function useProcessChildReveal(
  childCount: number,
  active: boolean,
  paceMs = 320,
): number {
  const [revealed, setRevealed] = useState(0);
  const activeSinceRef = useRef(0);

  useEffect(() => {
    if (!active) {
      setRevealed(childCount);
      activeSinceRef.current = 0;
      return;
    }
    if (childCount === 0) {
      setRevealed(0);
      activeSinceRef.current = 0;
    } else if (activeSinceRef.current === 0) {
      activeSinceRef.current = Date.now();
      setRevealed(0);
    }
  }, [active, childCount]);

  useEffect(() => {
    if (!active || childCount === 0) return;
    const id = window.setInterval(() => {
      const elapsed = Date.now() - activeSinceRef.current;
      const timeCap = 1 + Math.floor(elapsed / paceMs);
      setRevealed((current) => {
        const target = Math.min(childCount, timeCap);
        if (current >= target) return current;
        return current + 1;
      });
    }, Math.min(paceMs, 100));
    return () => window.clearInterval(id);
  }, [active, childCount, paceMs]);

  if (!active) return childCount;
  return Math.min(childCount, revealed);
}

/** Fingerprint sub-activity on the active step so nested rows update live. */
export function activeStepSubFingerprint(steps: readonly ChatProgressStep[]): string {
  const running = [...steps].reverse().find((s) => s.status === 'running');
  const target = running ?? steps[steps.length - 1];
  if (!target) return '';
  const parts = [
    target.stage,
    target.label,
    target.detail ?? '',
    String(target.processLog?.length ?? 0),
    String(target.councilMembers?.length ?? 0),
    String(target.toolRuns?.length ?? 0),
  ];
  for (const member of target.councilMembers ?? []) {
    parts.push(member.name, member.verdict, String(member.confidence));
  }
  for (const tool of target.toolRuns ?? []) {
    parts.push(tool.id, tool.status, tool.name);
  }
  return parts.join('|');
}
