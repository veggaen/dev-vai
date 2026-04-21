import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, X } from 'lucide-react';
import type { SearchSourceUI } from '../../stores/chatStore.js';

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
  const sourceDomains = Array.from(new Set(
    sources.map((source) => source.domain.replace(/^www\./, '')),
  )).slice(0, 3);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-zinc-800/70 bg-zinc-950/80 shadow-[0_28px_120px_rgba(0,0,0,0.38)] backdrop-blur-xl">
      <div className="border-b border-zinc-800/70 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              <span className="rounded-full border border-zinc-800/80 bg-zinc-900/70 px-2.5 py-1 font-medium text-zinc-200">
                {sources.length} source{sources.length === 1 ? '' : 's'}
              </span>
              <span className="uppercase tracking-[0.2em] text-zinc-600">Research context</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-200">
              Source trail for <span className="text-zinc-400">{question}</span>
            </p>
            {sourceDomains.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {sourceDomains.map((domain) => (
                  <span
                    key={domain}
                    className="rounded-full border border-zinc-800/80 bg-zinc-900/60 px-2 py-1 text-[10px] font-medium text-zinc-400"
                  >
                    {domain}
                  </span>
                ))}
              </div>
            )}
          </div>

          {showCloseButton && onClose && (
            <button
              type="button"
              onClick={onClose}
              data-research-sidebar-close="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-800/80 bg-zinc-900/60 text-zinc-500 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200"
              aria-label="Close sources sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
        {sources.slice(0, 10).map((source, index) => (
          <a
            key={`${source.url}-${index}`}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            data-research-source-item={index + 1}
            className="group/context block rounded-[1.35rem] border border-zinc-800/70 bg-zinc-950/35 px-3.5 py-3.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/50"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex flex-shrink-0 items-center gap-2">
                <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-zinc-800/80 bg-zinc-900/70 px-1.5 text-[10px] font-semibold text-zinc-300">
                  {index + 1}
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-800/80 bg-zinc-900/80">
                  {source.favicon ? (
                    <img
                      src={source.favicon}
                      alt=""
                      className="h-4 w-4 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <span className="text-[10px] font-semibold uppercase text-zinc-500">
                      {source.domain.slice(0, 1)}
                    </span>
                  )}
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  <span className="truncate text-zinc-400">{source.domain.replace(/^www\./, '')}</span>
                  <span className="rounded-full border border-zinc-800/70 px-1.5 py-0.5 text-[9px] text-zinc-600">
                    {source.trustTier}
                  </span>
                  <span className="rounded-full border border-zinc-800/70 px-1.5 py-0.5 text-[9px] text-zinc-600">
                    {Math.round(source.trustScore * 100)}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-5 text-zinc-100 transition-colors group-hover/context:text-white">
                  {source.title}
                </p>
                {source.snippet && (
                  <p className="mt-1.5 line-clamp-3 text-[11px] leading-5 text-zinc-500 transition-colors group-hover/context:text-zinc-400">
                    {source.snippet}
                  </p>
                )}
              </div>

              <ExternalLink className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-zinc-700 transition-colors group-hover/context:text-zinc-300" />
            </div>
          </a>
        ))}
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
            className="fixed inset-x-4 bottom-24 top-20 z-40 xl:hidden"
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
            className="hidden xl:block xl:sticky xl:top-6"
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
