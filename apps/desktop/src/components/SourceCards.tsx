import { useState } from 'react';
import { ExternalLink, ChevronDown, ChevronUp, Globe } from 'lucide-react';
import type { SearchSourceUI } from '../stores/chatStore.js';

const TRUST_TONES: Record<string, string> = {
  high: 'border-emerald-500/18 bg-emerald-500/8 text-emerald-300/85',
  medium: 'border-amber-500/18 bg-amber-500/8 text-amber-300/85',
  low: 'border-zinc-700/70 bg-zinc-800/70 text-zinc-300/85',
  untrusted: 'border-rose-500/18 bg-rose-500/8 text-rose-300/85',
};

interface SourceCardsProps {
  sources: SearchSourceUI[];
  confidence?: number;
  /** chips = compact horizontal favicon row (top of message); list = expandable numbered list */
  variant?: 'chips' | 'list';
}

/** Compact favicon chip — shown in the horizontal row at top of research answers */
function SourceChip({ source, index }: { source: SearchSourceUI; index: number }) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const label = source.domain.replace(/^www\./, '');

  return (
    <div className="relative flex-shrink-0">
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
        className="group/chip flex items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-400 transition-all hover:border-zinc-600/80 hover:bg-zinc-800/70 hover:text-zinc-200"
        aria-label={`Source ${index + 1}: ${source.title || label}`}
      >
        <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
          {source.favicon ? (
            <img
              src={source.favicon}
              alt=""
              className="h-3.5 w-3.5 rounded-sm"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <span className="text-[9px] font-bold uppercase text-zinc-500">{label.slice(0, 1)}</span>
          )}
        </span>
        <span className="max-w-[80px] truncate font-medium">{label}</span>
        <span className="rounded-md bg-zinc-800/80 px-1 py-px text-[9px] font-semibold text-zinc-500">{index + 1}</span>
      </a>

      {tooltipVisible && (
        <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-64 animate-in fade-in slide-in-from-top-1 duration-100">
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-950/96 p-3 shadow-[0_18px_48px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            <p className="mb-1 line-clamp-2 text-[12px] font-medium leading-5 text-zinc-100">{source.title || label}</p>
            {source.snippet && (
              <p className="line-clamp-3 text-[11px] leading-5 text-zinc-400">{source.snippet}</p>
            )}
            <span className="mt-2 inline-flex items-center gap-1 text-[10px] text-zinc-600">
              <ExternalLink className="h-2.5 w-2.5" />
              {label}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Horizontal chip row — rendered above the answer text (Perplexity-style) */
function SourceChipRow({ sources, confidence }: { sources: SearchSourceUI[]; confidence?: number }) {
  const visible = sources.slice(0, 5);
  const overflow = Math.max(0, sources.length - 5);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
        <Globe className="h-3 w-3" />
        Grounded in {sources.length} source{sources.length === 1 ? '' : 's'}
      </span>
      <div className="h-3 w-px bg-zinc-800" />
      {visible.map((src, i) => (
        <SourceChip key={`${src.domain}-${i}`} source={src} index={i} />
      ))}
      {overflow > 0 && (
        <span className="rounded-md border border-zinc-800/60 bg-zinc-900/40 px-2 py-1 text-[11px] text-zinc-600">
          +{overflow}
        </span>
      )}
      {confidence !== undefined && (
        <span
          className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
            confidence >= 0.7
              ? 'bg-emerald-500/10 text-emerald-400'
              : confidence >= 0.4
                ? 'bg-amber-500/10 text-amber-400'
                : 'bg-zinc-800/60 text-zinc-500'
          }`}
          title={`Search confidence: ${Math.round(confidence * 100)}%`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${
            confidence >= 0.7 ? 'bg-emerald-400' : confidence >= 0.4 ? 'bg-amber-400' : 'bg-zinc-600'
          }`} />
          {Math.round(confidence * 100)}%
        </span>
      )}
    </div>
  );
}

/** Numbered source list — rendered below the answer text (expandable) */
function SourceList({ sources, confidence }: { sources: SearchSourceUI[]; confidence?: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sources : sources.slice(0, 3);
  const hiddenCount = Math.max(0, sources.length - visible.length);
  const confidenceLabel = confidence !== undefined ? `${Math.round(confidence * 100)}% confidence` : null;

  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-zinc-500">
        <span className="font-semibold uppercase tracking-[0.18em] text-zinc-400">Grounded in {sources.length} source{sources.length === 1 ? '' : 's'}</span>
        {confidenceLabel && <span className="text-zinc-600">{confidenceLabel}</span>}
      </div>

      <div className="space-y-0.5">
        {visible.map((source, index) => {
          const trustTone = TRUST_TONES[source.trustTier] ?? TRUST_TONES.low;
          const label = source.domain.replace(/^www\./, '');
          return (
            <a
              key={`${source.domain}-${index}`}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/source flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors duration-150 hover:bg-zinc-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700/60"
            >
              <div className="flex flex-shrink-0 items-center gap-2">
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900/80 text-[9px] font-bold text-zinc-500 ring-1 ring-zinc-800/80">
                  {index + 1}
                </span>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800/80 bg-zinc-900/70">
                  {source.favicon ? (
                    <img
                      src={source.favicon}
                      alt=""
                      className="h-4 w-4 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <span className="text-[10px] font-bold uppercase text-zinc-500">{label.slice(0, 1)}</span>
                  )}
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
                <span className={`rounded-md border px-1.5 py-px text-[9px] font-medium ${trustTone}`}>
                    {source.trustTier}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-5 text-zinc-300 transition-colors group-hover/source:text-zinc-100">
                  {source.title}
                </p>
                {source.snippet && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-zinc-600 transition-colors group-hover/source:text-zinc-500">
                    {source.snippet}
                  </p>
                )}
              </div>

              <ExternalLink className="mt-1 h-3 w-3 flex-shrink-0 text-zinc-700 transition-colors group-hover/source:text-zinc-400" />
            </a>
          );
        })}
      </div>

      {sources.length > 3 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-800/60 bg-zinc-900/30 py-1.5 text-[11px] text-zinc-500 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-300"
        >
          {expanded
            ? <><ChevronUp className="h-3 w-3" /> Collapse</>
            : <><ChevronDown className="h-3 w-3" /> {hiddenCount} more source{hiddenCount === 1 ? '' : 's'}</>
          }
        </button>
      )}
    </section>
  );
}

export function SourceCards({ sources, confidence, variant = 'list' }: SourceCardsProps) {
  if (sources.length === 0) return null;
  return variant === 'chips'
    ? <SourceChipRow sources={sources} confidence={confidence} />
    : <SourceList sources={sources} confidence={confidence} />;
}
