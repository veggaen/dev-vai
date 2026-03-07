import { MessageSquare, Brain, Search, Settings, Zap, BookOpen, Maximize2, Minimize2, Container, Activity, Dumbbell, Orbit } from 'lucide-react';
import { useLayoutStore, type SidebarPanel } from '../stores/layoutStore.js';
import { useEngineStore } from '../stores/engineStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { useCursorStore } from '../stores/cursorStore.js';
import { motion } from 'framer-motion';

interface RailItem {
  id: SidebarPanel;
  icon: typeof MessageSquare;
  label: string;
  /** Keyboard shortcut hint */
  shortcut?: string;
}

const RAIL_ITEMS: RailItem[] = [
  { id: 'chats', icon: MessageSquare, label: 'Chat History', shortcut: 'Ctrl+Shift+C' },
  { id: 'devlogs', icon: Brain, label: 'Dev Logs', shortcut: 'Ctrl+Shift+L' },
  { id: 'knowledge', icon: BookOpen, label: 'Knowledge Base', shortcut: 'Ctrl+Shift+K' },
  { id: 'vaigym', icon: Dumbbell, label: 'Vai Gymnasium', shortcut: 'Ctrl+Shift+G' },
  { id: 'docker', icon: Container, label: 'Docker Sandboxes', shortcut: 'Ctrl+Shift+D' },
  { id: 'thorsen', icon: Orbit, label: 'Thorsen Wormhole', shortcut: 'Ctrl+Shift+T' },
  { id: 'search', icon: Search, label: 'Search', shortcut: 'Ctrl+Shift+F' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export function ActivityRail() {
  const { sidebarState, activePanel, setActivePanel, setShowQuickSwitch,
    showBuilderPanel, focusMode, layoutMode, toggleLayoutMode,
  } = useLayoutStore();
  const { status: engineStatus } = useEngineStore();
  const { conversations } = useChatStore();
  const overlayVisible = useCursorStore((s) => s.overlayVisible);
  const setOverlayVisible = useCursorStore((s) => s.setOverlayVisible);

  const isExpanded = sidebarState === 'expanded';

  return (
    <div className="flex h-full w-12 flex-shrink-0 flex-col items-center border-r border-zinc-800/60 bg-zinc-950 py-2">
      {/* Logo / Quick Switch trigger */}
      <button
        onClick={() => setShowQuickSwitch(true)}
        className="group mb-3 flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-200 hover:bg-zinc-800 hover:shadow-sm hover:shadow-violet-500/10"
        title="Quick Switch (Ctrl+K)"
      >
        <div className="relative flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-600 to-blue-600 shadow-sm shadow-violet-500/20 transition-all duration-200 group-hover:scale-110 group-hover:shadow-md group-hover:shadow-violet-500/30">
          <span className="text-xs font-bold text-white">V</span>
        </div>
      </button>

      {/* Rail icons */}
      <div className="flex flex-1 flex-col items-center gap-0.5">
        {RAIL_ITEMS.map((item) => {
          const isActive = activePanel === item.id && isExpanded;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              data-panel={item.id}
              onClick={() => setActivePanel(item.id)}
              title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
              className={`group/rail relative flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm shadow-violet-500/10'
                  : 'text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-300 hover:shadow-sm hover:shadow-violet-500/5'
              }`}
            >
              {/* Active tab indicator — left accent bar */}
              {isActive && (
                <motion.div
                  layoutId="rail-indicator"
                  className="absolute left-0 h-5 w-[2px] rounded-r-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.6)]"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}

              <Icon className={`h-[18px] w-[18px] transition-all duration-200 group-hover/rail:scale-110 ${
                isActive ? 'drop-shadow-[0_0_4px_rgba(139,92,246,0.4)]' : 'group-hover/rail:drop-shadow-[0_0_3px_rgba(161,161,170,0.3)]'
              }`} />

              {/* Badge: unread/active indicator */}
              {item.id === 'chats' && conversations.length > 0 && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-violet-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom section: overlay toggle + layout mode + engine status */}
      <div className="flex flex-col items-center gap-1 border-t border-zinc-800/60 pt-2">
        {/* Vai Actions / Overlay toggle — show/hide the demo overlay + action log */}
        <button
          onClick={() => setOverlayVisible(!overlayVisible)}
          title={overlayVisible ? 'Hide Vai overlays' : 'Show Vai overlays'}
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-all ${
            overlayVisible
              ? 'bg-zinc-800/80 text-violet-400'
              : 'text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-400'
          }`}
        >
          <Activity className="h-4 w-4" />
        </button>

        {/* Layout mode toggle (compact / open) */}
        <button
          onClick={toggleLayoutMode}
          title={`Switch to ${layoutMode === 'compact' ? 'open' : 'compact'} layout (Ctrl+Shift+M)`}
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-all ${
            layoutMode === 'open'
              ? 'bg-violet-500/20 text-violet-400'
              : 'text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-400'
          }`}
        >
          {layoutMode === 'open' ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>

        {/* Engine health dot */}
        <div
          className="flex h-8 w-8 items-center justify-center"
          title={`Engine: ${engineStatus}`}
        >
          <span
            className={`h-2 w-2 rounded-full transition-colors ${
              engineStatus === 'ready'
                ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                : engineStatus === 'offline'
                  ? 'bg-red-500 animate-pulse'
                  : engineStatus === 'starting'
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-zinc-600'
            }`}
          />
        </div>

        {/* Quick-switch button */}
        <button
          onClick={() => setShowQuickSwitch(true)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 transition-all hover:bg-zinc-800/60 hover:text-zinc-400"
          title="Quick Switch (Ctrl+K)"
        >
          <Zap className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
