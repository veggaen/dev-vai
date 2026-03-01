import { useSandboxStore, type SandboxTemplateInfo } from '../stores/sandboxStore.js';
import { Globe, RefreshCw, Smartphone, Tablet, Monitor, Package, Layers } from 'lucide-react';
import { useState, useCallback, useRef, useEffect } from 'react';

type BreakpointKey = 'mobile' | 'tablet' | 'desktop';

const BREAKPOINTS: Record<BreakpointKey, { width: number; icon: typeof Smartphone; label: string }> = {
  mobile:  { width: 375,  icon: Smartphone, label: 'Mobile' },
  tablet:  { width: 768,  icon: Tablet,     label: 'Tablet' },
  desktop: { width: 1280, icon: Monitor,    label: 'Desktop' },
};

const STEP_ORDER = ['creating', 'writing', 'installing', 'building', 'running'] as const;

const CATEGORY_COLORS: Record<string, string> = {
  frontend: 'text-blue-400 bg-blue-500/10',
  backend: 'text-emerald-400 bg-emerald-500/10',
  fullstack: 'text-purple-400 bg-purple-500/10',
};

/**
 * Template picker shown when no sandbox project is active.
 */
function TemplatePicker() {
  const { templates, fetchTemplates, scaffoldFromTemplate, status } = useSandboxStore();

  useEffect(() => {
    if (templates.length === 0) fetchTemplates();
  }, [templates.length, fetchTemplates]);

  const isWorking = status !== 'idle' && status !== 'failed';

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <Layers className="mb-3 h-10 w-10 text-zinc-700" />
      <h3 className="mb-1 text-sm font-medium text-zinc-300">Start a Sandbox</h3>
      <p className="mb-5 text-xs text-zinc-600">Pick a framework to scaffold a new project</p>

      {templates.length === 0 ? (
        <p className="text-xs text-zinc-600">Loading templates...</p>
      ) : (
        <div className="grid w-full max-w-md grid-cols-2 gap-2">
          {templates.map((t: SandboxTemplateInfo) => (
            <button
              key={t.id}
              onClick={() => scaffoldFromTemplate(t.id)}
              disabled={isWorking}
              className="group rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/50 disabled:opacity-40"
            >
              <div className="flex items-center gap-2">
                <Package className="h-3.5 w-3.5 text-zinc-500 group-hover:text-zinc-300" />
                <span className="text-xs font-medium text-zinc-300">{t.name}</span>
              </div>
              <p className="mt-1 text-[10px] leading-tight text-zinc-600">{t.description}</p>
              <span className={`mt-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-medium ${CATEGORY_COLORS[t.category] ?? 'text-zinc-500 bg-zinc-800'}`}>
                {t.category}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Preview panel — shows iframe of running sandbox app + build stepper.
 * When no project is active, shows template picker.
 */
export function PreviewPanel() {
  const { status, devPort, projectName, projectId } = useSandboxStore();
  const [breakpoint, setBreakpoint] = useState<BreakpointKey>('desktop');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const previewUrl = devPort ? `http://localhost:${devPort}` : 'about:blank';
  const currentIdx = STEP_ORDER.indexOf(status as typeof STEP_ORDER[number]);

  const refresh = useCallback(() => {
    if (iframeRef.current) {
      const url = new URL(iframeRef.current.src);
      url.searchParams.set('_t', String(Date.now()));
      iframeRef.current.src = url.toString();
    }
  }, []);

  // No active project — show template picker
  if (!projectId && status === 'idle') {
    return (
      <div className="flex h-full flex-col bg-zinc-950">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
          <Globe className="h-3.5 w-3.5 text-zinc-500" />
          <span className="flex-1 text-xs text-zinc-500">No active project</span>
        </div>
        <div className="flex-1">
          <TemplatePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <Globe className="h-3.5 w-3.5 text-zinc-500" />
        <div className="flex-1 flex items-center gap-1.5 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
          {projectName && (
            <span className="text-zinc-600">{projectName} —</span>
          )}
          <span className="truncate text-zinc-400">{previewUrl}</span>
        </div>
        <button
          onClick={refresh}
          disabled={!devPort}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
          title="Refresh preview"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>

        {/* Responsive breakpoints */}
        <div className="flex gap-0.5 border-l border-zinc-800 pl-2">
          {(Object.entries(BREAKPOINTS) as [BreakpointKey, typeof BREAKPOINTS[BreakpointKey]][]).map(
            ([key, { icon: Icon, label }]) => (
              <button
                key={key}
                onClick={() => setBreakpoint(key)}
                className={`rounded p-1 ${
                  breakpoint === key
                    ? 'bg-zinc-800 text-blue-400'
                    : 'text-zinc-600 hover:text-zinc-400'
                }`}
                title={label}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ),
          )}
        </div>
      </div>

      {/* Build stepper */}
      {status !== 'idle' && (
        <div className="flex items-center gap-1 border-b border-zinc-800 px-3 py-1">
          {STEP_ORDER.map((step, i) => (
            <div key={step} className="flex items-center gap-1">
              <div
                className={`h-1.5 w-6 rounded-full transition-colors ${
                  i < currentIdx ? 'bg-emerald-500' :
                  i === currentIdx ? (status === 'failed' ? 'bg-red-500' : 'bg-blue-500 animate-pulse') :
                  'bg-zinc-800'
                }`}
              />
              {i < STEP_ORDER.length - 1 && (
                <div className={`h-px w-2 ${i < currentIdx ? 'bg-emerald-500/50' : 'bg-zinc-800'}`} />
              )}
            </div>
          ))}
          <span className={`ml-2 text-[10px] capitalize ${
            status === 'failed' ? 'text-red-400' :
            status === 'running' ? 'text-emerald-400' :
            'text-zinc-500'
          }`}>
            {status}
          </span>
        </div>
      )}

      {/* Iframe preview area */}
      <div className="flex flex-1 items-center justify-center bg-zinc-900/50 p-4">
        {status === 'failed' ? (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <Monitor className="h-6 w-6 text-red-400" />
            </div>
            <p className="text-sm text-red-400">Build failed</p>
            <p className="mt-1 text-xs text-zinc-600">Check the console for errors</p>
          </div>
        ) : status === 'running' && devPort ? (
          <div
            className="h-full overflow-hidden rounded border border-zinc-800 bg-white"
            style={{
              width: breakpoint === 'desktop' ? '100%' : BREAKPOINTS[breakpoint].width,
              maxWidth: '100%',
            }}
          >
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="h-full w-full"
              title="App Preview"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          </div>
        ) : (
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
            <p className="text-xs text-zinc-500 capitalize">{status}...</p>
          </div>
        )}
      </div>
    </div>
  );
}
