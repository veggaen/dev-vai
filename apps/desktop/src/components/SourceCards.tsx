/**
 * SourceCards — Perplexity-style source display with hovercards.
 *
 * Shows a compact row of source favicons + count badge above the answer.
 * Each source has a hovercard with title, snippet, trust indicator, and
 * navigation buttons. Sources can be expanded into a full grid view.
 *
 * Inspired by Perplexity's source citations: compact when collapsed,
 * rich when hovered, informative when expanded.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { ExternalLink, ChevronLeft, ChevronRight, Shield, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { SearchSourceUI } from '../stores/chatStore.js';

// ── Trust badge colors ──

const TRUST_CONFIG: Record<string, { icon: typeof Shield; color: string; label: string }> = {
  high: { icon: ShieldCheck, color: 'text-emerald-400', label: 'Trusted' },
  medium: { icon: Shield, color: 'text-amber-400', label: 'Moderate' },
  low: { icon: ShieldAlert, color: 'text-orange-400', label: 'Low trust' },
  untrusted: { icon: ShieldAlert, color: 'text-red-400', label: 'Untrusted' },
};

// ── Hovercard for a single source ──

interface HovercardProps {
  source: SearchSourceUI;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  currentIndex: number;
  total: number;
}

function SourceHovercard({ source, onClose, onPrev, onNext, currentIndex, total }: HovercardProps) {
  const trust = TRUST_CONFIG[source.trustTier] ?? TRUST_CONFIG.low;
  const TrustIcon = trust.icon;

  return (
    <div className="absolute bottom-full left-0 z-50 mb-2 w-80 animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/95 shadow-2xl shadow-black/40 backdrop-blur-sm">
        {/* Header with close + navigation */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={source.favicon}
              alt=""
              className="h-4 w-4 rounded-sm"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="truncate text-xs font-medium text-zinc-300">{source.domain}</span>
            <TrustIcon className={`h-3 w-3 flex-shrink-0 ${trust.color}`} />
          </div>
          <div className="flex items-center gap-1">
            {total > 1 && (
              <>
                <button
                  onClick={onPrev ?? undefined}
                  disabled={!onPrev}
                  className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-[10px] tabular-nums text-zinc-600">
                  {currentIndex + 1}/{total}
                </span>
                <button
                  onClick={onNext ?? undefined}
                  disabled={!onNext}
                  className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="rounded p-0.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-3">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group/link mb-2 block"
          >
            <h4 className="text-sm font-medium leading-snug text-zinc-200 group-hover/link:text-blue-400 transition-colors">
              {source.title}
            </h4>
          </a>
          <p className="text-[12px] leading-relaxed text-zinc-500 line-clamp-4">
            {source.snippet}
          </p>
        </div>

        {/* Footer with trust info + open link */}
        <div className="flex items-center justify-between border-t border-zinc-800/80 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <TrustIcon className={`h-3 w-3 ${trust.color}`} />
            <span className={`text-[10px] font-medium ${trust.color}`}>{trust.label}</span>
            <span className="text-[10px] text-zinc-700">
              ({(source.trustScore * 100).toFixed(0)}%)
            </span>
          </div>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            Open <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Main SourceCards component ──

interface SourceCardsProps {
  sources: SearchSourceUI[];
  confidence?: number;
}

export function SourceCards({ sources, confidence }: SourceCardsProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback((index: number) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setHoveredIndex(index), 200);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setHoveredIndex(null), 300);
  }, []);

  // Close hovercard on outside click
  useEffect(() => {
    if (hoveredIndex === null) return;
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setHoveredIndex(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [hoveredIndex]);

  const navigate = useCallback((direction: -1 | 1) => {
    setHoveredIndex((prev) => {
      if (prev === null) return null;
      const next = prev + direction;
      return next >= 0 && next < sources.length ? next : prev;
    });
  }, [sources.length]);

  if (sources.length === 0) return null;

  // Collapsed: show favicon row + count badge
  // Expanded: show full card grid
  return (
    <div ref={cardRef} className="mb-3">
      {/* Collapsed source row */}
      <div className="flex items-center gap-2">
        <div
          className="relative flex items-center"
          onMouseLeave={handleMouseLeave}
        >
          {/* Stacked favicons (collapsed) */}
          {!expanded && (
            <div className="flex items-center">
              {sources.slice(0, 4).map((source, i) => (
                <button
                  key={`${source.domain}-${i}`}
                  className="relative -ml-1 first:ml-0 h-6 w-6 rounded-full border-2 border-zinc-900 bg-zinc-800 transition-transform hover:z-10 hover:scale-110 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                  onMouseEnter={() => handleMouseEnter(i)}
                  onClick={() => setHoveredIndex(hoveredIndex === i ? null : i)}
                  title={source.title}
                >
                  <img
                    src={source.favicon}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect fill="%233f3f46" width="32" height="32" rx="16"/><text x="16" y="21" text-anchor="middle" fill="%23a1a1aa" font-size="16">${source.domain[0]?.toUpperCase() ?? '?'}</text></svg>`;
                    }}
                  />
                </button>
              ))}
              {sources.length > 4 && (
                <button
                  className="-ml-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 bg-zinc-800 text-[9px] font-bold text-zinc-400 transition-transform hover:scale-110"
                  onClick={() => setExpanded(true)}
                >
                  +{sources.length - 4}
                </button>
              )}
            </div>
          )}

          {/* Hovercard */}
          {hoveredIndex !== null && sources[hoveredIndex] && (
            <SourceHovercard
              source={sources[hoveredIndex]}
              onClose={() => setHoveredIndex(null)}
              onPrev={hoveredIndex > 0 ? () => navigate(-1) : null}
              onNext={hoveredIndex < sources.length - 1 ? () => navigate(1) : null}
              currentIndex={hoveredIndex}
              total={sources.length}
            />
          )}
        </div>

        {/* Source count + expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 rounded-full border border-zinc-800/80 bg-zinc-900/50 px-2 py-0.5 text-[11px] text-zinc-500 transition-all hover:border-zinc-700 hover:text-zinc-300"
        >
          {sources.length} source{sources.length !== 1 ? 's' : ''}
        </button>

        {/* Confidence indicator */}
        {confidence !== undefined && (
          <div
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              confidence >= 0.7
                ? 'bg-emerald-500/10 text-emerald-400'
                : confidence >= 0.4
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-red-500/10 text-red-400'
            }`}
            title={`Confidence: ${(confidence * 100).toFixed(0)}%`}
          >
            <div
              className={`h-1.5 w-1.5 rounded-full ${
                confidence >= 0.7
                  ? 'bg-emerald-400'
                  : confidence >= 0.4
                    ? 'bg-amber-400'
                    : 'bg-red-400'
              }`}
            />
            {confidence >= 0.7 ? 'High' : confidence >= 0.4 ? 'Medium' : 'Low'} confidence
          </div>
        )}
      </div>

      {/* Expanded grid view */}
      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {sources.map((source, i) => {
            const trust = TRUST_CONFIG[source.trustTier] ?? TRUST_CONFIG.low;
            const TrustIcon = trust.icon;
            return (
              <a
                key={`${source.domain}-${i}`}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group/card flex flex-col gap-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/50 p-2.5 transition-all hover:border-zinc-700/80 hover:bg-zinc-800/50"
              >
                <div className="flex items-center gap-2">
                  <img
                    src={source.favicon}
                    alt=""
                    className="h-4 w-4 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <span className="truncate text-[11px] font-medium text-zinc-400 group-hover/card:text-zinc-200">
                    {source.domain}
                  </span>
                  <TrustIcon className={`ml-auto h-3 w-3 flex-shrink-0 ${trust.color}`} />
                </div>
                <p className="text-[11px] leading-snug text-zinc-500 line-clamp-2 group-hover/card:text-zinc-400">
                  {source.title}
                </p>
              </a>
            );
          })}
          <button
            onClick={() => setExpanded(false)}
            className="flex items-center justify-center rounded-lg border border-dashed border-zinc-800/60 p-2.5 text-[11px] text-zinc-600 transition-colors hover:border-zinc-700 hover:text-zinc-400"
          >
            Collapse
          </button>
        </div>
      )}
    </div>
  );
}
