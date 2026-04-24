import { useSandboxStore } from '../stores/sandboxStore.js';
import { apiFetch } from '../lib/api.js';
import {
  RefreshCw, Smartphone, Tablet, Monitor, Copy, ExternalLink,
  Code2, Eye, EyeOff, Trash2, Download, CheckCircle, XCircle, Loader2,
  Camera, Terminal, FolderTree, Play, Square, Maximize2, Minimize2,
  ArrowLeft, ArrowRight, Save, RotateCcw, MessageSquare, File, Moon, Sun,
} from 'lucide-react';
import { useState, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TemplateGallery } from './TemplateGallery.js';
import { DeployProgress } from './DeployProgress.js';
import { useLayoutStore } from '../stores/layoutStore.js';
import { useCursorStore } from '../stores/cursorStore.js';
import { useChatStore } from '../stores/chatStore.js';

/* ── Types ── */

type ViewMode = 'preview' | 'code';
type BreakpointKey = 'mobile' | 'tablet' | 'desktop';
type CodeLanguage = 'script' | 'markup' | 'style' | 'data' | 'plain';

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

const STUDIO_PREVIEW_TIPS = [
  'Ask for Discussion or Plan mode when you want to save iterations for trickier product calls.',
  'Version history in your workflow can restore an earlier sandbox when an edit goes sideways.',
  'Pick Stripe, PayPal, Klarna, Vipps, or mock checkout — Vai can wire the UI to match.',
  'Toggle mobile preview to catch layout issues before you ship.',
] as const;

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
      <span className="text-lg font-semibold tracking-[-0.08em] text-zinc-100">V</span>
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
        copy: activeStepLabel || 'The preview is connected and ready to inspect.',
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
      detail: devPort ? previewUrl : 'A local preview URL appears here when the sandbox boots.',
    },
    {
      label: 'Files',
      value: hasFiles ? String(files.length) : '0',
      detail: hasFiles ? 'Generated source files are ready to inspect.' : 'No source bundle has landed yet.',
    },
    {
      label: 'Viewport',
      value: BREAKPOINTS[breakpoint].label.replace(/\s*\(.*\)/, ''),
      detail: 'Current preview width for the live iframe surface.',
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
                Open Preview
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
                  <div className={`mt-2 truncate font-mono text-[12px] ${studioChrome ? 'text-zinc-700' : 'text-zinc-300'}`}>{devPort ? previewUrl : 'Preview pending'}</div>
                  <p className="mt-2 text-[11px] leading-6 text-zinc-500">
                    {devPort
                      ? 'Use Preview when you want to verify layout, hover states, and end-user polish.'
                      : 'Once the sandbox exposes a port, the live URL will appear here automatically.'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className={`border px-4 py-4 ${studioChrome ? 'border-zinc-200 bg-white/90' : 'border-zinc-800/70 bg-zinc-950/40'}`}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Source snapshot</div>
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
  studio = false,
}: {
  title: string;
  body: string;
  eyebrow: string;
  previewUrl?: string;
  activeStep?: string;
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
          <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-violet-200">Live preview handoff</span>
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
            <span className="truncate font-mono">{previewUrl ?? 'Preparing live preview...'}</span>
          </div>
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
function CodeView({ projectId }: { projectId: string }) {
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
  const activeRequestRef = useRef(0);
  const fileTreeEntries = buildFileTreeEntries(files.filter((file) => !file.includes('node_modules') && !file.endsWith('.lock')));

  useEffect(() => {
    setSelectedFile(null);
    setContent('');
    setDraft('');
    setIsEditing(false);
  }, [projectId]);

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
      <aside className={`flex max-h-48 w-full shrink-0 flex-col border-b md:max-h-none md:w-64 md:border-b-0 md:border-r ${
        isLight ? 'border-zinc-200 bg-zinc-50/90' : 'border-zinc-800/60 bg-zinc-950/90'
      }`}>
        <div className={`border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${
          isLight ? 'border-zinc-200 text-zinc-500' : 'border-zinc-800/50 text-zinc-500'
        }`}>
          Project Explorer
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className={`flex items-center justify-between border-b px-3 py-1 ${
          isLight ? 'border-zinc-200 bg-zinc-50/60' : 'border-zinc-800/40'
        }`}>
          <span className="truncate text-[10px] text-zinc-500">{selectedFile || 'No file selected'}</span>
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
function Toolbar({
  viewMode, setViewMode, projectName, previewUrl, devPort,
  breakpoint, setBreakpoint, onRefresh, onOpenExternal, onCopyUrl,
  onScreenshot, onDestroy, showActions, copied, hasFiles, hasActiveSandbox,
  canShowConsoleChrome = false,
  demoRunning, onToggleDemo, iframeRef,
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
    previewExpanded, togglePreviewExpanded, toggleBuilderPanel,
    toggleThemePreference,
  } = useLayoutStore();
  const showViewToggle = true;

  const chromeBtn = studioChrome
    ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
    : 'text-zinc-500 hover:bg-zinc-900/80 hover:text-zinc-100';
  const chromeTabActive = studioChrome
    ? 'border-zinc-900 text-zinc-900'
    : 'border-zinc-100 text-zinc-100';
  const chromeTabIdle = studioChrome
    ? 'border-transparent text-zinc-500 hover:text-zinc-900'
    : 'border-transparent text-zinc-500 hover:text-zinc-200';
  const chromeUrlRing = studioChrome ? 'border-zinc-200' : 'border-zinc-800/70';
  const chromeUrlBg = studioChrome ? 'bg-zinc-50 hover:bg-zinc-100' : 'bg-zinc-950 hover:bg-zinc-900';
  const iconGhost = studioChrome
    ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
    : 'text-zinc-500 hover:bg-zinc-900/80 hover:text-zinc-100';
  const bpOn = studioChrome
    ? 'bg-zinc-900 text-white'
    : 'bg-zinc-100 text-zinc-950';
  const bpOff = studioChrome
    ? 'text-zinc-500 hover:text-zinc-900'
    : 'text-zinc-600 hover:text-zinc-300';
  const rail = studioChrome ? 'bg-zinc-200' : 'bg-zinc-800/70';

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 ${
      studioChrome
        ? 'border-zinc-200 bg-white'
        : 'border-zinc-800/75 bg-[linear-gradient(180deg,rgba(18,24,39,0.96),rgba(10,12,20,0.92))]'
    }`}>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => {
            try {
              iframeRef?.current?.contentWindow?.history.back();
            } catch {
              return;
            }
          }}
          className={`rounded-md p-1.5 transition-colors ${chromeBtn}`}
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
          className={`rounded-md p-1.5 transition-colors ${chromeBtn}`}
          title="Forward"
        >
          <ArrowRight className="h-3 w-3" />
        </button>
        <button
          onClick={onRefresh}
          className={`rounded-md p-1.5 transition-colors ${chromeBtn}`}
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      <div className={`hidden h-4 w-px md:block ${rail}`} />

      {showViewToggle && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1.5 border-b-2 px-0 py-1.5 text-[11px] font-medium transition-colors ${
              viewMode === 'preview'
                ? chromeTabActive
                : chromeTabIdle
            }`}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          {hasFiles && (
            <button
              onClick={() => setViewMode('code')}
              className={`flex items-center gap-1.5 border-b-2 px-0 py-1.5 text-[11px] font-medium transition-colors ${
                viewMode === 'code'
                  ? chromeTabActive
                  : chromeTabIdle
              }`}
            >
              <Code2 className="h-3 w-3" />
              Code
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={devPort ? onCopyUrl : undefined}
        disabled={!devPort}
        className={`flex min-w-[13rem] flex-1 items-center gap-2 rounded-md border px-3 py-2 text-[11px] transition-colors ${
          devPort
            ? `cursor-pointer ${chromeUrlBg} ${chromeUrlRing} hover:border-zinc-300`
            : `cursor-default ${studioChrome ? 'bg-zinc-50 border-zinc-200' : 'bg-zinc-950/72 border-zinc-800/70'}`
        }`}
        title={devPort ? `Copy: ${previewUrl}` : 'No live preview'}
      >
        <div className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full ${
          devPort ? 'bg-emerald-500/20' : studioChrome ? 'bg-zinc-200' : 'bg-zinc-800'
        }`}>
          <div className={`h-1.5 w-1.5 rounded-full ${devPort ? 'bg-emerald-400' : studioChrome ? 'bg-zinc-400' : 'bg-zinc-700'}`} />
        </div>
        {devPort ? (
          <span className={`truncate font-mono ${studioChrome ? 'text-zinc-600' : 'text-zinc-400'}`}>{previewUrl}</span>
        ) : (
          <span className={studioChrome ? 'text-zinc-500' : 'text-zinc-700'}>
            {hasActiveSandbox ? 'Starting preview...' : 'No live preview'}
          </span>
        )}
      </button>

      {showActions && (
        <div className="flex items-center gap-0.5">
          <div className={`hidden h-4 w-px md:block ${rail}`} />
          <div className="flex items-center gap-0.5">
            {(Object.entries(BREAKPOINTS) as [BreakpointKey, typeof BREAKPOINTS[BreakpointKey]][]).map(
              ([key, { icon: Icon, label }]) => (
                <button
                  key={key}
                  onClick={() => setBreakpoint(key)}
                  className={`rounded-md p-1.5 transition-colors ${
                    breakpoint === key ? bpOn : bpOff
                  }`}
                  title={label}
                >
                  <Icon className="h-3 w-3" />
                </button>
              ),
            )}
          </div>

          <button onClick={onCopyUrl} disabled={!devPort}
            className={`rounded-md p-1.5 transition-colors disabled:opacity-30 ${iconGhost}`} title={copied ? 'Copied!' : 'Copy URL'}>
            <Copy className="h-3 w-3" />
          </button>
          <button onClick={onScreenshot} disabled={!devPort}
            className={`rounded-md p-1.5 transition-colors disabled:opacity-30 ${iconGhost}`} title="Take screenshot">
            <Camera className="h-3 w-3" />
          </button>
          {onToggleDemo && (
            <button
              onClick={onToggleDemo}
              className={`rounded-md p-1.5 transition-colors ${
                demoRunning
                  ? studioChrome
                    ? 'text-red-600 hover:bg-red-50 hover:text-red-700'
                    : 'text-red-400 hover:bg-zinc-900 hover:text-red-300'
                  : studioChrome
                    ? 'text-orange-600 hover:bg-orange-50 hover:text-orange-800'
                    : 'text-violet-400 hover:bg-zinc-900 hover:text-violet-300'
              }`}
              title={demoRunning ? 'Stop demo' : 'Run Vai demo sequence'}
            >
              {demoRunning ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3" />}
            </button>
          )}
          <button onClick={onOpenExternal} disabled={!devPort}
            className={`rounded-md p-1.5 transition-colors disabled:opacity-30 ${iconGhost}`} title="Open in new tab">
            <ExternalLink className="h-3 w-3" />
          </button>
          <button onClick={onDestroy}
            className={`rounded-md p-1.5 transition-colors ${
              studioChrome
                ? 'text-zinc-500 hover:bg-red-50 hover:text-red-600'
                : 'text-zinc-600 hover:bg-zinc-900 hover:text-red-400'
            }`} title="Destroy project">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}

      {canShowConsoleChrome && (
        <div className="flex items-center gap-0.5">
          <div className={`h-4 w-px ${rail}`} />
          <button
            onClick={toggleDebugConsole}
            title={showDebugConsole ? 'Hide console (Ctrl+J)' : 'Show console (Ctrl+J)'}
            className={`rounded-md p-1.5 transition-colors ${
              showDebugConsole
                ? studioChrome
                  ? 'text-emerald-600 hover:bg-emerald-50'
                  : 'text-emerald-400 hover:bg-zinc-900'
                : chromeBtn
            }`}
          >
            <Terminal className="h-3 w-3" />
          </button>
          {hasActiveSandbox && (
            <button
              onClick={toggleFileExplorer}
              title={showFileExplorer ? 'Hide files (Ctrl+E)' : 'Show files (Ctrl+E)'}
              className={`rounded-md p-1.5 transition-colors ${
                showFileExplorer
                  ? studioChrome
                    ? 'text-amber-700 hover:bg-amber-50'
                    : 'text-amber-400 hover:bg-zinc-900'
                  : chromeBtn
              }`}
            >
              <FolderTree className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        <button
          onClick={toggleThemePreference}
          title={studioChrome ? 'Switch to dark theme' : 'Switch to light theme'}
          className={`rounded-md p-1.5 transition-colors ${chromeBtn}`}
        >
          {studioChrome ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
        </button>
        <button
          onClick={toggleBuilderPanel}
          title="Hide preview (Ctrl+B)"
          className={`rounded-md p-1.5 transition-colors ${chromeBtn}`}
        >
          <EyeOff className="h-3 w-3" />
        </button>
        <button
          onClick={togglePreviewExpanded}
          title={previewExpanded ? 'Shrink preview' : 'Expand preview'}
          className={`rounded-md p-1.5 transition-colors ${
            previewExpanded
              ? studioChrome
                ? 'text-orange-600 hover:bg-orange-50'
                : 'text-violet-400 hover:bg-zinc-900 hover:text-violet-300'
              : chromeBtn
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
    deployStack, destroyProject, cancelDeploy, scaffoldFromTemplate,
    markPreviewLoading, markPreviewReady, previewReady, fetchFiles,
  } = useSandboxStore();

  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [breakpoint, setBreakpoint] = useState<BreakpointKey>('desktop');
  const [copied, setCopied] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const seenPreviewKeysRef = useRef<Set<string>>(new Set());
  const mode = useLayoutStore((s) => s.mode);
  const themePreference = useLayoutStore((s) => s.themePreference);
  const buildStatus = useLayoutStore((s) => s.buildStatus);
  const isStreaming = useChatStore((s) => s.isStreaming);

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
  const shouldShowPreviewOverlay = status === 'running' && Boolean(devPort) && !iframeReady && !hasWarmPreview;

  // Reset to preview if code tab becomes unavailable
  useEffect(() => {
    if (viewMode === 'code' && !hasFiles) setViewMode('preview');
  }, [hasFiles, viewMode]);

  // When a build is actively progressing, bias the panel back to the live preview.
  useEffect(() => {
    if (viewMode === 'code' && hasFiles && status !== 'idle' && status !== 'failed' && status !== 'running') {
      setViewMode('preview');
    }
  }, [hasFiles, status, viewMode]);

  useEffect(() => {
    if (viewMode === 'code' && projectId) {
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
    if (status !== 'running') {
      setIframeReady(false);
      markPreviewLoading(null);
    }
  }, [devPort, markPreviewLoading, previewCacheKey, status]);

  useEffect(() => {
    if (status === 'running' && devPort && viewMode === 'code' && !hasWarmPreview) {
      setViewMode('preview');
    }
  }, [devPort, hasWarmPreview, status, viewMode]);

  useEffect(() => {
    const openPreview = () => setViewMode('preview');
    window.addEventListener('vai-open-preview', openPreview);
    return () => window.removeEventListener('vai-open-preview', openPreview);
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
          : 'Ask for a concrete app, screen, or edit in Builder mode. As soon as files or a starter land, this panel becomes the live app automatically.';

      return (
        <div className={`flex h-full flex-col ${studioChrome ? 'bg-[#fafafa]' : 'bg-zinc-950'}`}>
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
      <div className="flex h-full flex-col bg-zinc-950">
        <Toolbar viewMode="preview" setViewMode={() => {}} projectName={null} previewUrl=""
          devPort={null} breakpoint={breakpoint} setBreakpoint={setBreakpoint}
          onRefresh={() => {}} onOpenExternal={() => {}} onCopyUrl={() => {}}
          onScreenshot={() => {}} onDestroy={() => {}} showActions={false}
          hasFiles={false} hasActiveSandbox={false}
          demoRunning={demoRunning} onToggleDemo={toggleDemo} />
        <div className="flex-1 min-h-0">
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
    <div className={`flex h-full flex-col ${studioChrome ? 'bg-[#fafafa]' : 'bg-zinc-950'}`}>
      {/* ── Toolbar ── */}
      <Toolbar
        viewMode={viewMode} setViewMode={setViewMode}
        projectName={projectName} previewUrl={previewUrl} devPort={devPort}
        breakpoint={breakpoint} setBreakpoint={setBreakpoint}
        onRefresh={refresh} onOpenExternal={openExternal} onCopyUrl={handleCopyUrl}
        onScreenshot={handleScreenshot} onDestroy={destroyProject}
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
              className={`flex h-full items-stretch justify-stretch ${
                studioChrome
                  ? 'bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,200,170,0.35),rgba(250,250,250,0)_50%),linear-gradient(180deg,#fafafa,#f4f4f5)]'
                  : 'bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),rgba(9,11,20,0)_44%),linear-gradient(180deg,rgba(15,18,29,0.98),rgba(6,8,15,0.98))]'
              }`}
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
                  className={`relative h-full w-full overflow-hidden ${
                    studioChrome
                      ? 'bg-white'
                      : 'bg-zinc-950'
                  }`}
                  style={{ width: breakpoint === 'desktop' ? '100%' : BREAKPOINTS[breakpoint].width, maxWidth: '100%' }}
                >
                  <iframe ref={iframeRef} src={previewUrl} className="h-full w-full"
                    onLoad={() => setTimeout(() => {
                      if (previewCacheKey) {
                        seenPreviewKeysRef.current.add(previewCacheKey);
                      }
                      setIframeReady(true);
                      markPreviewReady(devPort);
                    }, 180)}
                    title="App Preview" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups" />
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
                          eyebrow="Preview warming"
                          title="Connecting the live app"
                          body="The sandbox is already running. Holding the handoff shell until the first real paint lands keeps this from feeling like a blank iframe race."
                          previewUrl={previewUrl}
                          activeStep={activeStepLabel}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <PreviewHandoffShell
                  studio={studioChrome}
                  eyebrow="Preview handoff"
                  title="Starting preview"
                  body={buildStatus.message || 'Creating the sandbox, wiring dependencies, and reconnecting the live app for this conversation.'}
                  previewUrl={devPort ? `http://localhost:${devPort}` : undefined}
                  activeStep={activeStepLabel}
                />
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
