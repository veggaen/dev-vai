/**
 * DeployProgress — Step-by-step deploy progress with live status updates.
 * Shows during stack deployment, replacing the preview panel content.
 */

import { useMemo } from 'react';
import {
  Check,
  Loader2,
  X,
  FolderPlus,
  Package,
  Hammer,
  Container,
  TestTubeDiagonal,
  Play,
  HeartPulse,
} from 'lucide-react';

/* ── Types ── */

export interface DeployStepStatus {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  message?: string;
  elapsed?: number;
}

interface Props {
  steps: DeployStepStatus[];
  stackName: string;
  tierName: string;
  startTime: number;
  onCancel?: () => void;
  onRetry?: () => void;
}

/* ── Constants ── */

const STEP_ICONS: Record<string, typeof Package> = {
  scaffold: FolderPlus,
  install: Package,
  build: Hammer,
  docker: Container,
  test: TestTubeDiagonal,
  start: Play,
  verify: HeartPulse,
};

function StatusIcon({ status }: { status: DeployStepStatus['status'] }) {
  switch (status) {
    case 'done':
      return <Check className="h-3.5 w-3.5 text-emerald-400" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />;
    case 'failed':
      return <X className="h-3.5 w-3.5 text-red-400" />;
    default:
      return <div className="h-3.5 w-3.5 rounded-full border border-zinc-700 bg-zinc-800" />;
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ── Component ── */

export function DeployProgress({ steps, stackName, tierName: _tierName, startTime, onCancel, onRetry }: Props) {
  const visibleSteps = steps.filter((step) => step.status !== 'skipped');

  const hasFailed = visibleSteps.some((s) => s.status === 'failed');
  const allDone = visibleSteps.length > 0 && visibleSteps.every((s) => s.status === 'done');
  const isStarterFlow = visibleSteps.every((step) => ['scaffold', 'install', 'start', 'verify'].includes(step.id));

  const progress = useMemo(() => {
    if (visibleSteps.length === 0) return 0;
    const baseWeights: Record<string, number> = {
      scaffold: 10,
      install: 40,
      build: 20,
      docker: 15,
      test: 10,
      start: 10,
      verify: 5,
    };
    // Calculate total weight of visible steps, then normalize
    let rawTotal = 0;
    for (const step of visibleSteps) rawTotal += baseWeights[step.id] ?? 10;

    let completedFraction = 0;
    for (const step of visibleSteps) {
      const w = (baseWeights[step.id] ?? 10) / rawTotal; // normalized 0-1
      if (step.status === 'done' || step.status === 'skipped') completedFraction += w;
      else if (step.status === 'running') completedFraction += w * 0.5;
    }
    return Math.min(100, Math.round(completedFraction * 100));
  }, [visibleSteps]);

  const elapsed = Date.now() - startTime;

  return (
    <div className="flex h-full flex-col p-5">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-zinc-200">
          {allDone ? 'Preview ready' : hasFailed ? 'Deploy issue' : isStarterFlow ? 'Creating your app' : 'Deploying'}
        </h3>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          {stackName}
        </p>
      </div>

      {/* Progress bar */}
      <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
        <span>{progress}%</span>
        <span>{formatMs(elapsed)}</span>
      </div>
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            hasFailed
              ? 'bg-red-500'
              : allDone
                ? 'bg-emerald-500'
                : 'bg-blue-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps list */}
      <div className="flex-1 space-y-1 overflow-y-auto">
        {visibleSteps.map((step, i) => {
          const StepIcon = STEP_ICONS[step.id] ?? Package;
          const isActive = step.status === 'running';
          const isDone = step.status === 'done';
          const isFailed = step.status === 'failed';
          return (
            <div key={step.id}>
              <div
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                  isActive
                    ? 'bg-blue-500/5 ring-1 ring-blue-500/20'
                    : isFailed
                      ? 'bg-red-500/5'
                      : ''
                }`}
              >
                {/* Step icon */}
                <StepIcon
                  className={`h-3.5 w-3.5 ${
                    isDone
                      ? 'text-emerald-500'
                      : isActive
                        ? 'text-blue-400'
                        : isFailed
                          ? 'text-red-400'
                          : 'text-zinc-700'
                  }`}
                />

                {/* Label + message */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-medium ${
                        isDone
                            ? 'text-zinc-400'
                            : isActive
                              ? 'text-zinc-200'
                              : isFailed
                                ? 'text-red-300'
                                : 'text-zinc-600'
                      }`}
                    >
                      {step.label}
                    </span>
                    {step.elapsed != null && (isDone || isFailed) && (
                      <span className="text-[9px] text-zinc-600">{formatMs(step.elapsed)}</span>
                    )}
                  </div>
                  {step.message && (step.status !== 'pending') && (
                    <p className={`mt-0.5 truncate text-[10px] ${
                      isFailed ? 'text-red-400/70' : 'text-zinc-600'
                    }`}>
                      {step.message}
                    </p>
                  )}
                </div>

                {/* Status indicator */}
                <StatusIcon status={step.status} />
              </div>

              {/* Connector line */}
              {i < visibleSteps.length - 1 && (
                <div className="ml-[15px] h-1 border-l border-zinc-800" />
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom status */}
      {allDone && (
        <div className="mt-3 rounded-lg border border-emerald-800/30 bg-emerald-500/5 p-3 text-center">
          <p className="text-xs font-medium text-emerald-400">
            App is live. Loading preview.
          </p>
        </div>
      )}
      {hasFailed && (
        <div className="mt-3 rounded-lg border border-red-800/30 bg-red-500/5 p-3">
          <p className="mb-2 text-center text-xs font-medium text-red-400">
            Deployment hit a problem. Check the step details above.
          </p>
          <div className="flex items-center justify-center gap-2">
            {onRetry && (
              <button onClick={onRetry}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800">
                Retry
              </button>
            )}
            {onCancel && (
              <button onClick={onCancel}
                className="rounded-lg border border-red-800/40 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Cancel button — always available during deploy */}
      {!allDone && !hasFailed && onCancel && (
        <div className="mt-3 flex justify-center">
          <button onClick={onCancel}
            className="rounded-lg border border-zinc-700 px-4 py-1.5 text-xs text-zinc-400 transition-colors hover:border-red-800/40 hover:bg-red-500/10 hover:text-red-400">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
