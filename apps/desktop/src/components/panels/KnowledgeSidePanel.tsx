import { useCallback, useEffect, useState, useMemo } from 'react';
import { BookOpen, Brain, ExternalLink, Globe, Search as SearchIcon, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useEngineStore } from '../../stores/engineStore.js';
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

interface KnowledgeDiagnostics {
  ingest: {
    totalSources: number;
    ingestedLast24h: number;
    updatedSources: number;
    duplicateUpdateCount: number;
    duplicateRate: number;
    domainHotspots: Array<{ domain: string; count: number }>;
  };
  retrieval: {
    totalQueries: number;
    lowConfidenceQueries: number;
    lowConfidenceRate: number;
    averageTopScore: number;
    averageResultCount: number;
    domainHotspots: Array<{ domain: string; hits: number }>;
    recentTrend: Array<{ at: number; topScore: number; lowConfidence: boolean; resultCount: number }>;
    recentLowConfidence: Array<{ query: string; topScore: number; domains: string[]; at: number }>;
  };
}

export function KnowledgeSidePanel() {
  const { stats } = useEngineStore();
  const [sources, setSources] = useState<KBSource[]>([]);
  const [diagnostics, setDiagnostics] = useState<KnowledgeDiagnostics | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ text: string; source: string; score: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadKnowledgeState = useCallback(async () => {
    try {
      const [sourcesRes, metricsRes] = await Promise.all([
        apiFetch('/api/sources'),
        apiFetch('/api/ingest/metrics'),
      ]);

      if (sourcesRes.ok) {
        setSources(await sourcesRes.json());
      }
      if (metricsRes.ok) {
        setDiagnostics(await metricsRes.json() as KnowledgeDiagnostics);
      }
    } catch {
      // Best-effort diagnostics
    }
  }, []);

  useEffect(() => {
    void loadKnowledgeState();
  }, [loadKnowledgeState]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=5`);
      if (res.ok) setResults(await res.json());
    } catch { /* offline */ }
    setSearching(false);
    void loadKnowledgeState();
  };

  const handleDeleteSource = async (sourceId: string) => {
    setDeletingId(sourceId);
    try {
      const res = await apiFetch(`/api/sources/${sourceId}`, { method: 'DELETE' });
      if (res.ok) {
        setSources((prev) => prev.filter((s) => s.id !== sourceId));
        toast.success('Source deleted');
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
    <div className="flex flex-col gap-3 p-2">
      {/* Stats overview */}
      {stats && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
          <div className="mb-2 flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-xs font-medium text-zinc-300">Engine Stats</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            <div className="rounded bg-zinc-800/60 px-2 py-1">
              <div className="text-zinc-500">Vocab</div>
              <div className="text-sm font-medium text-zinc-200">{stats.vocabSize.toLocaleString()}</div>
            </div>
            <div className="rounded bg-zinc-800/60 px-2 py-1">
              <div className="text-zinc-500">Knowledge</div>
              <div className="text-sm font-medium text-zinc-200">{stats.knowledgeEntries.toLocaleString()}</div>
            </div>
            <div className="rounded bg-zinc-800/60 px-2 py-1">
              <div className="text-zinc-500">Documents</div>
              <div className="text-sm font-medium text-zinc-200">{stats.documentsIndexed.toLocaleString()}</div>
            </div>
            <div className="rounded bg-zinc-800/60 px-2 py-1">
              <div className="text-zinc-500">Sources</div>
              <div className="text-sm font-medium text-zinc-200">{sources.length}</div>
            </div>
          </div>
        </div>
      )}

      {diagnostics && (
        <>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-zinc-300">Memory Health</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
              <div className="rounded bg-zinc-800/60 px-2 py-1">
                <div className="text-zinc-500">Last 24h</div>
                <div className="text-sm font-medium text-zinc-200">{diagnostics.ingest.ingestedLast24h}</div>
              </div>
              <div className="rounded bg-zinc-800/60 px-2 py-1">
                <div className="text-zinc-500">Updated sources</div>
                <div className="text-sm font-medium text-zinc-200">{diagnostics.ingest.updatedSources}</div>
              </div>
              <div className="rounded bg-zinc-800/60 px-2 py-1">
                <div className="text-zinc-500">Duplicate rate</div>
                <div className="text-sm font-medium text-zinc-200">{Math.round(diagnostics.ingest.duplicateRate * 100)}%</div>
              </div>
              <div className="rounded bg-zinc-800/60 px-2 py-1">
                <div className="text-zinc-500">Low confidence</div>
                <div className="text-sm font-medium text-zinc-200">{Math.round(diagnostics.retrieval.lowConfidenceRate * 100)}%</div>
              </div>
            </div>

            {diagnostics.ingest.domainHotspots.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">Top domains</div>
                <div className="flex flex-wrap gap-1">
                  {diagnostics.ingest.domainHotspots.map((domain) => (
                    <span key={domain.domain} className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-400">
                      {domain.domain} · {domain.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
            <div className="mb-2 flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-xs font-medium text-zinc-300">Retrieval Confidence</span>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-1.5 text-[10px]">
              <div className="rounded bg-zinc-800/60 px-2 py-1">
                <div className="text-zinc-500">Queries tracked</div>
                <div className="text-sm font-medium text-zinc-200">{diagnostics.retrieval.totalQueries}</div>
              </div>
              <div className="rounded bg-zinc-800/60 px-2 py-1">
                <div className="text-zinc-500">Avg top score</div>
                <div className="text-sm font-medium text-zinc-200">{diagnostics.retrieval.averageTopScore.toFixed(2)}</div>
              </div>
            </div>

            {diagnostics.retrieval.recentTrend.length > 0 && (
              <div className="mb-2">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">Recent trend</div>
                <div className="flex items-end gap-1 rounded-md border border-zinc-800/60 bg-zinc-950/70 px-2 py-2">
                  {diagnostics.retrieval.recentTrend.slice(-12).map((point, index) => (
                    <div key={`${point.at}-${index}`} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className={`w-full rounded-sm ${
                          point.lowConfidence ? 'bg-amber-500/70' : 'bg-emerald-500/70'
                        }`}
                        style={{ height: `${Math.max(6, Math.round(point.topScore * 36))}px` }}
                        title={`${Math.round(point.topScore * 100)}% confidence`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {diagnostics.retrieval.recentLowConfidence.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">Recent low-confidence queries</div>
                <div className="space-y-1">
                  {diagnostics.retrieval.recentLowConfidence.map((item, index) => (
                    <div key={`${item.at}-${index}`} className="rounded-md border border-amber-500/15 bg-amber-500/5 px-2 py-1.5 text-[10px]">
                      <div className="line-clamp-2 text-zinc-300">{item.query}</div>
                      <div className="mt-1 text-zinc-600">
                        score {item.topScore.toFixed(2)} · {item.domains.join(', ') || 'no domains'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Quick search */}
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleSearch()}
          placeholder="Search knowledge..."
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none"
        />
        <button
          onClick={() => void handleSearch()}
          disabled={searching}
          className="rounded-md bg-violet-600/80 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
        >
          <SearchIcon className="h-3 w-3" />
        </button>
      </div>

      {/* Search results */}
      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map((r, i) => (
            <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
              <p className="text-[11px] leading-snug text-zinc-300 line-clamp-3">{r.text.slice(0, 200)}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="truncate text-[9px] text-zinc-600">{r.source}</span>
                <span className="ml-1 shrink-0 text-[9px] text-zinc-600">{r.score.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Source type breakdown */}
      <div className="flex flex-wrap gap-1.5">
        {typeCounts.web > 0 && (
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
            <Globe className="mr-0.5 inline h-2.5 w-2.5" /> {typeCounts.web} web
          </span>
        )}
        {typeCounts.youtube > 0 && (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
            ▶ {typeCounts.youtube} videos
          </span>
        )}
        {typeCounts.file > 0 && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
            {typeCounts.file} files
          </span>
        )}
      </div>

      {/* Recent sources — show 50 with scroll */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Recent Sources ({sources.length})
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto">
          {sources.slice(0, 50).map((s) => (
            <div
              key={s.id}
              className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/40 hover:text-zinc-200"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.sourceType === 'youtube' ? 'bg-red-500' :
                s.sourceType === 'file' ? 'bg-amber-500' : 'bg-blue-500'
                }`} />
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="truncate">{s.title || s.url}</div>
                <div className="text-[10px] text-zinc-600">{s.sourceType} · {formatRelative(s.capturedAt)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-2.5 w-2.5 text-zinc-600 hover:text-zinc-400" />
                  </a>
                )}
                <button
                  type="button"
                  disabled={deletingId === s.id}
                  onClick={() => void handleDeleteSource(s.id)}
                  className="rounded p-0.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Delete source"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          ))}
          {sources.length === 0 && (
            <p className="py-4 text-center text-[10px] text-zinc-600">No sources yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
