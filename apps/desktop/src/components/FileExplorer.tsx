import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { API_BASE } from '../lib/api.js';
import {
  FolderTree, File, FolderOpen, Folder, ChevronRight, ChevronDown,
  RefreshCw, Trash2, Plus, Copy, Download, Search, X, Loader2,
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
        child = { name: part, path: currentPath, isDir: !isLast, children: [] };
        current.children.push(child);
      }
      current = child;
    }
  }

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
  tsx: 'text-blue-400', ts: 'text-blue-400',
  jsx: 'text-yellow-400', js: 'text-yellow-400',
  css: 'text-purple-400', html: 'text-orange-400',
  json: 'text-green-400', md: 'text-zinc-400',
  py: 'text-green-400', toml: 'text-orange-300',
  yaml: 'text-rose-300', yml: 'text-rose-300',
  env: 'text-zinc-500', sh: 'text-zinc-400',
  sql: 'text-cyan-400', svg: 'text-pink-400',
  png: 'text-pink-300', jpg: 'text-pink-300',
};

function getFileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return EXT_COLORS[ext] || 'text-zinc-500';
}

/* ── Line-level syntax coloring ── */
function getLineClass(line: string): string {
  if (/^\s*(import|export|from)\b/.test(line)) return 'text-violet-400';
  if (/^\s*(const|let|var|function|class|interface|type)\b/.test(line)) return 'text-blue-400';
  if (/^\s*\/\//.test(line)) return 'text-zinc-600';
  if (/^\s*return\b/.test(line)) return 'text-amber-400';
  if (/['"`]/.test(line)) return 'text-emerald-400';
  if (/^\s*</.test(line)) return 'text-orange-300';
  return 'text-zinc-300';
}

/* ── Tree node component ── */
function TreeItem({
  node, depth, selectedPath, onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
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
            ? 'bg-violet-500/15 text-violet-300'
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
        {node.isDir && node.children.length > 0 && (
          <span className="ml-auto text-[9px] text-zinc-700">{node.children.length}</span>
        )}
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

/* ── Syntax-highlighted file content viewer ── */
function FileViewer({ filePath }: { filePath: string }) {
  const { projectId } = useSandboxStore();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!projectId || !filePath) return;
    setLoading(true);
    fetch(`${API_BASE}/api/sandbox/${projectId}/file?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data: { content: string }) => setContent(data.content))
      .catch(() => setContent('// Failed to load file'))
      .finally(() => setLoading(false));
  }, [projectId, filePath]);

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!content) return;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split('/').pop() || 'file.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
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

  const lines = content.split('\n');

  return (
    <div className="flex h-full flex-col">
      {/* Viewer header */}
      <div className="flex items-center justify-between border-b border-zinc-800/40 px-2 py-1">
        <span className="truncate text-[10px] text-zinc-500">{filePath}</span>
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] text-zinc-700">{lines.length} lines</span>
          <button onClick={handleCopy}
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
            <Copy className="h-2.5 w-2.5" />
            {copied ? 'Copied!' : ''}
          </button>
          <button onClick={handleDownload}
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" title="Download">
            <Download className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>

      {/* Syntax-highlighted code */}
      <div className="flex flex-1 overflow-auto bg-zinc-950 text-[11px] leading-5 font-mono">
        {/* Line numbers */}
        <div className="sticky left-0 flex flex-col items-end border-r border-zinc-800/40 bg-zinc-950 px-1.5 py-1 text-zinc-700 select-none">
          {lines.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        {/* Code */}
        <pre className="flex-1 overflow-x-auto px-2 py-1">
          {lines.map((line, i) => (
            <div key={i} className={`${getLineClass(line)} hover:bg-zinc-800/20`}>
              {line || ' '}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

/* ── Main FileExplorer component ── */
export function FileExplorer() {
  const { projectId, projectName, files, status, fetchFiles, destroyProject } = useSandboxStore();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showViewer, setShowViewer] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const tree = useMemo(() => buildTree(files), [files]);

  // Filter tree by search
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return tree;
    const q = searchQuery.toLowerCase();
    const filterNode = (node: TreeNode): TreeNode | null => {
      if (!node.isDir) {
        return node.name.toLowerCase().includes(q) ? node : null;
      }
      const filteredChildren = node.children.map(filterNode).filter(Boolean) as TreeNode[];
      if (filteredChildren.length === 0) return null;
      return { ...node, children: filteredChildren };
    };
    return tree.map(filterNode).filter(Boolean) as TreeNode[];
  }, [tree, searchQuery]);

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
            onClick={() => { setShowSearch((v) => !v); if (showSearch) setSearchQuery(''); }}
            className={`rounded p-1 transition-colors ${showSearch ? 'text-violet-400' : 'text-zinc-600'} hover:bg-zinc-800`}
            title="Search files"
          >
            <Search className="h-3 w-3" />
          </button>
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

      {/* Search bar */}
      {showSearch && (
        <div className="flex items-center gap-1.5 border-b border-zinc-800/60 bg-zinc-900/40 px-3 py-1">
          <Search className="h-3 w-3 text-zinc-600" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
            className="flex-1 bg-transparent text-xs text-zinc-300 placeholder-zinc-600 outline-none"
            autoFocus
          />
          {searchQuery && (
            <span className="text-[9px] text-zinc-500">
              {filteredTree.reduce((acc, n) => acc + (n.isDir ? n.children.length : 1), 0)} matches
            </span>
          )}
          <button onClick={() => { setSearchQuery(''); setShowSearch(false); }}
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-300">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* File tree + optional viewer */}
      <div className="flex flex-1 min-h-0">
        {/* Tree pane */}
        <div className={`overflow-y-auto overflow-x-hidden py-1 ${showViewer ? 'w-[40%] border-r border-zinc-800' : 'flex-1'}`}>
          {filteredTree.length === 0 ? (
            <div className="px-3 py-4 text-xs text-zinc-600">
              {searchQuery ? 'No matching files' :
               status === 'installing' ? 'Installing dependencies...' :
               status === 'creating' ? 'Creating project...' :
               status === 'writing' ? 'Writing files...' :
               'No files yet'}
            </div>
          ) : (
            filteredTree.map((node) => (
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

        {/* Syntax-highlighted file viewer pane */}
        {showViewer && selectedFile && (
          <div className="flex flex-1 flex-col min-w-0">
            <FileViewer filePath={selectedFile} />
            {/* Close button overlay */}
            <button
              onClick={() => { setShowViewer(false); setSelectedFile(null); }}
              className="absolute right-1 top-1 rounded p-0.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
              title="Close viewer"
            >
              <Plus className="h-3 w-3 rotate-45" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
