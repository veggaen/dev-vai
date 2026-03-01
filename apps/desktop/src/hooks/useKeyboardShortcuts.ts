import { useEffect } from 'react';
import { useLayoutStore, type ChatMode } from '../stores/layoutStore.js';

const MODE_KEYS: Record<string, ChatMode> = {
  '1': 'chat',
  '2': 'agent',
  '3': 'builder',
  '4': 'plan',
  '5': 'debate',
};

/**
 * Global keyboard shortcuts:
 *   Ctrl+1-5   — Switch mode (chat / agent / builder / plan / debate)
 *   Ctrl+J     — Toggle debug console
 */
export function useKeyboardShortcuts() {
  const { setMode, toggleDebugConsole } = useLayoutStore();

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

      if (ctrl && key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleDebugConsole();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setMode, toggleDebugConsole]);
}
