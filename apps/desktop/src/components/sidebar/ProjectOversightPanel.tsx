/**
 * T3-inspired project oversight — workspace context, build status, and IDE quick nav.
 *
 * This is the IDE command center in the sidebar: what's attached, what's running,
 * what needs review, and one-click jumps to files / diffs / preview / console.
 */

import { useMemo, useState } from 'react';
import {
  FolderOpen, GitBranch, FileCode2, GitPullRequest, Monitor, Terminal,
  Loader2, CheckCircle2, AlertCircle, Circle, Paperclip, X,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.js';
import { useSandboxStore } from '../../stores/sandboxStore.js';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { useChatStore } from '../../stores/chatStore.js';
import { FileTreePanel } from '../ide/FileTreePanel.js';
import { SidebarSection } from './SidebarPrimitives.js';

function StatusRow({
  icon: Icon,
  label,
  detail,
  tone = 'muted',
}: {
  icon: typeof Circle;
  label: string;
  detail?: string;
  tone?: 'ok' | 'warn' | 'busy' | 'muted' | 'error';
}) {
  const toneClass = tone === 'ok'
    ? 'text-emerald-400'
    : tone === 'warn'
      ? 'text-amber-400'
      : tone === 'busy'
        ? 'text-violet-400'
        : tone === 'error'
          ? 'text-red-400'
          : 'text-[color:var(--chat-muted)]';

  return (
    <div className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-[11px]">
      <Icon size={12} className={`mt-0.5 shrink-0 ${toneClass}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[color:var(--chat-body)]">{label}</div>
        {detail && <div className="truncate text-[10px] text-[color:var(--chat-muted)]">{detail}</div>}
      </div>
    </div>
  );
}

function QuickNavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof FileCode2;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-1 rounded-lg border px-1.5 py-2 text-[10px] font-medium transition-colors ${
        active
          ? 'border-violet-400/35 bg-violet-500/15 text-violet-200'
          : 'border-white/[0.06] bg-white/[0.03] text-[color:var(--chat-muted)] hover:border-white/10 hover:bg-white/[0.06] hover:text-[color:var(--chat-body)]'
      }`}
    >
      <Icon size={14} aria-hidden />
      {label}
    </button>
  );
}

export function ProjectOversightPanel() {
  const localRoot = useWorkspaceStore((s) => s.localRoot);
  const localName = useWorkspaceStore((s) => s.localName);
  const pending = useWorkspaceStore((s) => s.pendingCount());
  const openRel = useWorkspaceStore((s) => s.openRel);
  const lastCheckpointId = useWorkspaceStore((s) => s.lastCheckpointId);
  const councilBusy = useWorkspaceStore((s) => s.councilBusy);
  const devServerStatus = useWorkspaceStore((s) => s.devServerStatus);
  const devServerUrl = useWorkspaceStore((s) => s.devServerUrl);
  const devServerPort = useWorkspaceStore((s) => s.devServerPort);
  const detach = useWorkspaceStore((s) => s.detach);
  const setShowDiffPanel = useWorkspaceStore((s) => s.setShowDiffPanel);

  const projectId = useSandboxStore((s) => s.projectId);
  const projectName = useSandboxStore((s) => s.projectName);
  const sandboxStatus = useSandboxStore((s) => s.status);
  const devPort = useSandboxStore((s) => s.devPort);
  const previewReady = useSandboxStore((s) => s.previewReady);
  const deployPhase = useSandboxStore((s) => s.deployPhase);
  const sandboxError = useSandboxStore((s) => s.error);
  const sandboxExternal = useSandboxStore((s) => s.external);
  const sandboxLogs = useSandboxStore((s) => s.logs);

  const mode = useLayoutStore((s) => s.mode);
  const buildStatus = useLayoutStore((s) => s.buildStatus);
  const showFileExplorer = useLayoutStore((s) => s.showFileExplorer);
  const showDebugConsole = useLayoutStore((s) => s.showDebugConsole);
  const showBuilderPanel = useLayoutStore((s) => s.showBuilderPanel);
  const showDiffPanel = useWorkspaceStore((s) => s.showDiffPanel);
  const {
    expandBuilder,
    toggleFileExplorer,
    toggleDebugConsole,
    toggleBuilderPanel,
    setLayoutMode,
  } = useLayoutStore();

  const streamingId = useChatStore((s) => s.streamingConversationId);
  const isStreaming = Boolean(streamingId);
  const [filesCollapsed, setFilesCollapsed] = useState(false);

  const workspaceLabel = useMemo(() => {
    if (localName) return { kind: 'local' as const, name: localName, path: localRoot };
    if (projectName) return { kind: 'sandbox' as const, name: projectName, path: null };
    return null;
  }, [localName, localRoot, projectName]);

  const openIde = () => {
    setLayoutMode('odyssey');
    expandBuilder();
  };

  const focusFiles = () => {
    openIde();
    if (!showFileExplorer) toggleFileExplorer();
  };

  const focusDiffs = () => {
    openIde();
    setShowDiffPanel(true);
  };

  const focusPreview = () => {
    openIde();
    if (!showBuilderPanel) toggleBuilderPanel();
  };

  const focusConsole = () => {
    openIde();
    if (!showDebugConsole) toggleDebugConsole();
  };

  const buildTone = buildStatus.step === 'ready'
    ? 'ok'
    : buildStatus.step === 'failed'
      ? 'error'
      : buildStatus.step !== 'idle'
        ? 'busy'
        : 'muted';

  const sandboxTone = sandboxStatus === 'running' && previewReady
    ? 'ok'
    : sandboxStatus === 'failed'
      ? 'error'
      : sandboxStatus !== 'idle'
        ? 'busy'
        : 'muted';
  const browserError = sandboxLogs.find((line) => (
    line.includes('[Uncaught]')
    || line.includes('[UnhandledRejection]')
    || (line.includes('[browser]') && (line.includes('✗') || line.includes('âœ—') || line.toLowerCase().includes('error')))
  ));
  const previewStatusLabel = previewReady
    ? `${sandboxExternal ? 'Preview loaded' : 'Preview live'}${devPort ? ` :${devPort}` : ''}`
    : sandboxStatus === 'running' && devPort
      ? `Preview warming :${devPort}`
      : `Sandbox: ${sandboxStatus}`;
  const previewStatusDetail = browserError
    ? browserError
    : previewReady && sandboxExternal
      ? 'External folder — if blank, open the preview console/browser errors.'
      : !previewReady && sandboxStatus === 'running' && devPort
        ? 'Waiting for the iframe load event; first Next compile can take a while.'
        : deployPhase !== 'idle'
          ? `Deploy: ${deployPhase}`
          : sandboxError ?? undefined;
  const previewStatusTone = browserError ? 'error' : sandboxTone;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Active workspace card */}
      <div className="border-b border-white/[0.06] px-3 py-3">
        {workspaceLabel ? (
          <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
            <div className="flex items-start gap-2">
              {workspaceLabel.kind === 'local'
                ? <FolderOpen size={16} className="mt-0.5 shrink-0 text-violet-400" />
                : <GitBranch size={16} className="mt-0.5 shrink-0 text-emerald-400" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[color:var(--chat-body)]">
                  {workspaceLabel.name}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-[color:var(--chat-muted)]">
                  {workspaceLabel.kind === 'local' ? 'Local folder' : 'Sandbox project'}
                </div>
                {workspaceLabel.path && (
                  <div className="mt-1 truncate font-mono text-[10px] text-[color:var(--chat-muted)]" title={workspaceLabel.path}>
                    {workspaceLabel.path}
                  </div>
                )}
              </div>
              {localRoot && (
                <button
                  type="button"
                  aria-label="Detach folder"
                  onClick={detach}
                  className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/10 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {pending > 0 && (
              <button
                type="button"
                onClick={focusDiffs}
                className="mt-2 flex w-full items-center gap-1.5 rounded-lg bg-amber-500/15 px-2 py-1.5 text-left text-[11px] text-amber-200 hover:bg-amber-500/25"
              >
                <GitPullRequest size={12} />
                {pending} change{pending === 1 ? '' : 's'} awaiting review
              </button>
            )}
            {lastCheckpointId && (
              <div className="mt-2 text-[10px] text-[color:var(--chat-muted)]">
                Last checkpoint: <span className="font-mono text-emerald-400/80">{lastCheckpointId}</span>
              </div>
            )}
            {councilBusy && (
              <StatusRow icon={Loader2} label="Council editing…" tone="busy" />
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center">
            <FolderOpen size={20} className="mx-auto mb-2 text-[color:var(--chat-muted)] opacity-50" />
            <p className="text-[11px] text-[color:var(--chat-muted)]">No project attached</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('vai:workspace-attach-request'))}
              className="mt-2 text-[11px] font-medium text-violet-300 hover:text-violet-200"
            >
              Attach folder (Ctrl+Shift+O)
            </button>
          </div>
        )}
      </div>

      {/* Live status — T3-style orchestration glance */}
      <div className="border-b border-white/[0.06] px-2 py-2">
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--chat-muted)]">
          Status
        </div>
        <StatusRow
          icon={isStreaming ? Loader2 : Circle}
          label={isStreaming ? 'Turn in progress' : 'Turn idle'}
          detail={isStreaming ? `Mode: ${mode}` : `Mode: ${mode}`}
          tone={isStreaming ? 'busy' : 'muted'}
        />
        {buildStatus.step !== 'idle' && (
          <StatusRow
            icon={buildStatus.step === 'ready' ? CheckCircle2 : buildStatus.step === 'failed' ? AlertCircle : Loader2}
            label={buildStatus.message ?? buildStatus.step}
            tone={buildTone}
          />
        )}
        {projectId && (
          <StatusRow
            icon={browserError ? AlertCircle : previewReady ? CheckCircle2 : sandboxStatus === 'failed' ? AlertCircle : Loader2}
            label={previewStatusLabel}
            detail={previewStatusDetail}
            tone={previewStatusTone}
          />
        )}
        {openRel && (
          <StatusRow icon={FileCode2} label="Editing" detail={openRel} tone="muted" />
        )}
        {localRoot && (
          <StatusRow
            icon={devServerStatus === 'running' ? CheckCircle2 : devServerStatus === 'starting' ? Loader2 : Monitor}
            label={
              devServerStatus === 'running'
                ? `App preview :${devServerPort ?? ''}`
                : devServerStatus === 'starting'
                  ? 'Starting dev server…'
                  : devServerStatus === 'detected'
                    ? 'App detected — awaiting your go-ahead'
                    : 'App preview idle'
            }
            detail={devServerUrl ?? undefined}
            tone={devServerStatus === 'running' ? 'ok' : devServerStatus === 'starting' ? 'busy' : devServerStatus === 'detected' ? 'busy' : 'muted'}
          />
        )}
      </div>

      {/* Quick nav — IDE surface toggles */}
      <div className="border-b border-white/[0.06] px-3 py-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--chat-muted)]">
          Workspace
        </div>
        <div className="flex gap-1.5">
          <QuickNavButton icon={FileCode2} label="Files" active={showFileExplorer} onClick={focusFiles} />
          <QuickNavButton icon={GitPullRequest} label="Diffs" active={showDiffPanel} onClick={focusDiffs} />
          <QuickNavButton icon={Monitor} label="Preview" active={showBuilderPanel} onClick={focusPreview} />
          <QuickNavButton icon={Terminal} label="Console" active={showDebugConsole} onClick={focusConsole} />
        </div>
      </div>

      {/* File tree when local folder attached */}
      {localRoot && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
          <SidebarSection
            label="Files"
            isLight={false}
            collapsed={filesCollapsed}
            onToggle={() => setFilesCollapsed((v) => !v)}
          >
            <li className="min-h-0 flex-1">
              <div className="flex h-full min-h-[120px] max-h-[min(50vh,420px)] flex-col overflow-hidden rounded-lg border border-white/[0.06] bg-black/15">
                <FileTreePanel compact />
              </div>
            </li>
          </SidebarSection>
        </div>
      )}

      {/* Attach hint for sandbox-only */}
      {!localRoot && projectId && (
        <div className="px-3 py-2">
          <p className="text-[10px] leading-relaxed text-[color:var(--chat-muted)]">
            Sandbox files live in the builder panel. Attach a local folder to browse and edit on disk with diff review.
          </p>
        </div>
      )}

      {!localRoot && !projectId && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center">
          <Paperclip size={18} className="text-[color:var(--chat-muted)] opacity-40" />
          <p className="text-[11px] leading-relaxed text-[color:var(--chat-muted)]">
            Start a builder turn or attach a folder to open the IDE workspace.
          </p>
        </div>
      )}
    </div>
  );
}

export default ProjectOversightPanel;
