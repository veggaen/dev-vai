import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useChatStore } from '../stores/chatStore.js';
import {
  Search,
  CaseSensitive,
  WholeWord,
  Regex,
  ChevronDown,
  ChevronRight,
  X,
  Replace,
  ReplaceAll,
} from 'lucide-react';

export type SearchLayer = 1 | 2 | 3;

const LAYER_LABELS: Record<SearchLayer, string> = {
  1: 'Chat only',
  2: 'Chat + Files',
  3: 'Chat + Files + Links',
};

interface SearchResult {
  conversationId: string;
  title: string;
  matchCount: number;
  snippet?: string;
}

interface SidebarSearchProps {
  onSelectConversation: (id: string) => void;
  onClose: () => void;
}

export function SidebarSearch({ onSelectConversation, onClose }: SidebarSearchProps) {
  const { conversations, messages: currentMessages, activeConversationId } = useChatStore();

  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [preserveCase, setPreserveCase] = useState(false);
  const [layer, setLayer] = useState<SearchLayer>(1);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close layer menu on outside click
  useEffect(() => {
    if (!showLayerMenu) return;
    const handle = (e: MouseEvent) => {
      if (layerRef.current && !layerRef.current.contains(e.target as Node)) setShowLayerMenu(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showLayerMenu]);

  // Build search pattern
  const buildMatcher = useCallback((): ((text: string) => number) | null => {
    if (!query.trim()) return null;

    try {
      let pattern: RegExp;
      if (useRegex) {
        pattern = new RegExp(query, matchCase ? 'g' : 'gi');
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordBoundary = wholeWord ? `\\b${escaped}\\b` : escaped;
        pattern = new RegExp(wordBoundary, matchCase ? 'g' : 'gi');
      }

      return (text: string) => {
        const matches = text.match(pattern);
        return matches ? matches.length : 0;
      };
    } catch {
      return null;
    }
  }, [query, matchCase, wholeWord, useRegex]);

  // Search results
  const results = useMemo((): SearchResult[] => {
    const matcher = buildMatcher();
    if (!matcher) return [];

    return conversations
      .map((conv) => {
        // Layer 1: search title only
        let totalMatches = matcher(conv.title);
        let snippet: string | undefined;

        // If this is the active conversation, also search message content
        if (conv.id === activeConversationId && (layer >= 1)) {
          for (const msg of currentMessages) {
            const count = matcher(msg.content);
            if (count > 0) {
              totalMatches += count;
              if (!snippet) {
                // Extract snippet around first match
                const idx = msg.content.search(
                  useRegex ? new RegExp(query, matchCase ? '' : 'i') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? '' : 'i')
                );
                if (idx >= 0) {
                  const start = Math.max(0, idx - 30);
                  const end = Math.min(msg.content.length, idx + query.length + 30);
                  snippet = (start > 0 ? '...' : '') + msg.content.slice(start, end) + (end < msg.content.length ? '...' : '');
                }
              }
            }
          }
        }

        // Title-only match for non-active conversations
        if (conv.id !== activeConversationId) {
          const titleCount = matcher(conv.title);
          if (titleCount > 0 && !snippet) {
            snippet = conv.title;
          }
        }

        return { conversationId: conv.id, title: conv.title, matchCount: totalMatches, snippet };
      })
      .filter((r) => r.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount);
  }, [conversations, currentMessages, activeConversationId, buildMatcher, query, matchCase, useRegex, layer]);

  const totalCount = results.reduce((sum, r) => sum + r.matchCount, 0);

  return (
    <div className="flex flex-col border-b border-zinc-800 bg-zinc-950">
      {/* Search input row */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-1">
        <button
          onClick={() => setShowReplace((v) => !v)}
          className="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="Toggle Replace"
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showReplace ? 'rotate-90' : ''}`} />
        </button>
        <div className="flex flex-1 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 focus-within:border-blue-500">
          <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Search chats..."
            className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-zinc-500 hover:text-zinc-300">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Replace input row */}
      {showReplace && (
        <div className="flex items-center gap-1 px-3 pb-1">
          {/* Spacer to align with search input */}
          <div className="w-[22px] shrink-0" />
          <div className="flex flex-1 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 focus-within:border-blue-500">
            <input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder="Replace..."
              className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none"
            />
            {replaceText && (
              <button onClick={() => setReplaceText('')} className="text-zinc-500 hover:text-zinc-300">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => {/* TODO: replace current match */}}
              disabled={!query || totalCount === 0}
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
              title="Replace (Ctrl+Shift+1)"
            >
              <Replace className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {/* TODO: replace all matches */}}
              disabled={!query || totalCount === 0}
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
              title="Replace All (Ctrl+Alt+Enter)"
            >
              <ReplaceAll className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Toggle buttons row */}
      <div className="flex items-center gap-1 px-3 py-1.5">
        <ToggleBtn active={matchCase} onClick={() => setMatchCase((v) => !v)} title="Match Case (Alt+C)">
          <CaseSensitive className="h-3.5 w-3.5" />
        </ToggleBtn>
        <ToggleBtn active={wholeWord} onClick={() => setWholeWord((v) => !v)} title="Match Whole Word (Alt+W)">
          <WholeWord className="h-3.5 w-3.5" />
        </ToggleBtn>
        <ToggleBtn active={useRegex} onClick={() => setUseRegex((v) => !v)} title="Use Regular Expression (Alt+R)">
          <Regex className="h-3.5 w-3.5" />
        </ToggleBtn>
        {showReplace && (
          <ToggleBtn active={preserveCase} onClick={() => setPreserveCase((v) => !v)} title="Preserve Case">
            <span className="text-[9px] font-bold leading-none">AB</span>
          </ToggleBtn>
        )}

        <div className="mx-1 h-3.5 w-px bg-zinc-700" />

        {/* Layer selector */}
        <div ref={layerRef} className="relative">
          <button
            onClick={() => setShowLayerMenu((v) => !v)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Search depth"
          >
            L{layer}
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
          {showLayerMenu && (
            <div className="absolute top-full left-0 z-10 mt-1 w-36 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
              {([1, 2, 3] as SearchLayer[]).map((l) => (
                <button
                  key={l}
                  onClick={() => { setLayer(l); setShowLayerMenu(false); }}
                  className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors ${
                    layer === l ? 'bg-blue-600/15 text-blue-400' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  L{l}: {LAYER_LABELS[l]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Result count */}
        {query && (
          <span className="ml-auto text-[10px] text-zinc-500">
            {totalCount} result{totalCount !== 1 ? 's' : ''} in {results.length} chat{results.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Results list */}
      {query && results.length > 0 && (
        <div className="max-h-48 overflow-y-auto border-t border-zinc-800">
          {results.map((r) => (
            <button
              key={r.conversationId}
              onClick={() => onSelectConversation(r.conversationId)}
              className={`w-full px-3 py-2 text-left transition-colors hover:bg-zinc-900 ${
                r.conversationId === activeConversationId ? 'bg-zinc-800/50' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-xs font-medium text-zinc-300">{r.title}</span>
                <span className="ml-2 shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  {r.matchCount}
                </span>
              </div>
              {r.snippet && (
                <p className="mt-0.5 truncate text-[10px] text-zinc-500">{r.snippet}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {query && results.length === 0 && (
        <div className="border-t border-zinc-800 px-3 py-3 text-center text-[11px] text-zinc-600">
          No results found
        </div>
      )}
    </div>
  );
}

/* Small toggle button */
function ToggleBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded p-1 transition-colors ${
        active
          ? 'bg-blue-600/20 text-blue-400'
          : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}
