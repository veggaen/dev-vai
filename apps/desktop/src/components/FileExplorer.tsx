import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { API_BASE } from '../lib/api.js';
import {
  FolderTree, File, FolderOpen, Folder, ChevronRight, ChevronDown,
  RefreshCw, Trash2, Plus,
} from 'lucide-react';

/* ── Tree node type ── */
interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

/**
 * Build a tree structure from flat file paths.
 * Input: ['src/App.tsx', 'src/index.css', 'package.json']
 * Output: nested TreeNode[]
 */
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };

  for (const filePath of paths.sort()) {
    const parts = filePath.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: currentPath,
          isDir: !isLast,
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Sort: folders first, then alphabetical
  const sortChildren = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortChildren);
  };
  sortChildren(root);

  return root.children;
}

/* ── File icon color map ── */
const EXT_COLORS: Record<string, string> = {
  tsx: 'text-blue-400',
  ts: 'text-blue-400',
  jsx: 'text-yellow-400',
  js: 'text-yellow-400',
  css: 'text-purple-400',
  html: 'text-orange-400',
  json: 'text-green-400',
  md: 'text-zinc-400',
  py: 'text-green-400',
  toml: 'text-orange-300',
  yaml: 'text-rose-300',
  yml: 'text-rose-300',
  env: 'text-zinc-500',
  sh: 'text-zinc-400',
  sql: 'text-cyan-400',
};

function getFileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return EXT_COLORS[ext] || 'text-zinc-500';
}

/* ── Tree node component ── */
function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2); // auto-expand top 2 levels

  const isSelected = selectedPath === node.path;

  const handleClick = () => {
    if (node.isDir) {
      setExpanded((e) => !e);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={`flex w-full items-center gap-1 rounded px-1 py-[3px] text-left text-xs transition-colors ${
          isSelected
            ? 'bg-blue-500/15 text-blue-300'
            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {node.isDir ? (
          <>
            {expanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-zinc-600" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600" />
            )}
            {expanded ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            )}
          </>
        ) : (
          <>
            <span className="w-3" />
            <File className={`h-3.5 w-3.5 shrink-0 ${getFileColor(node.name)}`} />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {node.isDir && expanded && node.children.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

/* ── File content viewer ── */
function FileViewer({ filePath }: { filePath: string }) {
  const { projectId } = useSandboxStore();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId || !filePath) return;
    setLoading(true);
    fetch(`${API_BASE}/api/sandbox/${projectId}/file?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data: { content: string }) => setContent(data.content))
      .catch(() => setContent('// Failed to load file'))
      .finally(() => setLoading(false));
  }, [projectId, filePath]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-600">
        Loading...
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-600">
        Select a file to view
      </div>
    );
  }

  return (
    <pre className="h-full overflow-auto p-2 text-[11px] leading-relaxed text-zinc-300 font-mono">
      {content}
    </pre>
  );
}

/* ── Main FileExplorer component ── */
export function FileExplorer() {
  const { projectId, projectName, files, status, fetchFiles, destroyProject } = useSandboxStore();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showViewer, setShowViewer] = useState(false);

  const tree = useMemo(() => buildTree(files), [files]);

  // Refresh file list when project changes or status updates
  useEffect(() => {
    if (projectId && (status === 'running' || status === 'idle')) {
      fetchFiles();
    }
  }, [projectId, status, fetchFiles]);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedFile(path);
    setShowViewer(true);
  }, []);

  if (!projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <FolderTree className="mb-2 h-8 w-8 text-zinc-700" />
        <p className="text-xs text-zinc-600">No project active</p>
        <p className="mt-1 text-[10px] text-zinc-700">
          Use a template or ask Vai in Builder mode to scaffold a project.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <FolderTree className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span className="truncate text-xs font-medium text-zinc-300">
            {projectName || 'Project'}
          </span>
          <span className="text-[10px] text-zinc-600">
            {files.length} file{files.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => fetchFiles()}
            className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="Refresh files"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            onClick={destroyProject}
            className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
            title="Delete project"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* File tree + optional viewer */}
      <div className="flex flex-1 min-h-0">
        {/* Tree pane */}
        <div className={`overflow-y-auto overflow-x-hidden py-1 ${showViewer ? 'w-[45%] border-r border-zinc-800' : 'flex-1'}`}>
          {tree.length === 0 ? (
            <div className="px-3 py-4 text-xs text-zinc-600">
              {status === 'installing' ? 'Installing dependencies...' :
               status === 'creating' ? 'Creating project...' :
               status === 'writing' ? 'Writing files...' :
               'No files yet'}
            </div>
          ) : (
            tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedFile}
                onSelect={handleSelectFile}
              />
            ))
          )}
        </div>

        {/* File viewer pane */}
        {showViewer && selectedFile && (
          <div className="flex flex-1 flex-col min-w-0">
            <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1">
              <span className="truncate text-[10px] text-zinc-500">{selectedFile}</span>
              <button
                onClick={() => { setShowViewer(false); setSelectedFile(null); }}
                className="rounded p-0.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                title="Close viewer"
              >
                <Plus className="h-3 w-3 rotate-45" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-zinc-900/50">
              <FileViewer filePath={selectedFile} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
