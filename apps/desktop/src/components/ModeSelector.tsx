import { useState, useRef, useEffect } from 'react';
import { type ChatMode, useLayoutStore, MODE_DESCRIPTIONS } from '../stores/layoutStore.js';
import { MessageCircle, Bot, Hammer, ListChecks, Swords, ChevronDown } from 'lucide-react';

const MODES: { id: ChatMode; label: string; icon: typeof Bot; shortcut: string }[] = [
  { id: 'chat', label: 'Chat', icon: MessageCircle, shortcut: '1' },
  { id: 'agent', label: 'Agent', icon: Bot, shortcut: '2' },
  { id: 'builder', label: 'Builder', icon: Hammer, shortcut: '3' },
  { id: 'plan', label: 'Plan', icon: ListChecks, shortcut: '4' },
  { id: 'debate', label: 'Debate', icon: Swords, shortcut: '5' },
];

/**
 * Compact dropdown mode selector — sits inside the chat input bar.
 */
export function ModeSelector() {
  const { mode, setMode } = useLayoutStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  const CurrentIcon = current.icon;

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        title={`Mode: ${current.label} (Ctrl+1-5)`}
      >
        <CurrentIcon className="h-3.5 w-3.5" />
        <span>{current.label}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {MODES.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.id;

            return (
              <button
                key={m.id}
                onClick={() => {
                  setMode(m.id);
                  setOpen(false);
                }}
                className={`group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  isActive
                    ? 'bg-blue-600/15 text-blue-400'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
                title={MODE_DESCRIPTIONS[m.id]}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium">{m.label}</span>
                  <p className="truncate text-[10px] leading-tight text-zinc-600 group-hover:text-zinc-500">
                    {MODE_DESCRIPTIONS[m.id]}
                  </p>
                </div>
                <kbd className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  ⌃{m.shortcut}
                </kbd>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
