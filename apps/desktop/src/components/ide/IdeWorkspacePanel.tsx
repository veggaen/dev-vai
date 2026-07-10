/**
 * Unified IDE builder panel — editor + app preview + terminal (file tree lives in sidebar).
 */

import { useRef } from 'react';
import { Group, Panel } from 'react-resizable-panels';
import { syncPanelCollapsedAttr } from '../../lib/panel-collapse.js';
import { useWorkspaceStore } from '../../stores/workspaceStore.js';
import { useSandboxStore } from '../../stores/sandboxStore.js';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { EditorTabs } from './EditorTabs.js';
import { DiffReviewPanel } from './DiffReviewPanel.js';
import { TerminalPanel } from './TerminalPanel.js';
import { LocalAppPreview } from './LocalAppPreview.js';
import { PreviewPanel } from '../PreviewPanel.js';
import { FileExplorer } from '../FileExplorer.js';
import { HoverResizeHandle } from '../workspace/HoverResizeHandle.js';

export function IdeWorkspacePanel() {
  const consoleElementRef = useRef<HTMLDivElement>(null);
  const localRoot = useWorkspaceStore((s) => s.localRoot);

  const projectId = useSandboxStore((s) => s.projectId);
  const sandboxStatus = useSandboxStore((s) => s.status);
  const showDebugConsole = useLayoutStore((s) => s.showDebugConsole);
  const showFileExplorer = useLayoutStore((s) => s.showFileExplorer);

  const hasSandbox = projectId !== null;
  const hasLocal = Boolean(localRoot);
  const canShowConsole = hasLocal || hasSandbox || sandboxStatus === 'failed';
  const showSandboxTree = hasSandbox && showFileExplorer && !hasLocal;

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <Group id="vai-builder-layout" orientation="vertical">
        <Panel
          id="ide-main"
          defaultSize={canShowConsole && showDebugConsole ? '68' : '100'}
          minSize="30"
        >
          <Group id="vai-ide-main-row" orientation="horizontal">
            {hasLocal ? (
              <>
                <Panel id="editor" defaultSize="48" minSize="22">
                  <EditorTabs />
                </Panel>
                <HoverResizeHandle direction="vertical" />
                <Panel id="app-preview" defaultSize="52" minSize="24">
                  <LocalAppPreview />
                </Panel>
              </>
            ) : showSandboxTree ? (
              <>
                <Panel id="sandbox-files" defaultSize="30" minSize="16" collapsible>
                  <FileExplorer />
                </Panel>
                <HoverResizeHandle direction="vertical" />
                <Panel id="preview" defaultSize="70" minSize="24">
                  <PreviewPanel />
                </Panel>
              </>
            ) : (
              <Panel id="preview" defaultSize="100" minSize="20">
                <PreviewPanel />
              </Panel>
            )}
          </Group>
        </Panel>

        {canShowConsole && showDebugConsole && (
          <>
            <HoverResizeHandle direction="horizontal" />
            <Panel
              id="console"
              elementRef={consoleElementRef}
              defaultSize="28"
              minSize="10"
              collapsible
              collapsedSize={0}
              onResize={(size) => syncPanelCollapsedAttr(consoleElementRef.current, size)}
            >
              <TerminalPanel />
            </Panel>
          </>
        )}
      </Group>
      <DiffReviewPanel />
    </div>
  );
}

export default IdeWorkspacePanel;
