/**
 * Hierarchical file tree — folders + subfolders, click file to open in editor.
 */

import { useMemo, useState, useCallback } from 'react';
import {
  FileText, FolderOpen, Folder, Loader2, RefreshCw, ChevronRight, ChevronDown,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.js';
import { useLayoutStore } from '../../stores/layoutStore.js';
import type { WorkspaceEntry } from '../../lib/ide/workspace-client.js';

interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
}

function buildTree(entries: readonly WorkspaceEntry[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const e of entries) {
    nodes.set(e.path, {
      name: e.path.split('/').pop() ?? e.path,
      path: e.path,
      dir: e.dir,
      children: [],
    });
  }
  const roots: TreeNode[] = [];
  for (const e of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const node = nodes.get(e.path);
    if (!node) continue;
    const slash = e.path.lastIndexOf('/');
    if (slash < 0) {
      roots.push(node);
      continue;
    }
    const parentPath = e.path.slice(0, slash);
    const parent = nodes.get(parentPath);
    if (parent && !parent.children.some((c) => c.path === node.path)) {
      parent.children.push(node);
    } else if (!parent) {
      roots.push(node);
    }
  }
  const sortNodes = (list: TreeNode[]): TreeNode[] =>
    list
      .map((n) => ({ ...n, children: sortNodes(n.children) }))
      .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name)));
  return sortNodes(roots);
}

function TreeRow({
  node,
  depth,
  openRel,
  expanded,
  onToggle,
  onOpenFile,
}: {
  node: TreeNode;
  depth: number;
  openRel: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const pad = { paddingLeft: `${8 + depth * 14}px` };

  if (node.dir) {
    return (
      <>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          className="flex w-full items-center gap-1 truncate rounded py-0.5 text-left font-mono text-[11px] text-[color:var(--chat-muted)] hover:bg-white/[0.05] hover:text-[color:var(--chat-body)]"
          style={pad}
          title={node.path}
        >
          {isOpen
            ? <ChevronDown size={11} className="shrink-0 opacity-60" />
            : <ChevronRight size={11} className="shrink-0 opacity-60" />}
          <Folder size={11} className="shrink-0 text-amber-400/70" />
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            openRel={openRel}
            expanded={expanded}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
          />
        ))}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenFile(node.path)}
      className={`flex w-full items-center gap-1 truncate rounded py-0.5 text-left font-mono text-[11px] transition-colors hover:bg-white/[0.05] ${
        openRel === node.path ? 'bg-white/[0.08] text-white' : 'text-[color:var(--chat-muted)]'
      }`}
      style={pad}
      title={node.path}
    >
      <span className="w-[11px] shrink-0" />
      <FileText size={11} className="shrink-0 opacity-60" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function FileTreePanel({ compact = false }: { compact?: boolean }) {
  const localRoot = useWorkspaceStore((s) => s.localRoot);
  const localName = useWorkspaceStore((s) => s.localName);
  const tree = useWorkspaceStore((s) => s.tree);
  const openRel = useWorkspaceStore((s) => s.openRel);
  const busy = useWorkspaceStore((s) => s.busy);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);

  const nodes = useMemo(() => buildTree(tree), [tree]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['apps', 'packages', 'src']));

  const onToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const onOpenFile = useCallback((path: string) => {
    void openFile(path);
    const layout = useLayoutStore.getState();
    layout.setLayoutMode('odyssey');
    layout.expandBuilder();
  }, [openFile]);

  if (!localRoot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <FolderOpen className="h-8 w-8 text-[color:var(--chat-muted)] opacity-40" />
        <p className="text-xs text-[color:var(--chat-muted)]">
          Attach a folder from the composer chip or press Ctrl+Shift+O
        </p>
      </div>
    );
  }

  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden bg-[color:var(--shell-bg)] ${compact ? '' : ''}`}>
      {!compact && (
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
          <FolderOpen size={14} className="text-[color:var(--accent-text)]" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-[color:var(--chat-body)]">
            {localName}
          </span>
          <button
            type="button"
            title="Refresh"
            onClick={() => void refreshTree()}
            className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/[0.06]"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-1">
        {nodes.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            openRel={openRel}
            expanded={expanded}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
          />
        ))}
        {nodes.length === 0 && (
          <p className="px-2 py-2 text-[11px] text-[color:var(--chat-muted)]">No files in workspace.</p>
        )}
      </div>
    </div>
  );
}

export default FileTreePanel;