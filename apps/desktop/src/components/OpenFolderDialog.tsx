/**
 * OpenFolderDialog — open an existing local project folder as a live workspace.
 *
 * Triggered by the `vai:open-workspace` event (command palette "Open workspace")
 * or Ctrl+Shift+O. The user points Vai at a folder (e.g. C:\Users\you\Documents\dev-lawn);
 * the runtime scans it (framework, package manager, install state), installs deps when
 * needed, starts the project's own dev server (Next.js / Vite / node — with the project's
 * own hot reload), and binds a builder chat so chat-to-software edits target this app.
 *
 * External folders are served IN PLACE and never deleted by Vai.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FolderOpen, Loader2, X, Clock, AlertTriangle, BookOpen, Boxes, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api.js';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { useLayoutStore } from '../stores/layoutStore.js';
import { pickLatestProjectConversation } from '../lib/project-conversation.js';

const RECENTS_KEY = 'vai-recent-folders';
const MAX_RECENTS = 6;

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveRecent(path: string): void {
  try {
    const next = [path, ...loadRecents().filter((p) => p !== path)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch { /* best effort */ }
}

const FRAMEWORK_LABELS: Record<string, string> = {
  vinext: 'Vinext',
  nextjs: 'Next.js',
  vite: 'Vite',
  remix: 'Remix',
  astro: 'Astro',
  node: 'Node.js',
  static: 'static site',
  unknown: 'project',
};

interface ScanProfile {
  name: string | null;
  framework: string;
  frameworkLabel: string;
  packageManager: string;
  scripts: Record<string, string>;
  hasPackageJson: boolean;
  hasNodeModules: boolean;
  hasTypeScript: boolean;
  monorepo: boolean;
  missingEnvVars: string[];
  readmeSetup: string | null;
  devScriptPortable: boolean;
  requiredNode?: string | null;
  nodeMismatch?: boolean;
}

interface ScanCandidate {
  rootDir: string;
  relativePath: string;
  profile: ScanProfile;
}

/** Anything the user genuinely needs to know before we start their app. */
function scanWarnings(profile: ScanProfile): string[] {
  const warnings: string[] = [];
  if (profile.nodeMismatch && profile.requiredNode) {
    warnings.push(`This project declares engines.node ${profile.requiredNode}, which doesn't match the Node version Vai runs on — dev/build may misbehave.`);
  }
  if (profile.missingEnvVars.length > 0) {
    warnings.push(`Missing env vars from .env.example: ${profile.missingEnvVars.join(', ')}`);
  }
  if (!profile.devScriptPortable) {
    warnings.push(`The dev script ("${profile.scripts.dev}") can't run on Windows — Vai will use the ${profile.frameworkLabel} binary directly.`);
  }
  if (profile.monorepo) {
    warnings.push('Monorepo workspace — the root dev script decides which apps start.');
  }
  return warnings;
}

export function OpenFolderDialog() {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [review, setReview] = useState<{
    path: string;
    requestedPath: string;
    profile: ScanProfile;
    warnings: string[];
  } | null>(null);
  const [choices, setChoices] = useState<{ requestedPath: string; candidates: ScanCandidate[] } | null>(null);
  const [showSetupNotes, setShowSetupNotes] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sandboxStatus = useSandboxStore((s) => s.status);

  // Live stage copy while the pipeline runs.
  useEffect(() => {
    if (!busy) return;
    if (sandboxStatus === 'creating') setStage('Scanning folder…');
    else if (sandboxStatus === 'installing') setStage('Installing dependencies… (first open can take a minute)');
    else if (sandboxStatus === 'building') setStage('Starting dev server…');
    else if (sandboxStatus === 'running') setStage('Dev server is up — opening preview…');
  }, [busy, sandboxStatus]);

  const show = useCallback(() => {
    setRecents(loadRecents());
    setErrorText(null);
    setReview(null);
    setChoices(null);
    setShowSetupNotes(false);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const onEvent = (e: Event) => {
      // A path supplied by a native picker (paperclip/Tauri) opens SILENTLY —
      // no modal. Progress shows in the build strip + project console; the
      // dialog appears only if the scan finds something worth reviewing.
      const detailPath = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (typeof detailPath === 'string' && detailPath.trim()) {
        setPath(detailPath);
        void scanThenMaybeStartRef.current?.(detailPath, { silent: true });
        return;
      }
      show();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener('vai:open-workspace', onEvent);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('vai:open-workspace', onEvent);
      window.removeEventListener('keydown', onKey);
    };
  }, [show]);

  const close = useCallback(() => {
    if (busy) return; // don't abandon a pipeline mid-flight
    setOpen(false);
  }, [busy]);

  const openFolder = useCallback(async (candidate: string, opts: { silent?: boolean } = {}) => {
    const target = candidate.trim().replace(/^["']|["']$/g, '');
    if (!target || busy) return;
    setBusy(true);
    setErrorText(null);
    setStage('Starting…');
    try {
      const sandbox = useSandboxStore.getState();
      const { id, framework } = await sandbox.openLocalFolder(target);
      saveRecent(target);

      // Bind an AGENT conversation so chat edits target this app. Agent is the
      // home mode (auto chat+code): the runtime routes build/edit intent through
      // the builder machinery natively without a visible mode flip.
      const chat = useChatStore.getState();
      const activeConversationId = chat.activeConversationId;
      let boundConversationId: string;
      if (activeConversationId) {
        // "Attach folder" belongs to the chat the user is already in. Rebind that
        // chat instead of silently creating a second project chat and leaving the
        // visible request attached to a stale sandbox id.
        await chat.setConversationSandbox(activeConversationId, id);
        boundConversationId = activeConversationId;
      } else {
        const existing = pickLatestProjectConversation(chat.conversations, id);
        if (existing) {
          await chat.selectConversation(existing.id);
          boundConversationId = existing.id;
        } else {
          const modelId = 'vai:v0';
          boundConversationId = await chat.createConversation(modelId, 'agent', { sandboxProjectId: id });
        }
      }
      const bindingResponse = await apiFetch(`/api/conversations/${boundConversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandboxProjectId: id, workspaceRoot: target }),
      });
      if (!bindingResponse.ok) throw new Error('Project opened, but the chat binding could not be saved');
      await chat.fetchConversations();
      useLayoutStore.getState().setActivePanel('chats');
      // The whole point of opening a folder is seeing the app — expand the app window.
      useLayoutStore.getState().expandBuilder();

      const label = FRAMEWORK_LABELS[framework] ?? framework;
      toast.success(`Opened ${target.split(/[\\/]/).pop()} — ${label} dev server running`);
      setOpen(false);
      setPath('');
      setReview(null);
      setChoices(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to open folder';
      // Silent flow has no dialog to render the error in — surface it as a toast.
      if (opts.silent) toast.error(message);
      else setErrorText(message);
    } finally {
      setBusy(false);
      setStage('');
    }
  }, [busy]);

  /** Step 1 — scan only. Clean projects start immediately; anything the user
   *  should know first (missing env, setup notes, monorepo) shows a review card.
   *  silent: no modal unless a review is genuinely needed. */
  const scanThenMaybeStart = useCallback(async (candidate: string, opts: { silent?: boolean } = {}) => {
    const target = candidate.trim().replace(/^["']|["']$/g, '');
    if (!target || busy) return;
    setBusy(true);
    setErrorText(null);
    setStage('Scanning folder…');
    try {
      const res = await apiFetch('/api/sandbox/scan-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target }),
      });
      const data = await res.json().catch(() => null) as {
        requestedRootDir?: string;
        rootDir?: string | null;
        profile?: ScanProfile | null;
        candidates?: ScanCandidate[];
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? 'Unable to scan folder');
      }
      if ((data?.candidates?.length ?? 0) > 1) {
        setBusy(false);
        setStage('');
        setChoices({ requestedPath: data?.requestedRootDir ?? target, candidates: data?.candidates ?? [] });
        if (opts.silent) {
          setRecents(loadRecents());
          setOpen(true);
        }
        return;
      }
      if (!data?.profile || !data.rootDir) {
        throw new Error(data?.error ?? 'Unable to find a runnable project');
      }
      const warnings = scanWarnings(data.profile);
      const discoveredNestedRoot = data.rootDir !== (data.requestedRootDir ?? target);
      if (warnings.length === 0 && !data.profile.readmeSetup && !discoveredNestedRoot) {
        setBusy(false);
        await openFolder(target, opts);
        return;
      }
      setBusy(false);
      setStage('');
      setReview({
        path: data.rootDir,
        requestedPath: data.requestedRootDir ?? target,
        profile: data.profile,
        warnings,
      });
      // Review genuinely needed — the modal earns its appearance now.
      if (opts.silent) {
        setRecents(loadRecents());
        setOpen(true);
      }
    } catch (err) {
      setBusy(false);
      setStage('');
      const message = err instanceof Error ? err.message : 'Unable to scan folder';
      if (opts.silent) toast.error(message);
      else setErrorText(message);
    }
  }, [busy, openFolder]);

  // Ref so the mount-time event listener can call the latest scan logic
  // without re-subscribing on every state change.
  const scanThenMaybeStartRef = useRef<typeof scanThenMaybeStart | null>(null);
  useEffect(() => { scanThenMaybeStartRef.current = scanThenMaybeStart; }, [scanThenMaybeStart]);

  const placeholder = useMemo(() => (
    navigator.userAgent.includes('Windows')
      ? 'C:\\Users\\you\\Documents\\my-app'
      : '/Users/you/projects/my-app'
  ), []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-black/55 pt-[16vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
          role="dialog"
          aria-modal="true"
          aria-label="Open a local project folder"
        >
          <motion.div
            className="w-[min(600px,92vw)] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <FolderOpen className="h-4.5 w-4.5 text-violet-400" size={18} />
                <h2 className="text-sm font-semibold text-zinc-100">Open a local project</h2>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="rounded-md p-1 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4">
              {choices ? (
                <div>
                  <div className="mb-1 text-sm font-semibold text-zinc-100">
                    Found {choices.candidates.length} runnable apps
                  </div>
                  <p className="mb-3 text-xs leading-relaxed text-zinc-400">
                    Choose which app Dev-Vai should open from <span className="font-mono text-zinc-300">{choices.requestedPath}</span>.
                  </p>
                  <div className="space-y-2">
                    {choices.candidates.map((candidate) => (
                      <button
                        key={candidate.rootDir}
                        type="button"
                        onClick={() => {
                          setChoices(null);
                          setPath(candidate.rootDir);
                          void scanThenMaybeStart(candidate.rootDir);
                        }}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-left transition hover:border-violet-500/40 hover:bg-violet-500/10"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-zinc-200">{candidate.profile.name ?? candidate.relativePath}</span>
                          <span className="block truncate font-mono text-[10px] text-zinc-500">{candidate.relativePath}</span>
                        </span>
                        <span className="shrink-0 rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                          {candidate.profile.frameworkLabel}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : review ? (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setReview(null); setShowSetupNotes(false); requestAnimationFrame(() => inputRef.current?.focus()); }}
                      disabled={busy}
                      className="rounded-md p-1 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40"
                      aria-label="Back"
                    >
                      <ArrowLeft size={14} />
                    </button>
                    <span className="truncate font-mono text-[11px] text-zinc-400" title={review.path}>{review.path}</span>
                  </div>

                  {review.path !== review.requestedPath && (
                    <div className="mb-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs leading-relaxed text-violet-200">
                      Found <span className="font-semibold">{review.profile.name ?? review.path.split(/[\\/]/).pop()}</span> inside the folder you selected. Dev-Vai will use this app root.
                    </div>
                  )}

                  {/* Identity row */}
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-300">
                      {review.profile.frameworkLabel}
                    </span>
                    <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">{review.profile.packageManager}</span>
                    {review.profile.hasTypeScript && (
                      <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">TypeScript</span>
                    )}
                    {review.profile.monorepo && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400"><Boxes size={11} /> monorepo</span>
                    )}
                    {!review.profile.hasNodeModules && (
                      <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">install needed</span>
                    )}
                  </div>

                  {review.warnings.length > 0 && (
                    <ul className="mb-3 space-y-1.5">
                      {review.warnings.map((warning) => (
                        <li key={warning} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
                          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {review.profile.readmeSetup && (
                    <div className="mb-3">
                      <button
                        type="button"
                        onClick={() => setShowSetupNotes((v) => !v)}
                        className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 transition hover:text-zinc-200"
                      >
                        <BookOpen size={12} />
                        Setup notes from this project's README
                        <span className="text-zinc-600">{showSetupNotes ? '▾' : '▸'}</span>
                      </button>
                      {showSetupNotes && (
                        <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[11px] leading-relaxed text-zinc-300">
                          {review.profile.readmeSetup}
                        </pre>
                      )}
                    </div>
                  )}

                  {busy && stage && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
                      <Loader2 className="shrink-0 animate-spin" size={13} />
                      <span aria-live="polite">{stage}</span>
                    </div>
                  )}
                  {errorText && !busy && (
                    <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
                      {errorText}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={close}
                      disabled={busy}
                      className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => void openFolder(review.path)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy ? <Loader2 className="animate-spin" size={13} /> : <FolderOpen size={13} />}
                      {busy ? 'Starting…' : review.warnings.length > 0 ? 'Start anyway' : 'Start'}
                    </button>
                  </div>
                </div>
              ) : (
              <>
              <p className="mb-3 text-xs leading-relaxed text-zinc-400">
                Point Vai at a project folder. It detects the framework, installs dependencies if
                needed, starts the dev server with hot reload, and opens the app live in the
                preview — ready for chat edits. Your folder is never modified beyond what you ask.
              </p>

              <form
                onSubmit={(e) => { e.preventDefault(); void scanThenMaybeStart(path); }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={placeholder}
                  spellCheck={false}
                  disabled={busy}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/60 focus:outline-none disabled:opacity-50"
                  aria-label="Folder path"
                />
                <button
                  type="submit"
                  disabled={busy || !path.trim()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? <Loader2 className="animate-spin" size={13} /> : <FolderOpen size={13} />}
                  {busy ? 'Opening…' : 'Open'}
                </button>
              </form>

              {busy && stage && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
                  <Loader2 className="shrink-0 animate-spin" size={13} />
                  <span aria-live="polite">{stage}</span>
                </div>
              )}

              {errorText && !busy && (
                <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
                  {errorText}
                </div>
              )}

              {recents.length > 0 && !busy && (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <Clock size={11} /> Recent folders
            