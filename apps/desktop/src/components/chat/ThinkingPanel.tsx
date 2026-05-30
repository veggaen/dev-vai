import { useState } from 'react';
import { Brain, ChevronRight, AlertTriangle } from 'lucide-react';
import type { TurnThinkingUI } from '../../stores/chatStore.js';
import { buildThinkingPanelModel } from './ThinkingPanel.logic.js';

interface ThinkingPanelProps {
  readonly thinking: TurnThinkingUI;
}

/**
 * Collapsible "Thinking" panel — surfaces Vai's deterministic decision trace
 * (intent + strategy chain + trust + confidence). Collapsed by default; a
 * suspected misroute auto-expands and is flagged, turning the panel into a
 * live diagnostic lens for routing bugs.
 */
export function ThinkingPanel({ thinking }: ThinkingPanelProps) {
  const model = buildThinkingPanelModel(thinking);
  const [expanded, setExpanded] = useState(model.defaultExpanded);
  const flagged = model.misrouteSuspected;

  return (
    <div
      className={`mb-2 rounded-lg border text-xs ${
        flagged ? 'border-amber-500/40 bg-amber-500/5' : 'border-white/10 bg-white/[0.03]'
      }`}
      data-testid="thinking-panel"
      data-misroute={flagged ? '1' : '0'}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-zinc-400 hover:text-zinc-200"
        aria-expanded={expanded}
      >
        {flagged
          ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          : <Brain className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
        <span className="font-medium">Thinking</span>
        <span className="text-zinc-500">·</span>
        <span className="truncate">{model.headerLabel}</span>
        {flagged && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">possible misroute</span>}
        <ChevronRight className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="space-y-2 px-3 pb-2.5 pt-0.5">
          {model.misrouteHint && (
            <p className="text-amber-300/90">{model.misrouteHint}</p>
          )}

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Strategy chain</div>
            <ol className="space-y-1">
              {model.steps.map((step, i) => (
                <li key={`${step.raw}-${i}`} className="flex items-center gap-2 text-zinc-300">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[9px] text-zinc-400">{i + 1}</span>
                  <span>{step.label}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <Badge label="intent" value={model.intentLabel} />
            {model.trustLabel && <Badge label="trust" value={model.trustLabel} />}
            {model.confidencePct !== undefined && <Badge label="confidence" value={`${model.confidencePct}%`} />}
            {model.topic && <Badge label="topic" value={model.topic} />}
            {model.knowledgeDepth && <Badge label="depth" value={model.knowledgeDepth} />}
            {model.durationMs !== undefined && <Badge label="took" value={`${model.durationMs}ms`} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-zinc-400">
      <span className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</span>
      <span className="text-zinc-300">{value}</span>
    </span>
  );
}
