import { useLayoutStore } from '../stores/layoutStore.js';
import { Globe, RefreshCw, Smartphone, Tablet, Monitor } from 'lucide-react';
import { useState } from 'react';

type BreakpointKey = 'mobile' | 'tablet' | 'desktop';

const BREAKPOINTS: Record<BreakpointKey, { width: number; icon: typeof Smartphone; label: string }> = {
  mobile:  { width: 375,  icon: Smartphone, label: 'Mobile' },
  tablet:  { width: 768,  icon: Tablet,     label: 'Tablet' },
  desktop: { width: 1280, icon: Monitor,    label: 'Desktop' },
};

/**
 * Preview panel — shows iframe of running app + build stepper.
 * Phase 1 = placeholder UI. Docker/sandbox routes come in Phase 3.
 */
export function PreviewPanel() {
  const { buildStatus } = useLayoutStore();
  const [breakpoint, setBreakpoint] = useState<BreakpointKey>('desktop');
  const [url, setUrl] = useState('about:blank');

  const STEPS = ['generating', 'writing', 'installing', 'building', 'testing'] as const;
  const currentIdx = STEPS.indexOf(buildStatus.step as typeof STEPS[number]);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <Globe className="h-3.5 w-3.5 text-zinc-500" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Preview URL"
        />
        <button
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
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
      {buildStatus.step !== 'idle' && (
        <div className="flex items-center gap-1 border-b border-zinc-800 px-3 py-1">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-1">
              <div
                className={`h-1.5 w-6 rounded-full transition-colors ${
                  i < currentIdx ? 'bg-emerald-500' :
                  i === currentIdx ? 'bg-blue-500 animate-pulse' :
                  'bg-zinc-800'
                }`}
              />
              {i < STEPS.length - 1 && (
                <div className={`h-px w-2 ${i < currentIdx ? 'bg-emerald-500/50' : 'bg-zinc-800'}`} />
              )}
            </div>
          ))}
          <span className="ml-2 text-[10px] text-zinc-500 capitalize">{buildStatus.step}</span>
        </div>
      )}

      {/* Iframe preview area */}
      <div className="flex flex-1 items-center justify-center bg-zinc-900/50 p-4">
        {buildStatus.step === 'idle' ? (
          <div className="text-center">
            <Monitor className="mx-auto mb-3 h-12 w-12 text-zinc-800" />
            <p className="text-sm text-zinc-600">Preview will appear here</p>
            <p className="mt-1 text-xs text-zinc-700">
              Switch to <span className="text-blue-400">Builder</span> mode and describe what to build
            </p>
          </div>
        ) : (
          <div
            className="h-full overflow-hidden rounded border border-zinc-800 bg-white"
            style={{
              width: breakpoint === 'desktop' ? '100%' : BREAKPOINTS[breakpoint].width,
              maxWidth: '100%',
            }}
          >
            <iframe
              src={url}
              className="h-full w-full"
              title="App Preview"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        )}
      </div>
    </div>
  );
}
