import { MessageSquare, Brain, Search, Settings, BookOpen, Maximize2, Minimize2, Container, Activity, Dumbbell, Orbit, FolderKanban, Shield, UserRound } from 'lucide-react';
import { useLayoutStore, type SidebarPanel, ROLE_NAV_ITEMS } from '../stores/layoutStore.js';
import { useEngineStore } from '../stores/engineStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { useCursorStore } from '../stores/cursorStore.js';
import { useAuthStore, type AppRole } from '../stores/authStore.js';
import { motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { UserPopover } from './UserPopover.js';

interface RailItem {
  id: SidebarPanel;
  icon: typeof MessageSquare;
  label: string;
  /** Keyboard shortcut hint */
  shortcut?: string;
}

const BASE_RAIL_ITEMS: RailItem[] = [
  { id: 'chats', icon: MessageSquare, label: 'Chat History', shortcut: 'Ctrl+Shift+C' },
  { id: 'projects', icon: FolderKanban, label: 'Projects', shortcut: 'Ctrl+Shift+P' },
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
    layoutMode, toggleLayoutMode,
    themePreference,
  } = useLayoutStore();
  const { status: engineStatus } = useEngineStore();
  const { conversations } = useChatStore();
  const authStatus = useAuthStore((state) => state.status);
  const authUser = useAuthStore((state) => state.user);
  const role: AppRole = useAuthStore((state) => state.role);
  const overlayVisible = useCursorStore((s) => s.overlayVisible);
  const setOverlayVisible = useCursorStore((s) => s.setOverlayVisible);

  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);

  const isExpanded = sidebarState === 'expanded';
  const isLight = themePreference === 'light';
  const allowedPanels = ROLE_NAV_ITEMS[role];
  const railItems: RailItem[] = role === 'owner'
    ? [...BASE_RAIL_ITEMS.slice(0, 2), { id: 'control' as const, icon: Shield, label: 'Control', shortcut: 'Ctrl+Shift+O' }, ...BASE_RAIL_ITEMS.slice(2)]
    : BASE_RAIL_ITEMS.filter((item) => allowedPanels.includes(item.id));

  return (
    <div
      className={`flex h-full min-w-0 flex-shrink-0 flex-col items-center overflow-hidden border-r py-2 ${
        isLight ? 'border-zinc-200 bg-white/90' : 'border-zinc-800/70 bg-zinc-950/88'
      }`}
      style={{ width: 'var(--layout-rail-width)' }}
    >
      {/* Logo / Quick Switch trigger */}
      <button
        onClick={() => setShowQuickSwitch(true)}
        className={`group mb-3 flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200 ${
          isLight ? 'hover:bg-zinc-100' : 'hover:bg-zinc-900'
        }`}
        title="Quick Switch (Ctrl+K)"
      >
        <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 shadow-sm shadow-violet-500/20 transition-all duration-200 group-hover:scale-110 group-hover:shadow-md group-hover:shadow-violet-500/30">
          <span className="text-xs font-bold text-white">V</span>
        </div>
      </button>

      {/* Rail icons */}
      <div className="flex flex-1 flex-col items-center gap-0.5">
        {railItems.map((item) => {
          const isActive = activePanel === item.id && isExpanded;
          const Icon = item.icon;

          return (
            <motion.button
              key={item.id}
              data-panel={item.id}
              onClick={() => setActivePanel(item.id)}
              title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
              className={`group/rail relative flex h-10 w-10 items-center justify-center rounded-xl border transition-colors duration-200 ${isActive
                  ? isLight
                    ? 'border-violet-200 bg-violet-50 text-violet-700 shadow-sm'
                    : 'border-zinc-800/80 bg-zinc-900 text-zinc-100 shadow-sm shadow-violet-500/10'
                  : isLight
                    ? 'border-transparent text-zinc-500 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900'
                    : 'border-transparent text-zinc-600 hover:border-zinc-800/70 hover:bg-zinc-900/70 hover:text-zinc-300'
                }`}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            >
              {/* Active tab indicator — left accent bar */}
              {isActive && (
                <motion.div
                  layoutId="rail-indicator"
                  className="absolute left-0 h-5 w-[2px] rounded-r-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.45)]"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}

              {/* Hover border box — Thorsen micro-interaction */}
              <motion.div
                className="pointer-events-none absolute inset-0 rounded-lg border border-violet-500/0"
                whileHover={{ borderColor: 'rgba(139,92,246,0.35)', boxShadow: '0 0 12px rgba(139,92,246,0.15)' }}
                transition={{ duration: 0.2 }}
              />

              <motion.div
                initial={false}
                animate={isActive ? { rotate: [0, -8, 8, 0], scale: 1.05 } : { rotate: 0, scale: 1 }}
                transition={isActive ? { duration: 0.4, ease: 'easeOut' } : { duration: 0.2 }}
              >
                <Icon className={`h-[18px] w-[18px] transition-all duration-200 ${isActive ? 'drop-shadow-[0_0_4px_rgba(139,92,246,0.4)]' : 'group-hover/rail:drop-shadow-[0_0_3px_rgba(161,161,170,0.3)]'
                  }`} />
              </motion.div>

              {/* Badge: unread/active indicator */}
              {item.id === 'chats' && conversations.length > 0 && (
                <motion.span
                  className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-violet-500"
                  animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Bottom section: overlay toggle + layout mode + engine status */}
      <div className={`flex flex-col items-center gap-1 border-t pt-2 ${isLight ? 'border-zinc-200' : 'border-zinc-800/70'}`}>
        {/* Vai Actions / Overlay toggle — show/hide the demo overlay + action log */}
        <button
          onClick={() => setOverlayVisible(!overlayVisible)}
          title={overlayVisible ? 'Hide Vai overlays' : 'Show Vai overlays'}
          className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all ${overlayVisible
              ? isLight ? 'bg-violet-50 text-violet-700' : 'bg-zinc-900 text-violet-400'
              : isLight ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800' : 'text-zinc-600 hover:bg-zinc-900/70 hover:text-zinc-400'
            }`}
        >
          <Activity className="h-4 w-4" />
        </button>

        {/* Layout mode toggle (compact / open) */}
        <button
          onClick={toggleLayoutMode}
          title={`Switch to ${layoutMode === 'compact' ? 'open' : 'compact'} layout (Ctrl+Shift+M)`}
          className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all ${layoutMode === 'open'
              ? isLight ? 'bg-violet-50 text-violet-700' : 'bg-violet-500/20 text-violet-400'
              : isLight ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800' : 'text-zinc-600 hover:bg-zinc-900/70 hover:text-zinc-400'
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
            className={`h-2 w-2 rounded-full transition-colors ${engineStatus === 'ready'
                ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                : engineStatus === 'offline'
                  ? 'bg-red-500 animate-pulse'
                  : engineStatus === 'starting'
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-zinc-600'
              }`}
          />
        </div>

        {/* Account popover trigger */}
        <button
          ref={userButtonRef}
          onClick={() => setUserPopoverOpen((prev) => !prev)}
          className={`relative flex h-8 w-8 items-center justify-center rounded-xl transition-all ${userPopoverOpen
              ? isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-100'
              : authStatus === 'authenticated'
                ? isLight ? 'text-emerald-700 hover:bg-zinc-100 hover:text-emerald-600' : 'text-emerald-400 hover:bg-zinc-900/70 hover:text-emerald-300'
                : isLight ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800' : 'text-zinc-600 hover:bg-zinc-900/70 hover:text-zinc-400'
            }`}
          title={authStatus === 'authenticated'
            ? `Account${authUser?.email ? ` (${authUser.email})` : ''}`
            : 'Account'}
        >
          <UserRound className="h-4 w-4" />
          <span
            className={`absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full ${authStatus === 'authenticated'
                ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                : 'bg-zinc-600'
              }`}
          />
        </button>
      </div>

      {/* User popover */}
      <UserPopover
        open={userPopoverOpen}
        onClose={() => setUserPopoverOpen(false)}
        anchorRect={userButtonRef.current?.getBoundingClientRect() ?? null}
      />
    </div>
  );
}
