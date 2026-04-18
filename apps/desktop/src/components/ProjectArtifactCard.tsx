import { AlertTriangle, CheckCircle2, ExternalLink, FolderOpenDot, Rocket, Sparkles, Wrench } from 'lucide-react';
import { useLayoutStore } from '../stores/layoutStore.js';
import type { ProjectUpdateArtifact } from '../lib/project-artifact.js';

const TONE_CLASSES: Record<NonNullable<ProjectUpdateArtifact['tone']>, { frame: string; badge: string; icon: string; action: string; chip: string }> = {
  violet: {
    frame: 'border-violet-500/18 bg-[linear-gradient(180deg,rgba(76,29,149,0.2),rgba(17,17,22,0.96))] shadow-[0_24px_64px_rgba(76,29,149,0.16)]',
    badge: 'border-violet-400/20 bg-violet-500/12 text-violet-200',
    icon: 'border-violet-400/20 bg-violet-500/12 text-violet-200',
    action: 'bg-violet-500 text-white hover:bg-violet-400',
    chip: 'border-violet-500/18 bg-violet-500/10 text-violet-100 hover:border-violet-400/30 hover:bg-violet-500/14',
  },
  blue: {
    frame: 'border-blue-500/18 bg-[linear-gradient(180deg,rgba(30,64,175,0.18),rgba(17,17,22,0.96))] shadow-[0_24px_64px_rgba(30,64,175,0.14)]',
    badge: 'border-blue-400/20 bg-blue-500/12 text-blue-200',
    icon: 'border-blue-400/20 bg-blue-500/12 text-blue-200',
    action: 'bg-blue-500 text-white hover:bg-blue-400',
    chip: 'border-blue-500/18 bg-blue-500/10 text-blue-100 hover:border-blue-400/30 hover:bg-blue-500/14',
  },
  emerald: {
    frame: 'border-emerald-500/18 bg-[linear-gradient(180deg,rgba(6,78,59,0.22),rgba(15,23,42,0.96))] shadow-[0_24px_64px_rgba(6,78,59,0.14)]',
    badge: 'border-emerald-400/20 bg-emerald-500/12 text-emerald-200',
    icon: 'border-emerald-400/20 bg-emerald-500/12 text-emerald-200',
    action: 'bg-emerald-500 text-white hover:bg-emerald-400',
    chip: 'border-emerald-500/18 bg-emerald-500/10 text-emerald-100 hover:border-emerald-400/30 hover:bg-emerald-500/14',
  },
  amber: {
    frame: 'border-amber-500/18 bg-[linear-gradient(180deg,rgba(120,53,15,0.22),rgba(24,24,27,0.96))] shadow-[0_24px_64px_rgba(120,53,15,0.16)]',
    badge: 'border-amber-400/20 bg-amber-500/12 text-amber-200',
    icon: 'border-amber-400/20 bg-amber-500/12 text-amber-200',
    action: 'bg-amber-500 text-white hover:bg-amber-400',
    chip: 'border-amber-500/18 bg-amber-500/10 text-amber-100 hover:border-amber-400/30 hover:bg-amber-500/14',
  },
};

interface Props {
  artifact: ProjectUpdateArtifact;
  summary: string;
  details: string[];
  onPrompt?: (prompt: string) => void;
}

export function ProjectArtifactCard({ artifact, summary, details, onPrompt }: Props) {
  const expandBuilder = useLayoutStore((state) => state.expandBuilder);
  const themePreference = useLayoutStore((state) => state.themePreference);
  const isLight = themePreference === 'light';
  const tone = TONE_CLASSES[artifact.tone ?? 'violet'];
  const liveUrl = artifact.liveUrl ?? (artifact.port ? `http://localhost:${artifact.port}` : null);
  const statusLabel = artifact.status === 'live'
    ? 'Live preview'
    : artifact.status === 'failed'
      ? 'Preview failed'
      : 'Updated';
  const primaryBadge = artifact.badge ?? (artifact.kind === 'starter' ? 'Starter baseline' : 'Preview artifact');
  const evidenceLabel = artifact.evidenceTier
    ? artifact.evidenceTier === 'high'
      ? 'Proof: verified'
      : artifact.evidenceTier === 'medium'
        ? 'Proof: partial'
        : artifact.evidenceTier === 'low'
          ? 'Proof: light'
          : 'Proof: unverified'
    : null;
  const visibleVerificationItems = (artifact.verificationItems ?? []).slice(0, 3);
  const visibleChangedFiles = (artifact.changedFiles ?? []).slice(0, 5);
  const remainingChangedFiles = Math.max(0, (artifact.changedFiles?.length ?? 0) - visibleChangedFiles.length);
  const frameClass = isLight
    ? 'border-zinc-200 bg-zinc-50/90 text-zinc-900'
    : 'border-zinc-800/60 bg-zinc-950/58 text-zinc-100';
  const mutedChip = isLight
    ? 'border-zinc-200 bg-zinc-50 text-zinc-600'
    : 'border-zinc-800/70 bg-zinc-950/70 text-zinc-300';
  const dividerClass = isLight ? 'border-zinc-200' : 'border-zinc-800/60';
  const metaItems = [
    primaryBadge,
    statusLabel,
    evidenceLabel,
    artifact.fileCount ? `${artifact.fileCount} file${artifact.fileCount === 1 ? '' : 's'}` : null,
    artifact.packageChanged ? 'deps touched' : null,
    artifact.port ? `localhost:${artifact.port}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className={`overflow-hidden rounded-[0.9rem] border px-4 py-4 ${frameClass}`}>
      <div className="flex flex-wrap gap-2">
        {metaItems.map((item, index) => (
          <span
            key={item}
            className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
              index === 0 ? mutedChip : (isLight ? 'border-zinc-200 bg-white text-zinc-500' : 'border-zinc-800/70 bg-zinc-950/60 text-zinc-400')
            }`}
          >
            {item}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className={`text-[15px] font-semibold ${isLight ? 'text-zinc-900' : 'text-white'}`}>{artifact.title}</h3>
          <p className={`mt-1.5 max-w-2xl text-sm leading-6 ${isLight ? 'text-zinc-600' : 'text-zinc-200'}`}>{summary}</p>
          {artifact.recoveryLabel ? (
            <div className={`mt-2 inline-flex items-center gap-2 text-[11px] ${isLight ? 'text-zinc-500' : 'text-zinc-400'}`}>
              <Wrench className={`h-3.5 w-3.5 ${isLight ? 'text-zinc-500' : 'text-zinc-200'}`} />
              {artifact.recoveryLabel}
            </div>
          ) : null}
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${tone.icon}`}>
          {artifact.status === 'failed'
            ? <AlertTriangle className="h-5 w-5" />
            : artifact.kind === 'starter'
            ? <Sparkles className="h-5 w-5" />
            : artifact.kind === 'update'
              ? <CheckCircle2 className="h-5 w-5" />
              : <Rocket className="h-5 w-5" />}
        </div>
      </div>

      {details.length > 0 && (
        <div className="mt-4 grid gap-1.5">
          {details.slice(0, 2).map((detail) => (
            <div key={detail} className={`flex items-start gap-2 text-sm ${isLight ? 'text-zinc-700' : 'text-zinc-200'}`}>
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
              <span className="leading-6">{detail}</span>
            </div>
          ))}
        </div>
      )}

      {(visibleVerificationItems.length > 0 || visibleChangedFiles.length > 0 || artifact.failureClass) && (
        <div className={`mt-5 grid gap-4 border-t pt-4 ${dividerClass}`}>
          {visibleVerificationItems.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Verification</div>
              <div className="space-y-2">
                {visibleVerificationItems.map((item) => (
                  <div key={item} className={`flex items-start gap-2 text-[13px] ${isLight ? 'text-zinc-700' : 'text-zinc-200'}`}>
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                    <span className="leading-5">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(visibleChangedFiles.length > 0 || artifact.failureClass) && (
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Touched Surface</div>
              <div className={`space-y-1.5 text-[12px] ${isLight ? 'text-zinc-600' : 'text-zinc-300'}`}>
                {visibleChangedFiles.map((file) => (
                  <div key={file} className={`truncate font-mono ${isLight ? 'text-zinc-800' : 'text-zinc-200'}`}>
                    {file}
                  </div>
                ))}
                {remainingChangedFiles > 0 && (
                  <div className="text-zinc-500">+{remainingChangedFiles} more</div>
                )}
                {artifact.failureClass ? (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-amber-200">
                    <AlertTriangle className="h-3 w-3" />
                    last failure: {artifact.failureClass.replace(/_/g, ' ')}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            expandBuilder();
            window.dispatchEvent(new Event('vai-open-preview'));
          }}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors ${tone.action}`}
        >
          <FolderOpenDot className="h-4 w-4" />
          Open preview
        </button>
        {liveUrl ? (
          <button
            type="button"
            onClick={() => window.open(liveUrl, '_blank', 'noopener,noreferrer')}
            className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors ${
              isLight
                ? 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                : 'border-zinc-800/70 bg-zinc-950/70 text-zinc-100 hover:bg-zinc-900'
            }`}
          >
            <ExternalLink className="h-4 w-4" />
            Open in browser
          </button>
        ) : null}
      </div>

      {liveUrl ? (
        <div className={`mt-4 flex items-center gap-2 border-t pt-3 text-xs ${dividerClass}`}>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Live URL</span>
          <span className={`min-w-0 truncate font-mono ${isLight ? 'text-zinc-800' : 'text-zinc-100'}`}>{liveUrl}</span>
        </div>
      ) : null}
    </div>
  );
}