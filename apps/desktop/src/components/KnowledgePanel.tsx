import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { API_BASE } from '../lib/api.js';

/* ── Types ─────────────────────────────────────────────────────── */

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

/* ── Constants ─────────────────────────────────────────────────── */

const PAGE_SIZE = 50;

/* ── Component ─────────────────────────────────────────────────── */

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

  // NEW: text filter + pagination
  const [textFilter, setTextFilter] = useState('');
  const [page, setPage] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSources();
  }, []);

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [filter, textFilter]);

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
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(searchQuery)}&limit=20`);
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

  const handleExpand = useCallback(async (sourceId: string) => {
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
  }, [expandedSourceId]);

  /* ── Derived data ───────────────────────────────────────────── */

  const filteredSources = useMemo(() => {
    let list = filter === 'all'
      ? sources
      : sources.filter(s => s.sourceType === filter);

    if (textFilter.trim()) {
      const q = textFilter.toLowerCase();
      list = list.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.url.toLowerCase().includes(q),
      );
    }

    return list;
  }, [sources, filter, textFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredSources.length / PAGE_SIZE));
  const pagedSources = useMemo(
    () => filteredSources.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filteredSources, page],
  );

  const sourceTypeCounts = useMemo(() => ({
    all: sources.length,
    web: sources.filter(s => s.sourceType === 'web').length,
    youtube: sources.filter(s => s.sourceType === 'youtube').length,
    file: sources.filter(s => s.sourceType === 'file').length,
  }), [sources]);

  const goPage = useCallback((p: number) => {
    setPage(p);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-6 py-4 backdrop-blur-sm">
        <h2 className="bg-gradient-to-r from-blue-400 via-zinc-100 to-blue-400 bg-clip-text text-lg font-bold text-transparent">Knowledge Base</h2>
        <button
          onClick={onClose}
          className="group/back rounded-lg px-3 py-1 text-sm text-zinc-400 transition-all duration-200 hover:bg-zinc-800 hover:text-zinc-200 hover:shadow-sm"
        >
          <span className="transition-transform duration-200 group-hover/back:-translate-x-0.5 inline-block">←</span> Back to Chat
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800/60">
        <button
          onClick={() => setTab('sources')}
          className={`group/stab relative px-6 py-3 text-sm font-medium transition-all duration-200 ${
            tab === 'sources'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Sources ({sources.length})
          {tab === 'sources' && (
            <motion.div
              layoutId="kb-tab-glow"
              className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            />
          )}
        </button>
        <button
          onClick={() => setTab('search')}
          className={`group/stab relative px-6 py-3 text-sm font-medium transition-all duration-200 ${
            tab === 'search'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Search Knowledge
          {tab === 'search' && (
            <motion.div
              layoutId="kb-tab-glow"
              className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            />
          )}
        </button>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-6">
        {tab === 'sources' && (
          <div className="space-y-4">
            {/* Add URL input */}
            <div className="flex gap-2">
              <input
                value={ingestUrl}
                onChange={(e) => setIngestUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleIngestUrl()}
                placeholder="Paste a URL to learn from..."
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 transition-all duration-200 focus:border-blue-500 focus:outline-none focus:shadow-[0_0_12px_rgba(59,130,246,0.15)] focus:ring-1 focus:ring-blue-500/30"
              />
              <button
                onClick={handleIngestUrl}
                disabled={ingesting || !ingestUrl.trim()}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-blue-500 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/20 disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {ingesting ? '...' : 'Add'}
              </button>
            </div>

            {/* Incremental text filter */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
              <input
                value={textFilter}
                onChange={(e) => setTextFilter(e.target.value)}
                placeholder="Filter sources by title or URL..."
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder-zinc-600 focus:border-zinc-700 focus:outline-none"
              />
              {textFilter && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-600">
                  {filteredSources.length} match{filteredSources.length !== 1 ? 'es' : ''}
                </span>
              )}
            </div>

            {/* Type filter + pagination info */}
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'web', 'youtube', 'file'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-all duration-200 hover:scale-105 ${
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

              {/* Page indicator */}
              {filteredSources.length > PAGE_SIZE && (
                <span className="ml-auto text-xs text-zinc-600">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredSources.length)} of {filteredSources.length}
                </span>
              )}
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
                ) : textFilter ? (
                  <p>No sources match &quot;{textFilter}&quot;</p>
                ) : (
                  <p>No {filter} sources found.</p>
                )}
              </div>
            )}

            {pagedSources.map((s) => (
              <motion.div
                key={s.id}
                whileHover={{ scale: 1.005, y: -1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="group/source rounded-lg border border-zinc-800 transition-all duration-200 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20"
              >
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-zinc-200 transition-colors group-hover/source:text-zinc-100">{s.title}</h3>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 flex items-center gap-1 truncate text-xs text-zinc-500 hover:text-zinc-400"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{s.url}</span>
                      </a>
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
                <AnimatePresence>
                {expandedSourceId === s.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden border-t border-zinc-800 bg-zinc-900/50 p-4"
                  >
                    {loadingDetail ? (
                      <div className="flex items-center gap-2 text-sm text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading content...
                      </div>
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

                        {/* Content display — generous height instead of max-h-96 */}
                        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
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
                  </motion.div>
                )}
                </AnimatePresence>
              </motion.div>
            ))}

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={() => goPage(page - 1)}
                  disabled={page === 0}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  // Show pages near current page
                  let p: number;
                  if (totalPages <= 7) {
                    p = i;
                  } else if (page < 4) {
                    p = i;
                  } else if (page > totalPages - 5) {
                    p = totalPages - 7 + i;
                  } else {
                    p = page - 3 + i;
                  }
                  return (
                    <button
                      key={p}
                      onClick={() => goPage(p)}
                      className={`min-w-[28px] rounded px-1.5 py-0.5 text-xs transition-colors ${
                        page === p
                          ? 'bg-blue-600/20 text-blue-400 font-medium'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {p + 1}
                    </button>
                  );
                })}
                <button
                  onClick={() => goPage(page + 1)}
                  disabled={page >= totalPages - 1}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
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
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 placeholder-zinc-500 transition-all duration-200 focus:border-blue-500 focus:outline-none focus:shadow-[0_0_12px_rgba(59,130,246,0.15)] focus:ring-1 focus:ring-blue-500/30"
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="group/sbtn shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-blue-500 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/20 disabled:opacity-50"
              >
                {loading ? '...' : 'Search'}
              </button>
            </div>

            <div className="space-y-3">
              {searchResults.length === 0 && searchQuery && !loading && (
                <p className="py-8 text-center text-sm text-zinc-500">No results found.</p>
              )}
              {searchResults.map((r, i) => (
                <motion.div
                  key={i}
                  whileHover={{ scale: 1.005, y: -1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  className="group/sr rounded-lg border border-zinc-800 p-4 transition-all duration-200 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="min-w-0 truncate text-xs text-zinc-500 transition-colors group-hover/sr:text-zinc-400">{r.source}</span>
                    <span className="ml-2 shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 transition-colors group-hover/sr:bg-blue-500/10 group-hover/sr:text-blue-400">
                      score: {r.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="break-words text-sm text-zinc-300 transition-colors group-hover/sr:text-zinc-200">{r.text.slice(0, 300)}{r.text.length > 300 ? '...' : ''}</p>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
