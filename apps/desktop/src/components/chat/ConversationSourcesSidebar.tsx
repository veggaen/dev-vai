import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import { ExternalLink, Layers, Sparkles, X } from 'lucide-react';
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
  return { label: 'Thin', dot: 'bg-[color:var(--color-muted)]', text: 'text-[color:var(--color-muted)]' };
}

interface Props {
  messages: readonly ChatMessage[];
  isOpen: boolean;
  onClose: () => void;
  onJumpToMessage?: (messageIndex: number) => void;
  /** Latest assistant message's follow-up suggestions. Rendered as a Related section. */
  relatedFollowUps?: readonly string[];
  onFollowUp?: (question: string) => void;
}

/**
 * Right-edge layout sidebar (not floating). Grows from right to left as it
 * opens. Sits as a sibling of the chat column inside ChatWindow's flex row,
 * so it pushes the chat content rather than overlaying it.
 */
export function ConversationSourcesSidebar({ messages, isOpen, onClose, onJumpToMessage, relatedFollowUps, onFollowUp }: Props) {
  const aggregated = useMemo(() => aggregateConversationSources(messages), [messages]);
  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const s of aggregated) set.add(s.domain.replace(/^www\./, ''));
    return Array.from(set);
  }, [aggregated]);
  const visibleFollowUps = useMemo(() => (relatedFollowUps ?? []).slice(0, 6), [relatedFollowUps]);
  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'assistant') return messages[i];
    }
    return null;
  }, [messages]);

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
          className="relative flex h-full min-h-0 flex-shrink-0 flex-col overflow-hidden border-l border-[color:var(--border)] bg-[color:var(--panel)]/95 backdrop-blur-md"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--color-subheader)]">
                <Layers className="h-3 w-3" />
                <span>Sources in this chat</span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-[18px] font-semibold tabular-nums text-[color:var(--fg)]">{aggregated.length}</span>
                <span className="text-[11px] text-[color:var(--color-muted)]">
                  {aggregated.length === 1 ? 'source' : 'sources'}
                  {domains.length > 0 && (
                    <>
                      <span className="mx-1.5 text-[color:var(--border)]">·</span>
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
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[color:var(--color-muted)] transition-colors hover:bg-[color:var(--panel-bg-muted)] hover:text-[color:var(--fg)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {visibleFollowUps.length > 0 && (
            <div data-conversation-sources-related className="border-b border-[color:var(--border)] px-4 py-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--color-subheader)]">
                <Sparkles className="h-3 w-3" />
                <span>Related</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {visibleFollowUps.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onFollowUp?.(q)}
                    data-conversation-related-followup={i + 1}
                    className="group/fu flex w-full items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-2.5 py-2 text-left text-[12px] leading-[1.35] text-[color:var(--chat-body)] transition-colors hover:border-[color:var(--selection-border,var(--border))] hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]"
                  >
                    <span className="line-clamp-2 flex-1">{q}</span>
                    <span className="flex-shrink-0 text-[color:var(--color-muted)] transition-colors group-hover/fu:text-[color:var(--fg)]">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {aggregated.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--panel-bg-muted)] text-[color:var(--color-muted)]">
                <Layers className="h-4 w-4" />
              </div>
              <p className="text-[12px] font-medium text-[color:var(--fg)]">No sources yet</p>
              <p className="text-[11px] leading-5 text-[color:var(--color-muted)]">
                {lastAssistant
                  ? 'This answer was drawn from model knowledge. Web sources appear here when Vai searches to ground a reply.'
                  : 'Ask Vai a research question and any sources used to ground the answer will collect here for the whole chat.'}
              </p>
            </div>
          ) : (
            <ul className="flex-1 divide-y divide-[color:var(--border)] overflow-y-auto px-3 py-2">
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
                      className="group/src flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-[color:var(--panel-bg-muted)]"
                    >
                      <div className="flex flex-shrink-0 flex-col items-center gap-1 pt-0.5">
                        <span className="font-mono text-[10px] font-semibold tabular-nums text-[color:var(--color-muted)] group-hover/src:text-[color:var(--fg)]">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--panel-bg-muted)] ring-1 ring-[color:var(--border)]">
                          {src.favicon ? (
                            <img
                              src={src.favicon}
                              alt=""
                              className="h-3 w-3 rounded-sm"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          ) : (
                            <span className="text-[9px] font-bold uppercase text-[color:var(--color-muted)]">{label.slice(0, 1)}</span>
                          )}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-muted)]">
                          <span className="truncate font-medium text-[color:var(--chat-body)]">{label}</span>
                          <span className="flex h-1 w-1 flex-shrink-0 rounded-full bg-[color:var(--border)]" />
                          <span className={`inline-flex flex-shrink-0 items-center gap-1 normal-case tracking-normal ${band.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${band.dot}`} />
                            {band.label}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-5 text-[color:var(--fg)] transition-colors group-hover/src:text-[color:var(--accent-text,var(--fg))]">
                          {src.title}
                        </p>
                        {src.snippet && (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-[1.45] text-[color:var(--color-muted)] transition-colors group-hover/src:text-[color:var(--chat-body)]">
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
                                className="rounded-md border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--color-muted)] transition-colors hover:border-[color:var(--selection-border,var(--border))] hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]"
                                title={`Jump to answer #${Math.floor(mi / 2) + 1}`}
                              >
                                Used in #{Math.floor(mi / 2) + 1}
                              </button>
                            ))}
                            {src.messageIndices.length > 4 && (
                              <span className="text-[10px] text-[color:var(--color-muted)]">+{src.messageIndices.length - 4}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <ExternalLink className="mt-1 h-3 w-3 flex-shrink-0 text-[color:var(--color-muted)] transition-colors group-hover/src:text-[color:var(--fg)]" />
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
