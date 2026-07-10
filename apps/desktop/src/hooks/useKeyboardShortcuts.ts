import { useEffect } from 'react';
import { useLayoutStore, type ChatMode } from '../stores/layoutStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { useShortcutsStore } from '../stores/shortcutsStore.js';
import { eventMatchesShortcut, type ShortcutId } from '../lib/keyboard-shortcuts.js';
import { FOCUS_CHAT_SEARCH_EVENT } from '../components/SidebarPanel.js';
import { useWorkspaceStore } from '../stores/workspaceStore.js';

const MODE_BY_SHORTCUT: Partial<Record<ShortcutId, ChatMode>> = {
  modeChat: 'chat',
  modeAgent: 'agent',
  modeBuilder: 'builder',
  modePlan: 'plan',
  modeDebate: 'debate',
};

export function useKeyboardShortcuts() {
  const overrides = useShortcutsStore((s) => s.overrides);
  const getKeys = useShortcutsStore((s) => s.getKeys);
  const {
    setMode,
    toggleDebugConsole,
    toggleFileExplorer,
    toggleBuilderPanel,
    toggleFocusMode,
    cycleSidebar,
    setShowQuickSwitch,
    setActivePanel,
    cycleLayoutMode,
    togglePreviewExpanded,
  } = useLayoutStore();
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const updateConversationMode = useChatStore((state) => state.updateConversationMode);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (!e.ctrlKey && !e.metaKey) return;
      }

      const match = (id: ShortcutId) => eventMatchesShortcut(e, getKeys(id));

      if (match('quickSwitch')) {
        e.preventDefault();
        setShowQuickSwitch(true);
        return;
      }

      if (match('settings')) {
        e.preventDefault();
        setActivePanel('settings');
        return;
      }

      if (match('cycleSidebar')) {
        e.preventDefault();
        cycleSidebar();
        return;
      }

      if (match('devLogs')) {
        e.preventDefault();
        setActivePanel('devlogs');
        return;
      }

      if (match('focusChatSearch')) {
        e.preventDefault();
        setActivePanel('chats');
        window.dispatchEvent(new CustomEvent(FOCUS_CHAT_SEARCH_EVENT));
        return;
      }

      if (match('knowledge')) {
        e.preventDefault();
        setActivePanel('knowledge');
        return;
      }

      if (match('cycleLayout')) {
        e.preventDefault();
        cycleLayoutMode();
        return;
      }

      if (match('appFullscreen')) {
        e.preventDefault();
        togglePreviewExpanded();
        return;
      }

      if (match('toggleSources')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('vai:toggle-sources-panel'));
        return;
      }

      for (const [shortcutId, mode] of Object.entries(MODE_BY_SHORTCUT) as [ShortcutId, ChatMode][]) {
        if (match(shortcutId)) {
          e.preventDefault();
          setMode(mode);
          if (activeConversationId) {
            void updateConversationMode(activeConversationId, mode).catch((error) => {
              console.error('Failed to sync conversation mode from keyboard shortcut', error);
            });
          }
          return;
        }
      }

      if (match('focusMode')) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      if (match('toggleConsole')) {
        e.preventDefault();
        toggleDebugConsole();
        return;
      }

      if (match('toggleFiles')) {
        e.preventDefault();
        toggleFileExplorer();
        return;
      }

      if (match('toggleApp')) {
        e.preventDefault();
        toggleBuilderPanel();
        return;
      }

      if (match('projectPanel')) {
        e.preventDefault();
        setActivePanel('chats');
        return;
      }

      if (match('attachWorkspace')) {
        e.preventDefault();
        // One project-open flow everywhere: the sandbox pipeline (scan → review
        // → dev server → live preview). The legacy workspace-IDE attach stays
        // reachable from the Project sidebar's own button.
        window.dispatchEvent(new CustomEvent('vai:open-workspace'));
        return;
      }

      if (match('toggleDiff')) {
        e.preventDefault();
        useWorkspaceStore.getState().toggleDiffPanel();
        return;
      }

      if (match('detachWorkspace')) {
        e.preventDefault();
        useWorkspaceStore.getState().detach();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeConversationId,
    cycleSidebar,
    getKeys,
    overrides,
    setActivePanel,
    setMode,
    setShowQuickSwitch,
    toggleBuilderPanel,
    toggleDebugConsole,
    toggleFileExplorer,
    toggleFocusMode,
    togglePreviewExpanded,
    cycleLayoutMode,
    updateConversationMode,
  ]);
}
