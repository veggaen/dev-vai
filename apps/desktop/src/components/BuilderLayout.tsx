import {
  Panel,
  Group,
  Separator,
} from 'react-resizable-panels';
import { Sidebar } from './Sidebar.js';
import { ChatWindow } from './ChatWindow.js';
import { PreviewPanel } from './PreviewPanel.js';
import { DebugConsole } from './DebugConsole.js';
import { useLayoutStore } from '../stores/layoutStore.js';

/**
 * Builder Layout — 3-pane resizable workspace:
 *   Left   : Sidebar (min 200px)
 *   Center : Chat (min 300px)
 *   Right  : Preview (top) + Debug Console (bottom), min 350px
 *
 * Drag handles have a blue hover glow.
 */
export function BuilderLayout() {
  const { showDebugConsole } = useLayoutStore();

  return (
    <Group orientation="horizontal" className="h-screen bg-zinc-950">
      {/* Left — Sidebar */}
      <Panel defaultSize={18} minSize={12} maxSize={25}>
        <Sidebar />
      </Panel>

      <Separator className="w-[3px] bg-zinc-800 transition-colors hover:bg-blue-500/60 active:bg-blue-500" />

      {/* Center — Chat */}
      <Panel defaultSize={42} minSize={25}>
        <ChatWindow />
      </Panel>

      <Separator className="w-[3px] bg-zinc-800 transition-colors hover:bg-blue-500/60 active:bg-blue-500" />

      {/* Right — Preview + Debug Console */}
      <Panel defaultSize={40} minSize={22}>
        <Group orientation="vertical">
          <Panel defaultSize={showDebugConsole ? 65 : 100} minSize={30}>
            <PreviewPanel />
          </Panel>

          {showDebugConsole && (
            <>
              <Separator className="h-[3px] bg-zinc-800 transition-colors hover:bg-blue-500/60 active:bg-blue-500" />
              <Panel defaultSize={35} minSize={15} maxSize={60}>
                <DebugConsole />
              </Panel>
            </>
          )}
        </Group>
      </Panel>
    </Group>
  );
}
