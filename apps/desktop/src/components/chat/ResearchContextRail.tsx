import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, X, Layers } from 'lucide-react';
import type { SearchSourceUI } from '../../stores/chatStore.js';

/**
 * ResearchContextRail — the right-hand "sources slice" that surfaces
 * retrieval sources backing the latest Vai answer.
 *
 * Design: vertical sliced rail. No nested rounded container; the rail is
 * a flat column with a single accent edge and hairline dividers between
 * each source, giving it a "stacked slices" feel instead of the old
 * "rounded box inside a rounded panel" aesthetic.
 */

function confidenceBandForScore(score: number): { label: string; className: string; dotClass: string } {
  if (score >= 0.8) return { label: 'Strong', className: 'text-emerald-300', dotClass: 'bg-emerald-400' };
  if (score >= 0.55) return { label: 'Solid', className: 'text-sky-300', dotClass: 'bg-sky-400' };
  if (score >= 0.35) return { label: 'Mixed', className: 'text-amber-300', dotClass: 'bg-amber-400' };
  return { label: 'Thin', className: 'text-zinc-400', dotClass: 'bg-zinc-500' };
}

function ResearchContextRailContent({
  question,
  sources,
  onClose,
  showCloseButton = false,
}: {
  question: string;
  sources: readonly SearchSourceUI[];
  onClose?: () => void;
  showCloseButton?: boolean;
}) {
  const sourceDomains = Array.from(
    new Set(sources.map((source) => source.domain.replace(/^www\./, ''))),
  );
  const avgTrust =
    sources.length > 0
      ? sources.reduce((sum, s) => sum + (s.trustScore ?? 0), 0) / sources.length
      : 0;
  const confidenceBand = confidenceBandForScore(avgTrust);

  return (
    <div
      data-research-sidebar-slice="root"
      className="relative flex h-full max-h-[calc(100dvh-2.5rem)] min-h-0 w-full flex-col overflow-hidden text-zinc-200"
    >
      {/* Left accent edge — the "slice" marker */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-violet-500/50 via-violet-500/20 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-4 h-10 w-[3px] rounded-r-full bg-gradient-to-b from-violet-400/80 to-violet-500/30"
      />

      {/* Header strip */}
      <div className="flex items-start justify-between gap-3 py-4 pl-5 pr-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-500">
            <Layers className="h-3 w-3" />
            <span>Sources</span>
            <span className={`ml-1 inline-flex items-center gap-1.5 text-[10px] font-medium normal-case tracking-normal ${confidenceBand.className}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${confidenceBand.dotClass}`} />
              {confidenceBand.label}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-5 text-zinc-300">
            <span className="text-zinc-500">Trail for </span>
            <span className="text-zinc-100">{question}</span>
          </p>
          <div className="mt-2 text-[10px] text-zinc-500">
            {sources.length} result{sources.length === 1 ? '' : 's'}
            {sourceDomains.length > 0 && (
              <>
                <span className="mx-1.5 text-zinc-700">·</span>
                <span className="truncate">{sourceDomains.slice(0, 3).join(' · ')}</span>
                {sourceDomains.length > 3 && <span className="text-zinc-600"> +{sourceDomains.length - 3}</span>}
              </>
            )}
          </div>
        </div>

        {showCloseButton && onClose && (
          <button
            type="button"
            onClick={onClose}
            data-research-sidebar-close="button"
            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900/60 hover:text-zinc-200"
            aria-label="Close sources sidebar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Divided list of source "slices" */}
      <div className="flex-1 overflow-y-auto pl-5 pr-3 pb-4">
        <ul className="divide-y divide-zinc-900/70">
          {sources.slice(0, 10).map((source, index) => (
            <li key={`${source.url}-${index}`}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                data-research-source-item={index + 1}
                className="group/slice relative flex items-start gap-3 py-3 pr-2 transition-colors hover:bg-zinc-900/35"
              >
                {/* Number + favicon stack on left */}
                <div className="flex flex-shrink-0 flex-col items-center gap-1.5 pt-0.5">
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-zinc-500 group-hover/slice:text-zinc-300">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900/80 ring-1 ring-zinc-800/80">
                    {source.favicon ? (
                      <img
                        src={source.favicon}
                        alt=""
                        className="h-3 w-3 rounded-sm"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-[9px] font-semibold uppercase text-zinc-500">
                        {source.domain.slice(0, 1)}
                      </span>
                    )}
                  </span>
                </div>

                {/* Body */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                    <span className="truncate font-medium text-zinc-300">
                      {source.domain.replace(/^www\./, '')}
                    </span>
                    <span className="flex h-1 w-1 flex-shrink-0 rounded-full bg-zinc-700" />
                    <span className="flex-shrink-0 text-zinc-500">{source.trustTier}</span>
                    <span className="ml-auto font-mono tabular-nums text-zinc-600">
                      {Math.round(source.trustScore * 100)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-5 text-zinc-100 transition-colors group-hover/slice:text-white">
                    {source.title}
                  </p>
                  {source.snippet && (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-[1.45] text-zinc-500 transition-colors group-hover/slice:text-zinc-400">
                      {source.snippet}
                    </p>
                  )}
                </div>

                <ExternalLink className="mt-1 h-3 w-3 flex-shrink-0 text-zinc-700 transition-colors group-hover/slice:text-zinc-300" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ResearchContextRail({
  question,
  sources,
  isOpen,
  onClose,
}: {
  question: string;
  sources: readonly SearchSourceUI[];
  isOpen: boolean;
  onClose: () => void;
}) {
  if (sources.length === 0) return null;

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.button
            key="research-rail-backdrop"
            type="button"
            aria-label="Close sources sidebar"
            onClick={onClose}
            className="fixed inset-0 z-30 bg-black/55 backdrop-blur-[2px] xl:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.aside
            key="research-rail-mobile"
            data-research-sidebar="panel"
            data-state="open"
            className="fixed inset-y-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] border-l border-zinc-800/70 bg-zinc-950/95 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-md xl:hidden"
            initial={{ opacity: 0, x: 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 36 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.7 }}
          >
            <ResearchContextRailContent
              question={question}
              sources={sources}
              onClose={onClose}
              showCloseButton
            />
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.aside
            key="research-rail-desktop"
            data-research-sidebar="panel"
            data-state="open"
            className="hidden xl:sticky xl:top-4 xl:block xl:h-[calc(100dvh-2rem)] xl:self-start xl:border-l xl:border-zinc-800/70 xl:bg-transparent"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.6 }}
          >
            <ResearchContextRailContent question={question} sources={sources} />
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
