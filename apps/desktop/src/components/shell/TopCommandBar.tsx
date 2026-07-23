/**
 * TopCommandBar — Open mode's nav instrument (T3-style).
 * The vertical rail becomes a horizontal command bar: brand left,
 * nav tabs center, settings/engine/account right. Structurally different
 * from compact's left rail — same vocabulary, different room.
 */

import { useRef, useState } from 'react';
import { PanelLeft, Settings, UserRound } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { useEngineStore } from '../../stores/engineStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { getRailNavSections, type SidebarNavItem } from '../../lib/sidebar-nav.js';
import { UserPopover } from '../UserPopover.js';
import { VaiMark } from '../brand/VaiMark.js';

export function TopCommandBar() {
  const { activePanel, setActivePanel, setShowQuickSwitch, sidebarState, toggleSidebar } = useLayoutStore();
  const { status: engineStatus } = useEngineStore();
  const authStatus = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => state.role);
  const ownerFeaturesHidden = useAuthStore((state) => state.ownerFeaturesHidden);

  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);

  const sections = getRailNavSections(role, ownerFeaturesHidden);
  const items: SidebarNavItem[] = [...sections.core, ...sections.tools, ...sections.platform];

  const engineDotClass = engineStatus === 'ready'
    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.55)]'
    : engineStatus === 'offline'
      ? 'bg-red-500 animate-pulse'
      : engineStatus === 'starting'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-zinc-500';

  return (
    <motion.nav
      aria-label="Main navigation"
      initial={{ y: -14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 360, damping: 32 }}
      className="top-command-bar relative z-20 flex h-11 shrink-0 items-center gap-3 px-3"
    >
      <button
        type="button"
        onClick={() => setShowQuickSwitch(true)}
        className="group flex h-8 items-center gap-2 rounded-full px-2 transition-colors hover:bg-[color:var(--panel)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
        title="Quick Switch (Ctrl+K)"
        aria-label="Open quick switch"
      >
        <VaiMark size={18} />
        <span className="hidden font-display text-[12.5px] font-semibold tracking-tight text-[color:var(--fg)] md:inline">
          Vai
        </span>
      </button>

      <button
        type="button"
        onClick={toggleSidebar}
        title={sidebarState === 'expanded' ? 'Collapse sidebar (Ctrl+B)' : 'Expand sidebar (Ctrl+B)'}
        aria-label={sidebarState === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-pressed={sidebarState === 'expanded'}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] ${
          sidebarState === 'expanded'
            ? 'text-[color:var(--fg)]'
            : 'text-[color:var(--color-muted)] hover:bg-[color:var(--panel)]/70 hover:text-[color:var(--fg)]'
        }`}
      >
        <PanelLeft className="h-3.5 w-3.5" aria-hidden />
      </button>

      <div className="top-command-tabs flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto" role="tablist">
        {items.map((item) => (
          <TopTab
            key={item.id}
            item={item}
            active={activePanel === item.id}
            onSelect={() => setActivePanel(item.id)}
          />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full transition-colors ${engineDotClass}`}
          title={`Engine: ${engineStatus}`}
          role="status"
          aria-label={`Engine ${engineStatus}`}
        />
        <button
          type="button"
          onClick={() => setActivePanel('settings')}
          title="Settings (Ctrl+,)"
          aria-label="Open settings"
          aria-current={activePanel === 'settings' ? 'page' : undefined}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] ${
            activePanel === 'settings'
              ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]'
              : 'text-[color:var(--color-muted)] hover:bg-[color:var(--panel)]/70 hover:text-[color:var(--fg)]'
          }`}
        >
          <Settings className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          ref={userButtonRef}
          type="button"
          onClick={() => setUserPopoverOpen((prev) => !prev)}
          className="relative flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted)] transition-colors hover:bg-[color:var(--panel)]/70 hover:text-[color:var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
          title="Account"
          aria-label="Account"
        >
          <UserRound className="h-3.5 w-3.5" aria-hidden />
          <span
            className={`absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full ${
              authStatus === 'authenticated' ? 'bg-emerald-400' : 'bg-zinc-600'
            }`}
          />
        </button>
      </div>

      <UserPopover
        open={userPopoverOpen}
        onClose={() => setUserPopoverOpen(false)}
        anchorRect={userButtonRef.current?.getBoundingClientRect() ?? null}
      />
    </motion.nav>
  );
}

function TopTab({
  item,
  active,
  onSelect,
}: {
  item: SidebarNavItem;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      data-panel={item.id}
      onClick={onSelect}
      role="tab"
      aria-selected={active}
      aria-label={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
      title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
      className={`relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] ${
        active
          ? 'text-[color:var(--accent-text)]'
          : 'text-[color:var(--color-muted)] hover:text-[color:var(--fg)]'
      }`}
    >
      {active && (
        <motion.span
          layoutId="top-command-active"
          className="absolute inset-0 rounded-full bg-[color:var(--accent-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_24%,transparent)]"
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        />
      )}
      <Icon aria-hidden className="relative z-[1] h-3.5 w-3.5" />
      <span className="relative z-[1] hidden lg:inline">{item.label}</span>
    </button>
  );
}

export default TopCommandBar;
