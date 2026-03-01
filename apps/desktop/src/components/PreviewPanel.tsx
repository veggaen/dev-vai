import { useSandboxStore } from '../stores/sandboxStore.js';
import { Globe, RefreshCw, Smartphone, Tablet, Monitor } from 'lucide-react';
import { useState, useCallback, useRef } from 'react';
import { TemplateGallery } from './TemplateGallery.js';
import { DeployProgress } from './DeployProgress.js';

type BreakpointKey = 'mobile' | 'tablet' | 'desktop';

const BREAKPOINTS: Record<BreakpointKey, { width: number; icon: typeof Smartphone; label: string }> = {
  mobile:  { width: 375,  icon: Smartphone, label: 'Mobile' },
  tablet:  { width: 768,  icon: Tablet,     label: 'Tablet' },
  desktop: { width: 1280, icon: Monitor,    label: 'Desktop' },
};

const STEP_ORDER = ['creating', 'writing', 'installing', 'building', 'running'] as const;

/**
 * Preview panel — shows iframe of running sandbox app + build stepper.
 * When no project is active, shows TemplateGallery for stack deployment.
 * During deploy, shows DeployProgress with live step tracking.
 */
export function PreviewPanel() {
  const {
    status, devPort, projectName, projectId,
    deployPhase, deploySteps, deployStartTime, deployStackName, deployTierName,
    deployStack,
  } = useSandboxStore();
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

  // No active project — show template gallery or deploy progress
  if (!projectId && status === 'idle' && deployPhase === 'idle') {
    return (
      <div className="flex h-full flex-col bg-zinc-950">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
          <Globe className="h-3.5 w-3.5 text-zinc-500" />
          <span className="flex-1 text-xs text-zinc-500">Deploy a stack</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <TemplateGallery
            onDeploy={(stackId, tier) => deployStack(stackId, tier)}
            isDeploying={false}
          />
        </div>
      </div>
    );
  }

  // Deploy in progress or failed — show step-by-step progress
  if (deployPhase === 'deploying' || deployPhase === 'failed') {
    return (
      <div className="flex h-full flex-col bg-zinc-950">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
          <Globe className="h-3.5 w-3.5 text-zinc-500" />
          <span className="flex-1 text-xs text-zinc-400">Deploying...</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <DeployProgress
            steps={deploySteps}
            stackName={deployStackName}
            tierName={deployTierName}
            startTime={deployStartTime}
          />
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
