import { useRef, useState } from 'react';
import { Settings, UserRound } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLayoutStore } from '../stores/layoutStore.js';
import { useEngineStore } from '../stores/engineStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { getRailNavSections, type SidebarNavItem } from '../lib/sidebar-nav.js';
import { UserPopover } from './UserPopover.js';
import { VaiMark } from './brand/VaiMark.js';

interface RailTooltipState {
  label: string;
  shortcut?: string;
  x: number;
  y: number;
}

export function ActivityRail() {
  const {
    sidebarState,
    activePanel,
    setActivePanel,
    setShowQuickSwitch,
    themePreference,
    layoutMode,
  } = useLayoutStore();
  const { status: engineStatus } = useEngineStore();
  const authStatus = useAuthStore((state) => state.status);
  const authUser = useAuthStore((state) => state.user);
  const role = useAuthStore((state) => state.role);
  const ownerFeaturesHidden = useAuthStore((state) => state.ownerFeaturesHidden);

  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [tooltip, setTooltip] = useState<RailTooltipState | null>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);

  const isExpanded = sidebarState === 'expanded';
  const isLight = themePreference === 'light';
  const isOpenLayout = layoutMode === 'open';
  const isOdysseyLayout = layoutMode === 'odyssey';
  const isFloatingRail = isOpenLayout || isOdysseyLayout;
  const sections = getRailNavSections(role, ownerFeaturesHidden);

  const engineDotClass = engineStatus === 'ready'
    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.55)]'
    : engineStatus === 'offline'
      ? 'bg-red-500 animate-pulse'
      : engineStatus === 'starting'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-zinc-500';

  const engineLabel = engineStatus === 'ready' ? 'online' : engineStatus;
  const accountLabel = authStatus === 'authenticated'
    ? `Account${authUser?.email ? ` — ${authUser.email}` : ''}`
    : 'Account';

  return (
    <nav
      aria-label="Main navigation"
      className={`activity-rail relative flex h-full min-w-0 flex-shrink-0 flex-col items-center ${
        isOdysseyLayout ? 'justify-between py-2' : 'py-3'
      } ${
        isFloatingRail
          ? 'overflow-hidden border-0 bg-transparent'
          : 'overflow-visible border-r border-[color:var(--shell-line-soft)] bg-[color:var(--sidebar-surface)]'
      }`}
      style={{ width: 'var(--layout-rail-width)' }}
    >
      <button
        type="button"
        onClick={() => setShowQuickSwitch(true)}
        className="group relative mb-3 flex h-9 w-9 touch-manipulation items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
        title="Quick Switch (Ctrl+K)"
        aria-label="Open quick switch"
      >
        <div
          aria-hidden
          className="relative flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 group-hover:scale-110 group-hover:drop-shadow-[0_4px_12px_color-mix(in_srgb,var(--brand-color)_55%,transparent)]"
        >
          <VaiMark size={22} />
        </div>
      </button>

      <div className="flex flex-1 flex-col items-center">
        <RailSection items={sections.core} activePanel={activePanel} isExpanded={isExpanded} isLight={isLight} onSelect={setActivePanel} onTooltip={setTooltip} />
        {sections.tools.length > 0 && (
          <RailSection
            items={sections.tools}
            activePanel={activePanel}
            isExpanded={isExpanded}
            isLight={isLight}
            onSelect={setActivePanel}
            onTooltip={setTooltip}
            subdued
            className="mt-3"
          />
        )}
        {sections.platform.length > 0 && (
          <RailSection
            items={sections.platform}
            activePanel={activePanel}
            isExpanded={isExpanded}
            isLight={isLight}
            onSelect={setActivePanel}
            onTooltip={setTooltip}
            subdued
            className="mt-2"
          />
        )}
      </div>

      <div className="mt-auto flex flex-col items-center gap-1 pt-2">
        <button
          type="button"
          onClick={() => setActivePanel('settings')}
          title="Settings (Ctrl+,)"
          aria-label="Open settings"
          aria-current={activePanel === 'settings' ? 'page' : undefined}
          className={`flex h-8 w-8 touch-manipulation items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] ${
            activePanel === 'settings'
              ? isLight
                ? 'bg-zinc-100 text-zinc-900'
                : 'bg-zinc-900 text-zinc-100'
              : isLight
                ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
                : 'text-zinc-500 hover:bg-zinc-900/70 hover:text-zinc-300'
          }`}
        >
          <Settings className="h-3.5 w-3.5" aria-hidden />
        </button>

        <div
          className="flex h-6 w-8 items-center justify-center"
          title={`Engine: ${engineLabel}`}
          role="status"
          aria-label={`Engine ${engineLabel}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full transition-colors ${engineDotClass}`} />
        </div>

        <button
          ref={userButtonRef}
          type="button"
          onClick={() => setUserPopoverOpen((prev) => !prev)}
          className={`relative flex h-8 w-8 touch-manipulation items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] ${
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
          title={accountLabel}
          aria-label={accountLabel}
        >
          <UserRound className="h-3.5 w-3.5" aria-hidden />
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

      {/* Rail tooltip — fixed position so no layout mode can clip it */}
      <AnimatePresence>
        {tooltip && (
          <motion.div
            key="rail-tooltip"
            initial={{ opacity: 0, x: -6, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            className="pointer-events-none fixed z-[70] flex items-center gap-2 whitespace-nowrap rounded-lg border border-[color:var(--shell-line-soft)] bg-[color:var(--panel)]/90 py-1.5 pl-3 pr-2.5 text-[12px] font-medium text-[color:var(--fg)] shadow-xl backdrop-blur-xl"
            style={{ left: tooltip.x, top: tooltip.y, translateY: '-50%' }}
            role="tooltip"
          >
            {tooltip.label}
            {tooltip.shortcut && (
              <kbd className="rounded border border-[color:var(--shell-line-soft)] bg-[color:var(--bg)]/60 px-1.5 py-0.5 text-[9.5px] font-normal tracking-wide text-[color:var(--color-muted)]">
                {tooltip.shortcut}
              </kbd>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

function RailSection({
  items,
  activePanel,
  isExpanded,
  isLight,
  onSelect,
  onTooltip,
  subdued = false,
  className = '',
}: {
  items: SidebarNavItem[];
  activePanel: string;
  isExpanded: boolean;
  isLight: boolean;
  onSelect: (panel: SidebarNavItem['id']) => void;
  onTooltip: (tooltip: RailTooltipState | null) => void;
  subdued?: boolean;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.035 } } }}
      className={`flex flex-col items-center gap-0.5 ${subdued ? 'opacity-75 transition-opacity duration-300 hover:opacity-100' : ''} ${className}`}
    >
      {items.map((item) => (
        <RailIconButton
          key={item.id}
          item={item}
          isActive={isRailItemActive(item, activePanel, isExpanded)}
          onClick={() => onSelect(item.id)}
          onTooltip={onTooltip}
          isLight={isLight}
        />
      ))}
    </motion.div>
  );
}

function RailIconButton({
  item,
  isActive,
  onClick,
  onTooltip,
  isLight,
}: {
  item: SidebarNavItem;
  isActive: boolean;
  onClick: () => void;
  onTooltip: (tooltip: RailTooltipState | null) => void;
  isLight: boolean;
}) {
  const Icon = item.icon;
  const buttonRef = useRef<HTMLButtonElement>(null);

  const showTooltip = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    onTooltip({
      label: item.label,
      shortcut: item.shortcut,
      x: rect.right + 10,
      y: rect.top + rect.height / 2,
    });
  };

  return (
    <motion.button
      ref={buttonRef}
      type="button"
      data-panel={item.id}
      onClick={onClick}
      onMouseEnter={showTooltip}
      onMouseLeave={() => onTooltip(null)}
      onFocus={showTooltip}
      onBlur={() => onTooltip(null)}
      aria-label={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
      aria-current={isActive ? 'page' : undefined}
      variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
      className={`group/rail relative flex h-9 w-9 touch-manipulation items-center justify-center rounded-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] ${
        isActive
          ? 'text-[color:var(--accent-text)]'
          : isLight
            ? 'text-zinc-500 hover:text-zinc-900'
            : 'text-zinc-500 hover:text-zinc-200'
      }`}
    >
      {isActive && (
        <motion.span
          layoutId="rail-active-pill"
          className="absolute inset-0 rounded-[10px] bg-[color:var(--accent-softer)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_22%,transparent)]"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      {!isActive && (
        <span
          aria-hidden
          className={`absolute inset-0 rounded-[10px] opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 ${
            isLight ? 'bg-zinc-100' : 'bg-zinc-900/60'
          }`}
        />
      )}
      {isActive && (
        <motion.span
          layoutId="rail-active-accent"
          className="absolute -left-[5px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-[color:var(--accent)]"
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        />
      )}
      <Icon aria-hidden className="relative z-[1] h-[17px] w-[17px] transition-transform duration-200 group-hover/rail:-translate-y-px" />
    </motion.button>
  );
}

function isRailItemActive(item: SidebarNavItem, activePanel: string, isExpanded: boolean): boolean {
  if (activePanel !== item.id) return false;
  if (item.presentation === 'fullscreen' || item.presentation === 'drawer') return true;
  return isExpanded;
}
