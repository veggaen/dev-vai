/**
 * SearchPanel — VS Code-style project-wide text search for the IDE workspace.
 *
 * Features: match case (Aa), whole word (ab|), regex (.*), replace + Replace All
 * (revertable — the runtime records a revision), results grouped by file with
 * line previews. Clicking a result opens the file in the project file viewer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search, CaseSensitive, WholeWord, Regex, Replace, ReplaceAll,
  ChevronRight, ChevronDown, Loader2, X, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSandboxStore } from '../../stores/sandboxStore.js';
import { apiFetch } from '../../lib/api.js';

interface SearchLineMatch {
  line: number;
  column: number;
  matchText: string;
  preview: string;
}

interface SearchFileMatch {
  path: string;
  matches: SearchLineMatch[];
}

interface SearchResult {
  files: SearchFileMatch[];
  totalMatches: number;
  filesScanned: number;
  truncated: boolean;
}

/** Highlight the match inside its preview line. */
function PreviewLine({ preview, matchText, caseSensitive }: { preview: string; matchText: string; caseSensitive: boolean }) {
  const haystack = caseSensitive ? preview : preview.toLowerCase();
  const needle = caseSensitive ? matchText : matchText.toLowerCase();
  const idx = needle ? haystack.indexOf(needle) : -1;
  if (idx < 0) {
    return <span className="truncate">{preview.trim().slice(0, 160)}</span>;
  }
  const before = preview.slice(Math.max(0, idx - 40), idx);
  const hit = preview.slice(idx, idx + matchText.length);
  const after = preview.slice(idx + matchText.length, idx + matchText.length + 90);
  return (
    <span className="truncate">
      <span className="opacity-70">{before.trimStart()}</span>
      <span className="rounded-[2px] bg-amber-400/25 text-amber-200">{hit}</span>
      <span className="opacity-70">{after}</span>
    </span>
  );
}

function ToggleButton({ active, onClick, title, children }: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded p-[3px] transition-colors ${
        active
          ? 'bg-violet-500/25 text-violet-300 ring-1 ring-violet-400/40'
          : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}

export function SearchPanel({ onOpenFile }: { onOpenFile?: (path: string, line?: number) => void }) {
  const projectId = useSandboxStore((s) => s.projectId);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [searching, setSearching] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const debounceRef = useRef<number | null>(null);
  const requestSeq = useRef(0);

  const runSearch = useCallback(async (q: string, opts: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }) => {
    if (!projectId || !q.trim()) {
      setResult(null);
      setErrorText(null);
      return;
    }
    const seq = ++requestSeq.current;
    setSearching(true);
    setErrorText(null);
    try {
      const res = await apiFetch(`/api/sandbox/${projectId}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, ...opts }),
      });
      const data = await res.json().catch(() => null) as (SearchResult & { error?: string }) | null;
      if (seq !== requestSeq.current) return; // stale response
      if (!res.ok || !data || data.error) {
        setErrorText(data?.error ?? 'Search failed');
        setResult(null);
        return;
      }
      setResult(data);
      setCollapsed(new Set());
    } catch {
      if (seq === requestSeq.current) setErrorText('Search failed — is the runtime up?');
    } finally {
      if (seq === requestSeq.current) setSearching(false);
    }
  }, [projectId]);

  // Debounced search-as-you-type.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runSearch(query, { caseSensitive, wholeWord, regex });
    }, 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [query, caseSensitive, wholeWord, regex, runSearch]);

  const replaceAll = useCallback(async () => {
    if (!projectId || !query.trim() || !result || result.totalMatches === 0) return;
    if (!window.confirm(`Replace ${result.totalMatches} match(es) across ${result.files.length} file(s)?\nThis is recorded as a revision and can be reverted.`)) return;
    setReplacing(true);
    try {
      const res = await apiFetch(`/api/sandbox/${projectId}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, replacement, caseSensitive, wholeWord, regex }),
      });
      const data = await res.json().catch(() => null) as { filesChanged?: number; replacements?: number; error?: string } | null;
      if (!res.ok || !data || data.error) {
        toast.error(data?.error ?? 'Replace failed');
        return;
      }
      toast.success(`Replaced ${data.replacements} match(es) in ${data.filesChanged} file(s)`);
      await useSandboxStore.getState().fetchFiles();
      void runSearch(query, { caseSensitive, wholeWord, regex });
    } finally {
      setReplacing(false);
    }
  }, [projectId, query, replacement, caseSensitive, wholeWord, regex, result, runSearch]);

  const toggleFile = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  if (!projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <Search className="mb-2 h-7 w-7 text-zinc-700" />
        <p className="text-xs text-zinc-600">No project active</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Query row */}
      <div className="shrink-0 space-y-1.5 border-b border-zinc-800 px-2.5 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowReplace((v) => !v)}
            title={showReplace ? 'Hide replace' : 'Show replace'}
            aria-expanded={showReplace}
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-300"
          >
            {showReplace ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-zinc-700/70 bg-black/30 px-2 py-1 focus-within:border-violet-500/60">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search project files"
              spellCheck={false}
              aria-label="Search query"
              className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            {searching && <Loader2 size={11} className="shrink-0 animate-spin text-zinc-500" />}
            {query && !searching && (
              <button type="button" onClick={() => setQuery('')} className="shrink-0 text-zinc-600 hover:text-zinc-300" aria-label="Clear search">
                <X size={11} />
              </button>
            )}
            <div className="flex shrink-0 items-center gap-0.5">
              <ToggleButton active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} title="Match case (Aa)">
                <CaseSensitive size={13} />
              </ToggleButton>
              <ToggleButton active={wholeWord} onClick={() => setWholeWord((v) => !v)} title="Match whole word">
                <WholeWord size={13} />
              </ToggleButton>
              <ToggleButton active={regex} onClick={() => setRegex((v) => !v)} title="Use regular expression">
                <Regex size={13} />
              </ToggleButton>
            </div>
          </div>
        </div>

        {showReplace && (
          <div className="flex items-center gap-1 pl-[18px]">
            <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-zinc-700/70 bg-black/30 px-2 py-1 focus-within:border-violet-500/60">
              <Replace size={11} className="shrink-0 text-zinc-600" />
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="Replace with"
                spellCheck={false}
                aria-label="Replacement text"
                className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
              />
            </div>
            <button
              type="button"
              onClick={() => void replaceAll()}
              disabled={replacing || !result || result.totalMatches === 0}
              title="Replace all matches (revertable)"
              className="flex shrink-0 items-center gap-1 rounded-md bg-violet-600/80 px-2 py-1 text-[10px] font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {replacing ? <Loader2 size={11} className="animate-spin" /> : <ReplaceAll size={11} />}
              All
            </button>
          </div>
        )}

        {result && (
          <p className="pl-[18px] text-[10px] text-zinc-500" aria-live="polite">
            {result.totalMatches === 0
              ? 'No results'
              : `${result.totalMatches}${result.truncated ? '+' : ''} result${result.totalMatches === 1 ? '' : 's'} in ${result.files.length} file${result.files.length === 1 ? '' : 's'}`}
          </p>
        )}
        {errorText && <p className="pl-[18px] text-[10px] text-red-400" role="alert">{errorText}</p>}
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1">
        {result?.files.map((file) => {
          const isCollapsed = collapsed.has(file.path);
          const fileName = file.path.split('/').pop() ?? file.path;
          const dir = file.path.slice(0, file.path.length - fileName.length).replace(/\/$/, '');
          return (
            <div key={file.path} className="mb-0.5">
              <button
                type="button"
                onClick={() => toggleFile(file.path)}
                className="flex w-full items-center gap-1 rounded px-1 py-[3px] text-left text-xs text-zinc-300 hover:bg-zinc-800/60"
                title={file.path}
              >
                {isCollapsed ? <ChevronRight size={11} className="shrink-0 text-zinc-600" /> : <ChevronDown size={11} className="shrink-0 text-zinc-600" />}
                <FileText size={11} className="shrink-0 text-blue-400/80" />
                <span className="truncate font-medium">{fileName}</span>
                {dir && <span className="truncate text-[10px] text-zinc-600">{dir}</span>}
                <span className="ml-auto shrink-0 rounded-full bg-zinc-800 px-1.5 text-[9px] text-zinc-400">{file.matches.length}</span>
              </button>
              {!isCollapsed && file.matches.map((m, i) => (
                <button
                  key={`${file.path}:${m.line}:${m.column}:${i}`}
                  type="button"
                  onClick={() => onOpenFile?.(file.path, m.line)}
                  className="flex w-full items-center gap-1.5 rounded py-[2px] pl-7 pr-2 text-left font-mono text-[11px] text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                  title={`${file.path}:${m.line}`}
                >
                  <span className="shrink-0 text-[9px] text-zinc-600">{m.line}</span>
                  <PreviewLine preview={m.preview} matchText={m.matchText} caseSensitive={caseSensitive} />
                </button>
              ))}
            </div>
          );
        })}
        {result && result.truncated && (
          <p className="px-2 py-1.5 text-center text-[10px] text-zinc-600">
            Results capped — refine the query to see everything.
          </p>
        )}
      </div>
    </div>
  );
}
