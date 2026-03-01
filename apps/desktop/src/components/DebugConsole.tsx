import { useSandboxStore } from '../stores/sandboxStore.js';
import { Terminal, Trash2, FolderTree } from 'lucide-react';
import { useEffect, useRef } from 'react';

/**
 * Debug Console — shows sandbox build output, install logs, and dev server output.
 */
export function DebugConsole() {
  const { status, logs, files, projectName, fetchLogs, destroyProject } = useSandboxStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-poll logs when not idle
  useEffect(() => {
    if (status === 'idle') return;
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [status, fetchLogs]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex h-full flex-col border-t border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-xs font-medium text-zinc-400">Console</span>
          {projectName && (
            <span className="text-[10px] text-zinc-600">— {projectName}</span>
          )}
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            status === 'running' ? 'bg-emerald-500/20 text-emerald-400' :
            status === 'failed' ? 'bg-red-500/20 text-red-400' :
            status === 'idle' ? 'bg-zinc-800 text-zinc-500' :
            'bg-yellow-500/20 text-yellow-400'
          }`}>
            {status}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {files.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-600" title={files.join('\n')}>
              <FolderTree className="h-3 w-3" />
              {files.length} files
            </span>
          )}
          {projectName && (
            <button
              onClick={destroyProject}
              className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
              title="Destroy sandbox project"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Output area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs">
        {logs.length === 0 ? (
          <p className="text-zinc-600">Waiting for build...</p>
        ) : (
          <div className="space-y-0.5">
            {logs.map((line, i) => (
              <p key={i} className={`whitespace-pre-wrap ${
                line.includes('✗') || line.includes('error') || line.includes('Error')
                  ? 'text-red-400'
                  : line.includes('✓') || line.includes('ready') || line.includes('success')
                    ? 'text-emerald-400'
                    : line.includes('warning') || line.includes('warn')
                      ? 'text-yellow-400'
                      : 'text-zinc-400'
              }`}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
