import { useLayoutStore } from '../stores/layoutStore.js';
import { Terminal } from 'lucide-react';

/**
 * Debug Console — streams build output and test results.
 * Uses a simple pre-formatted text view for now.
 * Will upgrade to @xterm/xterm when build routes are wired.
 */
export function DebugConsole() {
  const { buildStatus } = useLayoutStore();

  return (
    <div className="flex h-full flex-col border-t border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-xs font-medium text-zinc-400">Console</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            buildStatus.step === 'ready' ? 'bg-emerald-500/20 text-emerald-400' :
            buildStatus.step === 'failed' ? 'bg-red-500/20 text-red-400' :
            buildStatus.step === 'idle' ? 'bg-zinc-800 text-zinc-500' :
            'bg-yellow-500/20 text-yellow-400'
          }`}>
            {buildStatus.step}
          </span>
        </div>
      </div>

      {/* Output area */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
        {buildStatus.step === 'idle' ? (
          <p className="text-zinc-600">Waiting for build...</p>
        ) : (
          <div className="space-y-1">
            {buildStatus.message && (
              <p className={`${
                buildStatus.step === 'failed' ? 'text-red-400' :
                buildStatus.step === 'ready' ? 'text-emerald-400' :
                'text-zinc-400'
              }`}>
                {buildStatus.message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
