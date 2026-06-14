import { useCallback, useEffect, useState } from 'react';
import { Brain, Sparkles } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';

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

/** Owner-only ingest/retrieval diagnostics — belongs in Settings → Engine, not the user Knowledge panel. */
export function KnowledgeEngineMetrics() {
  const [diagnostics, setDiagnostics] = useState<KnowledgeDiagnostics | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/ingest/metrics');
      if (res.ok) setDiagnostics(await res.json() as KnowledgeDiagnostics);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!diagnostics) {
    return (
      <p className="text-[11px] text-[color:var(--color-muted)]">
        Memory metrics unavailable — runtime may be offline.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[color:var(--fg)]">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          Ingest health
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <Metric label="Last 24h" value={String(diagnostics.ingest.ingestedLast24h)} />
          <Metric label="Updated" value={String(diagnostics.ingest.updatedSources)} />
          <Metric label="Duplicate rate" value={`${Math.round(diagnostics.ingest.duplicateRate * 100)}%`} />
          <Metric label="Low confidence" value={`${Math.round(diagnostics.retrieval.lowConfidenceRate * 100)}%`} />
        </div>
        {diagnostics.ingest.domainHotspots.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {diagnostics.ingest.domainHotspots.slice(0, 6).map((d) => (
              <span key={d.domain} className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted)]">
                {d.domain} · {d.count}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[color:var(--fg)]">
          <Brain className="h-3.5 w-3.5 text-violet-400" />
          Retrieval confidence
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <Metric label="Queries" value={String(diagnostics.retrieval.totalQueries)} />
          <Metric label="Avg top score" value={diagnostics.retrieval.averageTopScore.toFixed(2)} />
        </div>
        {diagnostics.retrieval.recentTrend.length > 0 && (
          <div className="mt-2 flex items-end gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-2">
            {diagnostics.retrieval.recentTrend.slice(-12).map((point, index) => (
              <div key={`${point.at}-${index}`} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={`w-full rounded-sm ${point.lowConfidence ? 'bg-amber-500/70' : 'bg-emerald-500/70'}`}
                  style={{ height: `${Math.max(6, Math.round(point.topScore * 36))}px` }}
                  title={`${Math.round(point.topScore * 100)}% · ${point.resultCount} results`}
                />
              </div>
            ))}
          </div>
        )}
        {diagnostics.retrieval.recentLowConfidence.length > 0 && (
          <ul className="mt-2 list-none space-y-1">
            {diagnostics.retrieval.recentLowConfidence.slice(0, 4).map((item, index) => (
              <li key={`${item.at}-${index}`} className="rounded-md border border-amber-500/15 bg-amber-500/5 px-2 py-1.5 text-[10px] text-[color:var(--color-muted)]">
                <div className="line-clamp-2 text-[color:var(--fg)]">{item.query}</div>
                score {item.topScore.toFixed(2)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-[color:var(--panel)] px-2 py-1">
      <div className="text-[color:var(--color-muted)]">{label}</div>
      <div className="text-sm font-medium text-[color:var(--fg)]">{value}</div>
    </div>
  );
}
