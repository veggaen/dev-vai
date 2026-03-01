import { useSandboxStore } from '../stores/sandboxStore.js';
import { Terminal, Trash2, FolderTree, Copy, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';

/* ── Copy filter helpers ── */

type CopyFilter = 'all' | 'no-errors' | 'errors-only' | 'warnings-only' | 'red-only' | 'success-only';

const COPY_OPTIONS: { key: CopyFilter; label: string; desc: string }[] = [
  { key: 'all',           label: 'Copy All',                  desc: 'Everything in console' },
  { key: 'no-errors',     label: 'Copy Without Errors',       desc: 'Exclude red and yellow lines' },
  { key: 'errors-only',   label: 'Copy Errors Only',          desc: 'Red + yellow lines only' },
  { key: 'red-only',      label: 'Copy Red Errors Only',      desc: 'Only error/failure lines' },
  { key: 'warnings-only', label: 'Copy Warnings Only',        desc: 'Only yellow warning lines' },
  { key: 'success-only',  label: 'Copy Success Only',         desc: 'Only green success lines' },
];

function isErrorLine(line: string): boolean {
  return /✗|error|Error|ERR!|FAIL|fatal/i.test(line);
}

function isWarningLine(line: string): boolean {
  return /warning|warn|WARN/i.test(line) && !isErrorLine(line);
}

function isSuccessLine(line: string): boolean {
  return /✓|ready|success|✅|done|passed/i.test(line);
}

function filterLines(logs: string[], filter: CopyFilter): string[] {
  switch (filter) {
    case 'all':           return logs;
    case 'no-errors':     return logs.filter((l) => !isErrorLine(l) && !isWarningLine(l));
    case 'errors-only':   return logs.filter((l) => isErrorLine(l) || isWarningLine(l));
    case 'red-only':      return logs.filter(isErrorLine);
    case 'warnings-only': return logs.filter(isWarningLine);
    case 'success-only':  return logs.filter(isSuccessLine);
  }
}

/**
 * Debug Console — shows sandbox build output, install logs, and dev server output.
 */
export function DebugConsole() {
  const { status, logs, files, projectName, fetchLogs, destroyProject } = useSandboxStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const copyMenuRef = useRef<HTMLDivElement>(null);

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

  // Close copy menu on outside click
  useEffect(() => {
    if (!showCopyMenu) return;
    const handler = (e: MouseEvent) => {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) {
        setShowCopyMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCopyMenu]);

  const handleCopy = useCallback((filter: CopyFilter) => {
    const filtered = filterLines(logs, filter);
    const text = filtered.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      const count = filtered.length;
      setCopyFeedback(`Copied ${count} line${count !== 1 ? 's' : ''}`);
      setTimeout(() => setCopyFeedback(''), 2000);
    });
    setShowCopyMenu(false);
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

          {/* Copy feedback */}
          {copyFeedback && (
            <span className="text-[10px] text-emerald-400 animate-in fade-in">{copyFeedback}</span>
          )}

          {/* Smart copy button */}
          {logs.length > 0 && (
            <div className="relative" ref={copyMenuRef}>
              <button
                onClick={() => setShowCopyMenu(!showCopyMenu)}
                className="flex items-center gap-0.5 rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                title="Copy console output"
              >
                <Copy className="h-3 w-3" />
                <ChevronDown className="h-2.5 w-2.5" />
              </button>

              {showCopyMenu && (
                <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
                  {COPY_OPTIONS.map((opt) => {
                    const count = filterLines(logs, opt.key).length;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => handleCopy(opt.key)}
                        disabled={count === 0}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-800 disabled:opacity-30"
                      >
                        <div>
                          <div className="text-zinc-300">{opt.label}</div>
                          <div className="text-[9px] text-zinc-600">{opt.desc}</div>
                        </div>
                        <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
                isErrorLine(line)
                  ? 'text-red-400'
                  : isSuccessLine(line)
                    ? 'text-emerald-400'
                    : isWarningLine(line)
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
