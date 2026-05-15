import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import { ExternalLink, Layers, X } from 'lucide-react';
import type { ChatMessage, SearchSourceUI } from '../../stores/chatStore.js';

/**
 * Aggregate every source used by every assistant message in the current
 * conversation. Deduplicate by URL. Track which message indices each source
 * appeared in so a reader can trace a fact back to the answer that used it.
 */
export interface AggregatedSource extends SearchSourceUI {
  messageIndices: number[];
  firstSeenIndex: number;
}

export function aggregateConversationSources(messages: readonly ChatMessage[]): AggregatedSource[] {
  const byUrl = new Map<string, AggregatedSource>();
  messages.forEach((msg, idx) => {
    if (msg.role !== 'assistant' || !msg.sources?.length) return;
    for (const src of msg.sources) {
      const key = src.url || `${src.domain}::${src.title}`;
      const existing = byUrl.get(key);
      if (existing) {
        if (!existing.messageIndices.includes(idx)) existing.messageIndices.push(idx);
      } else {
        byUrl.set(key, { ...src, messageIndices: [idx], firstSeenIndex: idx });
      }
    }
  });
  return Array.from(byUrl.values()).sort((a, b) => a.firstSeenIndex - b.firstSeenIndex);
}

function trustBand(score: number): { label: string; dot: string; text: string } {
  if (score >= 0.8) return { label: 'Strong', dot: 'bg-emerald-400', text: 'text-emerald-300' };
  if (score >= 0.55) return { label: 'Solid', dot: 'bg-sky-400', text: 'text-sky-300' };
  if (score >= 0.35) return { label: 'Mixed', dot: 'bg-amber-400', text: 'text-amber-300' };
  return { label: 'Thin', dot: 'bg-zinc-500', text: 'text-zinc-400' };
}

interface Props {
  messages: readonly ChatMessage[];
  isOpen: boolean;
  onClose: () => void;
  onJumpToMessage?: (messageIndex: number) => void;
}

/**
 * Right-edge layout sidebar (not floating). Grows from right to left as it
 * opens. Sits as a sibling of the chat column inside ChatWindow's flex row,
 * so it pushes the chat content rather than overlaying it.
 */
export function ConversationSourcesSidebar({ messages, isOpen, onClose, onJumpToMessage }: Props) {
  const aggregated = useMemo(() => aggregateConversationSources(messages), [messages]);
  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const s of aggregated) set.add(s.domain.replace(/^www\./, ''));
    return Array.from(set);
  }, [aggregated]);

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.aside
          key="conversation-sources-sidebar"
          data-conversation-sources="panel"
          data-state="open"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 'min(22rem, 32vw)', opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 34, mass: 0.7 }}
          className="relative flex h-full min-h-0 flex-shrink-0 flex-col overflow-hidden border-l border-zinc-800/70 bg-zinc-950/85 backdrop-blur-md"
        >
          <div className="flex items-start justify-between gap-3 border-b border-zinc-900/80 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                <Layers className="h-3 w-3" />
                <span>Sources in this chat</span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-[18px] font-semibold tabular-nums text-zinc-100">{aggregated.length}</span>
                <span className="text-[11px] text-zinc-500">
                  {aggregated.length === 1 ? 'source' : 'sources'}
                  {domains.length > 0 && (
                    <>
                      <span className="mx-1.5 text-zinc-700">·</span>
                      {domains.length} {domains.length === 1 ? 'domain' : 'domains'}
                    </>
                  )}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              data-conversation-sources-close
              aria-label="Close sources sidebar"
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900/60 hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {aggregated.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900/70 text-zinc-600">
                <Layers className="h-4 w-4" />
              </div>
              <p className="text-[12px] font-medium text-zinc-300">No sources yet</p>
              <p className="text-[11px] leading-5 text-zinc-500">
                Ask Vai a research question and any sources used to ground the answer will collect here for the whole chat.
              </p>
            </div>
          ) : (
            <ul className="flex-1 divide-y divide-zinc-900/70 overflow-y-auto px-3 py-2">
              {aggregated.map((src, idx) => {
                const band = trustBand(src.trustScore ?? 0);
                const label = src.domain.replace(/^www\./, '');
                return (
                  <li key={src.url || `${src.domain}-${idx}`}>
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-conversation-source-item={idx + 1}
                      className="group/src flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-zinc-900/45"
                    >
                      <div className="flex flex-shrink-0 flex-col items-center gap-1 pt-0.5">
                        <span className="font-mono text-[10px] font-semibold tabular-nums text-zinc-500 group-hover/src:text-zinc-300">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900/80 ring-1 ring-zinc-800/80">
                          {src.favicon ? (
                            <img
                              src={src.favicon}
                              alt=""
                              className="h-3 w-3 rounded-sm"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          ) : (
                            <span className="text-[9px] font-bold uppercase text-zinc-500">{label.slice(0, 1)}</span>
                          )}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                          <span className="truncate font-medium text-zinc-300">{label}</span>
                          <span className="flex h-1 w-1 flex-shrink-0 rounded-full bg-zinc-700" />
                          <span className={`inline-flex flex-shrink-0 items-center gap-1 normal-case tracking-normal ${band.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${band.dot}`} />
                            {band.label}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-5 text-zinc-100 transition-colors group-hover/src:text-white">
                          {src.title}
                        </p>
                        {src.snippet && (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-[1.45] text-zinc-500 transition-colors group-hover/src:text-zinc-400">
                            {src.snippet}
                          </p>
                        )}
                        {onJumpToMessage && src.messageIndices.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {src.messageIndices.slice(0, 4).map((mi) => (
                              <button
                                key={mi}
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onJumpToMessage(mi); }}
                                className="rounded-md border border-zinc-800/80 bg-zinc-900/40 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200"
                                title={`Jump to answer #${Math.floor(mi / 2) + 1}`}
                              >
                                Used in #{Math.floor(mi / 2) + 1}
                              </button>
                            ))}
                            {src.messageIndices.length > 4 && (
                              <span className="text-[10px] text-zinc-600">+{src.messageIndices.length - 4}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <ExternalLink className="mt-1 h-3 w-3 flex-shrink-0 text-zinc-700 transition-colors group-hover/src:text-zinc-300" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
