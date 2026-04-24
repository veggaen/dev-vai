import {
  MessageSquare,
  Brain,
  Search,
  Settings,
  BookOpen,
  Container,
  Dumbbell,
  Orbit,
  FolderKanban,
  Shield,
  UserRound,
  Sparkles,
} from 'lucide-react';
import { useLayoutStore, type SidebarPanel, ROLE_NAV_ITEMS } from '../stores/layoutStore.js';
import { useEngineStore } from '../stores/engineStore.js';
import { useCursorStore } from '../stores/cursorStore.js';
import { useAuthStore, type AppRole } from '../stores/authStore.js';
import { motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { UserPopover } from './UserPopover.js';

/**
 * ActivityRail — left icon rail with Chat History, Projects, Knowledge,
 * plus owner-only advanced tools in a collapsed bottom group.
 *
 * Design: slim, flat icon stack. Active item shows a violet glyph + left
 * accent bar. Advanced owner-only entries (Dev Logs, Gym, Thorsen, Docker,
 * Control) sit below a subtle separator so the primary flow stays uncluttered.
 */

interface RailItem {
  id: SidebarPanel;
  icon: typeof MessageSquare;
  label: string;
  shortcut?: string;
}

/** Core items every role sees (order matters for muscle memory). */
const CORE_ITEMS: RailItem[] = [
  { id: 'chats', icon: MessageSquare, label: 'Chat History', shortcut: 'Ctrl+Shift+C' },
  { id: 'projects', icon: FolderKanban, label: 'Projects', shortcut: 'Ctrl+Shift+P' },
  { id: 'knowledge', icon: BookOpen, label: 'Knowledge Base', shortcut: 'Ctrl+Shift+K' },
  { id: 'search', icon: Search, label: 'Search', shortcut: 'Ctrl+Shift+F' },
];

/** Advanced owner/admin tools — shown below a separator when the role allows. */
const ADVANCED_ITEMS: RailItem[] = [
  { id: 'docker', icon: Container, label: 'Docker Sandboxes', shortcut: 'Ctrl+Shift+D' },
  { id: 'devlogs', icon: Brain, label: 'Dev Logs', shortcut: 'Ctrl+Shift+L' },
  { id: 'vaigym', icon: Dumbbell, label: 'Vai Gym', shortcut: 'Ctrl+Shift+G' },
  { id: 'thorsen', icon: Orbit, label: 'Thorsen', shortcut: 'Ctrl+Shift+T' },
];

const CONTROL_ITEM: RailItem = {
  id: 'control',
  icon: Shield,
  label: 'Control',
  shortcut: 'Ctrl+Shift+O',
};

export function ActivityRail() {
  const {
    sidebarState,
    activePanel,
    setActivePanel,
    setShowQuickSwitch,
    themePreference,
  } = useLayoutStore();
  const { status: engineStatus } = useEngineStore();
  const authStatus = useAuthStore((state) => state.status);
  const authUser = useAuthStore((state) => state.user);
  const role: AppRole = useAuthStore((state) => state.role);
  const overlayVisible = useCursorStore((s) => s.overlayVisible);
  const setOverlayVisible = useCursorStore((s) => s.setOverlayVisible);

  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);

  const isExpanded = sidebarState === 'expanded';
  const isLight = themePreference === 'light';
  const allowedPanels = new Set(ROLE_NAV_ITEMS[role]);

  const coreItems = CORE_ITEMS.filter((item) => allowedPanels.has(item.id));
  const advancedItems: RailItem[] = [];
  if (role === 'owner') {
    advancedItems.push(CONTROL_ITEM);
  }
  for (const item of ADVANCED_ITEMS) {
    if (allowedPanels.has(item.id)) advancedItems.push(item);
  }

  const engineDotClass = engineStatus === 'ready'
    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.55)]'
    : engineStatus === 'offline'
      ? 'bg-red-500 animate-pulse'
      : engineStatus === 'starting'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-zinc-500';

  const engineLabel = engineStatus === 'ready' ? 'online' : engineStatus;

  return (
    <div
      className={`relative flex h-full min-w-0 flex-shrink-0 flex-col items-center overflow-visible py-3 ${
        isLight ? 'bg-white/95' : 'bg-zinc-950/88'
      }`}
      style={{ width: 'var(--layout-rail-width)' }}
    >
      {/* Vertical hairline separator on the right side — the rail reads as a
          quiet sliver, not a heavy boxed panel */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-3 right-0 w-px ${
          isLight ? 'bg-zinc-200' : 'bg-zinc-800/70'
        }`}
      />

      {/* Logo / Quick Switch trigger */}
      <button
        onClick={() => setShowQuickSwitch(true)}
        className="group relative mb-3 flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
        title="Quick Switch (Ctrl+K)"
      >
        <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 shadow-sm shadow-violet-500/20 transition-transform duration-150 group-hover:scale-105">
          <span className="text-xs font-bold text-white">V</span>
        </div>
      </button>

      {/* Rail icons */}
      <div className="flex flex-1 flex-col items-center">
        <div className="flex flex-col items-center gap-0.5">
          {coreItems.map((item) => (
            <RailIconButton
              key={item.id}
              item={item}
              isActive={activePanel === item.id && isExpanded}
              onClick={() => setActivePanel(item.id)}
              isLight={isLight}
            />
          ))}
        </div>

        {advancedItems.length > 0 && (
          <>
            <div
              aria-hidden
              className={`my-2 h-px w-6 ${isLight ? 'bg-zinc-200' : 'bg-zinc-800/70'}`}
            />
            <div className="flex flex-col items-center gap-0.5 opacity-80 hover:opacity-100">
              {advancedItems.map((item) => (
                <RailIconButton
                  key={item.id}
                  item={item}
                  isActive={activePanel === item.id && isExpanded}
                  onClick={() => setActivePanel(item.id)}
                  isLight={isLight}
                  subdued
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Bottom cluster: overlay, settings, status dot, account */}
      <div className="mt-auto flex flex-col items-center gap-1 pt-2">
        <div
          aria-hidden
          className={`mb-1 h-px w-6 ${isLight ? 'bg-zinc-200' : 'bg-zinc-800/70'}`}
        />

        {/* Vai overlay toggle (demo cursor + action log) */}
        <button
          onClick={() => setOverlayVisible(!overlayVisible)}
          title={overlayVisible ? 'Hide Vai overlays' : 'Show Vai overlays'}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
            overlayVisible
              ? isLight
                ? 'bg-violet-50 text-violet-700'
                : 'bg-violet-500/15 text-violet-300'
              : isLight
                ? 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800'
                : 'text-zinc-600 hover:bg-zinc-900/70 hover:text-zinc-300'
          }`}
          aria-label="Toggle Vai overlay"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>

        {/* Settings — bottom aligned for traditional shell muscle memory */}
        {allowedPanels.has('settings') && (
          <button
            onClick={() => setActivePanel('settings')}
            title="Settings (Ctrl+,)"
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              activePanel === 'settings' && isExpanded
                ? isLight
                  ? 'bg-zinc-100 text-zinc-900'
                  : 'bg-zinc-900 text-zinc-100'
                : isLight
                  ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
                  : 'text-zinc-500 hover:bg-zinc-900/70 hover:text-zinc-300'
            }`}
            aria-label="Open settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Engine status dot */}
        <div
          className="flex h-6 w-8 items-center justify-center"
          title={`Engine: ${engineLabel}`}
          role="status"
          aria-label={`Engine ${engineLabel}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full transition-colors ${engineDotClass}`} />
        </div>

        {/* Account popover trigger */}
        <button
          ref={userButtonRef}
          onClick={() => setUserPopoverOpen((prev) => !prev)}
          className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
            userPopoverOpen
              ? isLight
                ? 'bg-zinc-100 text-zinc-900'
                : 'bg-zinc-900 text-zinc-100'
              : authStatus === 'authenticated'
                ? isLight
                  ? 'text-emerald-700 hover:bg-zinc-100'
                  : 'text-emerald-300 hover:bg-zinc-900/70'
                : isLight
                  ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
                  : 'text-zinc-500 hover:bg-zinc-900/70 hover:text-zinc-300'
          }`}
          title={authStatus === 'authenticated'
            ? `Account${authUser?.email ? ` · ${authUser.email}` : ''}`
            : 'Account'}
        >
          <UserRound className="h-3.5 w-3.5" />
          <span
            className={`absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full ${
              authStatus === 'authenticated'
                ? 'bg-emerald-400 shadow-[0_0_4px_rgba(16,185,129,0.55)]'
                : 'bg-zinc-600'
            }`}
          />
        </button>
      </div>

      <UserPopover
        open={userPopoverOpen}
        onClose={() => setUserPopoverOpen(false)}
        anchorRect={userButtonRef.current?.getBoundingClientRect() ?? null}
      />
    </div>
  );
}

interface RailIconButtonProps {
  item: RailItem;
  isActive: boolean;
  onClick: () => void;
  isLight: boolean;
  subdued?: boolean;
}

function RailIconButton({ item, isActive, onClick, isLight, subdued = false }: RailIconButtonProps) {
  const Icon = item.icon;

  const activeClass = isLight
    ? 'text-violet-700'
    : 'text-violet-200';
  const idleBase = subdued
    ? isLight
      ? 'text-zinc-400 hover:text-zinc-800'
      : 'text-zinc-600 hover:text-zinc-300'
    : isLight
      ? 'text-zinc-500 hover:text-zinc-900'
      : 'text-zinc-500 hover:text-zinc-200';
  const hoverBg = isLight ? 'hover:bg-zinc-100' : 'hover:bg-zinc-900/60';

  return (
    <motion.button
      data-panel={item.id}
      onClick={onClick}
      title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
      aria-label={item.label}
      aria-pressed={isActive}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
      className={`group/rail relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
        isActive ? activeClass : idleBase
      } ${hoverBg}`}
    >
      {isActive && (
        <motion.span
          layoutId="rail-active-accent"
          className="absolute -left-[5px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.5)]"
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        />
      )}
      <Icon
        className={`h-[17px] w-[17px] transition-all ${
          isActive ? 'drop-shadow-[0_0_4px_rgba(139,92,246,0.45)]' : ''
        }`}
      />
    </motion.button>
  );
}
