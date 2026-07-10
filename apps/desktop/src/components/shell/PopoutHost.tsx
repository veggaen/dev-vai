/**
 * PopoutHost — a detached panel living in its own OS window.
 * Renders exactly one workspace panel full-window with a slim return strip.
 */

import { Suspense, lazy, useEffect } from 'react';
import { ArrowLeftToLine, MessageSquare, AppWindow, SquareTerminal, Code2, GitCompare } from 'lucide-react';
import { initPopoutChildWindow, type PopoutPanel } from '../../stores/popoutStore.js';
import { useChatStore } from '../../stores/chatStore.js';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { useSandboxStore } from '../../stores/sandboxStore.js';
import { TerminalPanel } from '../ide/TerminalPanel.js';

const ChatWindow = lazy(() => import('../ChatWindow.js').then((m) => ({ default: m.ChatWindow })));
const IdeWorkspacePanel = lazy(() => import('../ide/IdeWorkspacePanel.js').then((m) => ({ default: m.IdeWorkspacePanel })));
const CodeView = lazy(() => import('../PreviewPanel.js').then((m) => ({ default: m.CodeView })));
const DiffReviewPanel = lazy(() => import('../ide/DiffReviewPanel.js').then((m) => ({ default: m.DiffReviewPanel })));

const PANEL_META: Record<PopoutPanel, { label: string; icon: typeof MessageSquare }> = {
  chat: { label: 'Chat', icon: MessageSquare },
  app: { label: 'App workspace', icon: AppWindow },
  code: { label: 'Code', icon: Code2 },
  diff: { label: 'Diff review', icon: GitCompare },
  console: { label: 'Console', icon: SquareTerminal },
};

export function PopoutHost({ panel }: { panel: PopoutPanel }) {
  const themePreference = useLayoutStore((s) => s.themePreference);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const attachProject = useSandboxStore((s) => s.attachProject);
  const projectId = useSandboxStore((s) => s.projectId);

  useEffect(() => {
    initPopoutChildWindow(panel);
    if (panel === 'chat') void fetchConversations();
    if (panel === 'app' || panel === 'code' || panel === 'diff') {
      const projectId = new URLSearchParams(window.location.search).get('projectId');
      if (projectId) void attachProject(projectId);
    }
  }, [panel, fetchConversations, attachProject]);

  const meta = PANEL_META[panel];
  const Icon = meta.icon;

  return (
    <div
      data-theme={themePreference}
      data-popout-panel={panel}
      className="popout-host flex h-dvh w-full flex-col overflow-hidden bg-[color:var(--bg)] text-[color:var(--fg)]"
    >
      <header className="popout-strip flex h-8 shrink-0 items-center gap-2 border-b border-[color:var(--shell-line-soft)] bg-[color:var(--panel)]/70 px-3 backdrop-blur-md">
        <Icon className="h-3.5 w-3.5 text-[color:var(--accent-text)]" aria-hidden />
        <span className="text-[11px] font-semibold tracking-wide text-[color:var(--fg)]">
          {meta.label}
        </span>
        <span className="text-[10px] text-[color:var(--color-muted)]">— detached window</span>
        <button
          type="button"
          onClick={() => window.close()}
          className="ml-auto flex h-6 items-center gap-1.5 rounded-md border border-[color:var(--shell-line-soft)] px-2 text-[10px] font-medium text-[color:var(--color-muted)] transition-colors hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
          title="Close and return this panel to the main window"
        >
          <ArrowLeftToLine className="h-3 w-3" aria-hidden />
          Return to main
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-[color:var(--color-muted)]">
              Loading {meta.label.toLowerCase()}…
            </div>
          }
        >
          {panel === 'chat' && <ChatWindow />}
          {panel === 'app' && <IdeWorkspacePanel />}
          {panel === 'code' && (
            projectId ? (
              <CodeView projectId={projectId} />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-xs text-[color:var(--color-muted)]">
                No active sandbox code is attached to this popout yet.
              </div>
            )
          )}
          {panel === 'diff' && <DiffReviewPanel detached />}
          {panel === 'console' && <TerminalPanel />}
        </Suspense>
      </main>
    </div>
  );
}

export default PopoutHost;
