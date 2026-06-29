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
const STEP_DRIP_MS = 850;

/**
 * Whether the reveal should keep dripping after the stream ends.
 *
 * The flash this prevents: a fast/cached/deterministic turn finishes before the
 * drip has shown every step. The old hook snapped to `steps.length` the instant
 * `isStreaming` went false, dumping all remaining rows at once. When rows are
 * still hidden we instead "drain" them at the drip pace so the user watches the
 * process finish unfolding. Pure → unit-testable. `0` runway = legacy snap.
 */
export function shouldDrainAfterStream(params: {
  revealed: number;
  total: number;
  runwayMs: number;
}): boolean {
  return params.runwayMs > 0 && params.revealed < params.total;
}

/**
 * Top-level step reveal — strictly one new row per `paceMs`, even when the backend
 * bursts several progress events in the same tick. After the stream ends, any rows
 * not yet shown keep draining at the same pace (while `settleRunwayMs > 0`) so a
 * turn that finished in a blink still reveals its steps sequentially, never flashed.
 */
export function useProcessStepReveal(
  steps: readonly ChatProgressStep[],
  isStreaming: boolean,
  paceMs = STEP_DRIP_MS,
  settleRunwayMs = 1600,
): number {
  const floor = useMemo(() => computeProcessRevealFloor(steps), [steps]);
  const floorRef = useRef(floor);
  floorRef.current = floor;
  const streamStartedAtRef = useRef(0);
  const [revealed, setRevealed] = useState(0);
  // True for a short window after streaming ends while rows are still draining.
  const [draining, setDraining] = useState(false);

  useEffect(() => {
    if (isStreaming) {
      if (steps.length === 0) {
        setRevealed(0);
        streamStartedAtRef.current = 0;
      } else if (streamStartedAtRef.current === 0) {
        streamStartedAtRef.current = Date.now();
        setRevealed(1);
      }
      setDraining(false);
      return;
    }
    // Stream ended. If everything is already shown, snapping is a no-op; otherwise
    // enter a drain phase so the remaining rows appear one-by-one, then settle.
    setRevealed((current) => {
      if (shouldDrainAfterStream({ revealed: current, total: steps.length, runwayMs: settleRunwayMs })) {
        if (streamStartedAtRef.current === 0) streamStartedAtRef.current = Date.now();
        setDraining(true);
        return Math.max(current, 1);
      }
      streamStartedAtRef.current = 0;
      setDraining(false);
      return steps.length;
    });
  }, [isStreaming, steps.length, settleRunwayMs]);

  useEffect(() => {
    if (!isStreaming && !draining) return;
    const id = window.setInterval(() => {
      const elapsed = Date.now() - streamStartedAtRef.current;
      const timeCap = streamStartedAtRef.current
        ? Math.min(floorRef.current, 1 + Math.floor(elapsed / paceMs))
        : 0;
      setRevealed((current) => {
        const target = Math.min(floorRef.current, timeCap);
        if (current >= target) {
          if (!isStreaming && current >= floorRef.current) setDraining(false);
          return current;
        }
        return current + 1;
      });
    }, Math.min(paceMs, 120));
    return () => window.clearInterval(id);
  }, [isStreaming, draining, paceMs]);

  if (steps.length === 0) return 0;
  if (!isStreaming && !draining) return steps.length;
  return Math.min(steps.length, Math.max(revealed, 1));
}

/** Nested rows drip only under an open council step while live. */
export function useProcessChildReveal(
  childCount: number,
  active: boolean,
  paceMs = 700,
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
