import { type ChatMode, useLayoutStore } from '../stores/layoutStore.js';
import { MessageSquare, Hammer, ListChecks, Swords } from 'lucide-react';
import type { ReactNode } from 'react';

const MODES: { id: ChatMode; label: string; icon: ReactNode; shortcut: string }[] = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="h-3.5 w-3.5" />, shortcut: '1' },
  { id: 'builder', label: 'Builder', icon: <Hammer className="h-3.5 w-3.5" />, shortcut: '2' },
  { id: 'plan', label: 'Plan', icon: <ListChecks className="h-3.5 w-3.5" />, shortcut: '3' },
  { id: 'debate', label: 'Debate', icon: <Swords className="h-3.5 w-3.5" />, shortcut: '4' },
];

export function ModeSelector() {
  const { mode, setMode, builderEnabled } = useLayoutStore();

  return (
    <div className="flex gap-1 rounded-lg bg-zinc-900 p-1">
      {MODES.map((m) => {
        const isActive = mode === m.id;
        const isDisabled = m.id === 'builder' && !builderEnabled;

        return (
          <button
            key={m.id}
            onClick={() => !isDisabled && setMode(m.id)}
            disabled={isDisabled}
            title={`${m.label} mode (Ctrl+${m.shortcut})`}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
              isActive
                ? 'bg-blue-600 text-white shadow-sm'
                : isDisabled
                  ? 'cursor-not-allowed text-zinc-600'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            {m.icon}
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
