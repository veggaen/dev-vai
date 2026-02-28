import { useState, useEffect } from 'react';
import { API_BASE } from '../lib/api.js';

interface Source {
  id: string;
  url: string;
  title: string;
  sourceType: string;
  capturedAt: string;
}

interface SourceDetail {
  id: string;
  url: string;
  title: string;
  sourceType: string;
  capturedAt: string;
  meta: Record<string, unknown> | null;
  content: {
    full: string;
    summary: string | null;
    bullets: string | null;
  };
  chunkCount: number;
}

interface SearchResult {
  text: string;
  source: string;
  score: number;
  level: string;
}

interface DiscoverResult {
  discovered: number;
  ingested: number;
  sources: Array<{ url: string; title: string; tokens: number }>;
}

export function KnowledgePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'sources' | 'search'>('sources');
  const [sources, setSources] = useState<Source[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [sourceDetail, setSourceDetail] = useState<SourceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [contentView, setContentView] = useState<'full' | 'summary' | 'bullets'>('summary');
  const [filter, setFilter] = useState<'all' | 'web' | 'youtube' | 'file'>('all');

  useEffect(() => {
    fetchSources();
  }, []);

  const fetchSources = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sources`);
      if (res.ok) setSources(await res.json());
    } catch { /* offline */ }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
      if (res.ok) setSearchResults(await res.json());
    } catch { /* offline */ }
    setLoading(false);
  };

  const handleDiscover = async (sourceUrl: string) => {
    setDiscovering(sourceUrl);
    setDiscoverResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl, maxPages: 5 }),
      });
      if (res.ok) {
        const result = await res.json() as DiscoverResult;
        setDiscoverResult(result);
        if (result.ingested > 0) fetchSources();
      }
    } catch { /* offline */ }
    setDiscovering(null);
  };

  const handleIngestUrl = async () => {
    const url = ingestUrl.trim();
    if (!url) return;
    setIngesting(true);
    try {
      const res = await fetch(`${API_BASE}/api/ingest/web`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        setIngestUrl('');
        fetchSources();
      }
    } catch { /* offline */ }
    setIngesting(false);
  };

  const handleExpand = async (sourceId: string) => {
    if (expandedSourceId === sourceId) {
      setExpandedSourceId(null);
      setSourceDetail(null);
      return;
    }

    setExpandedSourceId(sourceId);
    setLoadingDetail(true);
    setContentView('summary');
    try {
      const res = await fetch(`${API_BASE}/api/sources/${sourceId}`);
      if (res.ok) {
        setSourceDetail(await res.json());
      }
    } catch { /* offline */ }
    setLoadingDetail(false);
  };

  const filteredSources = filter === 'all'
    ? sources
    : sources.filter(s => s.sourceType === filter);

  const sourceTypeCounts = {
    all: sources.length,
    web: sources.filter(s => s.sourceType === 'web').length,
    youtube: sources.filter(s => s.sourceType === 'youtube').length,
    file: sources.filter(s => s.sourceType === 'file').length,
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h2 className="text-lg font-bold text-zinc-100">Knowledge Base</h2>
        <button
          onClick={onClose}
          className="rounded-lg px-3 py-1 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          Back to Chat
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setTab('sources')}
          className={`px-6 py-3 text-sm font-medium transition-colors ${
            tab === 'sources'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Sources ({sources.length})
        </button>
        <button
          onClick={() => setTab('search')}
          className={`px-6 py-3 text-sm font-medium transition-colors ${
            tab === 'search'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Search Knowledge
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-6">
        {tab === 'sources' && (
          <div className="space-y-4">
            {/* Add URL input */}
            <div className="flex gap-2">
              <input
                value={ingestUrl}
                onChange={(e) => setIngestUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleIngestUrl()}
                placeholder="Paste a URL to learn from..."
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleIngestUrl}
                disabled={ingesting || !ingestUrl.trim()}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {ingesting ? '...' : 'Add'}
              </button>
            </div>

            {/* Filter buttons */}
            <div className="flex gap-2">
              {(['all', 'web', 'youtube', 'file'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filter === f
                      ? f === 'youtube' ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40'
                        : f === 'web' ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/40'
                        : f === 'file' ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
                        : 'bg-zinc-700 text-zinc-200 ring-1 ring-zinc-600'
                      : 'bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {f === 'all' ? `All (${sourceTypeCounts.all})`
                    : f === 'youtube' ? `YouTube (${sourceTypeCounts.youtube})`
                    : f === 'web' ? `Web (${sourceTypeCounts.web})`
                    : `Files (${sourceTypeCounts.file})`}
                </button>
              ))}
            </div>

            {/* Discover result notification */}
            {discoverResult && (
              <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-3 text-sm">
                <p className="text-emerald-400">
                  Found {discoverResult.discovered} new links, ingested {discoverResult.ingested} pages
                </p>
                {discoverResult.sources.map((s, i) => (
                  <p key={i} className="mt-1 truncate text-xs text-emerald-500/70">+ {s.title}</p>
                ))}
              </div>
            )}

            {filteredSources.length === 0 && (
              <div className="py-8 text-center text-sm text-zinc-500">
                {sources.length === 0 ? (
                  <>
                    <p className="mb-2">No sources captured yet.</p>
                    <p>Paste a URL above, or use the Chrome extension to capture pages.</p>
                  </>
                ) : (
                  <p>No {filter} sources found.</p>
                )}
              </div>
            )}

            {filteredSources.map((s) => (
              <div key={s.id} className="rounded-lg border border-zinc-800 transition-colors hover:border-zinc-700">
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-zinc-200">{s.title}</h3>
                      <p className="mt-1 truncate text-xs text-zinc-500">{s.url}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        s.sourceType === 'youtube' ? 'bg-red-500/20 text-red-400' :
                        s.sourceType === 'github' ? 'bg-purple-500/20 text-purple-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {s.sourceType}
                      </span>
                      <button
                        onClick={() => handleExpand(s.id)}
                        className={`rounded px-2 py-0.5 text-xs transition-colors ${
                          expandedSourceId === s.id
                            ? 'bg-blue-600/20 text-blue-400'
                            : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                        }`}
                        title={expandedSourceId === s.id ? 'Collapse' : 'View content'}
                      >
                        {expandedSourceId === s.id ? 'Collapse' : 'Expand'}
                      </button>
                      {s.url && s.sourceType === 'web' && (
                        <button
                          onClick={() => handleDiscover(s.url)}
                          disabled={discovering === s.url}
                          className="rounded px-2 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
                          title="Discover and ingest linked pages"
                        >
                          {discovering === s.url ? '...' : 'Discover'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded source detail */}
                {expandedSourceId === s.id && (
                  <div className="border-t border-zinc-800 bg-zinc-900/50 p-4">
                    {loadingDetail ? (
                      <p className="text-sm text-zinc-500 animate-pulse">Loading content...</p>
                    ) : sourceDetail ? (
                      <div className="space-y-3">
                        {/* Meta info */}
                        {sourceDetail.meta && (
                          <div className="flex flex-wrap gap-2 text-xs">
                            {Boolean(sourceDetail.meta.videoId) && (
                              <span className="rounded bg-red-500/10 px-2 py-0.5 text-red-400">
                                Video: {String(sourceDetail.meta.videoId)}
                              </span>
                            )}
                            {sourceDetail.meta.hasTranscript !== undefined && (() => {
                              // Content-based override: don't trust meta alone
                              const contentLies = /\[no transcript|\[no captions/i.test(
                                sourceDetail.content.full ?? '',
                              );
                              const reallyHas = sourceDetail.meta.hasTranscript && !contentLies;
                              return (
                                <span className={`rounded px-2 py-0.5 ${
                                  reallyHas
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-amber-500/10 text-amber-400'
                                }`}>
                                  {reallyHas ? 'Has Transcript' : 'No Transcript'}
                                </span>
                              );
                            })()}
                            {Boolean(sourceDetail.meta.method) && (
                              <span className="rounded bg-zinc-700/50 px-2 py-0.5 text-zinc-400">
                                via {String(sourceDetail.meta.method)}
                              </span>
                            )}
                            {Boolean(sourceDetail.meta.capturedBy) && (
                              <span className="rounded bg-zinc-700/50 px-2 py-0.5 text-zinc-400">
                                captured by {String(sourceDetail.meta.capturedBy)}
                              </span>
                            )}
                            <span className="rounded bg-zinc-700/50 px-2 py-0.5 text-zinc-400">
                              {sourceDetail.chunkCount} chunks
                            </span>
                          </div>
                        )}

                        {/* Content view tabs */}
                        <div className="flex gap-1">
                          {(['summary', 'full', 'bullets'] as const).map((v) => (
                            <button
                              key={v}
                              onClick={() => setContentView(v)}
                              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                                contentView === v
                                  ? 'bg-blue-600/20 text-blue-400'
                                  : 'text-zinc-500 hover:text-zinc-300'
                              }`}
                            >
                              {v === 'full'
                                ? (s.sourceType === 'youtube' ? 'Full Transcript' : 'Full Content')
                                : v === 'summary' ? 'Summary' : 'Key Points'}
                            </button>
                          ))}
                        </div>

                        {/* Content display */}
                        <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                          {contentView === 'full' && sourceDetail.content.full ? (
                            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-zinc-300">
                              {sourceDetail.content.full}
                            </pre>
                          ) : contentView === 'summary' && sourceDetail.content.summary ? (
                            <p className="text-sm leading-relaxed text-zinc-300">
                              {sourceDetail.content.summary}
                            </p>
                          ) : contentView === 'bullets' && sourceDetail.content.bullets ? (
                            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">
                              {sourceDetail.content.bullets}
                            </pre>
                          ) : (
                            <p className="text-sm text-zinc-500 italic">No content available for this view.</p>
                          )}
                        </div>

                        {/* Content stats */}
                        <div className="flex gap-4 text-xs text-zinc-500">
                          {sourceDetail.content.full && (
                            <span>{sourceDetail.content.full.length.toLocaleString()} chars</span>
                          )}
                          {sourceDetail.content.full && (
                            <span>~{Math.ceil(sourceDetail.content.full.split(/\s+/).length).toLocaleString()} words</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500">Failed to load content.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'search' && (
          <div>
            <div className="mb-4 flex gap-2">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search what VAI has learned..."
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '...' : 'Search'}
              </button>
            </div>

            <div className="space-y-3">
              {searchResults.length === 0 && searchQuery && !loading && (
                <p className="py-8 text-center text-sm text-zinc-500">No results found.</p>
              )}
              {searchResults.map((r, i) => (
                <div key={i} className="rounded-lg border border-zinc-800 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="min-w-0 truncate text-xs text-zinc-500">{r.source}</span>
                    <span className="ml-2 shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                      score: {r.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="break-words text-sm text-zinc-300">{r.text.slice(0, 300)}{r.text.length > 300 ? '...' : ''}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
