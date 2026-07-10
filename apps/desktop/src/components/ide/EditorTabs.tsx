/**
 * Multi-tab Monaco editor — view/edit files only; agent chat lives in ChatWindow.
 */

import { X, Loader2 } from 'lucide-react';
import { MonacoEditor } from './MonacoEditor.js';
import { useWorkspaceStore } from '../../stores/workspaceStore.js';

export function EditorTabs() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const editorDraft = useWorkspaceStore((s) => s.editorDraft);
  const busy = useWorkspaceStore((s) => s.busy);
  const setEditorDraft = useWorkspaceStore((s) => s.setEditorDraft);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const proposeManualEdit = useWorkspaceStore((s) => s.proposeManualEdit);

  if (tabs.length === 0 || !activeTabPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-xs font-medium text-[color:var(--chat-body)]">File editor</p>
        <p className="max-w-xs text-[11px] leading-relaxed text-[color:var(--chat-muted)]">
          Open a file from the sidebar tree to view or edit it here.
          Talk to the agent in the main chat — one place for all project questions.
        </p>
      </div>
    );
  }

  const active = tabs.find((t) => t.path === activeTabPath);
  const dirty = active ? active.draft !== active.original : false;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#1e1e1e]">
      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-white/[0.06] bg-[#252526] px-1 py-0.5">
        {tabs.map((tab) => {
          const isActive = tab.path === activeTabPath;
          const isDirty = tab.draft !== tab.original;
          return (
            <div
              key={tab.path}
              className={`group flex max-w-[180px] shrink-0 items-center gap-1 rounded-t px-2 py-1 text-[11px] ${
                isActive
                  ? 'bg-[#1e1e1e] text-[color:var(--chat-body)]'
                  : 'text-[color:var(--chat-muted)] hover:bg-white/[0.04]'
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveTab(tab.path)}
                className="min-w-0 flex-1 truncate text-left font-mono"
                title={tab.path}
              >
                {tab.path.split('/').pop()}
                {isDirty && <span className="ml-0.5 text-violet-400">•</span>}
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.path}`}
                onClick={() => closeTab(tab.path)}
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[color:var(--chat-muted)]">
          {activeTabPath}
        </span>
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={proposeManualEdit}
          className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-[color:var(--chat-body)] hover:bg-white/[0.1] disabled:opacity-40"
        >
          Propose change
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <MonacoEditor
          path={activeTabPath}
          value={editorDraft}
          onChange={setEditorDraft}
        />
      </div>

      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <Loader2 className="h-5 w-5 animate-spin text-[color:var(--accent-text)]" />
        </div>
      )}
    </div>
  );
}

export default EditorTabs;