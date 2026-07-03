/**
 * Unified workspace panel toggles — same vocabulary in chat header and app toolbar.
 *
 * Panels: Sidebar · Chat focus · App · App fullscreen · Sources · Council
 */

import {
  PanelLeft,
  PanelLeftClose,
  MessageSquare,
  AppWindow,
  Maximize2,
  Minimize2,
  Layers,
  Users,
  Focus,
  Waypoints,
} from 'lucide-react';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { useShortcutsStore } from '../../stores/shortcutsStore.js';

export type WorkspaceControlSurface = 'chat' | 'app';

interface WorkspaceLayoutControlsProps {
  surface: WorkspaceControlSurface;
  /** Light studio chrome (builder active) */
  studio?: boolean;
  sourcesOpen?: boolean;
  sourcesCount?: number;
  onToggleSources?: () => void;
  compact?: boolean;
}

function chipClass(active: boolean, studio: boolean): string {
  const base = 'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]';
  if (active) {
    return studio
      ? `${base} border-blue-300 bg-blue-50 text-blue-700`
      : `${base} border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]`;
  }
  return studio
    ? `${base} border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50`
    : `${base} border-[color:var(--shell-line-soft)] bg-[color:var(--panel)]/40 text-[color:var(--color-muted)] hover:border-[color:var(--border)] hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]`;
}

function iconBtnClass(active: boolean): string {
  return `flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] ${
    active
      ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]'
      : 'text-[color:var(--color-muted)] hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]'
  }`;
}

export function WorkspaceLayoutControls({
  surface,
  studio = false,
  sourcesOpen = false,
  sourcesCount = 0,
  onToggleSources,
  compact = false,
}: WorkspaceLayoutControlsProps) {
  const {
    sidebarState,
    cycleSidebar,
    focusMode,
    toggleFocusMode,
    showBuilderPanel,
    toggleBuilderPanel,
    previewExpanded,
    togglePreviewExpanded,
    showCouncilPanel,
    toggleCouncilPanel,
    showKnowledgeGraph,
    toggleKnowledgeGraph,
  } = useLayoutStore();

  const shortcut = useShortcutsStore((s) => s.getKeys);
  const sidebarExpanded = sidebarState === 'expanded';
  const showLabels = !compact;

  const tip = (label: string, id: Parameters<typeof shortcut>[0]) =>
    `${label} (${shortcut(id)})`;

  if (surface === 'app') {
    return (
      <div className="flex items-center gap-1" role="toolbar" aria-label="App workspace layout">
        <button
          type="button"
          onClick={togglePreviewExpanded}
          className={iconBtnClass(previewExpanded)}
          title={tip(previewExpanded ? 'Restore split layout' : 'App full width', 'appFullscreen')}
          aria-pressed={previewExpanded}
        >
          {previewExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        {!previewExpanded && (
          <button
            type="button"
            onClick={toggleBuilderPanel}
            className={iconBtnClass(showBuilderPanel)}
            title={tip('Close app panel', 'toggleApp')}
            aria-label="Close app panel"
          >
            <AppWindow className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5" role="toolbar" aria-label="Workspace layout">
      <button
        type="button"
        onClick={cycleSidebar}
        className={chipClass(sidebarExpanded, studio)}
        title={tip('Cycle sidebar', 'cycleSidebar')}
        aria-pressed={sidebarExpanded}
      >
        {sidebarExpanded ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />}
        {showLabels && <span>{sidebarExpanded ? 'Hide nav' : 'Nav'}</span>}
      </button>

      <button
        type="button"
        onClick={toggleFocusMode}
        className={chipClass(focusMode, studio)}
        title={tip(focusMode ? 'Exit chat focus' : 'Chat focus', 'focusMode')}
        aria-pressed={focusMode}
      >
        <Focus className="h-3.5 w-3.5" />
        {showLabels && <span>{focusMode ? 'Unfocus' : 'Focus'}</span>}
      </button>

      <button
        type="button"
        onClick={toggleBuilderPanel}
        className={chipClass(showBuilderPanel, studio)}
        title={tip(showBuilderPanel ? 'Hide app' : 'Show app', 'toggleApp')}
        aria-pressed={showBuilderPanel}
      >
        <AppWindow className="h-3.5 w-3.5" />
        {showLabels && <span>{showBuilderPanel ? 'App' : 'App'}</span>}
      </button>

      {onToggleSources && (
        <button
          type="button"
          onClick={onToggleSources}
          className={chipClass(sourcesOpen, studio)}
          title={tip(sourcesOpen ? 'Hide sources' : 'Show sources', 'toggleSources')}
          aria-pressed={sourcesOpen}
          data-conversation-sources-toggle
          data-state={sourcesOpen ? 'open' : 'closed'}
        >
          <Layers className="h-3.5 w-3.5" />
          {showLabels && <span>Sources</span>}
          {sourcesCount > 0 && (
            <span className={`ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded px-1 text-[10px] font-semibold tabular-nums ${
              sourcesOpen
                ? studio ? 'bg-blue-100 text-blue-700' : 'bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]'
                : studio ? 'bg-zinc-100 text-zinc-600' : 'bg-[color:var(--panel-bg-muted)] text-[color:var(--color-muted)]'
            }`}>
              {sourcesCount}
            </span>
          )}
        </button>
      )}

      <button
        type="button"
        onClick={toggleCouncilPanel}
        className={chipClass(showCouncilPanel, studio)}
        title={tip(showCouncilPanel ? 'Hide council' : 'Show council', 'toggleCouncil')}
        aria-pressed={showCouncilPanel}
      >
        <Users className="h-3.5 w-3.5" />
        {showLabels && <span>Council</span>}
      </button>

      <button
        type="button"
        onClick={toggleKnowledgeGraph}
        className={chipClass(showKnowledgeGraph, studio)}
        title={showKnowledgeGraph ? 'Hide knowledge graph' : 'Knowledge graph — map of chats & projects'}
        aria-pressed={showKnowledgeGraph}
      >
        <Waypoints className="h-3.5 w-3.5" />
        {showLabels && <span>Graph</span>}
      </button>

      {showBuilderPanel && (
        <button
          type="button"
          onClick={togglePreviewExpanded}
          className={chipClass(previewExpanded, studio)}
          title={tip(previewExpanded ? 'Restore layout' : 'App full width', 'appFullscreen')}
          aria-pressed={previewExpanded}
        >
          {previewExpanded ? <Minimize2 className="h