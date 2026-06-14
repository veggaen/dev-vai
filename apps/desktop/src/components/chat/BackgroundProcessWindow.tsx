import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Terminal, X, Trash2 } from 'lucide-react';
import { formatDuration } from '../../lib/formatDuration.js';
import { useBackgroundTaskStore } from '../../stores/backgroundTaskStore.js';
import type { ProcessRow } from '../../hooks/useBackgroundProcesses.js';

interface BackgroundProcessWindowProps {
  processes: ProcessRow[];
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  studioChrome?: boolean;
}

function useNowTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function BackgroundProcessWindow({
  processes,
  expanded,
  onExpandedChange,
  studioChrome = false,
}: BackgroundProcessWindowProps) {
  const dismissTask = useBackgroundTaskStore((s) => s.dismissTask);
  const dismissAll = useBackgroundTaskStore((s) => s.dismissAll);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const autoExpandedForRef = useRef<string | null>(null);

  const running = processes.filter((p) => p.status === 'running');
  const settled = processes.filter((p) => p.status !== 'running');
  const visible = useMemo(
    () => [...running, ...settled.slice(0, Math.max(0, 6 - running.length))],
    [running, settled],
  );

  const now = useNowTick(running.length > 0 || expanded);
  const runningSignature = running.map((row) => row.id).join('|');

  useEffect(() => {
    if (running.length === 0) return;
    if (autoExpandedForRef.current === runningSignature) return;
    autoExpandedForRef.current = runningSignature;
    setHidden(false);
    onExpandedChange(true);
  }, [running.length, runningSignature, onExpandedChange]);

  if (hidden || visible.length === 0) return null;

  const shell = studioChrome
    ? 'border-zinc-200 bg-white/95 text-zinc-800 shadow-sm'
    : 'border-zinc-700/60 bg-zinc-900/95 text-zinc-200 shadow-lg shadow-black/20';

  const headerLabel = running.length === 1
    ? '1 background process'
    : `${running.length} background processes`;

  const handleDismissRow = (row: ProcessRow) => {
    if (row.source === 'manual') dismissTask(row.id);
  };

  const handleClose = () => {
    if (running.length === 0) {
      setHidden(true);
      dismissAll();
      autoExpandedForRef.current = null;
    }
    onExpandedChange(false);
  };

  return (
    <div className="mb-2" data-testid="background-process-window">
      {!expanded ? (
        <button
          type="button"
          onClick={() => onExpandedChange(true)}
          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-[12px] transition-colors ${shell} hover:border-violet-500/30`}
        >
          <span className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 opacity-70" aria-hidden />
            <span>{running.length > 0 ? headerLabel : `${visible.length} recent processes`}</span>
          </span>
          <span className="text-[11px] tabular-nums text-zinc-500">Show</span>
        </button>
      ) : (
        <AnimatePresence initial={false}>
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16 }}
            className={`overflow-hidden rounded-xl border ${shell}`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-inherit px-3 py-2 text-[12px]">
              <span className="font-medium">
                {running.length > 0
                  ? `${running.length} process${running.length === 1 ? '' : 'es'} running`
                  : 'Recent processes'}
              </span>
              <button
                type="button"
                onClick={handleClose}
                className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800/40 hover:text-zinc-300"
                aria-label="Close process window"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <ul className="max-h-52 overflow-y-auto py-1">
              {visible.map((row) => {
                const elapsed = formatDuration(now - row.startedAt);
                const isRunning = row.status === 'running';
                const faded = !isRunning;
                const showTrash = hoverId === row.id && row.source === 'manual';

                return (
                  <li
                    key={row.id}
                    onMouseEnter={() => setHoverId(row.id)}
                    onMouseLeave={() => setHoverId((id) => (id === row.id ? null : id))}
                    className={`group flex items-center gap-2 px-3 py-1.5 text-[12px] transition-opacity ${faded ? 'opacity-45' : ''}`}
                  >
                    <Terminal className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-[11px] text-zinc-500">{elapsed}</span>
                    {showTrash && (
                      <button
                        type="button"
                        onClick={() => handleDismissRow(row)}
                        className="rounded p-0.5 text-zinc-500 hover:text-red-400"
                        aria-label={`Dismiss ${row.label}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
