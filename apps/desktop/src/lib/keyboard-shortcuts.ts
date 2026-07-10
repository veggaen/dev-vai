/** Default keyboard shortcuts — ids are stable for user overrides. */
export type ShortcutId =
  | 'quickSwitch'
  | 'settings'
  | 'cycleSidebar'
  | 'focusMode'
  | 'modeChat'
  | 'modeAgent'
  | 'modeBuilder'
  | 'modePlan'
  | 'modeDebate'
  | 'toggleConsole'
  | 'toggleFiles'
  | 'toggleApp'
  | 'focusChatSearch'
  | 'devLogs'
  | 'knowledge'
  | 'cycleLayout'
  | 'toggleSources'
  | 'appFullscreen'
  | 'attachWorkspace'
  | 'toggleDiff'
  | 'detachWorkspace'
  | 'projectPanel';

export interface ShortcutDefinition {
  id: ShortcutId;
  keys: string;
  description: string;
  category: 'navigation' | 'workspace' | 'modes' | 'panels';
}

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  { id: 'quickSwitch', keys: 'Ctrl+K', description: 'Quick switch — search conversations and destinations', category: 'navigation' },
  { id: 'settings', keys: 'Ctrl+,', description: 'Open settings', category: 'navigation' },
  { id: 'cycleSidebar', keys: 'Ctrl+S', description: 'Cycle sidebar: expanded → rail → hidden', category: 'workspace' },
  { id: 'focusMode', keys: 'Ctrl+0', description: 'Focus mode — chat and app only', category: 'workspace' },
  { id: 'modeChat', keys: 'Ctrl+1', description: 'Switch to chat mode', category: 'modes' },
  { id: 'modeAgent', keys: 'Ctrl+2', description: 'Switch to agent mode', category: 'modes' },
  { id: 'modeBuilder', keys: 'Ctrl+3', description: 'Switch to builder mode', category: 'modes' },
  { id: 'modePlan', keys: 'Ctrl+4', description: 'Switch to plan mode', category: 'modes' },
  { id: 'modeDebate', keys: 'Ctrl+5', description: 'Switch to debate mode', category: 'modes' },
  { id: 'toggleConsole', keys: 'Ctrl+J', description: 'Toggle debug console', category: 'panels' },
  { id: 'toggleFiles', keys: 'Ctrl+E', description: 'Toggle file explorer', category: 'panels' },
  { id: 'toggleApp', keys: 'Ctrl+B', description: 'Toggle built app panel', category: 'panels' },
  { id: 'focusChatSearch', keys: 'Ctrl+Shift+F', description: 'Focus chat search in sidebar', category: 'navigation' },
  { id: 'devLogs', keys: 'Ctrl+Shift+L', description: 'Open dev logs', category: 'navigation' },
  { id: 'knowledge', keys: 'Ctrl+Shift+K', description: 'Open knowledge base', category: 'navigation' },
  { id: 'cycleLayout', keys: 'Ctrl+Shift+M', description: 'Cycle layout density', category: 'workspace' },
  { id: 'toggleSources', keys: 'Ctrl+Shift+S', description: 'Toggle sources panel', category: 'panels' },
  { id: 'appFullscreen', keys: 'Ctrl+Alt+P', description: 'Expand app to full width', category: 'workspace' },
  { id: 'projectPanel', keys: 'Ctrl+Shift+I', description: 'Open chats with code badges', category: 'navigation' },
  { id: 'attachWorkspace', keys: 'Ctrl+Shift+O', description: 'Attach a project folder to this chat', category: 'workspace' },
  { id: 'toggleDiff', keys: 'Ctrl+Alt+D', description: 'Toggle diff review panel', category: 'panels' },
  { id: 'detachWorkspace', keys: 'Ctrl+Shift+W', description: 'Detach workspace folder', category: 'workspace' },
];

const DEFAULT_BY_ID = new Map(DEFAULT_SHORTCUTS.map((s) => [s.id, s]));

export function getDefaultShortcut(id: ShortcutId): ShortcutDefinition {
  return DEFAULT_BY_ID.get(id)!;
}

/** Parse "Ctrl+Shift+K" into matcher for keydown events. */
export function parseShortcutKeys(keys: string): {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
} {
  const parts = keys.split('+').map((p) => p.trim());
  const last = parts[parts.length - 1] ?? '';
  return {
    ctrl: parts.some((p) => p.toLowerCase() === 'ctrl' || p.toLowerCase() === 'meta'),
    shift: parts.some((p) => p.toLowerCase() === 'shift'),
    alt: parts.some((p) => p.toLowerCase() === 'alt'),
    key: last.length === 1 ? last.toLowerCase() : last.toLowerCase(),
  };
}

export function eventMatchesShortcut(e: KeyboardEvent, keys: string): boolean {
  const parsed = parseShortcutKeys(keys);
  const ctrl = e.ctrlKey || e.metaKey;
  if (parsed.ctrl !== ctrl) return false;
  if (parsed.shift !== e.shiftKey) return false;
  if (parsed.alt !== e.altKey) return false;

  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (parsed.key === ',' && eventKey === ',') return true;
  if (parsed.key === eventKey) return true;
  if (parsed.key === '0' && e.key === '0') return true;
  return false;
}

/** Format a captured keydown into a display string like Ctrl+Shift+K */
export function formatCapturedShortcut(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}
