import { useEffect, useMemo, useRef } from 'react';
import { useChatStore } from '../stores/chatStore.js';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { useLayoutStore } from '../stores/layoutStore.js';
import { useBackgroundTaskStore, type BackgroundTask } from '../stores/backgroundTaskStore.js';

export type ProcessRow = BackgroundTask & { source: 'chat' | 'sandbox' | 'build' | 'manual' };

const BUILD_STEP_LABELS: Record<string, string> = {
  generating: 'Generating app',
  writing: 'Writing project files',
  installing: 'Installing dependencies',
  building: 'Building preview',
  testing: 'Running visual checks',
  fixing: 'Repairing build issues',
};

function mergeTasks(rows: ProcessRow[]): ProcessRow[] {
  const byId = new Map<string, ProcessRow>();
  for (const row of rows) {
    const prev = byId.get(row.id);
    if (!prev || row.status === 'running' || (prev.status !== 'running' && row.startedAt >= prev.startedAt)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (b.status === 'running' && a.status !== 'running') return 1;
    return b.startedAt - a.startedAt;
  });
}

/** Real background work only — sandbox deploy, build pipeline, manual tasks. Not council/chat progress steps. */
export function useBackgroundProcesses(): ProcessRow[] {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const deploySteps = useSandboxStore((s) => s.deploySteps);
  const deployPhase = useSandboxStore((s) => s.deployPhase);
  const deployStartTime = useSandboxStore((s) => s.deployStartTime);
  const sandboxStatus = useSandboxStore((s) => s.status);
  const buildStatus = useLayoutStore((s) => s.buildStatus);
  const manualTasks = useBackgroundTaskStore((s) => s.tasks);
  const startedAtRef = useRef<Map<string, number>>(new Map());

  const stamp = (id: string, fallback?: number) => {
    const map = startedAtRef.current;
    if (!map.has(id)) map.set(id, fallback ?? Date.now());
    return map.get(id)!;
  };

  useEffect(() => {
    const hasWork = isStreaming
      || deployPhase === 'deploying'
      || sandboxStatus === 'creating'
      || sandboxStatus === 'writing'
      || sandboxStatus === 'installing'
      || sandboxStatus === 'building'
      || (buildStatus.step !== 'idle' && buildStatus.step !== 'ready');
    if (!hasWork && manualTasks.every((task) => task.status !== 'running')) {
      startedAtRef.current.clear();
    }
  }, [isStreaming, deployPhase, sandboxStatus, buildStatus.step, manualTasks]);

  const chatRows = useMemo(() => [], []);

  const sandboxRows = useMemo(() => {
    const sandboxBusy = deployPhase === 'deploying'
      || sandboxStatus === 'creating'
      || sandboxStatus === 'writing'
      || sandboxStatus === 'installing'
      || sandboxStatus === 'building';
    if (!sandboxBusy) return [];

    if (deployPhase === 'deploying' && deploySteps.length > 0) {
      return deploySteps
        .filter((step) => step.status === 'running' || step.status === 'pending')
        .map((step) => ({
          id: `deploy:${step.id}`,
          label: step.label,
          startedAt: deployStartTime || stamp(`deploy:${step.id}`),
          status: 'running' as const,
          source: 'sandbox' as const,
        }));
    }

    const labelByStatus: Record<string, string> = {
      creating: 'Creating sandbox project',
      writing: 'Writing project files',
      installing: 'Installing dependencies',
      building: 'Building preview',
    };
    const label = labelByStatus[sandboxStatus] ?? 'Updating sandbox';
    return [{
      id: `sandbox:${sandboxStatus}`,
      label,
      startedAt: stamp(`sandbox:${sandboxStatus}`),
      status: 'running' as const,
      source: 'sandbox' as const,
    }];
  }, [deployPhase, deploySteps, deployStartTime, sandboxStatus]);

  const buildRows = useMemo(() => {
    const step = buildStatus.step;
    if (!step || step === 'idle' || step === 'ready') return [];
    const id = `build:${step}`;
    return [{
      id,
      label: buildStatus.message || BUILD_STEP_LABELS[step] || 'Building',
      startedAt: stamp(id),
      status: step === 'failed' ? 'failed' as const : 'running' as const,
      source: 'build' as const,
    }];
  }, [buildStatus]);

  const manualRows = useMemo(
    () => manualTasks.map((task) => ({ ...task, source: 'manual' as const })),
    [manualTasks],
  );

  return mergeTasks([...manualRows, ...sandboxRows, ...buildRows, ...chatRows]);
}

/** Listen for `vai:background-task` custom events (scripts, automation). */
export function useBackgroundTaskEvents() {
  const startTask = useBackgroundTaskStore((s) => s.startTask);
  const finishTask = useBackgroundTaskStore((s) => s.finishTask);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        op: 'start' | 'end';
        id: string;
        label?: string;
        status?: 'done' | 'failed';
      }>).detail;
      if (!detail?.id) return;
      if (detail.op === 'start') startTask(detail.id, detail.label ?? detail.id);
      else finishTask(detail.id, detail.status ?? 'done');
    };
    window.addEventListener('vai:background-task', handler);
    return () => window.removeEventListener('vai:background-task', handler);
  }, [finishTask, startTask]);
}
