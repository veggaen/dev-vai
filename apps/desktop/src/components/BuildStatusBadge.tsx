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
  failed: 'Failed',
};

export function BuildStatusBadge() {
  const { buildStatus, mode } = useLayoutStore();
  if (mode !== 'builder' && buildStatus.step === 'idle') return null;

  return (
    <div className="flex items-center gap-1.5" title={buildStatus.message ?? STEP_LABELS[buildStatus.step]}>
      <span className={`h-1.5 w-1.5 rounded-full ${STEP_COLORS[buildStatus.step]}`} />
      <span className="max-w-[100px] truncate text-[10px] text-zinc-500">
        {STEP_LABELS[buildStatus.step]}
      </span>
    </div>
  );
}
