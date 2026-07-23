/**
 * App window — live iframe preview of the user's attached local project dev server.
 */

import { useCallback } from 'react';
import {
  RefreshCw, ExternalLink, Play, Square, Loader2, Monitor, AlertCircle, Sparkles,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.js';
import { VaiMark } from '../brand/VaiMark.js';

export function LocalAppPreview() {
  const localName = useWorkspaceStore((s) => s.localName);
  const localRoot = useWorkspaceStore((s) => s.localRoot);
  const devStatus = useWorkspaceStore((s) => s.devServerStatus);
  const devUrl = useWorkspaceStore((s) => s.devServerUrl);
  const devLabel = useWorkspaceStore((s) => s.devServerLabel);
  const devError = useWorkspaceStore((s) => s.devServerError);
  const detectedRunCommand = useWorkspaceStore((s) => s.detectedRunCommand);
  const autoLaunchDevServer = useWorkspaceStore((s) => s.autoLaunchDevServer);
  const approveDevServer = useWorkspaceStore((s) => s.approveDevServer);
  const declineDevServer = useWorkspaceStore((s) => s.declineDevServer);
  const stopDevServer = useWorkspaceStore((s) => s.stopDevServer);
  const refreshDevProbe = useWorkspaceStore((s) => s.refreshDevProbe);

  const openExternal = useCallback(() => {
    if (!devUrl) return;
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('open_external', { target: devUrl }));
  }, [devUrl]);

  const busy = devStatus === 'starting';

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0a0c]">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Monitor size={13} className="text-orange-400/90" />
        <span className="flex-1 truncate text-[11px] font-medium text-[color:var(--chat-body)]">
          App · {localName ?? 'workspace'}
        </span>
        {devLabel && (
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[color:var(--chat-muted)]">
            {devLabel}
          </span>
        )}
        <button
          type="button"
          onClick={() => void refreshDevProbe()}
          className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/[0.06]"
          title="Refresh preview"
        >
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
        </button>
        {devUrl && (
          <button
            type="button"
            onClick={openExternal}
            className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/[0.06]"
            title="Open in browser"
          >
            <ExternalLink size={12} />
          </button>
        )}
        {devStatus === 'running' ? (
          <button
            type="button"
            onClick={() => void stopDevServer()}
            className="rounded p-1 text-red-400/80 hover:bg-red-500/10"
            title="Stop dev server"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void autoLaunchDevServer()}
            className="rounded p-1 text-emerald-400/80 hover:bg-emerald-500/10"
            title="Start dev server"
          >
            <Play size={12} />
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {devUrl && devStatus === 'running' ? (
          <iframe
            key={devUrl}
            src={devUrl}
            title={`${localName ?? 'project'} preview`}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        ) : devStatus === 'detected' ? (
          /* Council detected a runnable app — ask before touching the user's machine. */
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-zinc-900/80 p-5 shadow-2xl">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 ring-1 ring-orange-400/25">
                  <Sparkles size={16} className="text-orange-300" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[color:var(--chat-body)]">
                    Council found a runnable app
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--chat-muted)]">
                    <span className="font-medium text-[color:var(--chat-body)]">{localName}</span> looks like
                    a <span className="font-medium text-orange-300">{devLabel}</span> project. Run its dev
                    server so the app shows live in this window?
                  </p>
                  {detectedRunCommand && (
                    <code className="mt-2 inline-block rounded-md bg-black/40 px-2 py-1 font-mono text-[10px] text-emerald-300/90">
                      {detectedRunCommand}
                    </code>
                  )}
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 border-y border-white/[0.06] py-3 text-[10px] leading-4">
                <dt className="text-[color:var(--chat-muted)]">Folder</dt>
                <dd className="truncate font-mono text-[color:var(--chat-body)]" title={localRoot ?? undefined}>{localRoot ?? 'Unknown'}</dd>
                <dt className="text-[color:var(--chat-muted)]">Command</dt>
                <dd className="font-mono text-[color:var(--chat-body)]">{detectedRunCommand ?? 'No command reported'}</dd>
                <dt className="text-[color:var(--chat-muted)]">Access</dt>
                <dd className="text-amber-200/90">Runs project code as your OS user; it may read project files, start child processes, and use the network.</dd>
                <dt className="text-[color:var(--chat-muted)]">Persistence</dt>
                <dd className="text-[color:var(--chat-body)]">Run once expires when stopped. Always is stored only for this folder and can be revoked by choosing Not now.</dd>
              </dl>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void approveDevServer('once')}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-600/90 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-orange-500"
                  title="Run now — the council will ask again next time you attach this project"
                >
                  <Play size={12} aria-hidden /> Run once
                </button>
                <button
                  type="button"
                  onClick={() => void approveDevServer('always')}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-orange-400/30 bg-orange-500/10 px-3 py-1.5 text-[12px] font-medium text-orange-200 transition-colors hover:bg-orange-500/20"
                  title="Run now AND auto-run whenever this project is attached — revoke anytime by declining"
                >
                  Always for this project
                </button>
                <button
                  type="button"
                  onClick={declineDevServer}
                  className="rounded-lg px-2.5 py-1.5 text-[12px] text-[color:var(--chat-muted)] transition-colors hover:bg-white/[0.06] hover:text-[color:var(--chat-body)]"
                  title="Don't run — you can start it later with the Play button"
                >
                  Not now
                </button>
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-[color:var(--chat-muted)]">
                Vai never runs project code without your permission. “Always” is remembered per project on this machine.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-orange-500/10" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-zinc-900 ring-1 ring-white/10">
                {busy ? (
                  <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                ) : (
                  <VaiMark size={40} />
                )}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-[color:var(--chat-body)]">
                {busy ? 'Council is starting your dev server…' : 'Your app preview lives here'}
              </p>
              <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-[color:var(--chat-muted)]">
                {busy
                  ? `Detecting ${devLabel ?? 'dev script'} and waiting for a live URL (Vite, Next.js, Node…).`
                  : 'Attach a Node / Next / Vite project and we auto-run its dev script — your running app shows in this window.'}
              </p>
            </div>
            {devError && (
              <div className="flex max-w-md items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-left text-[11px] text-red-300">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{devError}</span>
              </div>
            )}
            {!busy && (
              <button
                type="button"
                onClick={() => void autoLaunchDevServer()}
                className="rounded-lg bg-orange-600/80 px-4 py-2 text-xs font-medium text-white hover:bg-orange-600"
              >
                Start dev server
              </button>
            )}
          </div>
        )}
      </div>
      {devUrl && (
        <div className="shrink-0 truncate border-t border-white/[0.06] px-3 py-1 font-mono text-[10px] text-[color:var(--chat-muted)]">
          {devUrl}
        </div>
      )}
    </div>
  );
}

export default LocalAppPreview;
