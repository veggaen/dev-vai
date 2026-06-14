import { useCallback, useEffect, useState, useMemo } from 'react';
import { BookOpen, ExternalLink, Globe, Search as SearchIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { API_BASE, apiFetch } from '../../lib/api.js';

function formatRelative(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(date).toLocaleDateString();
}

interface KBSource {
  id: string;
  url: string;
  title: string;
  sourceType: string;
  capturedAt: string;
}

export function KnowledgeSidePanel() {
  const setActivePanel = useLayoutStore((s) => s.setActivePanel);
  const [sources, setSources] = useState<KBSource[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ text: string; source: string; score: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const res = await apiFetch('/api/sources');
      if (res.ok) setSources(await res.json());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=8`);
      if (res.ok) setResults(await res.json());
    } catch { /* offline */ }
    setSearching(false);
  };

  const handleDeleteSource = async (sourceId: string) => {
    setDeletingId(sourceId);
    try {
      const res = await apiFetch(`/api/sources/${sourceId}`, { method: 'DELETE' });
      if (res.ok) {
        setSources((prev) => prev.filter((s) => s.id !== sourceId));
        toast.success('Source removed');
      } else {
        toast.error('Failed to delete source');
      }
    } catch {
      toast.error('Failed to delete source');
    }
    setDeletingId(null);
  };

  const typeCounts = useMemo(() => {
    const counts = { web: 0, youtube: 0, file: 0 };
    for (const s of sources) {
      if (s.sourceType === 'youtube') counts.youtube++;
      else if (s.sourceType === 'file') counts.file++;
      else counts.web++;
    }
    return counts;
  }, [sources]);

  return (
    <div className="flex min-h-0 flex-col gap-3 p-2">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
        <div className="flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5 text-violet-400" aria-hidden />
          <span className="text-xs font-medium text-zinc-200">Saved sources</span>
          <span className="ml-auto text-[10px] tabular-nums text-zinc-500">{sources.length}</span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          Pages and files Vai has read during research. Search below to test what it can recall.
        </p>
        <button
          type="button"
          onClick={() => setActivePanel('settings')}
          className="mt-2 text-[10px] text-violet-400/80 transition-colors hover:text-violet-300"
        >
          Engine metrics → Settings
        </button>
      </div>

      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleSearch()}
          placeholder="Search what Vai remembers…"
          aria-label="Search knowledge"
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={searching}
          className="rounded-md bg-violet-600/80 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
          aria-label="Search"
        >
          <SearchIcon className="h-3 w-3" />
        </button>
      </div>

      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map((r, i) => (
            <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
              <p className="text-[11px] leading-snug text-zinc-300 line-clamp-4">{r.text.slice(0, 280)}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-[9px] text-zinc-600">{r.source}</span>
                <span className="shrink-0 text-[9px] text-zinc-500">{Math.round(r.score * 100)}% match</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {typeCounts.web > 0 && (
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
            <Globe className="mr-0.5 inline h-2.5 w-2.5" aria-hidden /> {typeCounts.web} web
          </span>
        )}
        {typeCounts.youtube > 0 && (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
            {typeCounts.youtube} videos
          </span>
        )}
        {typeCounts.file > 0 && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
            {typeCounts.file} files
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Recent sources
        </div>
        <ul className="flex-1 list-none space-y-0.5 overflow-y-auto">
          {sources.slice(0, 50).map((s) => (
            <li
              key={s.id}
              className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/40 hover:text-zinc-200"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  s.sourceType === 'youtube' ? 'bg-red-500' : s.sourceType === 'file' ? 'bg-amber-500' : 'bg-blue-500'
                }`}
                aria-hidden
              />
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="truncate">{s.title || s.url}</div>
                <div className="text-[10px] text-zinc-600">{s.sourceType} · {formatRelative(s.capturedAt)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Open source"
                  >
                    <ExternalLink className="h-2.5 w-2.5 text-zinc-600 hover:text-zinc-400" />
                  </a>
                )}
                <button
                  type="button"
                  disabled={deletingId === s.id}
                  onClick={() => void handleDeleteSource(s.id)}
                  className="rounded p-0.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Remove source"
                  aria-label="Remove source"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            </li>
          ))}
          {sources.length === 0 && (
            <li className="py-6 text-center text-[11px] text-zinc-600">
              No sources yet — ask Vai to research something and saved pages will appear here.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
