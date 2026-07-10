import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileText,
  MonitorPlay,
} from 'lucide-react';
import { useLayoutStore } from '../stores/layoutStore.js';
import type { ProjectUpdateArtifact } from '../lib/project-artifact.js';

interface Props {
  artifact: ProjectUpdateArtifact;
  summary: string;
  details: string[];
  onPrompt?: (prompt: string) => void;
}

const STATUS_COPY: Record<ProjectUpdateArtifact['status'], string> = {
  live: 'App refreshed',
  updated: 'Files updated',
  failed: 'Needs attention',
};

/**
 * A compact IDE receipt for completed work. This intentionally avoids a
 * dashboard-style card: the chat response is the primary content, while proof,
 * files, and App/Code actions remain one scan away.
 */
export function ProjectArtifactCard({ artifact, summary, details }: Props) {
  const expandBuilder = useLayoutStore((state) => state.expandBuilder);
  const isLight = useLayoutStore((state) => state.themePreference) === 'light';
  const liveUrl = artifact.liveUrl ?? (artifact.port ? `http://localhost:${artifact.port}` : null);
  const verification = (artifact.verificationItems ?? []).slice(0, 2);
  const changedFiles = artifact.changedFiles ?? [];
  const successful = artifact.status !== 'failed';

  const shell = isLight
    ? 'border-zinc-200 bg-zinc-50/70 text-zinc-900'
    : 'border-zinc-800/70 bg-zinc-950/38 text-zinc-100';
  const secondary = isLight ? 'text-zinc-600' : 'text-zinc-400';
  const quietButton = isLight
    ? 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
    : 'border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/80 hover:text-white';

  const openSurface = (surface: 'preview' | 'code') => {
    expandBuilder();
    window.dispatchEvent(new Event(surface === 'preview' ? 'vai-open-preview' : 'vai-open-code'));
  };

  return (
    <section
      data-testid="project-update-receipt"
      className={`border-l-2 px-4 py-3.5 ${shell} ${successful ? 'border-l-emerald-400' : 'border-l-amber-400'}`}
    >
      <header className="flex min-w-0 items-center gap-2.5">
        {successful ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        )}
        <h3 className="truncate text-[13px] font-semibold">
          {artifact.status === 'failed' ? artifact.title : `Updated ${artifact.title}`}
        </h3>
        <span className={`ml-auto shrink-0 text-[11px] ${secondary}`}>{STATUS_COPY[artifact.status]}</span>
      </header>

      <p className={`mt-2 text-[13px] leading-5 ${isLight ? 'text-zinc-700' : 'text-zinc-200'}`}>
        {summary}
      </p>

      {(details.length > 0 || verification.length > 0) && (
        <div className={`mt-2.5 space-y-1 text-[12px] leading-5 ${secondary}`}>
          {[...details.slice(0, 1), ...verification]
            .filter((item, index, all) => all.indexOf(item) === index)
            .slice(0, 2)
            .map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className={`mt-[0.48rem] h-1 w-1 shrink-0 rounded-full ${successful ? 'bg-emerald-400/80' : 'bg-amber-400/80'}`} />
                <span>{item}</span>
              </div>
            ))}
        </div>
      )}

      {changedFiles.length > 0 && (
        <details className="group mt-2.5">
          <summary className={`flex cursor-pointer list-none items-center gap-2 text-[11px] ${secondary}`}>
            <FileText className="h-3.5 w-3.5" />
            {changedFiles.length} file{changedFiles.length === 1 ? '' : 's'} changed
            <span className="transition-transform group-open:rotate-90">›</span>
          </summary>
          <div className={`mt-2 space-y-1 border-l pl-3 font-mono text-[11px] ${isLight ? 'border-zinc-200 text-zinc-700' : 'border-zinc-800 text-zinc-300'}`}>
            {changedFiles.slice(0, 6).map((file) => <div key={file} className="truncate">{file}</div>)}
            {changedFiles.length > 6 && <div className={secondary}>+{changedFiles.length - 6} more</div>}
          </div>
        </details>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => openSurface('preview')}
          className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${quietButton}`}
        >
          <MonitorPlay className="h-3.5 w-3.5" />
          App
        </button>
        <button
          type="button"
          onClick={() => openSurface('code')}
          className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${quietButton}`}
        >
          <Code2 className="h-3.5 w-3.5" />
          Code
        </button>
        {liveUrl && (
          <button
            type="button"
            onClick={() => window.open(liveUrl, '_blank', 'noopener,noreferrer')}
            className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${quietButton}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Pop app
          </button>
        )}
        {artifact.port && <span className={`ml-auto font-mono text-[10px] ${secondary}`}>:{artifact.port}</span>}
      </footer>
    </section>
  );
}
