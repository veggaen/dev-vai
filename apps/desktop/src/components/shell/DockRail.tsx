/**
 * DockRail — Odyssey mode's nav instrument.
 * A bottom-center dock: quiet tiles with a restrained lift on hover and label
 * bubbles above. Structurally different from both compact's left rail and
 * open's top bar. In odyssey the chats tile opens the sidebar slide-over —
 * the dock is the stage's only permanent chrome.
 */

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings, UserRound } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { useEngineStore } from '../../stores/engineStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { getRailNavSections, type SidebarNavItem } from '../../lib/sidebar-nav.js';
import { UserPopover } from '../UserPopover.js';
import { VaiMark } from '../brand/VaiMark.js';

export function DockRail() {
  const { activePanel, setActivePanel, setShowQuickSwitch } = useLayoutStore();
  const { status: engineStatus } = useEngineStore();
  const authStatus = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => state.role);
  const ownerFeaturesHidden = useAuthStore((state) => state.ownerFeaturesHidden);

  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);

  const sections = getRailNavSections(role, ownerFeaturesHidden);
  const items: SidebarNavItem[] = [...sections.core, ...sections.tools, ...sections.platform];

  const engineDotClass = engineStatus === 'ready'
    ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]'
    : engineStatus === 'offline'
      ? 'bg-red-500 animate-pulse'
      : 'bg-amber-400 animate-pulse';

  return (
    <div className="dock-rail-lane pointer-events-none relative z-20 flex shrink-0 justify-center pb-3 pt-1.5">
      <motion.nav
        aria-label="Main navigation"
        initial={{ y: 26, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26, delay: 0.05 }}
        className="dock-rail pointer-events-auto flex items-center gap-1 px-2.5 py-1.5"
      >
        <DockTile
          label="Quick Switch"
          shortcut="Ctrl+K"
          onClick={() => setShowQuickSwitch(true)}
        >
          <VaiMark size={22} />
        </DockTile>

        <span aria-hidden className="dock-divider" />

        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DockTile
              key={item.id}
              label={item.label}
              shortcut={item.shortcut}
              active={activePanel === item.id}
              panelId={item.id}
              onClick={() => setActivePanel(item.id)}
            >
              <Icon aria-hidden className="h-[19px] w-[19px]" />
            </DockTile>
          );
        })}

        <span aria-hidden className="dock-divider" />

        <DockTile
          label="Settings"
          shortcut="Ctrl+,"
          active={activePanel === 'settings'}
          onClick={() => setActivePanel('settings')}
        >
          <Settings className="h-[17px] w-[17px]" aria-hidden />
        </DockTile>

        <DockTile
          label={authStatus === 'authenticated' ? 'Account — signed in' : 'Account'}
          onClick={() => setUserPopoverOpen((prev) => !prev)}
          buttonRef={userButtonRef}
        >
          <span className="relative">
            <UserRound className="h-[17px] w-[17px]" aria-hidden />
            <span className={`absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ${engineDotClass}`} />
          </span>
        </DockTile>
      </motion.nav>

      <UserPopover
        open={userPopoverOpen}
        onClose={() => setUserPopoverOpen(false)}
        anchorRect={userButtonRef.current?.getBoundingClientRect() ?? null}
      />
    </div>
  );
}

function DockTile({
  label,
  shortcut,
  active = false,
  panelId,
  onClick,
  buttonRef,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  panelId?: string;
  onClick: () => void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const ownButtonRef = useRef<HTMLButtonElement | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<{ x: number; y: number } | null>(null);

  const setRefs = (node: HTMLButtonElement | null) => {
    ownButtonRef.current = node;
    if (buttonRef) {
      (buttonRef as React.MutableRefObject<HTMLButtonElement | null>).current = node;
    }
  };

  const openTooltip = () => {
    setHovered(true);
    const rect = ownButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltipAnchor({ x: rect.left + rect.width / 2, y: rect.top - 10 });
    }
  };

  const closeTooltip = () => {
    setHovered(false);
    setTooltipAnchor(null);
  };

  return (
    <>
      <motion.button
        ref={setRefs}
        type="button"
        data-panel={panelId}
        onClick={onClick}
        onHoverStart={openTooltip}
        onHoverEnd={closeTooltip}
        onFocus={openTooltip}
        onBlur={closeTooltip}
        whileHover={{ scale: 1.08, y: -3 }}
        whileTap={{ scale: 0.95, y: -1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 26 }}
        aria-label={`${label}${shortcut ? ` (${shortcut})` : ''}`}
        aria-current={active ? 'page' : undefined}
        className={`dock-tile relative flex h-11 w-11 touch-manipulation items-center justify-center rounded-2xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] ${
          active ? 'dock-tile--active text-[color:var(--accent-text)]' : 'text-[color:var(--color-muted)] hover:text-[color:var(--fg)]'
        }`}
      >
        {children}
        {active && <span aria-hidden className="dock-tile-glow" />}
        {active && <span aria-hidden className="dock-tile-dot" />}
      </motion.button>
      {typeof document !== 'undefined' && createPortal(
        hovered && tooltipAnchor ? (
          <motion.span
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="dock-tile-label pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-[color:var(--shell-line-soft)] bg-[color:var(--panel)]/95 px-2.5 py-1 text-[11px] font-semibold text-[color:var(--fg)] shadow-xl backdrop-blur-xl"
            style={{ left: tooltipAnchor.x, top: tooltipAnchor.y }}
            role="tooltip"
          >
            {label}
            {shortcut && <span className="ml-1.5 font-normal text-[color:var(--color-muted)]">{shortcut}</span>}
          </motion.span>
        ) : null,
        document.body,
      )}
    </>
  );
}

export default DockRail;
