/**
 * FocusModeToggle — Inline button for the chat toolbar.
 *
 * Focus mode = chat + builder only (sidebar hidden, rail hidden).
 * The same Maximize2/Minimize2 icons are used — conveniently matching the old layout toggle.
 */

import { Maximize2, Minimize2 } from 'lucide-react';
import { useLayoutStore } from '../stores/layoutStore.js';

export function FocusModeToggle() {
  const { focusMode, toggleFocusMode } = useLayoutStore();

  return (
    <button
      id="focus-mode-toggle"
      onClick={toggleFocusMode}
      className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-all ${
        focusMode
          ? 'bg-violet-500/15 text-violet-300 hover:bg-violet-500/25'
          : 'text-zinc-600 hover:bg-zinc-800/80 hover:text-zinc-300'
      }`}
      title={focusMode ? 'Exit focus mode (Ctrl+0)' : 'Focus mode (Ctrl+0)'}
    >
      {focusMode ? (
        <Minimize2 className="h-3.5 w-3.5" />
      ) : (
        <Maximize2 className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">
        {focusMode ? 'Exit Focus' : 'Focus'}
      </span>
    </button>
  );
}

/* Keep old name as re-export for backward compat */
export const LayoutModeToggle = FocusModeToggle;
