/**
 * DeployProgress — Step-by-step deploy progress with live status updates.
 * Shows during stack deployment, replacing the preview panel content.
 */

import { useMemo } from 'react';
import {
  Check,
  Loader2,
  X,
  SkipForward,
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
    case 'skipped':
      return <SkipForward className="h-3.5 w-3.5 text-zinc-600" />;
    default:
      return <div className="h-3.5 w-3.5 rounded-full border border-zinc-700 bg-zinc-800" />;
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ── Component ── */

export function DeployProgress({ steps, stackName, tierName, startTime }: Props) {
  const _completedSteps = steps.filter((s) => s.status === 'done' || s.status === 'skipped');
  const _activeSteps = steps.filter((s) => s.status !== 'pending' && s.status !== 'skipped');
  const hasFailed = steps.some((s) => s.status === 'failed');
  const allDone = steps.every((s) => s.status === 'done' || s.status === 'skipped');

  const progress = useMemo(() => {
    if (steps.length === 0) return 0;
    const weights: Record<string, number> = {
      scaffold: 5,
      install: 40,
      build: 20,
      docker: 15,
      test: 10,
      start: 5,
      verify: 5,
    };
    let totalWeight = 0;
    let completedWeight = 0;
    for (const step of steps) {
      const w = weights[step.id] ?? 10;
      totalWeight += w;
      if (step.status === 'done' || step.status === 'skipped') completedWeight += w;
      else if (step.status === 'running') completedWeight += w * 0.5;
    }
    return totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
  }, [steps]);

  const elapsed = Date.now() - startTime;

  return (
    <div className="flex h-full flex-col p-5">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-zinc-200">
          {allDone ? '✅ Deployment Complete' : hasFailed ? '⚠️ Deploy Issue' : 'Deploying...'}
        </h3>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          {stackName} — {tierName}
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
        {steps.map((step, i) => {
          const StepIcon = STEP_ICONS[step.id] ?? Package;
          const isActive = step.status === 'running';
          const isDone = step.status === 'done';
          const isFailed = step.status === 'failed';
          const isSkipped = step.status === 'skipped';

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
                        isSkipped
                          ? 'text-zinc-600'
                          : isDone
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
              {i < steps.length - 1 && (
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
            Ready — loading preview...
          </p>
        </div>
      )}
      {hasFailed && (
        <div className="mt-3 rounded-lg border border-red-800/30 bg-red-500/5 p-3 text-center">
          <p className="text-xs font-medium text-red-400">
            Deploy had issues — check logs above
          </p>
        </div>
      )}
    </div>
  );
}
