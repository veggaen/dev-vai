import { useSandboxStore } from '../stores/sandboxStore.js';
import { API_BASE } from '../lib/api.js';
import {
  Globe, RefreshCw, Smartphone, Tablet, Monitor, Copy, ExternalLink,
  Code2, Eye, EyeOff, Trash2, Download, CheckCircle, XCircle, Loader2,
  Camera, Terminal, FolderTree, Play, Square, Maximize2, Minimize2,
  ArrowLeft, ArrowRight,
} from 'lucide-react';
import { useState, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TemplateGallery } from './TemplateGallery.js';
import { DeployProgress } from './DeployProgress.js';
import { useLayoutStore } from '../stores/layoutStore.js';
import { useCursorStore } from '../stores/cursorStore.js';

/* ── Types ── */

type ViewMode = 'preview' | 'code';
type BreakpointKey = 'mobile' | 'tablet' | 'desktop';

const BREAKPOINTS: Record<BreakpointKey, { width: number; icon: typeof Smartphone; label: string }> = {
  mobile:  { width: 375,  icon: Smartphone, label: 'Mobile (375px)' },
  tablet:  { width: 768,  icon: Tablet,     label: 'Tablet (768px)' },
  desktop: { width: 1280, icon: Monitor,    label: 'Desktop (full)' },
};

const STEP_ORDER = ['creating', 'writing', 'installing', 'building', 'running'] as const;

const STEP_LABELS: Record<string, string> = {
  creating: 'Creating',
  writing: 'Writing files',
  installing: 'Installing',
  building: 'Building',
  running: 'Running',
};

/* ── Line-level syntax coloring for code view ── */
function getLineClass(line: string): string {
  if (/^\s*(import|export|from)\b/.test(line)) return 'text-violet-400';
  if (/^\s*(const|let|var|function|class|interface|type)\b/.test(line)) return 'text-blue-400';
  if (/^\s*\/\//.test(line)) return 'text-zinc-600';
  if (/^\s*return\b/.test(line)) return 'text-amber-400';
  if (/['"`]/.test(line)) return 'text-emerald-400';
  return 'text-zinc-300';
}

/* ═══════════════════════════════════
   Build Step Progress Bar
   ═══════════════════════════════════ */
function BuildStepProgress({ status }: { status: string }) {
  const currentIdx = STEP_ORDER.indexOf(status as typeof STEP_ORDER[number]);

  return (
    <div className="flex items-center gap-1 border-b border-zinc-800/60 px-3 py-1.5">
      {STEP_ORDER.map((step, i) => {
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;
        const isFailed = isCurrent && status === 'failed';

        return (
          <div key={step} className="flex items-center gap-1">
            <div className="flex items-center gap-1">
              {isDone ? (
                <CheckCircle className="h-3 w-3 text-emerald-500" />
              ) : isFailed ? (
                <XCircle className="h-3 w-3 text-red-500" />
              ) : isCurrent ? (
                <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
              ) : (
                <div className="h-3 w-3 rounded-full border border-zinc-700" />
              )}
              <span className={`text-[10px] ${
                isDone ? 'text-emerald-400' :
                isFailed ? 'text-red-400' :
                isCurrent ? 'text-blue-400' :
                'text-zinc-600'
              }`}>
                {STEP_LABELS[step] || step}
              </span>
            </div>
            {i < STEP_ORDER.length - 1 && (
              <div className={`h-px w-3 ${isDone ? 'bg-emerald-500/50' : 'bg-zinc-800'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════
   Code View — syntax-highlighted source viewer
   ═══════════════════════════════════ */
function CodeView({ projectId }: { projectId: string }) {
  const { files } = useSandboxStore();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Auto-select first meaningful file
  useEffect(() => {
    if (!selectedFile && files.length > 0) {
      const preferredFile = files.find((f) =>
        f.endsWith('App.tsx') || f.endsWith('App.jsx') || f.endsWith('index.tsx') || f.endsWith('page.tsx')
      ) || files.find((f) => f.endsWith('.tsx') || f.endsWith('.jsx')) || files[0];
      setSelectedFile(preferredFile);
    }
  }, [files, selectedFile]);

  // Fetch file content
  useEffect(() => {
    if (!selectedFile || !projectId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/sandbox/${projectId}/file?path=${encodeURIComponent(selectedFile)}`)
      .then((r) => r.json())
      .then((data: { content: string }) => setContent(data.content || '// Empty file'))
      .catch(() => setContent('// Failed to load file'))
      .finally(() => setLoading(false));
  }, [selectedFile, projectId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = content.split('\n');

  return (
    <div className="flex h-full flex-col">
      {/* File tabs — scrollable, auto-filtered */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-zinc-800/60 bg-zinc-900/30 px-2 py-1 scrollbar-none">
        {files.filter((f) => !f.includes('node_modules') && !f.endsWith('.lock')).slice(0, 12).map((f) => {
          const name = f.split('/').pop() || f;
          const isActive = selectedFile === f;
          return (
            <button
              key={f}
              onClick={() => setSelectedFile(f)}
              className={`shrink-0 rounded-md px-2 py-1 text-[10px] transition-colors ${
                isActive
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
              }`}
              title={f}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* File path header + actions */}
      <div className="flex items-center justify-between border-b border-zinc-800/40 px-3 py-1">
        <span className="truncate text-[10px] text-zinc-500">{selectedFile || 'No file selected'}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <Copy className="h-3 w-3" />
            {copied ? 'Copied!' : 'Copy'}
          </button>
          {content && (
            <button
              onClick={() => {
                const blob = new Blob([content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = selectedFile?.split('/').pop() || 'file.txt';
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              title="Download file"
            >
              <Download className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Code content with line numbers */}
      <div className="flex-1 overflow-auto bg-zinc-950">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
          </div>
        ) : (
          <div className="flex text-[11px] leading-5 font-mono">
            {/* Line numbers gutter */}
            <div className="sticky left-0 flex flex-col items-end border-r border-zinc-800/40 bg-zinc-950 px-2 py-2 text-zinc-700 select-none">
              {lines.map((_, i) => (
                <span key={i}>{i + 1}</span>
              ))}
            </div>
            {/* Code lines */}
            <pre className="flex-1 overflow-x-auto px-3 py-2">
              {lines.map((line, i) => (
                <div key={i} className={`${getLineClass(line)} hover:bg-zinc-800/20`}>
                  {line || ' '}
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Toolbar — Preview/Code toggle, URL bar, responsive breakpoints, actions
   ═══════════════════════════════════════════════════════════════════════ */
function Toolbar({
  viewMode, setViewMode, projectName, previewUrl, devPort,
  breakpoint, setBreakpoint, onRefresh, onOpenExternal, onCopyUrl,
  onScreenshot, onDestroy, showActions, copied, hasFiles, hasActiveSandbox,
  demoRunning, onToggleDemo, iframeRef,
}: {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  projectName: string | null;
  previewUrl: string;
  devPort: number | null;
  breakpoint: BreakpointKey;
  setBreakpoint: (b: BreakpointKey) => void;
  onRefresh: () => void;
  onOpenExternal: () => void;
  onCopyUrl: () => void;
  onScreenshot: () => void;
  onDestroy: () => void;
  showActions: boolean;
  copied?: boolean;
  hasFiles?: boolean;
  hasActiveSandbox?: boolean;
  demoRunning?: boolean;
  onToggleDemo?: () => void;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}) {
  const {
    showDebugConsole, showFileExplorer,
    toggleDebugConsole, toggleFileExplorer,
    previewExpanded, togglePreviewExpanded, toggleBuilderPanel,
  } = useLayoutStore();

  return (
    <div className="flex items-center gap-1.5 border-b border-zinc-800/60 px-2 py-1">
      {/* Browser nav buttons: back, forward, refresh */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => { try { iframeRef?.current?.contentWindow?.history.back(); } catch {} }}
          className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="Back"
        >
          <ArrowLeft className="h-3 w-3" />
        </button>
        <button
          onClick={() => { try { iframeRef?.current?.contentWindow?.history.forward(); } catch {} }}
          className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="Forward"
        >
          <ArrowRight className="h-3 w-3" />
        </button>
        <button
          onClick={onRefresh}
          className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Code view toggle — only when project has files */}
      {hasFiles && (
        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5">
          <button
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all ${
              viewMode === 'preview'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          <button
            onClick={() => setViewMode('code')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all ${
              viewMode === 'code'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Code2 className="h-3 w-3" />
            Code
          </button>
        </div>
      )}

      {/* URL bar */}
      <div className="flex flex-1 items-center gap-1 rounded-md bg-zinc-900/50 px-2 py-1 text-[10px]">
        <Globe className="h-3 w-3 shrink-0 text-zinc-600" />
        {projectName && <span className="shrink-0 text-zinc-600">{projectName}</span>}
        {devPort && <span className="truncate text-zinc-500">{previewUrl}</span>}
        {!devPort && !projectName && <span className="text-zinc-600">No project</span>}
      </div>

      {/* Actions */}
      {showActions && (
        <>
          {/* Responsive breakpoints group */}
          <div className="flex gap-0.5 rounded-md border border-zinc-800/50 p-0.5">
            {(Object.entries(BREAKPOINTS) as [BreakpointKey, typeof BREAKPOINTS[BreakpointKey]][]).map(
              ([key, { icon: Icon, label }]) => (
                <button
                  key={key}
                  onClick={() => setBreakpoint(key)}
                  className={`rounded p-1 transition-colors ${
                    breakpoint === key
                      ? 'bg-zinc-800 text-violet-400'
                      : 'text-zinc-600 hover:text-zinc-400'
                  }`}
                  title={label}
                >
                  <Icon className="h-3 w-3" />
                </button>
              ),
            )}
          </div>

          <button onClick={onCopyUrl} disabled={!devPort}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30" title={copied ? 'Copied!' : 'Copy URL'}>
            <Copy className="h-3 w-3" />
          </button>
          <button onClick={onScreenshot} disabled={!devPort}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30" title="Take screenshot">
            <Camera className="h-3 w-3" />
          </button>
          {onToggleDemo && (
            <button
              onClick={onToggleDemo}
              className={`rounded p-1 transition-colors ${
                demoRunning
                  ? 'text-red-400 hover:bg-zinc-800 hover:text-red-300'
                  : 'text-violet-400 hover:bg-zinc-800 hover:text-violet-300'
              }`}
              title={demoRunning ? 'Stop demo' : 'Run Vai demo sequence'}
            >
              {demoRunning ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3" />}
            </button>
          )}
          <button onClick={onOpenExternal} disabled={!devPort}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30" title="Open in new tab">
            <ExternalLink className="h-3 w-3" />
          </button>
          <button onClick={onDestroy}
            className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400" title="Destroy project">
            <Trash2 className="h-3 w-3" />
          </button>
        </>
      )}

      {/* Console + File explorer toggles — always visible when sandbox active */}
      {hasActiveSandbox && (
        <>
          <div className="mx-0.5 h-3.5 w-px bg-zinc-800" />
          <button
            onClick={toggleDebugConsole}
            title={showDebugConsole ? 'Hide console (Ctrl+J)' : 'Show console (Ctrl+J)'}
            className={`rounded p-1 transition-colors ${
              showDebugConsole
                ? 'text-emerald-400 hover:bg-zinc-800'
                : 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400'
            }`}
          >
            <Terminal className="h-3 w-3" />
          </button>
          <button
            onClick={toggleFileExplorer}
            title={showFileExplorer ? 'Hide files (Ctrl+E)' : 'Show files (Ctrl+E)'}
            className={`rounded p-1 transition-colors ${
              showFileExplorer
                ? 'text-amber-400 hover:bg-zinc-800'
                : 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400'
            }`}
          >
            <FolderTree className="h-3 w-3" />
          </button>
        </>
      )}

      {/* Right side: Hide preview + Expand/Shrink */}
      <div className="ml-auto flex items-center gap-0.5">
        <button
          onClick={toggleBuilderPanel}
          title="Hide preview (Ctrl+B)"
          className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
        >
          <EyeOff className="h-3 w-3" />
        </button>
        <button
          onClick={togglePreviewExpanded}
          title={previewExpanded ? 'Shrink preview' : 'Expand preview'}
          className={`rounded p-1 transition-colors ${
            previewExpanded
              ? 'text-violet-400 hover:bg-zinc-800 hover:text-violet-300'
              : 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400'
          }`}
        >
          {previewExpanded
            ? <Minimize2 className="h-3 w-3" />
            : <Maximize2 className="h-3 w-3" />
          }
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ██████  PREVIEW PANEL — Claude Artifacts-inspired sandbox preview
   ═══════════════════════════════════════════════════════════════════════ */
export function PreviewPanel() {
  const {
    status, devPort, projectName, projectId, files,
    deployPhase, deploySteps, deployStartTime, deployStackName, deployTierName,
    deployStack, destroyProject, cancelDeploy,
  } = useSandboxStore();

  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [breakpoint, setBreakpoint] = useState<BreakpointKey>('desktop');
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  /* ── Phase 0: cursor store (global — rendered by VaiOverlaySystem) ── */
  const demoRunning = useCursorStore((s) => s.demoRunning);
  const toggleDemo = useCursorStore((s) => s.toggleDemo);

  const previewUrl = devPort ? `http://localhost:${devPort}` : 'about:blank';
  const hasFiles = files.length > 0;
  const hasActiveSandbox = projectId !== null;

  // Reset to preview if code tab becomes unavailable
  useEffect(() => {
    if (viewMode === 'code' && !hasFiles) setViewMode('preview');
  }, [hasFiles, viewMode]);

  const refresh = useCallback(() => {
    if (iframeRef.current) {
      const url = new URL(iframeRef.current.src);
      url.searchParams.set('_t', String(Date.now()));
      iframeRef.current.src = url.toString();
    }
  }, []);

  const openExternal = () => { if (devPort) window.open(`http://localhost:${devPort}`, '_blank'); };

  const handleCopyUrl = () => {
    if (devPort) {
      navigator.clipboard.writeText(`http://localhost:${devPort}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleScreenshot = useCallback(() => {
    useCursorStore.getState().screenshot();
  }, []);

  // ── Empty state: template gallery ──
  if (!projectId && status === 'idle' && deployPhase === 'idle') {
    return (
      <div className="flex h-full flex-col bg-zinc-950">
        <Toolbar viewMode="preview" setViewMode={() => {}} projectName={null} previewUrl=""
          devPort={null} breakpoint={breakpoint} setBreakpoint={setBreakpoint}
          onRefresh={() => {}} onOpenExternal={() => {}} onCopyUrl={() => {}}
          onScreenshot={() => {}} onDestroy={() => {}} showActions={false}
          hasFiles={false} hasActiveSandbox={false}
          demoRunning={demoRunning} onToggleDemo={toggleDemo} />
        <div className="flex-1 min-h-0">
          <TemplateGallery onDeploy={(stackId, tier, stackName, tierName) => deployStack(stackId, tier, stackName, tierName)} isDeploying={false} />
        </div>
      </div>
    );
  }

  // ── Deploy in progress ──
  if (deployPhase === 'deploying' || deployPhase === 'failed') {
    return (
      <div className="flex h-full flex-col bg-zinc-950">
        <Toolbar viewMode="preview" setViewMode={() => {}} projectName={deployStackName} previewUrl=""
          devPort={null} breakpoint={breakpoint} setBreakpoint={setBreakpoint}
          onRefresh={() => {}} onOpenExternal={() => {}} onCopyUrl={() => {}}
          onScreenshot={() => {}} onDestroy={cancelDeploy} showActions={false}
          hasFiles={false} hasActiveSandbox={false}
          demoRunning={demoRunning} onToggleDemo={toggleDemo} />
        <div className="flex-1 overflow-hidden">
          <DeployProgress steps={deploySteps} stackName={deployStackName}
            tierName={deployTierName} startTime={deployStartTime}
            onCancel={cancelDeploy} onRetry={deployPhase === 'failed' ? () => {
              const id = deployStackName.toLowerCase().replace(/\s+/g, '-');
              deployStack(id, deployTierName, deployStackName, deployTierName);
            } : undefined} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* ── Toolbar ── */}
      <Toolbar
        viewMode={viewMode} setViewMode={setViewMode}
        projectName={projectName} previewUrl={previewUrl} devPort={devPort}
        breakpoint={breakpoint} setBreakpoint={setBreakpoint}
        onRefresh={refresh} onOpenExternal={openExternal} onCopyUrl={handleCopyUrl}
        onScreenshot={handleScreenshot} onDestroy={destroyProject}
        showActions copied={copied}
        hasFiles={hasFiles} hasActiveSandbox={hasActiveSandbox}
        demoRunning={demoRunning} onToggleDemo={toggleDemo}
        iframeRef={iframeRef}
      />

      {/* ── Build step progress (while building) ── */}
      {status !== 'idle' && status !== 'running' && (
        <BuildStepProgress status={status} />
      )}

      {/* ── Main content: Preview or Code ── */}
      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'preview' ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex h-full items-center justify-center bg-zinc-900/30 p-3"
            >
              {status === 'failed' ? (
                <div className="text-center">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 ring-1 ring-red-500/20">
                    <XCircle className="h-7 w-7 text-red-400" />
                  </div>
                  <p className="text-sm font-medium text-red-400">Build Failed</p>
                  <p className="mt-1 text-xs text-zinc-600">Check the console for error details</p>
                  <button onClick={refresh}
                    className="mt-3 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800">
                    Retry
                  </button>
                </div>
              ) : status === 'running' && devPort ? (
                <div
                  ref={previewContainerRef}
                  className="relative h-full overflow-hidden rounded-lg border border-zinc-800 bg-white shadow-xl shadow-black/20"
                  style={{ width: breakpoint === 'desktop' ? '100%' : BREAKPOINTS[breakpoint].width, maxWidth: '100%' }}
                >
                  <iframe ref={iframeRef} src={previewUrl} className="h-full w-full"
                    title="App Preview" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups" />
                </div>
              ) : (
                <div className="text-center">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-800/50 ring-1 ring-zinc-700">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
                  </div>
                  <p className="text-sm text-zinc-300 capitalize">{status}...</p>
                  <p className="mt-1 text-xs text-zinc-600">Getting your app ready</p>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="code"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              {projectId ? (
                <CodeView projectId={projectId} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-600">
                  No project active
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
