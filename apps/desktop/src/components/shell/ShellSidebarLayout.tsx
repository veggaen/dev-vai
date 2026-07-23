/**
 * Shell sidebar architecture for the open + odyssey layout modes.
 *
 * • open ("Atelier")  — a fixed-width editorial column (300px, tight resize
 *   bounds). The old 34%-of-viewport resizable panel made the chat list balloon
 *   to ~900px on wide monitors and destroyed the reading-room structure; a list
 *   column is furniture, not a workspace, so it gets furniture sizing.
 *
 * • odyssey ("Stage") — the sidebar no longer reserves a column at all. It is
 *   a floating glass slide-over ABOVE the stage, opened from the dock and
 *   dismissed by scrim-click or Escape. The stage stays immersive; the list
 *   visits, it doesn't move in.
 */

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import { X as XIcon } from 'lucide-react';
import { SidebarPanel } from '../SidebarPanel.js';
import { HoverResizeHandle } from '../workspace/HoverResizeHandle.js';
import { useLayoutStore, type LayoutMode } from '../../stores/layoutStore.js';
import { isPanelCollapsedSize, syncPanelCollapsedAttr } from '../../lib/panel-collapse.js';
import type { ReactNode } from 'react';

interface ShellSidebarLayoutProps {
  readonly children: ReactNode;
  readonly showSidebar: boolean;
  readonly sidebarExpanded: boolean;
  readonly layoutMode: LayoutMode;
  /** Legacy prop — the rail is owned by App in compact mode; kept for call-site compat. */
  readonly showRail?: boolean;
}

/** Open mode: editorial column — fixed feel, gently adjustable. */
const OPEN_SIDEBAR_DEFAULT = '300px';
const OPEN_SIDEBAR_MIN = '260px';
const OPEN_SIDEBAR_MAX = '360px';

function OdysseySlideOver({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim — the stage dims, the panel is lit. */}
          <motion.div
            key="odyssey-sidebar-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 z-30 bg-black/35 backdrop-blur-[2px]"
            aria-hidden
          />
          <motion.aside
            key="odyssey-sidebar-panel"
            initial={{ x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="odyssey-sidebar-overlay absolute bottom-3 left-3 top-3 z-40 flex w-[320px] min-w-0 flex-col overflow-hidden"
            role="dialog"
            aria-label="Workspace sidebar"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sidebar (Esc)"
              title="Close (Esc)"
              className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--color-muted)] transition-colors hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
            >
              <XIcon className="h-3.5 w-3.5" aria-hidden />
            </button>
            <div className="h-full min-h-0 overflow-hidden">
              <SidebarPanel embedded />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function ShellSidebarLayout({
  children,
  showSidebar,
  sidebarExpanded,
  layoutMode,
}: ShellSidebarLayoutProps) {
  const sidebarPanelRef = usePanelRef();
  const sidebarElementRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const isOdyssey = layoutMode === 'odyssey';
  const isOpen = layoutMode === 'open';
  const sidebarSlotClass = isOpen ? 'open-sidebar-slot' : 'shell-sidebar-slot';

  useEffect(() => {
    if (isOdyssey) return; // odyssey uses the slide-over, not the panel group
    const panel = sidebarPanelRef.current;
    if (!panel || !showSidebar) return;
    syncingRef.current = true;
    if (!sidebarExpanded && !panel.isCollapsed()) {
      panel.collapse();
    } else if (sidebarExpanded) {
      if (panel.isCollapsed()) {
        panel.expand();
      }
      const size = panel.getSize();
      if (size.inPixels < 240) {
        panel.resize(OPEN_SIDEBAR_DEFAULT);
      }
    }
    const timer = window.setTimeout(() => {
      syncingRef.current = false;
    }, 320);
    return () => window.clearTimeout(timer);
  }, [isOdyssey, sidebarExpanded, showSidebar, sidebarPanelRef]);

  const onSidebarResize = (size: { asPercentage: number; inPixels: number }) => {
    syncPanelCollapsedAttr(sidebarElementRef.current, size);
    if (syncingRef.current) return;
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    const store = useLayoutStore.getState();
    // Only sync store once the panel has actually collapsed/expanded — not mid-animation.
    if (panel.isCollapsed()) {
      if (store.sidebarState === 'expanded') {
        store.setSidebarState('rail');
      }
    } else if (!isPanelCollapsedSize(size) && store.sidebarState === 'rail') {
      store.setSidebarState('expanded');
    }
  };

  /* ── Odyssey: full-bleed stage + floating slide-over ── */
  if (isOdyssey) {
    return (
      <div className="odyssey-nav-cluster relative flex h-full min-h-0 min-w-0 flex-1 items-stretch">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {children}
        </div>
        <OdysseySlideOver
          open={showSidebar && sidebarExpanded}
          onClose={() => useLayoutStore.getState().setSidebarState('rail')}
        />
      </div>
    );
  }

  /* ── Open (and fallback): fixed-feel editorial column ── */
  return (
    <div
      className="shell-nav-cluster flex h-full min-h-0 min-w-0 flex-1 items-stretch"
      style={{ gap: isOpen ? 'var(--layout-gap)' : undefined }}
    >
      {showSidebar && (
        <Group id="vai-shell-sidebar-group" orientation="horizontal" className="min-h-0 min-w-0 flex-1">
          <Panel
            id="shell-sidebar"
            elementRef={sidebarElementRef}
            defaultSize={OPEN_SIDEBAR_DEFAULT}
            minSize={OPEN_SIDEBAR_MIN}
            maxSize={OPEN_SIDEBAR_MAX}
            collapsible
            collapsedSize={0}
            panelRef={sidebarPanelRef}
            onResize={onSidebarResize}
            className="shell-sidebar-panel"
          >
            <div className={`${sidebarSlotClass} h-full min-h-0 overflow-hidden`}>
              <SidebarPanel embedded />
            </div>
          </Panel>
          <HoverResizeHandle direction="vertical" />
          <Panel id="shell-main" minSize={30}>
            {children}
          </Panel>
        </Group>
      )}

      {!showSidebar && (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}

export default ShellSidebarLayout;
