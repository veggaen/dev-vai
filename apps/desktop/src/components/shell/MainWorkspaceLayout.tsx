/**
 * Chat + builder split — drag the divider left to hide chat (console-style collapse).
 */

import { useRef, type ReactNode } from 'react';
import { Group, Panel } from 'react-resizable-panels';
import { ExternalLink, ArrowLeftToLine } from 'lucide-react';
import { HoverResizeHandle } from '../workspace/HoverResizeHandle.js';
import { syncPanelCollapsedAttr } from '../../lib/panel-collapse.js';
import { usePopoutStore } from '../../stores/popoutStore.js';
import type { LayoutMode } from '../../stores/layoutStore.js';

interface MainWorkspaceLayoutProps {
  readonly children: ReactNode;
  readonly builder: ReactNode;
  readonly showBuilder: boolean;
  readonly previewExpanded: boolean;
  readonly layoutMode: LayoutMode;
}

export function MainWorkspaceLayout({
  children,
  builder,
  showBuilder,
  previewExpanded,
  layoutMode,
}: MainWorkspaceLayoutProps) {
  const chatElementRef = useRef<HTMLDivElement>(null);
  const isOdyssey = layoutMode === 'odyssey';
  const popped = usePopoutStore((s) => s.popped);
  const reclaim = usePopoutStore((s) => s.reclaim);
  const chatPopped = popped.includes('chat');
  const appPopped = popped.includes('app');
  const showChatHere = !previewExpanded && !chatPopped;
  const showBuilderHere = showBuilder && !appPopped;
  const canCollapseChat = showBuilderHere && !previewExpanded;

  const onChatResize = (size: { asPercentage: number; inPixels: number }) => {
    syncPanelCollapsedAttr(chatElementRef.current, size);
  };

  // Everything is floating on other screens — show a calm reclaim surface.
  if (!showChatHere && !showBuilderHere) {
    return (
      <div className="layout-panel relative flex h-full min-w-0 flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <ExternalLink className="h-6 w-6 text-[color:var(--accent-text)]" aria-hidden />
          <p className="text-[13px] font-medium text-[color:var(--fg)]">Panels are floating on other screens</p>
          <p className="max-w-[36ch] text-[11.5px] text-[color:var(--color-muted)]">
            Chat{showBuilder ? ' and the app workspace are' : ' is'} detached into separate windows.
          </p>
          <div className="mt-1 flex items-center gap-2">
            {chatPopped && (
              <button
                type="button"
                onClick={() => reclaim('chat')}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-[color:var(--shell-line-soft)] px-3 text-[11px] font-medium text-[color:var(--color-muted)] transition-colors hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]"
              >
                <ArrowLeftToLine className="h-3.5 w-3.5" aria-hidden /> Bring chat back
              </button>
            )}
            {appPopped && showBuilder && (
              <button
                type="button"
                onClick={() => reclaim('app')}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-[color:var(--shell-line-soft)] px-3 text-[11px] font-medium text-[color:var(--color-muted)] transition-colors hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]"
              >
                <ArrowLeftToLine className="h-3.5 w-3.5" aria-hidden /> Bring app back
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    // h-full is required: inside react-resizable-panels' block wrapper, flex-1
    // alone never resolves a height and the workspace collapses to its header.
    <div className={`layout-panel relative h-full min-w-0 flex-1 ${isOdyssey ? 'layout-panel--odyssey-host' : ''}`}>
      <Group
        id="vai-main-layout"
        orientation="horizontal"
        className={isOdyssey ? 'odyssey-workspace-row h-full' : 'h-full'}
      >
        {showChatHere && (
          <Panel
            id="chat"
            elementRef={chatElementRef}
            defaultSize={showBuilderHere ? '55' : '100'}
            minSize={showBuilderHere ? 18 : 30}
            collapsible={canCollapseChat}
            collapsedSize={0}
            onResize={onChatResize}
          >
            <div className={isOdyssey ? 'odyssey-bubble h-full min-h-0' : 'h-full min-h-0'}>
              {children}
            </div>
          </Panel>
        )}

        {showBuilderHere && (
          <>
            {showChatHere && <HoverResizeHandle direction="vertical" />}
            <Panel
              id="builder"
              defaultSize={previewExpanded || !showChatHere ? '100' : '45'}
              minSize={previewExpanded || !showChatHere ? '100' : 22}
              collapsible={!previewExpanded && showChatHere}
              collapsedSize={0}
            >
              <div className={isOdyssey ? 'odyssey-bubble h-full min-h-0' : 'h-full min-h-0'}>
                {builder}
              </div>
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}

export default MainWorkspaceLayout;