import { useMemo } from 'react';
import { Users, Scale, BookOpen, Zap, Eye, RefreshCw, Sparkles, Brain } from 'lucide-react';
import type { CouncilThinkingUI } from '../../stores/chatStore.js';
import { motion } from 'framer-motion';

/**
 * CouncilProgressPanel — Codex-inspired right contextual panel for the SCIS Consensus Council.
 *
 * Shows live or recent council decision in a scannable "Progress" style:
 * - Outcome header (ship/act/escalate) with agreement
 * - Real intent read
 * - Member cards (verdict, confidence, action, note) — the "changes" / who weighed in
 * - Method lessons as actionable items (save as skill, apply to prompt, visual tweak)
 * - Missing capabilities
 * - Quick actions: re-convene, Design Mode annotate, export visual plan
 *
 * Ties directly to the wired core consensus (TurnThinking.council) and the
 * meaningful-council-sidebar Grok skill for TUI parity.
 *
 * Design goals from research (Cursor Design Mode, agent progress panels, visual plans):
 * - Contextual: only rich when council data present.
 * - Actionable: lessons are first-class, not just display.
 * - Visual-friendly: hints for point/draw/voice annotation.
 * - Clean, flat cards like the existing ThinkingPanel CouncilSection.
 */

interface Props {
  council?: CouncilThinkingUI | null;
  onApplyLesson?: (lesson: string) => void;
  onReconvene?: () => void;
  onDesignMode?: () => void;  // e.g. trigger visual annotation for this panel/routing
  onExportVisualPlan?: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export function CouncilProgressPanel({
  council,
  onApplyLesson,
  onReconvene,
  onDesignMode,
  onExportVisualPlan,
  isOpen = true,
  onClose,
}: Props) {
  const hasData = !!council;

  const outcomeMeta = useMemo(() => {
    if (!council) return null;
    if (council.outcome === 'ship') {
      return { label: 'Cleared for release', tone: 'emerald', icon: Zap };
    }
    if (council.outcome === 'act') {
      return { label: 'Act first (refine or search)', tone: 'amber', icon: RefreshCw };
    }
    return { label: 'Escalated for stronger help', tone: 'sky', icon: Scale };
  }, [council]);

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 flex-col border-l border-zinc-800 bg-zinc-950 text-xs">
      {/* Header — Codex progress style, sticky for better scrolling UX during live tests */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 py-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-violet-400" />
          <div>
            <div className="font-medium text-zinc-200">Council Progress</div>
            <div className="text-[10px] text-zinc-500">SCIS Consensus • {council?.topic || 'standby'}</div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            ×
          </button>
        )}
      </div>

      {!hasData ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-zinc-500">
          <div>
            <Brain className="mx-auto mb-2 h-6 w-6 opacity-40" />
            <p>No active council review.</p>
            <p className="mt-1 text-[10px]">Substantive turns with the gate will populate this panel with member verdicts, real intent, and method lessons.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto p-3">
          {/* Outcome header */}
          <div className="rounded-xl bg-white/[0.02] p-3">
            <div className="flex items-center gap-2">
              {outcomeMeta && <outcomeMeta.icon className={`h-4 w-4 text-${outcomeMeta.tone}-400`} />}
              <span className={`font-medium text-${outcomeMeta?.tone || 'zinc'}-300`}>
                {outcomeMeta?.label}
              </span>
              <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500">
                <Scale className="h-3 w-3" />
                {Math.round(council.agreement * 100)}% agree
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-zinc-400">{council.summary}</p>
            {council.realIntent && (
              <p className="mt-1.5 text-[10px] text-zinc-500">
                <span className="text-zinc-400">Read as:</span> {council.realIntent}
              </p>
            )}
            {council.recommendedAction && council.outcome !== 'ship' && (
              <p className="mt-1 text-[10px] text-amber-300/80">Advised: {council.recommendedAction}</p>
            )}
          </div>

          {/* Members — "who weighed in" like review cards */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-zinc-400">
              <Users className="h-3 w-3" /> Council members
            </div>
            <div className="space-y-1.5">
              {council.members.map((m, idx) => (
                <div key={idx} className="rounded-lg border border-white/[0.04] bg-white/[0.015] p-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-zinc-200">{m.name}</span>
                    <span className="text-[9px] text-zinc-500">[{m.topic}]</span>
                    {!m.failed && (
                      <span className={`ml-auto text-[9px] ${m.verdict === 'good' ? 'text-emerald-400' : m.verdict === 'bad' ? 'text-rose-400' : 'text-amber-400'}`}>
                        {m.verdict} @ {Math.round(m.confidence * 100)}%
                      </span>
                    )}
                  </div>
                  {m.failed ? (
                    <div className="mt-0.5 text-[10px] text-zinc-500">did not respond</div>
                  ) : (
                    <>
                      <div className="mt-0.5 text-[10px] text-zinc-400">→ {m.action}</div>
                      {m.note && <div className="mt-1 text-[10px] leading-tight text-zinc-500">{m.note}</div>}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Method lessons + missing — actionable "progress" items */}
          {(council.methodLessons.length > 0 || council.missingCapabilities.length > 0) && (
            <div className="space-y-2 rounded-xl bg-white/[0.015] p-3">
              {council.missingCapabilities.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium text-amber-300/80">Missing capabilities</div>
                  <div className="mt-0.5 text-[10px] text-zinc-400">{council.missingCapabilities.join(' • ')}</div>
                </div>
              )}
              {council.methodLessons.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 text-[10px] font-medium text-zinc-400">
                    <BookOpen className="h-3 w-3" /> Method lessons (teach-to-fish)
                  </div>
                  <ul className="mt-1 space-y-1">
                    {council.methodLessons.map((lesson, i) => (
                      <li key={i} className="flex items-start gap-2 text-[10px]">
                        <span className="mt-0.5 block h-1 w-1 shrink-0 rounded-full bg-violet-400/60" />
                        <span className="flex-1 text-zinc-400">{lesson}</span>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => onApplyLesson?.(lesson)}
                            className="rounded bg-white/[0.04] px-1.5 py-px text-[9px] text-zinc-400 hover:bg-violet-500/20 hover:text-violet-300"
                            title="Apply this lesson to the next turn or save as reusable skill"
                          >
                            apply
                          </button>
                          <button
                            onClick={() => onDesignMode?.()}
                            className="rounded bg-white/[0.04] px-1.5 py-px text-[9px] text-zinc-400 hover:bg-white/[0.08]"
                            title="Open Design Mode to visually refine how lessons surface"
                          >
                            <Sparkles className="h-3 w-3" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Actions footer — Codex progress actions style */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              onClick={onReconvene}
              className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] py-1 text-[10px] text-zinc-300 hover:bg-white/[0.05]"
            >
              <RefreshCw className="mr-1 inline h-3 w-3" /> Re-convene council
            </button>
            <button
              onClick={onDesignMode}
              className="flex-1 rounded-lg border border-violet-500/30 bg-violet-500/10 py-1 text-[10px] text-violet-300 hover:bg-violet-500/20"
            >
              <Eye className="mr-1 inline h-3 w-3" /> Design Mode annotate
            </button>
            <button
              onClick={onExportVisualPlan}
              className="flex-1 rounded-lg border border-white/[0.06] py-1 text-[10px] text-zinc-400 hover:bg-white/[0.05]"
            >
              Export visual plan
            </button>
          </div>

          <div className="pt-2 text-[9px] text-zinc-500/70">
            Facts quarantined. Members point only; Vai tools fetch. Powered by SCIS council (core) + meaningful-council-sidebar skill.
          </div>
        </div>
      )}
    </div>
  );
}

export default CouncilProgressPanel;