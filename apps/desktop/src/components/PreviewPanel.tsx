import { useSandboxStore } from '../stores/sandboxStore.js';
import { apiFetch } from '../lib/api.js';
import {
  RefreshCw, Smartphone, Tablet, Monitor, Copy, ExternalLink,
  Code2, Eye, Trash2, Download, CheckCircle, XCircle, Loader2,
  Camera, Terminal, FolderTree, Play, Square, Columns2,
  ArrowLeft, ArrowRight, Save, RotateCcw, MessageSquare, File, Moon, Sun, KeyRound,
} from 'lucide-react';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Group, Panel } from 'react-resizable-panels';
import { AnimatePresence, motion } from 'framer-motion';
import { TemplateGallery } from './TemplateGallery.js';
import { DeployProgress } from './DeployProgress.js';
import { VaiMark } from './brand/VaiMark.js';
import { useLayoutStore } from '../stores/layoutStore.js';
import { useCursorStore } from '../stores/cursorStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { groupEnvGuides } from '../lib/env-assistance.js';
import { SandboxAppToggle } from './SandboxAppToggle.js';
import { WorkspaceLayoutControls } from './workspace/WorkspaceLayoutControls.js';
import { HoverResizeHandle } from './workspace/HoverResizeHandle.js';
import { createPreviewRepairPrompt, PreviewFailureState } from './preview/PreviewFailureState.js';

/* ── Types ── */

type ViewMode = 'preview' | 'code' | 'split';
type BreakpointKey = 'mobile' | 'tablet' | 'desktop';
type CodeLanguage = 'script' | 'markup' | 'style' | 'data' | 'plain';

const BREAKPOINTS: Record<BreakpointKey, { width: number; icon: typeof Smartphone; label: string }> = {
  mobile:  { width: 375,  icon: Smartphone, label: 'Mobile (375px)' },
  tablet:  { width: 768,  icon: Tablet,     label: 'Tablet (768px)' },
  desktop: { width: 1280, icon: Monitor,    label: 'Desktop (full)' },
};

const STEP_ORDER = ['creating', 'writing', 'installing', 'building', 'running'] as const;

const EMPTY_HANDOFF_STEPS: ReadonlyArray<{ stage: string; label: string; detail?: string; status: string }> = [];

const STEP_LABELS: Record<string, string> = {
  creating: 'Creating',
  writing: 'Writing files',
  installing: 'Installing',
  building: 'Building',
  running: 'Running',
};

const STUDIO_PREVIEW_TIPS = [
  'Ask for Discussion or Plan mode when you want to save iterations for trickier product calls.',
  'Version history in your workflow can restore an earlier sandbox when an edit goes sideways.',
  'Pick Stripe, PayPal, Klarna, Vipps, or mock checkout — Vai can wire the UI to match.',
  'Toggle mobile app view to catch layout issues before you ship.',
] as const;

interface EnvStatus {
  exampleVars: string[];
  configuredVars: string[];
  missingEnvVars: string[];
  envLocalExists: boolean;
}

function missingEnvFromMessage(message: string): string | null {
  return /\bMissing\s+([A-Z][A-Z0-9_]*|VITE_[A-Z0-9_]+)\b/i.exec(message)?.[1] ?? null;
}

function EnvSetupDialog({
  projectId,
  failureMessage,
  onClose,
  onSaved,
}: {
  projectId: string;
  failureMessage: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const fallbackVar = missingEnvFromMessage(failureMessage);
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setErrorText(null);
    apiFetch(`/api/sandbox/${projectId}/env-local`)
      .then(async (res) => {
        const data = await res.json().catch(() => null) as EnvStatus | { error?: string } | null;
        if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? 'Unable to inspect env status');
        if (!cancelled) setStatus(data as EnvStatus);
      })
      .catch((err) => {
        if (!cancelled) setErrorText(err instanceof Error ? err.message : 'Unable to inspect env status');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const vars = useMemo(() => {
    const fromStatus = status?.missingEnvVars ?? [];
    const combined = fallbackVar ? [fallbackVar, ...fromStatus] : fromStatus;
    return [...new Set(combined)];
  }, [fallbackVar, status?.missingEnvVars]);

  const envGroups = useMemo(() => groupEnvGuides(vars), [vars]);

  const canSave = vars.some((name) => values[name]?.trim());

  const save = useCallback(async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      const bodyValues = Object.fromEntries(
        Object.entries(values)
          .filter(([key, value]) => vars.includes(key) && value.trim().length > 0),
      );
      const res = await apiFetch(`/api/sandbox/${projectId}/env-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: bodyValues }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? 'Unable to write .env.local');
      await onSaved();
      onClose();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Unable to write .env.local');
    } finally {
      setBusy(false);
    }
  }, [busy, canSave, onClose, onSaved, projectId, values, vars]);

  return (
    <motion.div
      className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden bg-black/55 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Set environment values"
    >
      <motion.div
        className="flex max-h-[calc(100%-2rem)] w-[min(720px,94vw)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
      >
        <div className="shrink-0 border-b border-white/10 px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Project setup</p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-white">Connect the services this app needs</h2>
          <p className="mt-2 text-xs leading-6 text-zinc-400">
            Start with Core runtime and Authentication. Billing, video, and storage can wait until you test those features. Values stay masked and are written only to this project's .env.local.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {busy && !status ? (
            <div className="flex items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Inspecting .env.example…
            </div>
          ) : vars.length === 0 ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-200">
              I could not infer a missing env variable from this failure. Open the console or README setup notes for the project-specific keys.
            </div>
          ) : (
            <div>
              {envGroups.map(({ group, guides }, groupIndex) => (
                <section key={group} className={groupIndex === 0 ? '' : 'mt-6 border-t border-white/10 pt-5'}>
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <h3 className="text-xs font-semibold text-zinc-100">{group}</h3>
                    {group === 'Core runtime' ? (
                      <span className="text-[10px] font-medium text-emerald-300">Start here</span>
                    ) : null}
                  </div>
                  <div className="space-y-4">
                    {guides.map((guide) => {
                      const name = guide.name;
                      return (
                        <label key={name} className="block">
                          <span className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono text-[11px] font-semibold text-zinc-200">{name}</span>
                            <span className="text-[10px] text-zinc-500">{guide.service}</span>
                            {guide.generated ? <span className="text-[10px] text-sky-300">Usually generated</span> : null}
                            {guide.requiredToBoot ? <span className="text-[10px] font-medium text-emerald-300">Required to open</span> : null}
                            {guide.serverOnly ? <span className="text-[10px] text-amber-300">Server only</span> : null}
                            {guide.getValueUrl ? (
                              <a
                                href={guide.getValueUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-violet-300 transition hover:text-violet-200"
                                onClick={(event) => event.stopPropagation()}
                              >
                                Get value <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            ) : null}
                          </span>
                          <span className="mb-2 block text-[10px] leading-4 text-zinc-500">{guide.description}</span>
                          <input
                            type="password"
                            value={values[name] ?? ''}
                            onChange={(e) => setValues((current) => ({ ...current, [name]: e.target.value }))}
                            placeholder={guide.generated ? 'Run provider setup, or paste an existing value…' : guide.serverOnly ? 'Paste the server-only value…' : 'Paste the real value…'}
                            className="w-full rounded-lg border border-white/10 bg-black/45 px-3 py-2 font-mono text-xs text-zinc-100 outline-none transition focus:border-violet-400/70"
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
          {status && status.configuredVars.length > 0 && (
            <p className="mt-3 text-[11px] leading-5 text-zinc-500">
              Already configured: {status.configuredVars.slice(0, 10).join(', ')}
              {status.configuredVars.length > 10 ? '…' : ''}
            </p>
          )}
          {errorText && (
            <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
              {errorText}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
          <p className="max-w-[430px] text-[11px] leading-5 text-zinc-500">
            Save restarts the App. Backend secrets used by Convex must also be added to that deployment's environment.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-xl px-3 py-2 text-xs font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave || busy}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save & restart
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function detectCodeLanguage(path: string | null): CodeLanguage {
  const ext = path?.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'script';
  if (['html', 'xml', 'svg'].includes(ext)) return 'markup';
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'style';
  if (['json', 'jsonc', 'json5', 'yaml', 'yml', 'toml'].includes(ext)) return 'data';
  return 'plain';
}

function tokenizeCodeLine(line: string, language: CodeLanguage): Array<{ text: string; type: string }> {
  const patterns: Record<CodeLanguage, RegExp | null> = {
    script: /(?<comment>\/\/.*$)|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`)|(?<keyword>\b(?:import|export|from|const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|extends|implements|interface|type|new|await|async|try|catch|finally|throw|true|false|null|undefined)\b)|(?<number>\b\d+(?:\.\d+)?\b)|(?<tag><\/?[A-Za-z][\w:-]*)/g,
    markup: /(?<comment><!--.*?-->)|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(?<tag><\/?[A-Za-z][\w:-]*)|(?<attr>\b[A-Za-z_:][-A-Za-z0-9_:.]*(?==))/g,
    style: /(?<comment>\/\*.*?\*\/)|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(?<keyword>\b(?:@media|@supports|@keyframes|from|to)\b)|(?<number>#(?:[0-9a-fA-F]{3,8})\b|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)?\b)|(?<attr>\b[a-z-]+(?=\s*:))/g,
    data: /(?<string>"(?:\\.|[^"])*")|(?<keyword>\b(?:true|false|null)\b)|(?<number>\b-?\d+(?:\.\d+)?\b)|(?<attr>\b[A-Za-z0-9_.-]+(?=\s*:))/g,
    plain: null,
  };

  const pattern = patterns[language];
  if (!pattern || line.length === 0) {
    return [{ text: line, type: 'plain' }];
  }

  const tokens: Array<{ text: string; type: string }> = [];
  let lastIndex = 0;

  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, index), type: 'plain' });
    }

    const text = match[0];
    const groups = match.groups ?? {};
    const type = Object.keys(groups).find((key) => groups[key] !== undefined) ?? 'plain';
    tokens.push({ text, type });
    lastIndex = index + text.length;
  }

  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), type: 'plain' });
  }

  return tokens.length > 0 ? tokens : [{ text: line, type: 'plain' }];
}

function tokenClass(type: string, isLight: boolean): string {
  switch (type) {
    case 'comment':
      return isLight ? 'text-zinc-400' : 'text-zinc-600';
    case 'string':
      return isLight ? 'text-emerald-700' : 'text-emerald-300';
    case 'keyword':
      return isLight ? 'text-violet-700' : 'text-violet-300';
    case 'number':
      return isLight ? 'text-sky-700' : 'text-sky-300';
    case 'tag':
      return isLight ? 'text-orange-700' : 'text-orange-300';
    case 'attr':
      return isLight ? 'text-blue-700' : 'text-blue-300';
    default:
      return isLight ? 'text-zinc-800' : 'text-zinc-200';
  }
}

function StudioMark({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex h-16 w-16 items-center justify-center rounded-[1.35rem] bg-[linear-gradient(135deg,#18181b,#27272a)] shadow-[0_20px_60px_rgba(0,0,0,0.24)] ring-1 ring-white/10 ${className}`}
      aria-hidden
    >
      <VaiMark size={30} />
    </div>
  );
}

function StudioHandoffContent({
  body,
  activeStep,
  previewUrl,
}: {
  body: string;
  activeStep?: string;
  previewUrl?: string;
}) {
  const [tip] = useState(
    () => STUDIO_PREVIEW_TIPS[Math.floor(Math.random() * STUDIO_PREVIEW_TIPS.length)],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center bg-[radial-gradient(ellipse_at_50%_18%,rgba(99,102,241,0.14),rgba(255,255,255,0)_55%),linear-gradient(180deg,#f5f5f5,#ededed)] px-6 py-10">
      <div className="flex flex-1 flex-col items-center justify-center">
        <StudioMark className="mb-8 scale-110" />
        <h3 className="text-center text-[22px] font-semibold tracking-tight text-zinc-900">
          Building your idea.
        </h3>
        {activeStep ? (
          <p className="mt-2 max-w-md text-center text-[13px] font-medium text-zinc-500">{activeStep}</p>
        ) : null}
        <p className="mt-3 max-w-lg text-center text-[13px] leading-relaxed text-zinc-600">
          {body}
        </p>
        {previewUrl ? (
          <p className="mt-6 max-w-[min(100%,28rem)] truncate font-mono text-[11px] text-zinc-400">{previewUrl}</p>
        ) : null}
      </div>
      <div className="mt-4 flex w-full max-w-md flex-col items-center gap-2 border-t border-zinc-200/80 pt-5 text-center">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Did you know?</span>
        <p className="text-[12px] leading-relaxed text-zinc-600">{tip}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   Build Step Progress Bar
   ═══════════════════════════════════ */
function BuildStepProgress({ status, studioChrome = false }: { status: string; studioChrome?: boolean }) {
  const currentIdx = STEP_ORDER.indexOf(status as typeof STEP_ORDER[number]);

  return (
    <div className={`flex items-center gap-1 border-b px-3 py-1.5 ${
      studioChrome ? 'border-zinc-200 bg-white/90' : 'border-zinc-800/60'
    }`}>
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
                <Loader2 className={`h-3 w-3 animate-spin ${studioChrome ? 'text-orange-500' : 'text-blue-400'}`} />
              ) : (
                <div className={`h-3 w-3 rounded-full border ${studioChrome ? 'border-zinc-300' : 'border-zinc-700'}`} />
              )}
              <span className={`text-[10px] ${
                isDone ? 'text-emerald-600' :
                isFailed ? 'text-red-500' :
                isCurrent ? 'text-orange-500' :
                studioChrome ? 'text-zinc-400' : 'text-zinc-600'
              }`}>
                {STEP_LABELS[step] || step}
              </span>
            </div>
            {i < STEP_ORDER.length - 1 && (
              <div className={`h-px w-3 ${isDone ? 'bg-emerald-500/50' : studioChrome ? 'bg-zinc-200' : 'bg-zinc-800'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained for an upcoming build-dashboard surface
function BuildDashboard({
  projectName,
  previewUrl,
  devPort,
  files,
  status,
  deployPhase,
  buildStatus,
  activeStepLabel,
  breakpoint,
  onOpenPreview,
  onOpenCode,
  onCopyUrl,
  onRefresh,
}: {
  projectName: string | null;
  previewUrl: string;
  devPort: number | null;
  files: string[];
  status: string;
  deployPhase: string;
  buildStatus: { step: string; message?: string };
  activeStepLabel?: string;
  breakpoint: BreakpointKey;
  onOpenPreview: () => void;
  onOpenCode: () => void;
  onCopyUrl: () => void;
  onRefresh: () => void;
}) {
  const { showDebugConsole, showFileExplorer, themePreference } = useLayoutStore();
  const studioChrome = themePreference === 'light';
  const hasFiles = files.length > 0;
  const featuredFiles = files
    .filter((file) => !file.includes('node_modules') && !file.endsWith('.lock'))
    .slice(0, 6);

  const statusMeta = deployPhase === 'deploying'
    ? {
      label: 'Deploying',
      badge: 'border-sky-400/20 bg-sky-400/10 text-sky-200',
      copy: activeStepLabel || 'Working through the deployment handoff.',
    }
    : status === 'running' && devPort
      ? {
        label: 'Live',
        badge: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
        copy: activeStepLabel || 'The app is connected and ready to inspect.',
      }
      : status === 'failed' || buildStatus.step === 'failed'
        ? {
          label: 'Needs attention',
          badge: 'border-rose-400/20 bg-rose-400/10 text-rose-200',
          copy: buildStatus.message || 'The builder answered, but the workspace did not reach a clean runnable state yet.',
        }
        : status !== 'idle' || buildStatus.step !== 'idle'
          ? {
            label: 'Working',
            badge: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
            copy: activeStepLabel || buildStatus.message || 'Preparing the next runnable update for the workspace.',
          }
          : {
            label: 'Waiting',
            badge: studioChrome ? 'border-zinc-200 bg-white text-zinc-700' : 'border-zinc-800/70 bg-zinc-950/80 text-zinc-200',
            copy: 'Ask for a screen, route, or product change to wake the builder surface up.',
          };

  const dashboardStats = [
    {
      label: 'Live surface',
      value: devPort ? 'Connected' : 'Not live yet',
      detail: devPort ? previewUrl : 'A local app URL appears here when the sandbox boots.',
    },
    {
      label: 'Files',
      value: hasFiles ? String(files.length) : '0',
      detail: hasFiles ? 'Generated code files are ready to inspect.' : 'No code bundle has landed yet.',
    },
    {
      label: 'Viewport',
      value: BREAKPOINTS[breakpoint].label.replace(/\s*\(.*\)/, ''),
      detail: 'Current app width for the live iframe surface.',
    },
    {
      label: 'Workspace',
      value: showDebugConsole || showFileExplorer ? 'Expanded' : 'Focused',
      detail: `${showDebugConsole ? 'Console on' : 'Console off'} · ${showFileExplorer ? 'Files on' : 'Files off'}`,
    },
  ];

  return (
    <div className={`h-full overflow-y-auto px-4 py-4 md:px-6 ${
      studioChrome
        ? 'bg-[linear-gradient(180deg,#fafafa,#f5f5f5)]'
        : 'bg-[linear-gradient(180deg,rgba(14,18,29,0.98),rgba(8,10,17,0.98))]'
    }`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <section className={`border px-4 py-4 ${
          studioChrome
            ? 'border-zinc-200 bg-white'
            : 'border-zinc-800/70 bg-zinc-950/35'
        }`}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                <span className={studioChrome ? 'text-zinc-700' : 'text-zinc-300'}>{statusMeta.label}</span>
                <span className={studioChrome ? 'text-zinc-300' : 'text-zinc-700'}>•</span>
                <span>Builder workspace</span>
              </div>
              <h3 className={`mt-4 text-2xl font-semibold tracking-[-0.03em] ${studioChrome ? 'text-zinc-900' : 'text-white'}`}>
                {projectName || 'Workspace dashboard'}
              </h3>
              <p className={`mt-3 text-sm leading-7 ${studioChrome ? 'text-zinc-600' : 'text-zinc-300'}`}>{statusMeta.copy}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={onOpenPreview}
                className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-[11px] font-medium transition-colors ${
                  studioChrome
                    ? 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100'
                    : 'border-zinc-800/70 bg-zinc-950/60 text-zinc-100 hover:border-zinc-700 hover:bg-zinc-900'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                Open App
              </button>
              <button
                onClick={onOpenCode}
                disabled={!hasFiles}
                className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  studioChrome
                    ? 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100'
                    : 'border-zinc-800/70 bg-zinc-950/60 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900'
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                Open Code
              </button>
              <button
                onClick={devPort ? onCopyUrl : onRefresh}
                className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-[11px] font-medium transition-colors ${
                  studioChrome
                    ? 'border-zinc-200 bg-zinc-900 text-white hover:bg-zinc-800'
                    : 'border-zinc-700 bg-zinc-100 text-zinc-950 hover:bg-white'
                }`}
              >
                {devPort ? <Copy className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {devPort ? 'Copy URL' : 'Refresh Status'}
              </button>
            </div>
          </div>

          <div className={`mt-5 grid gap-px overflow-hidden border sm:grid-cols-2 xl:grid-cols-4 ${
            studioChrome ? 'border-zinc-200 bg-zinc-200' : 'border-zinc-800/70 bg-zinc-800/70'
          }`}>
            {dashboardStats.map((item) => (
              <div key={item.label} className={`px-4 py-4 ${studioChrome ? 'bg-white' : 'bg-zinc-950/45'}`}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{item.label}</div>
                <div className={`mt-3 text-lg font-semibold ${studioChrome ? 'text-zinc-900' : 'text-zinc-100'}`}>{item.value}</div>
                <p className="mt-2 text-[11px] leading-6 text-zinc-500">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
          <section className={`border px-4 py-4 ${studioChrome ? 'border-zinc-200 bg-white/90' : 'border-zinc-800/70 bg-zinc-950/40'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Pipeline</div>
            <div className="mt-4">
              {(status !== 'idle' && status !== 'failed') ? (
                <BuildStepProgress status={status} />
              ) : (
                <div className={`border px-3 py-3 text-[11px] ${studioChrome ? 'border-zinc-200 bg-zinc-50 text-zinc-500' : 'border-zinc-800/70 bg-zinc-950/55 text-zinc-400'}`}>
                  The progress rail lights up as soon as the builder starts creating, installing, or booting a sandbox.
                </div>
              )}
              <div className={`mt-4 grid gap-px overflow-hidden border md:grid-cols-2 ${
                studioChrome ? 'border-zinc-200 bg-zinc-200' : 'border-zinc-800/70 bg-zinc-800/70'
              }`}>
                <div className={`px-3 py-3 ${studioChrome ? 'bg-white' : 'bg-zinc-950/55'}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Current focus</div>
                  <div className={`mt-2 text-sm font-medium ${studioChrome ? 'text-zinc-900' : 'text-zinc-100'}`}>{activeStepLabel || statusMeta.label}</div>
                  <p className="mt-2 text-[11px] leading-6 text-zinc-500">{statusMeta.copy}</p>
                </div>
                <div className={`px-3 py-3 ${studioChrome ? 'bg-white' : 'bg-zinc-950/55'}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Live target</div>
                  <div className={`mt-2 truncate font-mono text-[12px] ${studioChrome ? 'text-zinc-700' : 'text-zinc-300'}`}>{devPort ? previewUrl : 'App pending'}</div>
                  <p className="mt-2 text-[11px] leading-6 text-zinc-500">
                    {devPort
                      ? 'Use App when you want to verify layout, hover states, and end-user polish.'
                      : 'Once the sandbox exposes a port, the live URL will appear here automatically.'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className={`border px-4 py-4 ${studioChrome ? 'border-zinc-200 bg-white/90' : 'border-zinc-800/70 bg-zinc-950/40'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Code snapshot</div>
            <div className="mt-4">
              {featuredFiles.length > 0 ? (
                <div className={`overflow-hidden border ${studioChrome ? 'border-zinc-200' : 'border-zinc-800/70'}`}>
                  {featuredFiles.map((filePath) => {
                    const normalized = filePath.replace(/\\/g, '/');
                    const parts = normalized.split('/').filter(Boolean);
                    const fileName = parts.pop() || normalized;
                    const parent = parts.join('/');

                    return (
                      <div key={filePath} className={`flex items-start gap-3 border-b px-3 py-3 last:border-b-0 ${
                        studioChrome ? 'border-zinc-200 bg-white' : 'border-zinc-800/70 bg-zinc-950/45'
                      }`}>
                        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${studioChrome ? 'bg-zinc-100 text-zinc-700' : 'bg-zinc-900 text-zinc-200'}`}>
                          <File className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className={`truncate text-sm font-medium ${studioChrome ? 'text-zinc-900' : 'text-zinc-100'}`}>{fileName}</div>
                          <div className="truncate text-[11px] text-zinc-500">{parent || 'project root'}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={`border px-3 py-3 text-[11px] leading-6 text-zinc-500 ${studioChrome ? 'border-zinc-200 bg-zinc-50' : 'border-zinc-800/70 bg-zinc-950/55'}`}>
                  Files appear here after the first scaffold or edit lands. Once they do, the Code tab becomes the fastest way to inspect and patch the generated surface.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function PreviewHandoffShell({
  title,
  body,
  eyebrow,
  previewUrl,
  activeStep,
  steps,
  studio = false,
}: {
  title: string;
  body: string;
  eyebrow: string;
  previewUrl?: string;
  activeStep?: string;
  /** Live pipeline steps — rendered instead of the fake skeleton so the wait shows REAL process. */
  steps?: ReadonlyArray<{ stage: string; label: string; detail?: string; status: string }>;
  /** Base44-like light gradient + sun mark */
  studio?: boolean;
}) {
  if (studio) {
    return (
      <StudioHandoffContent body={body} activeStep={activeStep} previewUrl={previewUrl} />
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.12),rgba(9,9,11,0)_48%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(17,24,39,0.98))] p-6">
      <div className="w-full max-w-2xl rounded-[2rem] border border-zinc-800/80 bg-zinc-950/80 p-6 shadow-[0_28px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
          <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-violet-200">Live app handoff</span>
          {activeStep ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-zinc-200">{activeStep}</span>
          ) : null}
        </div>
        <div className="mt-4">
          <div className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-600">{eyebrow}</div>
          <h3 className="mt-2 text-2xl font-semibold text-white">{title}</h3>
          <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-300">{body}</p>
        </div>
        <div className="mt-6 rounded-[1.5rem] border border-zinc-800/70 bg-zinc-900/75 p-4">
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </div>
            <span className="truncate font-mono">{previewUrl ?? 'Preparing live app...'}</span>
          </div>
          {steps && steps.length > 0 ? (
            <div className="mt-4 space-y-2">
              {steps.slice(-5).map((step, index, shown) => {
                const isLast = index === shown.length - 1;
                const running = isLast && step.status === 'running';
                return (
                  <div key={`${step.stage}-${index}`} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-zinc-800/60 bg-zinc-950/60 px-3 py-2">
                    <span className={`mt-1.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'animate-pulse bg-violet-400' : 'bg-emerald-400'}`} />
                    <div className="min-w-0">
                      <div className={`truncate text-[12px] ${isLast ? 'font-medium text-zinc-100' : 'text-zinc-400'}`}>{step.label}</div>
                      {step.detail && isLast && (
                        <div className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-zinc-500">{step.detail}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
                <div className="mb-3 h-3 w-24 rounded-full bg-zinc-800" />
                <div className="space-y-2">
                  <div className="h-16 rounded-xl bg-zinc-900" />
                  <div className="h-3 w-4/5 rounded-full bg-zinc-800" />
                  <div className="h-3 w-3/5 rounded-full bg-zinc-800" />
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
                <div className="mb-3 h-3 w-28 rounded-full bg-zinc-800" />
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-20 rounded-xl bg-zinc-900" />
                  <div className="h-20 rounded-xl bg-zinc-900" />
                  <div className="col-span-2 h-10 rounded-xl bg-zinc-900" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FileTreeEntry {
  id: string;
  name: string;
  path: string;
  depth: number;
  isDirectory: boolean;
}

function buildFileTreeEntries(files: string[]): FileTreeEntry[] {
  const entries = new Map<string, FileTreeEntry>();

  for (const filePath of files) {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      if (entries.has(path)) return;
      entries.set(path, {
        id: path,
        name: part,
        path,
        depth: index,
        isDirectory: index < parts.length - 1,
      });
    });
  }

  return [...entries.values()].sort((left, right) => {
    if (left.path === right.path) return 0;
    const leftParts = left.path.split('/');
    const rightParts = right.path.split('/');
    const shared = Math.min(leftParts.length, rightParts.length);

    for (let index = 0; index < shared; index += 1) {
      if (leftParts[index] === rightParts[index]) continue;
      return leftParts[index].localeCompare(rightParts[index]);
    }

    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }

    return left.path.localeCompare(right.path);
  });
}

/* ═══════════════════════════════════
   Code View — syntax-highlighted source viewer
   ═══════════════════════════════════ */
export function CodeView({ projectId, showExplorer = true }: { projectId: string; showExplorer?: boolean }) {
  const { files, writeFiles, fetchFiles } = useSandboxStore();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const themePreference = useLayoutStore((state) => state.themePreference);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [askingVai, setAskingVai] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(256);
  const [explorerResizeArmed, setExplorerResizeArmed] = useState(false);
  const activeRequestRef = useRef(0);
  const explorerHoverTimerRef = useRef<number | null>(null);
  const explorerResizeRef = useRef({ startX: 0, startWidth: 256 });
  const fileTreeEntries = buildFileTreeEntries(files.filter((file) => !file.includes('node_modules') && !file.endsWith('.lock')));
  const explorerVisible = showExplorer && !explorerCollapsed;

  const clearExplorerHoverTimer = useCallback(() => {
    if (explorerHoverTimerRef.current != null) {
      window.clearTimeout(explorerHoverTimerRef.current);
      explorerHoverTimerRef.current = null;
    }
  }, []);

  const beginExplorerResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    clearExplorerHoverTimer();
    setExplorerResizeArmed(true);
    explorerResizeRef.current = { startX: event.clientX, startWidth: explorerWidth };

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - explorerResizeRef.current.startX;
      const next = Math.max(160, Math.min(520, explorerResizeRef.current.startWidth + delta));
      setExplorerWidth(next);
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      setExplorerResizeArmed(false);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  }, [clearExplorerHoverTimer, explorerWidth]);

  const armExplorerResize = useCallback(() => {
    clearExplorerHoverTimer();
    explorerHoverTimerRef.current = window.setTimeout(() => setExplorerResizeArmed(true), 500);
  }, [clearExplorerHoverTimer]);

  const disarmExplorerResize = useCallback(() => {
    clearExplorerHoverTimer();
    setExplorerResizeArmed(false);
  }, [clearExplorerHoverTimer]);

  useEffect(() => {
    setSelectedFile(null);
    setContent('');
    setDraft('');
    setIsEditing(false);
    setExplorerCollapsed(false);
    setExplorerWidth(256);
  }, [projectId]);

  useEffect(() => {
    if (!showExplorer) setExplorerCollapsed(false);
  }, [showExplorer]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles, projectId]);

  // Auto-select the most meaningful file for the current project.
  useEffect(() => {
    if (files.length > 0 && (!selectedFile || !files.includes(selectedFile))) {
      const preferredFile = files.find((f) =>
        f.endsWith('src/App.tsx')
        || f.endsWith('src/App.jsx')
        || f.endsWith('src/main.tsx')
        || f.endsWith('src/main.jsx')
        || f.endsWith('app/page.tsx')
        || f.endsWith('src/app/page.tsx')
      ) || files.find((f) =>
        f.endsWith('.tsx')
        || f.endsWith('.jsx')
        || f.endsWith('.ts')
        || f.endsWith('.js')
        || f.endsWith('.html')
        || f.endsWith('.css')
      ) || files[0];
      setSelectedFile(preferredFile);
    }
  }, [files, selectedFile]);

  useEffect(() => {
    setIsEditing(false);
  }, [selectedFile]);

  // Reveal a file requested from elsewhere (e.g. the chat "Files changed this
  // turn" strip). Tolerant match: exact path, else the first file whose path
  // ends with the requested path so a bare "src/App.tsx" still resolves.
  useEffect(() => {
    const onReveal = (event: Event) => {
      const raw = (event as CustomEvent<{ path?: string }>).detail?.path?.trim();
      if (!raw) return;
      const norm = raw.replace(/\\/g, '/');
      const match = files.includes(norm)
        ? norm
        : files.find((f) => f.replace(/\\/g, '/').endsWith(norm))
          ?? files.find((f) => f.replace(/\\/g, '/').endsWith(norm.split('/').pop() ?? norm));
      if (match) {
        setSelectedFile(match);
        setIsEditing(false);
      }
    };
    window.addEventListener('vai:reveal-file', onReveal);
    return () => window.removeEventListener('vai:reveal-file', onReveal);
  }, [files]);

  // Fetch file content
  useEffect(() => {
    if (!selectedFile || !projectId) return;
    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    setLoading(true);
    void apiFetch(`/api/sandbox/${projectId}/file?path=${encodeURIComponent(selectedFile)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || 'Failed to load file');
        }
        return r.json() as Promise<{ content?: string }>;
      })
      .then((data) => {
        if (activeRequestRef.current !== requestId) return;
        const next = typeof data.content === 'string' ? data.content : '// Failed to load file';
        setContent(next);
        setDraft(next);
      })
      .catch((error: unknown) => {
        if (activeRequestRef.current !== requestId) return;
        const message = error instanceof Error ? error.message : 'Failed to load file';
        setContent(`// ${message}`);
        setDraft(`// ${message}`);
      })
      .finally(() => {
        if (activeRequestRef.current === requestId) {
          setLoading(false);
        }
      });
  }, [selectedFile, projectId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = useCallback(async () => {
    if (!selectedFile || draft === content) return;
    setSaving(true);
    try {
      await writeFiles([{ path: selectedFile, content: draft }]);
      setContent(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  }, [content, draft, selectedFile, writeFiles]);

  const handleReset = useCallback(() => {
    setDraft(content);
  }, [content]);

  const handleAskVai = useCallback(() => {
    if (!selectedFile || !draft) return;
    setAskingVai(true);
    const prompt = `I'm looking at \`${selectedFile}\` in the active project. Here's the current content:\n\n\`\`\`\n${draft.slice(0, 4000)}\n\`\`\`\n\nPlease review this file and tell me if there are any issues, and how I could improve it.`;
    sendMessage(prompt);
    setTimeout(() => setAskingVai(false), 2000);
  }, [selectedFile, draft, sendMessage]);

  const lines = draft.split('\n');
  const isDirty = draft !== content;
  const isLight = themePreference === 'light';
  const language = detectCodeLanguage(selectedFile);

  return (
    <div className={`flex h-full min-h-0 flex-col md:flex-row ${isLight ? 'bg-white' : 'bg-zinc-950'}`}>
      {explorerVisible && (
        <aside className={`flex max-h-48 w-full shrink-0 flex-col border-b md:max-h-none md:w-64 md:border-b-0 md:border-r ${
          isLight ? 'border-zinc-200 bg-zinc-50/90' : 'border-zinc-800/60 bg-zinc-950/90'
        }`} style={{ width: `${explorerWidth}px` }}>
          <div className={`flex items-center justify-between gap-2 border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${
            isLight ? 'border-zinc-200 text-zinc-500' : 'border-zinc-800/50 text-zinc-500'
          }`}>
            <span>Project Explorer</span>
            <button
              type="button"
              onClick={() => setExplorerCollapsed(true)}
              className={`rounded px-1.5 py-0.5 text-[10px] normal-case tracking-normal transition-colors ${
                isLight ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
              title="Collapse code explorer"
            >
              Collapse
            </button>
          </div>
          <div className="flex-1 overflow-auto px-2 py-2">
            {fileTreeEntries.map((entry) => {
              if (entry.isDirectory) {
                return (
                  <div
                    key={entry.id}
                    className="truncate py-1 text-[11px] font-medium text-zinc-500"
                    style={{ paddingLeft: `${entry.depth * 14 + 8}px` }}
                  >
                    {entry.name}
                  </div>
                );
              }

              const isActive = selectedFile === entry.path;
              return (
                <button
                  key={entry.id}
                  onClick={() => setSelectedFile(entry.path)}
                  className={`flex w-full items-center rounded-md py-1.5 text-left text-[11px] transition-colors ${
                    isActive
                      ? isLight ? 'bg-zinc-200 text-zinc-900' : 'bg-zinc-800 text-zinc-100'
                      : isLight ? 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                  style={{ paddingLeft: `${entry.depth * 14 + 8}px`, paddingRight: '8px' }}
                  title={entry.path}
                >
                  <File className={`mr-2 h-3.5 w-3.5 shrink-0 ${isLight ? 'text-zinc-400' : 'text-zinc-600'}`} />
                  <span className="truncate">{entry.name}</span>
                </button>
              );
            })}
          </div>
        </aside>
      )}
      {explorerVisible && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize code explorer"
          title={explorerResizeArmed ? 'Drag to resize the explorer' : 'Hover to resize the explorer'}
          onPointerDown={beginExplorerResize}
          onMouseEnter={armExplorerResize}
          onMouseLeave={disarmExplorerResize}
          className={`group relative hidden w-[10px] shrink-0 cursor-col-resize items-center justify-center md:flex ${
            explorerResizeArmed ? 'z-10 bg-[color:var(--accent-soft)]' : ''
          }`}
        >
          <div className={`h-full w-[2px] rounded-full transition-all duration-200 ${
            explorerResizeArmed
              ? 'bg-[color:var(--accent)] opacity-100 shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_45%,transparent)]'
              : isLight ? 'bg-zinc-300 opacity-60 group-hover:opacity-90' : 'bg-zinc-800 opacity-70 group-hover:opacity-100'
          }`} />
          {explorerResizeArmed && (
            <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 select-none text-[9px] font-medium uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              resize
            </span>
          )}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className={`flex items-center justify-between border-b px-3 py-1 ${
          isLight ? 'border-zinc-200 bg-zinc-50/60' : 'border-zinc-800/40'
        }`}>
          <div className="flex min-w-0 items-center gap-1.5">
            {showExplorer && (
              <button
                type="button"
                onClick={() => setExplorerCollapsed((current) => !current)}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                  explorerCollapsed
                    ? isLight ? 'bg-zinc-200 text-zinc-800 hover:bg-zinc-300' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                    : isLight ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                }`}
                title={explorerCollapsed ? 'Restore code explorer' : 'Collapse code explorer'}
                aria-pressed={!explorerCollapsed}
              >
                <FolderTree className="h-3 w-3" />
                {explorerCollapsed ? 'Explorer' : 'Files'}
              </button>
            )}
            <span className="truncate text-[10px] text-zinc-500">{selectedFile || 'No file selected'}</span>
          </div>
          <div className="flex items-center gap-1">
            {selectedFile && (
              <>
                <button
                  onClick={() => setIsEditing((current) => !current)}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                    isEditing
                      ? isLight ? 'bg-zinc-900 text-white hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200'
                      : isLight ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                  }`}
                  title={isEditing ? 'Switch to highlighted read view' : 'Switch to raw edit mode'}
                >
                  {isEditing ? <Eye className="h-3 w-3" /> : <Code2 className="h-3 w-3" />}
                  {isEditing ? 'Read view' : 'Edit raw'}
                </button>
                <button
                  onClick={handleReset}
                  disabled={!isDirty || saving}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-40 ${
                    isLight ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                  }`}
                  title="Revert changes"
                >
                  <RotateCcw className="h-3 w-3" />
                  Revert
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={!isDirty || saving}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-40 ${
                    isLight ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/18'
                  }`}
                  title="Save changes"
                >
                  <Save className="h-3 w-3" />
                  {saving ? 'Saving' : saved ? 'Saved' : 'Save'}
                </button>
                <button
                  onClick={handleAskVai}
                  disabled={askingVai || !draft}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-40 ${
                    isLight ? 'bg-violet-100 text-violet-700 hover:bg-violet-200' : 'bg-violet-500/10 text-violet-400 hover:bg-violet-500/18'
                  }`}
                  title="Ask Vai about this file"
                >
                  <MessageSquare className="h-3 w-3" />
                  {askingVai ? 'Sent' : 'Ask Vai'}
                </button>
              </>
            )}
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                isLight ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
              }`}
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
                className={`rounded p-0.5 text-zinc-500 transition-colors ${
                  isLight ? 'hover:bg-zinc-100 hover:text-zinc-800' : 'hover:bg-zinc-800 hover:text-zinc-300'
                }`}
                title="Download file"
              >
                <Download className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className={`flex-1 overflow-auto ${isLight ? 'bg-white' : 'bg-zinc-950'}`}>
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
            </div>
          ) : (
            <div className="flex min-h-full text-[11px] leading-5 font-mono">
              <div className={`sticky left-0 flex flex-col items-end border-r px-2 py-2 select-none ${
                isLight ? 'border-zinc-200 bg-zinc-50 text-zinc-400' : 'border-zinc-800/40 bg-zinc-950 text-zinc-700'
              }`}>
                {lines.map((_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              {isEditing ? (
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                      event.preventDefault();
                      void handleSave();
                    }
                  }}
                  spellCheck={false}
                  wrap="off"
                  className={`min-h-full flex-1 resize-none bg-transparent px-3 py-2 whitespace-pre focus:outline-none ${
                    isLight ? 'text-zinc-800' : 'text-zinc-200'
                  }`}
                />
              ) : (
                <pre className="min-h-full min-w-max flex-1 px-3 py-2">
                  {lines.map((line, index) => (
                    <div
                      key={`${selectedFile ?? 'file'}-${index}`}
                      className={isLight ? 'hover:bg-zinc-100/80' : 'hover:bg-zinc-900/70'}
                    >
                      {line.length > 0 ? tokenizeCodeLine(line, language).map((token, tokenIndex) => (
                        <span
                          key={`${selectedFile ?? 'file'}-${index}-${tokenIndex}`}
                          className={tokenClass(token.type, isLight)}
                        >
                          {token.text}
                        </span>
                      )) : ' '}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Toolbar — Preview/Code toggle, URL bar, responsive breakpoints, actions
   ═══════════════════════════════════════════════════════════════════════ */
/**
 * LaneSwitch — the three-stop environment pill: dev | preview | prod.
 * Dev is the default lane (hot reload). Preview builds and serves the real
 * bundle; prod adds lint+typecheck gates first. Blue-green: the running app
 * keeps serving until the new lane is ready, so switching never shows a hole.
 */
function LaneSwitch() {
  const envLane = useSandboxStore((s) => s.envLane);
  const laneState = useSandboxStore((s) => s.laneState);
  const availableScripts = useSandboxStore((s) => s.availableScripts);
  const projectId = useSandboxStore((s) => s.projectId);
  const switchLane = useSandboxStore((s) => s.switchLane);

  // Without a build script there is only a dev lane — hide the pill entirely.
  if (!projectId || !availableScripts.includes('build')) return null;

  const switching = laneState?.status === 'switching';
  const failed = laneState?.status === 'failed';

  const stops: { id: 'dev' | 'preview' | 'production'; label: string; title: string }[] = [
    { id: 'dev', label: 'dev', title: 'Dev server — instant hot reload' },
    { id: 'preview', label: 'Preview', title: 'Build once, then serve the production-like bundle locally for testing' },
    { id: 'production', label: 'Prod', title: 'Run production gates first, then build and serve the production bundle' },
  ];
  const normalizedStops = stops.map((stop) => stop.id === 'dev'
    ? { ...stop, label: 'Dev', title: 'Run the framework dev server with hot reload/HMR' }
    : stop);

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-[color:var(--panel-border)] bg-[color:var(--panel-bg-muted)] p-0.5"
      role="radiogroup"
      aria-label="App environment lane"
      title={switching ? `Switching to ${laneState?.lane}… (${laneState?.stage ?? 'working'})` : undefined}
    >
      {normalizedStops.map((stop) => {
        const isActive = envLane === stop.id && !switching;
        const isTarget = switching && laneState?.lane === stop.id;
        const isFailedTarget = failed && laneState?.lane === stop.id;
        return (
          <button
            key={stop.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={switching}
            onClick={() => { void switchLane(stop.id); }}
            title={isFailedTarget && laneState?.error ? `${stop.title} — last attempt failed: ${laneState.error}` : stop.title}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-wait ${
              isActive
                ? stop.id === 'production'
                  ? 'bg-red-500/20 text-red-300'
                  : stop.id === 'preview'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-emerald-500/20 text-emerald-300'
                : isTarget
                  ? 'animate-pulse bg-violet-500/20 text-violet-300'
                  : isFailedTarget
                    ? 'text-red-400'
                    : 'text-[color:var(--color-muted)] hover:text-[color:var(--color-body)]'
            }`}
          >
            {isTarget ? `${stop.label}…` : stop.label}
          </button>
        );
      })}
    </div>
  );
}

function Toolbar({
  viewMode, setViewMode, previewUrl, devPort,
  breakpoint, setBreakpoint, onRefresh, onOpenExternal, onCopyUrl,
  onScreenshot, onDestroy, showActions, copied, hasFiles, hasActiveSandbox,
  canShowConsoleChrome = false,
  demoRunning, onToggleDemo, onConfigureEnv, iframeRef,
  studioChrome = false,
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
  onConfigureEnv?: () => void;
  showActions: boolean;
  copied?: boolean;
  hasFiles?: boolean;
  hasActiveSandbox?: boolean;
  canShowConsoleChrome?: boolean;
  demoRunning?: boolean;
  onToggleDemo?: () => void;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
  /** Light “studio builder” chrome (Base44-like) */
  studioChrome?: boolean;
}) {
  const {
    showDebugConsole, showFileExplorer,
    toggleDebugConsole, toggleFileExplorer,
    toggleThemePreference,
  } = useLayoutStore();
  const showViewToggle = true;

  return (
    <div className="preview-toolbar flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => {
            try {
              iframeRef?.current?.contentWindow?.history.back();
            } catch {
              return;
            }
          }}
          className="preview-toolbar-btn"
          title="Back"
        >
          <ArrowLeft className="h-3 w-3" />
        </button>
        <button
          onClick={() => {
            try {
              iframeRef?.current?.contentWindow?.history.forward();
            } catch {
              return;
            }
          }}
          className="preview-toolbar-btn"
          title="Forward"
        >
          <ArrowRight className="h-3 w-3" />
        </button>
        <button
          onClick={onRefresh}
          className="preview-toolbar-btn"
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      <div className="preview-toolbar-rail hidden h-4 w-px md:block" />

      {showViewToggle && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewMode('preview')}
            className={`preview-toolbar-tab ${viewMode === 'preview' ? 'preview-toolbar-tab--active' : 'preview-toolbar-tab--idle'}`}
          >
            <Eye className="h-3 w-3" />
            App
          </button>
          {hasFiles && (
            <>
              <button
                onClick={() => setViewMode('code')}
                className={`preview-toolbar-tab ${viewMode === 'code' ? 'preview-toolbar-tab--active' : 'preview-toolbar-tab--idle'}`}
              >
                <Code2 className="h-3 w-3" />
                Code
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={`preview-toolbar-tab ${viewMode === 'split' ? 'preview-toolbar-tab--active' : 'preview-toolbar-tab--idle'}`}
                title="Show code and app side by side"
              >
                <Columns2 className="h-3 w-3" />
                Split
              </button>
            </>
          )}
          <LaneSwitch />
        </div>
      )}

      <button
        type="button"
        onClick={devPort ? onCopyUrl : undefined}
        disabled={!devPort}
        className={`preview-toolbar-url flex min-w-[13rem] flex-1 items-center gap-2 px-3 py-2 text-[11px] ${
          devPort ? 'preview-toolbar-url--interactive cursor-pointer' : 'cursor-default opacity-80'
        }`}
        title={devPort ? `Copy: ${previewUrl}` : 'No live app'}
      >
        <div className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full ${
          devPort ? 'bg-emerald-500/20' : 'bg-[color:var(--panel-bg-muted)]'
        }`}>
          <div className={`h-1.5 w-1.5 rounded-full ${devPort ? 'bg-emerald-400' : 'bg-[color:var(--color-muted)]'}`} />
        </div>
        {devPort ? (
          <span className="truncate font-mono text-[color:var(--color-muted)]">{previewUrl}</span>
        ) : (
          <span className="text-[color:var(--color-muted)]">
            {hasActiveSandbox ? 'Starting app...' : 'No live app'}
          </span>
        )}
      </button>

      {showActions && (
        <div className="flex items-center gap-0.5">
          <div className="preview-toolbar-rail hidden h-4 w-px md:block" />
          <div className="flex items-center gap-0.5">
            {(Object.entries(BREAKPOINTS) as [BreakpointKey, typeof BREAKPOINTS[BreakpointKey]][]).map(
              ([key, { icon: Icon, label }]) => (
                <button
                  key={key}
                  onClick={() => setBreakpoint(key)}
                  className={breakpoint === key ? 'preview-toolbar-bp--active' : 'preview-toolbar-bp--idle'}
                  title={label}
                >
                  <Icon className="h-3 w-3" />
                </button>
              ),
            )}
          </div>

          <button onClick={onCopyUrl} disabled={!devPort}
            className="preview-toolbar-btn disabled:opacity-30" title={copied ? 'Copied!' : 'Copy URL'}>
            <Copy className="h-3 w-3" />
          </button>
          <button onClick={onScreenshot} disabled={!devPort}
            className="preview-toolbar-btn disabled:opacity-30" title="Take screenshot">
            <Camera className="h-3 w-3" />
          </button>
          {onToggleDemo && (
            <button
              onClick={onToggleDemo}
              className={`preview-toolbar-btn ${demoRunning ? 'text-[color:var(--red)]' : 'text-[color:var(--accent)]'}`}
              title={demoRunning ? 'Stop demo' : 'Run Vai demo sequence'}
            >
              {demoRunning ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3" />}
            </button>
          )}
          <button onClick={onOpenExternal} disabled={!devPort}
            className="preview-toolbar-btn hidden items-center gap-1 border border-[color:var(--shell-line-soft)] px-2 py-1 text-[10px] font-medium disabled:opacity-30 sm:flex" title="Open in browser tab">
            <ExternalLink className="h-3 w-3" />
            Browser
          </button>
          <button onClick={onDestroy}
            className="preview-toolbar-btn hover:text-[color:var(--red)]" title="Destroy project">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {canShowConsoleChrome && (
          <>
            <button
              onClick={toggleDebugConsole}
              title={showDebugConsole ? 'Hide console (Ctrl+J)' : 'Show console (Ctrl+J)'}
              className={showDebugConsole ? 'preview-toolbar-chip--on flex items-center gap-1' : 'preview-toolbar-btn flex items-center gap-1 px-2 py-1 text-[10px] font-medium'}
            >
              <Terminal className="h-3 w-3" />
              Console
            </button>
            {hasActiveSandbox && (
              <>
                {onConfigureEnv && (
                  <button
                    onClick={onConfigureEnv}
                    title="Set local .env values"
                    className="preview-toolbar-btn flex items-center gap-1 px-2 py-1 text-[10px] font-medium"
                  >
                    <KeyRound className="h-3 w-3" />
                    Env
                  </button>
                )}
                <button
                  onClick={toggleFileExplorer}
                  title={showFileExplorer ? 'Hide files (Ctrl+E)' : 'Show files (Ctrl+E)'}
                  className={showFileExplorer ? 'preview-toolbar-chip--warn flex items-center gap-1' : 'preview-toolbar-btn flex items-center gap-1 px-2 py-1 text-[10px] font-medium'}
                >
                  <FolderTree className="h-3 w-3" />
                  Files
                </button>
              </>
            )}
          </>
        )}
        <SandboxAppToggle studioChrome={studioChrome} size="toolbar" />
        <WorkspaceLayoutControls surface="app" studio={studioChrome} compact />
        <button
          onClick={toggleThemePreference}
          title={studioChrome ? 'Switch to dark theme' : 'Switch to light theme'}
          className="preview-toolbar-btn"
        >
          {studioChrome ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ██████  PREVIEW PANEL — Claude Artifacts-inspired sandbox preview
   ═══════════════════════════════════════════════════════════════════════ */
function derivePreviewFailureCause(error: string | null, buildMessage: string | null | undefined, logs: string[]): string {
  if (error?.trim()) return error.trim();

  const recentLogs = logs
    .filter(Boolean)
    .slice(-120)
    .reverse();
  const concrete = recentLogs.find((line) => /Missing\s+[A-Z][A-Z0-9_]+/i.test(line))
    ?? recentLogs.find((line) => /Preview health check failed|HTTP\s+5\d\d|HTTPError|Internal Server Error|Dev server error|Dev server exited/i.test(line));

  if (concrete) {
    return concrete
      .replace(/^.*?Preview health check failed:/i, 'Preview failed:')
      .replace(/:\s+cause:\s*/i, ': ')
      .replace(/^cause:\s*/i, '')
      .trim();
  }

  return buildMessage || 'The sandbox stopped before the preview became available.';
}

export function PreviewPanel() {
  const {
    status, devPort, projectName, projectId, files, logs, error,
    previewReady, lastPreviewPort,
    deployPhase, deploySteps, deployStartTime, deployStackName, deployTierName,
    deployStack, destroyProject, cancelDeploy, scaffoldFromTemplate,
    markPreviewLoading, markPreviewReady, fetchFiles, startDev,
  } = useSandboxStore();

  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [breakpoint, setBreakpoint] = useState<BreakpointKey>('desktop');
  const [copied, setCopied] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [previewWaitExpired, setPreviewWaitExpired] = useState(false);
  const [envSetupOpen, setEnvSetupOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const seenPreviewKeysRef = useRef<Set<string>>(new Set());
  const mode = useLayoutStore((s) => s.mode);
  const themePreference = useLayoutStore((s) => s.themePreference);
  const buildStatus = useLayoutStore((s) => s.buildStatus);
  const showDebugConsole = useLayoutStore((s) => s.showDebugConsole);
  const showFileExplorer = useLayoutStore((s) => s.showFileExplorer);
  const toggleDebugConsole = useLayoutStore((s) => s.toggleDebugConsole);
  const isStreaming = useChatStore((s) => s.isStreaming);
  // Live pipeline steps of the streaming turn — shown in the handoff card so
  // the wait displays REAL process (council stages), not a fake skeleton.
  const liveHandoffSteps = useChatStore((s) => {
    if (!s.isStreaming) return EMPTY_HANDOFF_STEPS;
    const last = s.messages[s.messages.length - 1];
    return (last?.progressSteps as typeof EMPTY_HANDOFF_STEPS | undefined) ?? EMPTY_HANDOFF_STEPS;
  });

  /* ── Phase 0: cursor store (global — rendered by VaiOverlaySystem) ── */
  const demoRunning = useCursorStore((s) => s.demoRunning);
  const toggleDemo = useCursorStore((s) => s.toggleDemo);

  const previewUrl = devPort ? `http://localhost:${devPort}` : 'about:blank';
  const hasFiles = files.length > 0;
  const hasActiveSandbox = projectId !== null;
  const canShowConsoleChrome = hasActiveSandbox || status === 'failed' || buildStatus.step === 'failed';
  const isBuildMode = mode === 'builder' || mode === 'agent';
  const studioChrome = themePreference === 'light';
  const activeDeployStep = deploySteps.find((step) => step.status === 'running') ?? deploySteps.find((step) => step.status === 'pending') ?? null;
  const activeStepLabel = deployPhase === 'deploying'
    ? activeDeployStep?.label
    : buildStatus.step !== 'idle' && buildStatus.step !== 'ready'
      ? buildStatus.message || buildStatus.step
      : undefined;
  const previewCacheKey = projectId && devPort ? `${projectId}:${devPort}` : null;
  const hasWarmPreview = previewCacheKey ? seenPreviewKeysRef.current.has(previewCacheKey) : false;
  const canKeepLoadedPreview = Boolean(
    devPort
    && (hasWarmPreview || (previewReady && lastPreviewPort === devPort)),
  );
  const shouldRenderPreviewFrame = Boolean(devPort) && (status === 'running' || canKeepLoadedPreview);
  const shouldShowPreviewOverlay = status === 'running' && Boolean(devPort) && !iframeReady && !hasWarmPreview;
  const failureMessage = derivePreviewFailureCause(error, buildStatus.message, logs);

  // Reset to preview if code tab becomes unavailable
  useEffect(() => {
    if (viewMode !== 'preview' && !hasFiles) setViewMode('preview');
  }, [hasFiles, viewMode]);

  // When a build is actively progressing, bias the panel back to the live preview.
  useEffect(() => {
    if (viewMode !== 'preview' && hasFiles && status !== 'idle' && status !== 'failed' && status !== 'running') {
      setViewMode('preview');
    }
  }, [hasFiles, status, viewMode]);

  useEffect(() => {
    if (viewMode !== 'preview' && projectId) {
      void fetchFiles();
    }
  }, [fetchFiles, projectId, viewMode]);

  useEffect(() => {
    if (status === 'running' && devPort) {
      if (previewCacheKey && seenPreviewKeysRef.current.has(previewCacheKey)) {
        setIframeReady(true);
        return;
      }
      setIframeReady(false);
      markPreviewLoading(devPort);
      return;
    }
    if (status === 'failed' && canKeepLoadedPreview) {
      setIframeReady(true);
      return;
    }
    if (status !== 'running') {
      setIframeReady(false);
      markPreviewLoading(null);
    }
  }, [canKeepLoadedPreview, devPort, markPreviewLoading, previewCacheKey, status]);

  useEffect(() => {
    setPreviewWaitExpired(false);
  }, [previewCacheKey, status]);

  useEffect(() => {
    if (status === 'running' && devPort && viewMode === 'code' && !hasWarmPreview) {
      setViewMode('preview');
    }
  }, [devPort, hasWarmPreview, status, viewMode]);

  useEffect(() => {
    const openPreview = () => setViewMode('preview');
    const openCode = () => setViewMode('code');
    window.addEventListener('vai-open-preview', openPreview);
    window.addEventListener('vai-open-code', openCode);
    return () => {
      window.removeEventListener('vai-open-preview', openPreview);
      window.removeEventListener('vai-open-code', openCode);
    };
  }, []);

  // Recovery: if we have a port but status is stuck building, force transition
  useEffect(() => {
    if (devPort && status !== 'running' && status !== 'idle' && status !== 'failed') {
      const timer = setTimeout(() => {
        const s = useSandboxStore.getState();
        if (s.devPort && s.status !== 'running' && s.status !== 'idle' && s.status !== 'failed') {
          useSandboxStore.setState({ status: 'running' });
        }
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [devPort, status]);

  // Do not auto-mark the app as live merely because a timeout elapsed. Some
  // real apps do stall the iframe load event, so we keep a manual "show anyway"
  // escape hatch; but previewReady should mean the iframe actually loaded.
  useEffect(() => {
    if (!shouldShowPreviewOverlay) return;
    const timer = setTimeout(() => {
      setPreviewWaitExpired(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [shouldShowPreviewOverlay]);

  const refresh = useCallback(() => {
    if (iframeRef.current) {
      setIframeReady(false);
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

  const renderPreviewSurface = (className = 'preview-panel-canvas flex h-full items-stretch justify-stretch') => (
    <div className={className}>
      {status === 'failed' && !canKeepLoadedPreview ? (
        <PreviewFailureState
          message={failureMessage}
          canRestart={Boolean(projectId)}
          onRestart={() => { void startDev(); }}
          onRepair={() => {
            window.dispatchEvent(new CustomEvent('vai:prefill-chat', {
              detail: { prompt: createPreviewRepairPrompt(failureMessage) },
            }));
          }}
          onViewConsole={() => {
            if (!showDebugConsole) toggleDebugConsole();
          }}
        />
      ) : shouldRenderPreviewFrame && devPort ? (
        <div
          ref={previewContainerRef}
          className="preview-panel-iframe-bg relative h-full w-full overflow-hidden"
          style={{ width: breakpoint === 'desktop' ? '100%' : BREAKPOINTS[breakpoint].width, maxWidth: '100%' }}
        >
          <iframe ref={iframeRef} src={previewUrl} className="h-full w-full" data-testid="preview-iframe"
            onLoad={() => setTimeout(() => {
              if (previewCacheKey) {
                seenPreviewKeysRef.current.add(previewCacheKey);
              }
              setIframeReady(true);
              markPreviewReady(devPort);
            }, 180)}
            title="App" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups" />
          <AnimatePresence>
            {shouldShowPreviewOverlay && (
              <motion.div
                key="preview-handoff-overlay"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="absolute inset-0"
              >
                <PreviewHandoffShell
                  studio={studioChrome}
                  eyebrow="App warming"
                  title={previewWaitExpired ? 'Still waiting for the browser load' : 'Connecting the live app'}
                  body={previewWaitExpired
                    ? 'The dev server is running, but the iframe has not reported a completed load yet. It may still be compiling, or the app may have a browser-side runtime error. You can show it anyway, but Vai will not mark it as live until the iframe actually loads.'
                    : 'The sandbox is already running. Holding the handoff shell until the first browser load lands keeps this from feeling like a blank iframe race.'}
                  previewUrl={previewUrl}
                  activeStep={activeStepLabel}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (previewCacheKey) seenPreviewKeysRef.current.add(previewCacheKey);
                    setIframeReady(true);
                  }}
                  className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/50 px-3.5 py-1.5 text-[11px] font-medium text-zinc-300 backdrop-blur transition hover:bg-black/70 hover:text-white"
                >
                  {previewWaitExpired ? 'Show anyway' : 'Show the app now'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <PreviewHandoffShell
          studio={studioChrome}
          eyebrow="App handoff"
          title={isStreaming ? 'Building your app' : 'Starting preview'}
          body={isStreaming
            ? 'Vai\'s council is working — these are the real pipeline steps as they happen.'
            : buildStatus.message || 'Creating the sandbox, wiring dependencies, and reconnecting the live app for this conversation.'}
          previewUrl={devPort ? `http://localhost:${devPort}` : undefined}
          activeStep={activeStepLabel}
          steps={liveHandoffSteps}
        />
      )}
    </div>
  );

  // ── Empty state: template gallery ──
  if (!projectId && status === 'idle' && deployPhase === 'idle') {
    if (isBuildMode) {
      const isFailed = buildStatus.step === 'failed';
      const title = isFailed
        ? 'No runnable update reached preview yet'
        : isStreaming
          ? `${mode === 'agent' ? 'Agent' : 'Builder'} is preparing your sandbox`
          : 'Live preview will appear here';
      const body = isFailed
        ? buildStatus.message || 'Vai answered in chat, but it did not emit files or a preview action yet. Ask for a concrete screen, route, or component so it can generate something runnable.'
        : isStreaming
          ? 'The preview stays neutral until files or a deploy action arrive. As soon as a sandbox exists, it will replace this waiting state automatically.'
          : 'Ask for a concrete app, screen, or edit in Agent or Builder mode. As soon as files or a starter land, this panel becomes the live app automatically.';

      return (
        <div className="preview-panel-root flex h-full flex-col">
          <Toolbar viewMode="preview" setViewMode={() => {}} projectName={null} previewUrl=""
            devPort={null} breakpoint={breakpoint} setBreakpoint={setBreakpoint}
            onRefresh={() => {}} onOpenExternal={() => {}} onCopyUrl={() => {}}
            onScreenshot={() => {}} onDestroy={() => {}} showActions={false}
            hasFiles={false} hasActiveSandbox={false}
            demoRunning={demoRunning} onToggleDemo={toggleDemo}
            studioChrome={studioChrome} />
          <div className="flex min-h-0 flex-1 flex-col">
            {studioChrome && !isFailed && isBuildMode ? (
              <PreviewHandoffShell
                studio
                eyebrow="Preview"
                title="Building your idea."
                body={body}
                activeStep={isStreaming ? activeStepLabel : undefined}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8">
                <div className="w-full max-w-sm text-center">
                  <div className="relative mx-auto mb-6 h-16 w-16">
                    {!isFailed && (
                      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 blur-2xl" />
                    )}
                    <div className={`relative flex h-16 w-16 items-center justify-center rounded-2xl ring-1 shadow-xl ${
                      isFailed
                        ? 'bg-red-500/10 ring-red-500/20 shadow-red-500/5'
                        : 'bg-gradient-to-br from-violet-600/15 to-blue-600/15 ring-violet-500/20 shadow-violet-500/10'
                    }`}>
                      {isFailed ? (
                        <XCircle className="h-7 w-7 text-red-400" />
                      ) : isStreaming ? (
                        <Loader2 className="h-7 w-7 animate-spin text-violet-300" />
                      ) : (
                        <Code2 className="h-7 w-7 text-violet-300" />
                      )}
                    </div>
                  </div>
                  <h3 className={`text-sm font-semibold leading-6 ${isFailed ? 'text-red-300' : 'text-zinc-100'}`}>{title}</h3>
                  <p className="mt-2 text-[12px] leading-6 text-zinc-500">{body}</p>
                  {isStreaming && !isFailed && (
                    <div className="mt-4 flex justify-center gap-1">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="h-1.5 w-1.5 rounded-full bg-violet-500/60 animate-pulse"
                          style={{ animationDelay: `${i * 150}ms` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="preview-panel-root flex h-full flex-col">
        <Toolbar viewMode="preview" setViewMode={() => {}} projectName={null} previewUrl=""
          devPort={null} breakpoint={breakpoint} setBreakpoint={setBreakpoint}
          onRefresh={() => {}} onOpenExternal={() => {}} onCopyUrl={() => {}}
          onScreenshot={() => {}} onDestroy={() => {}} showActions={false}
          hasFiles={false} hasActiveSandbox={false}
          demoRunning={demoRunning} onToggleDemo={toggleDemo}
          studioChrome={studioChrome} />
        <div className="preview-panel-canvas min-h-0 flex-1">
          <TemplateGallery
            onDeploy={(stackId, tier, stackName, tierName) => deployStack(stackId, tier, stackName, tierName)}
            onTemplate={(templateId, name) => scaffoldFromTemplate(templateId, name)}
            isDeploying={false}
          />
        </div>
      </div>
    );
  }

  // ── Deploy in progress ──
  if (deployPhase === 'deploying' || deployPhase === 'failed') {
    return (
      <div className="preview-panel-root flex h-full flex-col">
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
    <div className="preview-panel-root flex h-full flex-col">
      {/* ── Toolbar ── */}
      <Toolbar
        viewMode={viewMode} setViewMode={setViewMode}
        projectName={projectName} previewUrl={previewUrl} devPort={devPort}
        breakpoint={breakpoint} setBreakpoint={setBreakpoint}
        onRefresh={refresh} onOpenExternal={openExternal} onCopyUrl={handleCopyUrl}
        onScreenshot={handleScreenshot} onDestroy={destroyProject}
        onConfigureEnv={projectId ? () => setEnvSetupOpen(true) : undefined}
        showActions copied={copied}
        hasFiles={hasFiles} hasActiveSandbox={hasActiveSandbox} canShowConsoleChrome={canShowConsoleChrome}
        demoRunning={demoRunning} onToggleDemo={toggleDemo}
        iframeRef={iframeRef}
        studioChrome={studioChrome}
      />

      {/* ── Build step progress (while building) ── */}
      {status !== 'idle' && status !== 'running' && (
        <BuildStepProgress status={status} studioChrome={studioChrome} />
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
              className="preview-panel-canvas flex h-full items-stretch justify-stretch"
            >
              {status === 'failed' && !canKeepLoadedPreview ? (
                <PreviewFailureState
                  message={failureMessage}
                  canRestart={Boolean(projectId)}
                  onRestart={() => { void startDev(); }}
                  onConfigureEnv={projectId ? () => setEnvSetupOpen(true) : undefined}
                  onRepair={() => {
                    window.dispatchEvent(new CustomEvent('vai:prefill-chat', {
                      detail: { prompt: createPreviewRepairPrompt(failureMessage) },
                    }));
                  }}
                  onViewConsole={() => {
                    if (!showDebugConsole) toggleDebugConsole();
                  }}
                />
              ) : shouldRenderPreviewFrame && devPort ? (
                <div
                  ref={previewContainerRef}
                  className="preview-panel-iframe-bg relative h-full w-full overflow-hidden"
                  style={{ width: breakpoint === 'desktop' ? '100%' : BREAKPOINTS[breakpoint].width, maxWidth: '100%' }}
                >
                  <iframe ref={iframeRef} src={previewUrl} className="h-full w-full" data-testid="preview-iframe"
                    onLoad={() => setTimeout(() => {
                      if (previewCacheKey) {
                        seenPreviewKeysRef.current.add(previewCacheKey);
                      }
                      setIframeReady(true);
                      markPreviewReady(devPort);
                    }, 180)}
                    title="App" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups" />
                  <AnimatePresence>
                    {shouldShowPreviewOverlay && (
                      <motion.div
                        key="preview-handoff-overlay"
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                        className="absolute inset-0"
                      >
                        <PreviewHandoffShell
                          studio={studioChrome}
                          eyebrow="App warming"
                          title={previewWaitExpired ? 'Still waiting for the browser load' : 'Connecting the live app'}
                          body={previewWaitExpired
                            ? 'The dev server is running, but the iframe has not reported a completed load yet. It may still be compiling, or the app may have a browser-side runtime error. You can show it anyway, but Vai will not mark it as live until the iframe actually loads.'
                            : 'The sandbox is already running. Holding the handoff shell until the first browser load lands keeps this from feeling like a blank iframe race.'}
                          previewUrl={previewUrl}
                          activeStep={activeStepLabel}
                        />
                        {/* Manual escape — the shell is a courtesy, not a gate. */}
                        <button
                          type="button"
                          onClick={() => {
                            if (previewCacheKey) seenPreviewKeysRef.current.add(previewCacheKey);
                            setIframeReady(true);
                          }}
                          className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/50 px-3.5 py-1.5 text-[11px] font-medium text-zinc-300 backdrop-blur transition hover:bg-black/70 hover:text-white"
                        >
                          {previewWaitExpired ? 'Show anyway' : 'Show the app now'}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <PreviewHandoffShell
                  studio={studioChrome}
                  eyebrow="App handoff"
                  title={isStreaming ? 'Building your app' : 'Starting preview'}
                  body={isStreaming
                    ? 'Vai\'s council is working — these are the real pipeline steps as they happen.'
                    : buildStatus.message || 'Creating the sandbox, wiring dependencies, and reconnecting the live app for this conversation.'}
                  previewUrl={devPort ? `http://localhost:${devPort}` : undefined}
                  activeStep={activeStepLabel}
                  steps={liveHandoffSteps}
                />
              )}
            </motion.div>
          ) : viewMode === 'split' ? (
            <motion.div
              key="split"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full min-h-0 bg-zinc-950"
            >
              <Group id="app-code-split-layout" orientation="horizontal" className="h-full min-h-0">
                <Panel id="split-code" defaultSize="48" minSize="18" collapsible collapsedSize={0}>
                  <div className="h-full min-h-0 min-w-0 border-r border-zinc-800/70">
                    {projectId ? (
                      <CodeView projectId={projectId} showExplorer={!showFileExplorer} />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
                        No project active
                      </div>
                    )}
                  </div>
                </Panel>
                <HoverResizeHandle direction="vertical" />
                <Panel id="split-app" defaultSize="52" minSize="22">
                  <div className="h-full min-h-0 min-w-0">
                    {renderPreviewSurface()}
                  </div>
                </Panel>
              </Group>
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
                <CodeView projectId={projectId} showExplorer={!showFileExplorer} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-600">
                  No project active
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {envSetupOpen && projectId && (
            <EnvSetupDialog
              projectId={projectId}
              failureMessage={failureMessage}
              onClose={() => setEnvSetupOpen(false)}
              onSaved={async () => { await startDev(); }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
