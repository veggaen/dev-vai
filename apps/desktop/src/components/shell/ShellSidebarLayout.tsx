/**
 * Activity rail + drag-collapsible sidebar (console-style).
 * Drag the sidebar edge left to collapse; drag the border right to restore.
 */

import { useEffect, useRef } from 'react';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import { ActivityRail } from '../ActivityRail.js';
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
  /** Render the left activity rail column (compact); open/odyssey bring their own nav. */
  readonly showRail?: boolean;
}

export function ShellSidebarLayout({
  children,
  showSidebar,
  sidebarExpanded,
  layoutMode,
  showRail = true,
}: ShellSidebarLayoutProps) {
  const sidebarPanelRef = usePanelRef();
  const sidebarElementRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const isOdyssey = layoutMode === 'odyssey';
  const isOpen = layoutMode === 'open';
  const sidebarSlotClass = isOdyssey
    ? 'odyssey-sidebar-slot'
    : isOpen
      ? 'open-sidebar-slot'
      : 'shell-sidebar-slot';

  useEffect(() => {
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
      if (size.inPixels < 280) {
        panel.resize('34%');
      }
    }
    const timer = window.setTimeout(() => {
      syncingRef.current = false;
    }, 320);
    return () => window.clearTimeout(timer);
  }, [sidebarExpanded, showSidebar, sidebarPanelRef]);

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

  return (
    <div
      className={`${isOdyssey ? 'odyssey-nav-cluster' : 'shell-nav-cluster'} flex h-full min-h-0 min-w-0 flex-1 items-stretch`}
      style={{ gap: isOdyssey || isOpen ? 'var(--layout-gap)' : undefined }}
    >
      {showRail && (
        <div className={`layout-panel layout-panel--rail h-full shrink-0 ${isOdyssey ? 'odyssey-rail-shell' : ''}`}>
          <ActivityRail />
        </div>
      )}

      {showSidebar && (
        <Group id="vai-shell-sidebar-group" orientation="horizontal" className="min-h-0 min-w-0 flex-1">
          <Panel
            id="shell-sidebar"
            elementRef={sidebarElementRef}
            defaultSize="34%"
            minSize="260px"
            maxSize="48%"
            collapsible
            collapsedSize={0}
            panelRef={sidebarPanelRef}
            onResize={onSidebarResize}
            className={isOdyssey ? 'odyssey-sidebar-panel' : 'shell-sidebar-panel'}
          >
            <div className={`${sidebarSlotClass} h-full min-h-0 overflow-hidden`}>
              <SidebarPanel embedded />
            </div>
          </Panel>
          <HoverResizeHandle direction="vertical" />
          <Panel id="shell-main" minSize={30} defaultSize={78}>
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