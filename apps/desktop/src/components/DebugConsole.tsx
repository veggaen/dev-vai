import { useSandboxStore } from '../stores/sandboxStore.js';
import { useLayoutStore } from '../stores/layoutStore.js';
import {
  Terminal, Trash2, FolderTree, Copy, ChevronDown,
  Search, X, Lock, Unlock, Hash, Clock,
} from 'lucide-react';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

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

/** Strip common ANSI escape sequences for clean display */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/**
 * Debug Console — shows sandbox build output, install logs, and dev server output.
 * Features: line numbers, timestamps, search, scroll lock, ANSI strip, smart copy.
 */
export function DebugConsole() {
  const { status, logs, files, projectName, fetchLogs, destroyProject } = useSandboxStore();
  const themePreference = useLayoutStore((state) => state.themePreference);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const copyMenuRef = useRef<HTMLDivElement>(null);

  // New features state
  const [scrollLocked, setScrollLocked] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isLight = themePreference === 'light';

  // Track timestamps for each log line
  const timestampsRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    const map = timestampsRef.current;
    const now = Date.now();
    for (let i = map.size; i < logs.length; i++) {
      map.set(i, now);
    }
  }, [logs.length]);

  // Auto-poll logs when not idle
  useEffect(() => {
    if (status === 'idle') return;
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [status, fetchLogs]);

  // Auto-scroll to bottom (unless scroll-locked)
  useEffect(() => {
    if (!scrollLocked && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, scrollLocked]);

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

  // Focus search input when shown
  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

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

  // Search-filtered logs
  const displayLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs.map((line, i) => ({ line, index: i }));
    const q = searchQuery.toLowerCase();
    return logs
      .map((line, i) => ({ line, index: i }))
      .filter(({ line }) => stripAnsi(line).toLowerCase().includes(q));
  }, [logs, searchQuery]);

  // Error/warning/success counts
  const errorCount = useMemo(() => logs.filter(isErrorLine).length, [logs]);
  const warnCount = useMemo(() => logs.filter(isWarningLine).length, [logs]);

  const formatTimestamp = (idx: number): string => {
    const ts = timestampsRef.current.get(idx);
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex h-full flex-col border-t ${
      isLight ? 'border-zinc-200 bg-white' : 'border-zinc-800 bg-zinc-950'
    }`}>
      {/* Header */}
      <div className={`flex items-center justify-between border-b px-3 py-1.5 ${
        isLight ? 'border-zinc-200 bg-zinc-50/90' : 'border-zinc-800'
      }`}>
        <div className="flex items-center gap-2">
          <Terminal className={`h-3.5 w-3.5 ${isLight ? 'text-zinc-500' : 'text-zinc-500'}`} />
          <span className={`text-xs font-medium ${isLight ? 'text-zinc-700' : 'text-zinc-400'}`}>Console</span>
          {projectName && (
            <span className={`text-[10px] ${isLight ? 'text-zinc-500' : 'text-zinc-600'}`}>— {projectName}</span>
          )}
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            status === 'running' ? 'bg-emerald-500/20 text-emerald-400' :
            status === 'failed' ? 'bg-red-500/20 text-red-400' :
            status === 'idle' ? (isLight ? 'bg-zinc-100 text-zinc-500' : 'bg-zinc-800 text-zinc-500') :
            'bg-yellow-500/20 text-yellow-400'
          }`}>
            {status}
          </span>

          {/* Error/warning badges */}
          {errorCount > 0 && (
            <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-medium text-red-400">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
          {warnCount > 0 && (
            <span className="rounded-full bg-yellow-500/15 px-1.5 py-0.5 text-[9px] font-medium text-yellow-400">
              {warnCount} warn
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {files.length > 0 && (
            <span className={`flex items-center gap-1 text-[10px] ${isLight ? 'text-zinc-500' : 'text-zinc-600'}`} title={files.join('\n')}>
              <FolderTree className="h-3 w-3" />
              {files.length}
            </span>
          )}

          {/* Copy feedback */}
          {copyFeedback && (
            <span className="text-[10px] text-emerald-400">{copyFeedback}</span>
          )}

          {/* Toggle line numbers */}
          <button
            onClick={() => setShowLineNumbers((v) => !v)}
            className={`rounded p-1 transition-colors ${
              showLineNumbers ? (isLight ? 'text-violet-700' : 'text-violet-400') : 'text-zinc-600'
            } ${isLight ? 'hover:bg-zinc-100' : 'hover:bg-zinc-800'}`}
            title="Toggle line numbers"
          >
            <Hash className="h-3 w-3" />
          </button>

          {/* Toggle timestamps */}
          <button
            onClick={() => setShowTimestamps((v) => !v)}
            className={`rounded p-1 transition-colors ${
              showTimestamps ? (isLight ? 'text-violet-700' : 'text-violet-400') : 'text-zinc-600'
            } ${isLight ? 'hover:bg-zinc-100' : 'hover:bg-zinc-800'}`}
            title="Toggle timestamps"
          >
            <Clock className="h-3 w-3" />
          </button>

          {/* Search toggle */}
          <button
            onClick={() => { setShowSearch((v) => !v); if (showSearch) setSearchQuery(''); }}
            className={`rounded p-1 transition-colors ${
              showSearch ? (isLight ? 'text-violet-700' : 'text-violet-400') : 'text-zinc-600'
            } ${isLight ? 'hover:bg-zinc-100' : 'hover:bg-zinc-800'}`}
            title="Search logs (Ctrl+F)"
          >
            <Search className="h-3 w-3" />
          </button>

          {/* Scroll lock */}
          <button
            onClick={() => setScrollLocked((v) => !v)}
            className={`rounded p-1 transition-colors ${
              scrollLocked ? 'text-amber-400' : 'text-zinc-600'
            } ${isLight ? 'hover:bg-zinc-100' : 'hover:bg-zinc-800'}`}
            title={scrollLocked ? 'Auto-scroll locked' : 'Auto-scroll active'}
          >
            {scrollLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          </button>

          {/* Smart copy button */}
          {logs.length > 0 && (
            <div className="relative" ref={copyMenuRef}>
              <button
                onClick={() => setShowCopyMenu(!showCopyMenu)}
                className={`flex items-center gap-0.5 rounded p-1 text-zinc-600 ${
                  isLight ? 'hover:bg-zinc-100 hover:text-zinc-900' : 'hover:bg-zinc-800 hover:text-zinc-300'
                }`}
                title="Copy console output"
              >
                <Copy className="h-3 w-3" />
                <ChevronDown className="h-2.5 w-2.5" />
              </button>

              {showCopyMenu && (
                <div className={`absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-lg border py-1 shadow-xl ${
                  isLight ? 'border-zinc-200 bg-white' : 'border-zinc-700 bg-zinc-900'
                }`}>
                  {COPY_OPTIONS.map((opt) => {
                    const count = filterLines(logs, opt.key).length;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => handleCopy(opt.key)}
                        disabled={count === 0}
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-30 ${
                          isLight ? 'hover:bg-zinc-100' : 'hover:bg-zinc-800'
                        }`}
                      >
                        <div>
                          <div className={isLight ? 'text-zinc-800' : 'text-zinc-300'}>{opt.label}</div>
                          <div className="text-[9px] text-zinc-500">{opt.desc}</div>
                        </div>
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-[9px] text-zinc-500 ${
                          isLight ? 'bg-zinc-100' : 'bg-zinc-800'
                        }`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Clear console */}
          {logs.length > 0 && (
            <button
              onClick={() => {
                // Clear logs via direct store manipulation
                useSandboxStore.setState({ logs: [] });
                timestampsRef.current.clear();
              }}
              className={`rounded p-1 text-zinc-600 ${
                isLight ? 'hover:bg-zinc-100 hover:text-zinc-900' : 'hover:bg-zinc-800 hover:text-zinc-300'
              }`}
              title="Clear console"
            >
              <X className="h-3 w-3" />
            </button>
          )}

          {projectName && (
            <button
              onClick={destroyProject}
              className={`rounded p-1 text-zinc-600 ${
                isLight ? 'hover:bg-red-50 hover:text-red-500' : 'hover:bg-zinc-800 hover:text-red-400'
              }`}
              title="Destroy sandbox project"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className={`flex items-center gap-2 border-b px-3 py-1 ${
          isLight ? 'border-zinc-200 bg-zinc-50' : 'border-zinc-800/60 bg-zinc-900/40'
        }`}>
          <Search className="h-3 w-3 text-zinc-600" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            className={`flex-1 bg-transparent text-xs outline-none ${
              isLight ? 'text-zinc-800 placeholder-zinc-400' : 'text-zinc-300 placeholder-zinc-600'
            }`}
          />
          {searchQuery && (
            <span className="text-[10px] text-zinc-500">
              {displayLogs.length} / {logs.length}
            </span>
          )}
          <button
            onClick={() => { setSearchQuery(''); setShowSearch(false); }}
            className={`rounded p-0.5 text-zinc-600 ${isLight ? 'hover:text-zinc-900' : 'hover:text-zinc-300'}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Output area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto font-mono text-[11px] leading-5">
        {logs.length === 0 ? (
          <p className="px-3 py-4 text-zinc-600">Waiting for build...</p>
        ) : (
          <div>
            {displayLogs.map(({ line, index }) => {
              const cleaned = stripAnsi(line);
              const highlight = searchQuery && cleaned.toLowerCase().includes(searchQuery.toLowerCase());
              return (
                <div
                  key={index}
                  className={`flex ${
                    isLight ? 'hover:bg-zinc-100/90' : 'hover:bg-zinc-800/30'
                  } ${
                    highlight ? 'bg-yellow-500/10' : ''
                  }`}
                >
                  {/* Line number */}
                  {showLineNumbers && (
                    <span className={`w-8 shrink-0 select-none border-r px-1 text-right ${
                      isLight ? 'border-zinc-200 text-zinc-400' : 'border-zinc-800/40 text-zinc-700'
                    }`}>
                      {index + 1}
                    </span>
                  )}
                  {/* Timestamp */}
                  {showTimestamps && (
                    <span className={`w-16 shrink-0 select-none px-1 ${isLight ? 'text-zinc-400' : 'text-zinc-700'}`}>
                      {formatTimestamp(index)}
                    </span>
                  )}
                  {/* Log line */}
                  <span className={`flex-1 whitespace-pre-wrap px-2 ${
                    isErrorLine(cleaned)
                      ? 'text-red-400'
                      : isSuccessLine(cleaned)
                        ? 'text-emerald-400'
                        : isWarningLine(cleaned)
                          ? 'text-yellow-400'
                          : isLight ? 'text-zinc-700' : 'text-zinc-400'
                  }`}>
                    {cleaned}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
