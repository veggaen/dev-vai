import { createPortal } from 'react-dom';
import { Monitor } from 'lucide-react';
import type { IdeMentionItem } from '../lib/ideMentions.js';
import { IDE_MENTION_ALL_SLUG } from '../lib/ideMentions.js';

interface IdeMentionMenuProps {
  items: IdeMentionItem[];
  selectedIndex: number;
  onSelect: (item: IdeMentionItem) => void;
  onClose: () => void;
  anchorRect: DOMRect;
  emptyHint?: string;
}

export function IdeMentionMenu({
  items,
  selectedIndex,
  onSelect,
  onClose,
  anchorRect,
  emptyHint,
}: IdeMentionMenuProps) {
  const showEmpty = items.length === 0 && emptyHint;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close mention menu"
        className="fixed inset-0 z-[199]"
        onMouseDown={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        role="listbox"
        aria-label="IDE mentions"
        className="fixed z-[200] max-h-56 min-w-[220px] max-w-[min(100vw-24px,320px)] overflow-y-auto rounded-xl border border-zinc-700/70 bg-zinc-900 shadow-2xl shadow-black/50"
        style={{
          left: Math.max(12, anchorRect.left),
          bottom: window.innerHeight - anchorRect.top + 6,
        }}
        data-testid="ide-mention-menu"
      >
        <div className="border-b border-zinc-800/80 px-3 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Route to IDE</span>
        </div>
        {showEmpty ? (
          <div className="px-3 py-3 text-xs text-zinc-500">{emptyHint}</div>
        ) : (
          <ul className="p-1">
            {items.map((item, i) => (
              <li key={`${item.clientId}-${item.slug}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === selectedIndex}
                  data-testid={`ide-mention-option-${item.slug}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(item)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                    i === selectedIndex ? 'bg-violet-500/15 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/80'
                  }`}
                >
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                      item.clientId === '__all__'
                        ? 'bg-emerald-500/15'
                        : 'bg-zinc-800/80'
                    }`}
                  >
                    <Monitor className={`h-3.5 w-3.5 ${item.slug === IDE_MENTION_ALL_SLUG ? 'text-emerald-400' : 'text-zinc-400'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      <span className="text-violet-400/90">@{item.slug}</span>
                      <span className="mx-1.5 text-zinc-600">·</span>
                      {item.label}
                    </div>
                    <div className="truncate text-[10px] text-zinc-500">{item.hint}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>,
    document.body,
  );
}
