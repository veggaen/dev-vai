import { useState, useRef, useEffect } from 'react';
import { type ChatMode, useLayoutStore, MODE_DESCRIPTIONS } from '../stores/layoutStore.js';
import { MessageCircle, Bot, Hammer, ListChecks, Swords, ChevronDown } from 'lucide-react';
import { useChatStore } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';

const MODES: { id: ChatMode; label: string; icon: typeof Bot; shortcut: string }[] = [
  { id: 'chat',    label: 'Chat',    icon: MessageCircle, shortcut: '1' },
  { id: 'agent',   label: 'Agent',   icon: Bot,           shortcut: '2' },
  { id: 'builder', label: 'Builder', icon: Hammer,        shortcut: '3' },
  { id: 'plan',    label: 'Plan',    icon: ListChecks,    shortcut: '4' },
  { id: 'debate',  label: 'Debate',  icon: Swords,        shortcut: '5' },
];

const MODE_ACCENTS: Partial<Record<ChatMode, string>> = {
  builder: 'text-violet-400 bg-violet-500/12 ring-violet-500/25 hover:bg-violet-500/18',
  agent:   'text-blue-400 bg-blue-500/12 ring-blue-500/25 hover:bg-blue-500/18',
};

const MODE_DROPDOWN_ACCENTS: Partial<Record<ChatMode, string>> = {
  builder: 'bg-violet-500/12 text-violet-300',
  agent:   'bg-blue-500/12 text-blue-300',
  chat:    'bg-zinc-800/70 text-zinc-300',
  plan:    'bg-emerald-500/10 text-emerald-300',
  debate:  'bg-amber-500/10 text-amber-300',
};

/**
 * Compact dropdown mode selector — sits inside the chat input bar.
 * Builder mode gets a violet accent to signal "live app generation".
 */
export function ModeSelector() {
  const { mode, setMode, themePreference } = useLayoutStore();
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const updateConversationMode = useChatStore((state) => state.updateConversationMode);
  const workflowModes = useSettingsStore((state) => state.workflowModes);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isLight = themePreference === 'light';

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const availableModes = MODES.filter((candidate) => workflowModes.includes(candidate.id));
  const current = availableModes.find((m) => m.id === mode) ?? availableModes[0] ?? MODES[0];
  const CurrentIcon = current.icon;
  const accentClass = isLight
    ? current.id === 'builder'
      ? 'text-violet-700 bg-violet-100 ring-violet-200 hover:bg-violet-200'
      : current.id === 'agent'
        ? 'text-blue-700 bg-blue-100 ring-blue-200 hover:bg-blue-200'
        : 'text-zinc-700 bg-white ring-zinc-200 hover:bg-zinc-100'
    : MODE_ACCENTS[current.id] ?? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200';

  return (
    <div ref={ref} className="relative z-[80]">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 transition-all ${accentClass}`}
        title={`Mode: ${current.label} (Ctrl+1-5)`}
      >
        <CurrentIcon className="h-3.5 w-3.5" />
        <span>{current.label}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className={`absolute bottom-full left-0 mb-1.5 w-68 rounded-lg border py-1.5 shadow-xl backdrop-blur-sm ${
          isLight
            ? 'border-zinc-200 bg-white/98 shadow-[0_18px_48px_rgba(15,23,42,0.12)]'
            : 'border-zinc-700/60 bg-zinc-900/95 shadow-2xl shadow-black/40'
        }`}>
          <div className={`mb-1 border-b px-3 pb-1.5 ${isLight ? 'border-zinc-200' : 'border-zinc-800/60'}`}>
            <span className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${isLight ? 'text-zinc-500' : 'text-zinc-600'}`}>Response mode</span>
          </div>
          {availableModes.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.id;
            const dropAccent = isLight
              ? m.id === 'builder'
                ? 'bg-violet-100 text-violet-700'
                : m.id === 'agent'
                  ? 'bg-blue-100 text-blue-700'
                  : m.id === 'plan'
                    ? 'bg-emerald-100 text-emerald-700'
                    : m.id === 'debate'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-zinc-100 text-zinc-700'
              : MODE_DROPDOWN_ACCENTS[m.id] ?? 'text-zinc-400';

            return (
              <button
                key={m.id}
                onClick={async () => {
                  setMode(m.id);
                  if (activeConversationId) {
                    await updateConversationMode(activeConversationId, m.id);
                  }
                  setOpen(false);
                }}
                className={`group flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? `${dropAccent} font-medium`
                    : isLight
                      ? 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                }`}
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                  isActive
                    ? dropAccent.replace('text-', 'bg-').split(' ')[0]
                    : isLight
                      ? 'bg-zinc-100 group-hover:bg-zinc-200'
                      : 'bg-zinc-800/60 group-hover:bg-zinc-800'
                }`}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{m.label}</span>
                    {m.id === 'builder' && (
                      <span className={`rounded-md px-1.5 py-px text-[9px] font-semibold ${
                        isLight ? 'bg-violet-100 text-violet-700' : 'bg-violet-500/15 text-violet-400'
                      }`}>live</span>
                    )}
                  </div>
                  <p className={`mt-0.5 truncate text-[10px] leading-tight ${
                    isLight ? 'text-zinc-500 group-hover:text-zinc-600' : 'text-zinc-600 group-hover:text-zinc-500'
                  }`}>
                    {MODE_DESCRIPTIONS[m.id]}
                  </p>
                </div>
                <kbd className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                  isLight ? 'bg-zinc-100 text-zinc-500' : 'bg-zinc-800 text-zinc-500'
                }`}>
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
