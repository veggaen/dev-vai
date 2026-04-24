import { useEffect } from 'react';
import { useLayoutStore, type ChatMode } from '../stores/layoutStore.js';
import { useChatStore } from '../stores/chatStore.js';

const MODE_KEYS: Record<string, ChatMode> = {
  '1': 'chat',
  '2': 'agent',
  '3': 'builder',
  '4': 'plan',
  '5': 'debate',
};

/**
 * Global keyboard shortcuts:
 *   Ctrl+1-5        — Switch mode (chat / agent / builder / plan / debate)
 *   Ctrl+0          — Focus mode (chat only — hide sidebar + builder)
 *   Ctrl+K          — Quick Switch (fuzzy search conversations)
 *   Ctrl+,          — Settings sidebar (same tier as Ctrl+K / palette-style power user flow)
 *   Ctrl+S          — Cycle sidebar: expanded → rail → hidden
 *   Ctrl+Shift+L    — Toggle Dev Logs panel
 *   Ctrl+Shift+F    — Toggle Search panel
 *   Ctrl+Shift+K    — Toggle Knowledge Base panel
 *   Ctrl+Shift+M    — Toggle layout mode (compact ↔ open)
 *   Ctrl+J          — Toggle debug console (paired with Ctrl+K: pick chat vs inspect logs)
 *   Ctrl+E          — Toggle file explorer
 *   Ctrl+B          — Toggle builder panel
 */
export function useKeyboardShortcuts() {
  const {
    setMode, toggleDebugConsole, toggleFileExplorer,
    toggleBuilderPanel, toggleFocusMode, cycleSidebar,
    setShowQuickSwitch, setActivePanel, toggleLayoutMode,
  } = useLayoutStore();
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const updateConversationMode = useChatStore((state) => state.updateConversationMode);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when typing in inputs (except Ctrl shortcuts)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (!e.ctrlKey && !e.metaKey) return;
      }

      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      // Ctrl+K — Quick Switch
      if (ctrl && key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowQuickSwitch(true);
        return;
      }

      // Ctrl+, — Settings (VS Code–style preferences shortcut)
      if (ctrl && key === ',') {
        e.preventDefault();
        setActivePanel('settings');
        return;
      }

      // Ctrl+S — Cycle sidebar states
      if (ctrl && !shift && key.toLowerCase() === 's') {
        e.preventDefault();
        cycleSidebar();
        return;
      }

      // Ctrl+Shift+L — Dev Logs panel
      if (ctrl && shift && key.toLowerCase() === 'l') {
        e.preventDefault();
        setActivePanel('devlogs');
        return;
      }

      // Ctrl+Shift+F — Search panel
      if (ctrl && shift && key.toLowerCase() === 'f') {
        e.preventDefault();
        setActivePanel('search');
        return;
      }

      // Ctrl+Shift+K — Knowledge Base panel
      if (ctrl && shift && key.toLowerCase() === 'k') {
        e.preventDefault();
        setActivePanel('knowledge');
        return;
      }

      // Ctrl+Shift+M — Toggle layout mode (compact ↔ open)
      if (ctrl && shift && key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleLayoutMode();
        return;
      }

      if (ctrl && MODE_KEYS[key]) {
        e.preventDefault();
        const nextMode = MODE_KEYS[key];
        setMode(nextMode);
        if (activeConversationId) {
          void updateConversationMode(activeConversationId, nextMode).catch((error) => {
            console.error('Failed to sync conversation mode from keyboard shortcut', error);
          });
        }
        return;
      }

      // Ctrl+0 — Focus mode (chat-only zen mode)
      if (ctrl && key === '0') {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      if (ctrl && key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleDebugConsole();
        return;
      }

      if (ctrl && key.toLowerCase() === 'e') {
        e.preventDefault();
        toggleFileExplorer();
        return;
      }

      if (ctrl && key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleBuilderPanel();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeConversationId,
    cycleSidebar,
    setActivePanel,
    setMode,
    setShowQuickSwitch,
    toggleBuilderPanel,
    toggleDebugConsole,
    toggleFileExplorer,
    toggleFocusMode,
    toggleLayoutMode,
    updateConversationMode,
  ]);
}
