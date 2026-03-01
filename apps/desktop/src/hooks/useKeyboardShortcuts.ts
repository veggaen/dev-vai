import { useEffect } from 'react';
import { useLayoutStore, type ChatMode } from '../stores/layoutStore.js';

const MODE_KEYS: Record<string, ChatMode> = {
  '1': 'agent',
  '2': 'builder',
  '3': 'plan',
  '4': 'debate',
};

/**
 * Global keyboard shortcuts:
 *   Ctrl+1-4   — Switch mode (chat / builder / plan / debate)
 *   Ctrl+B     — Toggle builder view
 *   Ctrl+J     — Toggle debug console
 */
export function useKeyboardShortcuts() {
  const { setMode, enterBuilder, exitBuilder, view, toggleDebugConsole } =
    useLayoutStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        // Allow Ctrl shortcuts even inside inputs
        if (!e.ctrlKey && !e.metaKey) return;
      }

      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && MODE_KEYS[key]) {
        e.preventDefault();
        setMode(MODE_KEYS[key]);
        return;
      }

      if (ctrl && key.toLowerCase() === 'b') {
        e.preventDefault();
        if (view === 'builder') {
          exitBuilder();
        } else {
          enterBuilder();
        }
        return;
      }

      if (ctrl && key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleDebugConsole();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setMode, enterBuilder, exitBuilder, view, toggleDebugConsole]);
}
