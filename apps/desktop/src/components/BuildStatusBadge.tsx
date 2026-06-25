import { useLayoutStore } from '../stores/layoutStore.js';

type Status = 'idle' | 'generating' | 'writing' | 'installing' | 'building' | 'testing' | 'fixing' | 'ready' | 'failed';

const STEP_COLORS: Record<Status, string> = {
  idle: 'bg-zinc-700',
  generating: 'bg-yellow-500 animate-pulse',
  writing: 'bg-yellow-500 animate-pulse',
  installing: 'bg-yellow-500 animate-pulse',
  building: 'bg-blue-500 animate-pulse',
  testing: 'bg-blue-500 animate-pulse',
  fixing: 'bg-orange-500 animate-pulse',
  ready: 'bg-emerald-500',
  failed: 'bg-red-500',
};

const STEP_LABELS: Record<Status, string> = {
  idle: 'Idle',
  generating: 'Generating...',
  writing: 'Writing files...',
  installing: 'Installing deps...',
  building: 'Building...',
  testing: 'Testing...',
  fixing: 'Fixing...',
  ready: 'Ready',
  failed: 'Build failed',
};

/** Compact one-liner shown in the sidebar header area */
export function BuildStatusBadge() {
  const { buildStatus, mode } = useLayoutStore();
  const isBuildMode = mode === 'builder' || mode === 'agent';
  if (!isBuildMode && buildStatus.step === 'idle') return null;

  const isActive = buildStatus.step !== 'idle' && buildStatus.step !== 'ready';
  const isFailed = buildStatus.step === 'failed';
  const isReady = buildStatus.step === 'ready';

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors ${
        isFailed
          ? 'bg-red-500/10 ring-1 ring-red-500/20'
          : isReady
            ? 'bg-emerald-500/10'
            : isActive
              ? 'bg-zinc-800/60'
              : ''
      }`}
      title={buildStatus.message ?? STEP_LABELS[buildStatus.step]}
    >
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${STEP_COLORS[buildStatus.step]}`} />
      <span className={`max-w-[120px] truncate text-[10px] ${
        isFailed ? 'text-red-400' : isReady ? 'text-emerald-400' : 'text-zinc-500'
      }`}>
        {STEP_LABELS[buildStatus.step]}
      </span>
      {/* Show short message excerpt for failed/fixing states */}
      {(isFailed || buildStatus.step === 'fixing') && buildStatus.message && (
        <span className="max-w-[140px] truncate text-[9px] text-zinc-600" title={buildStatus.message}>
          — {buildStatus.message}
        </span>
      )}
    </div>
  );
}
