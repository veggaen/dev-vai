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
      // Static, full class strings — Tailwind can only see classes that appear
      // verbatim in source, so `text-${tone}-400` would silently render nothing.
      return { label: 'Cleared for release', icon: Zap, iconClass: 'text-emerald-400', textClass: 'text-emerald-300' };
    }
    if (council.outcome === 'act') {
      return { label: 'Act first (refine or search)', icon: RefreshCw, iconClass: 'text-amber-400', textClass: 'text-amber-300' };
    }
    return { label: 'Escalated for stronger help', icon: Scale, iconClass: 'text-sky-400', textClass: 'text-sky-300' };
  }, [council]);

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 flex-col border-l border-[color:var(--border)] bg-[color:var(--sidebar-surface)] text-xs text-[color:var(--fg)]">
      {/* Header — Codex progress style, sticky for better scrolling UX during live tests */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--sidebar-surface)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[color:var(--accent-text)]" />
          <div>
            <div className="font-medium opacity-90">Council Progress</div>
            <div className="text-[10px] opacity-50">SCIS Consensus • {council?.topic || 'standby'}</div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="opacity-60 transition-opacity hover:opacity-100" aria-label="Close council panel">
            ×
          </button>
        )}
      </div>

      {!hasData ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center opacity-50">
          <div>
            <Brain className="mx-auto mb-2 h-6 w-6 opacity-40" />
            <p>No active council review.</p>
            <p className="mt-1 text-[10px]">Substantive turns with the gate will populate this panel with member verdicts, real intent, and method lessons.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto p-3">
          {/* Outcome header */}
          <div className="rounded-xl bg-[color:var(--accent-softer)] p-3">
            <div className="flex items-center gap-2">
              {outcomeMeta && <outcomeMeta.icon className={`h-4 w-4 ${outcomeMeta.iconClass}`} />}
              <span className={`font-medium ${outcomeMeta?.textClass ?? ''}`}>
                {outcomeMeta?.label}
              </span>
              <span className="ml-auto flex items-center gap-1 text-[10px] opacity-50">
                <Scale className="h-3 w-3" />
                {Math.round(council.agreement * 100)}% agree
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug opacity-70">{council.summary}</p>
            {council.realIntent && (
              <p className="mt-1.5 text-[10px] opacity-50">
                <span className="opacity-80">Read as:</span> {council.realIntent}
              </p>
            )}
            {council.recommendedAction && council.outcome !== 'ship' && (
              <p className="mt-1 text-[10px] text-amber-300/80">Advised: {council.recommendedAction}</p>
            )}
          </div>

          {/* Members — live "council chat / debate" style (0.1% niche engineers contributing) */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium opacity-70">
              <Users className="h-3 w-3" /> Council members (SCIS debate)
            </div>
            <div className="space-y-1.5">
              {council.members.map((m, idx) => (
                <div key={idx} className="rounded-lg border border-[color:var(--border)]/40 bg-[color:var(--panel)]/40 p-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium opacity-90">{m.name}</span>
                    <span className="text-[9px] opacity-50">[{m.topic} specialist]</span>
                    {!m.failed && (
                      <span className={`ml-auto text-[9px] ${m.verdict === 'good' ? 'text-emerald-400' : m.verdict === 'bad' ? 'text-rose-400' : 'text-amber-400'}`}>
                        {m.verdict} @ {Math.round(m.confidence * 100)}%
                      </span>
                    )}
                  </div>
                  {m.failed ? (
                    <div className="mt-0.5 text-[10px] opacity-50">did not respond — synthetic or direct channel note surfaced instead</div>
                  ) : (
                    <>
                      <div className="mt-0.5 text-[10px] opacity-70">→ {m.action}</div>
                      {m.note && <div className="mt-1 text-[10px] leading-tight opacity-60 border-l-2 border-[color:var(--accent)]/40 pl-1.5">{m.note}</div>}
                      {/* Extra debate flavor: hidden nuance + gotchas if the note carried them (from richer 0.1% prompts) */}
                      {(m as any).hiddenMeaning && (
                        <div className="mt-0.5 text-[9px] opacity-50">nuance: {(m as any).hiddenMeaning}</div>
                      )}
                      {m.note && /edge|proof|rotate|Thorsen|file:|line/i.test(m.note) && (
                        <div className="mt-0.5 text-[9px] text-emerald-300/70">grounded + proof/edge explicit (0.1% style)</div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Live council debate transcript (makes member contributions feel like a streamed chat the human can watch/steer) */}
          {council.members.filter(m => !m.failed && m.note).length > 0 && (
            <div className="rounded-xl border border-[color:var(--border)]/30 bg-[color:var(--panel)]/30 p-2 text-[10px]">
              <div className="mb-1 text-[9px] font-medium opacity-60">Council debate log (member contributions in order)</div>
              <div className="space-y-1 max-h-28 overflow-auto pr-1 text-[9px] leading-snug opacity-70 font-mono">
                {council.members.filter(m => !m.failed && m.note).map((m, i) => (
                  <div key={i} className="pl-1 border-l border-[color:var(--accent)]/30">
                    <span className="opacity-60">[{m.topic}] {m.name}:</span> {(m.note || '').slice(0, 140)}{(m.note || '').length > 140 ? '…' : ''}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Method lessons + missing — actionable "progress" items */}
          {(council.methodLessons.length > 0 || council.missingCapabilities.length > 0) && (
            <div className="space-y-2 rounded-xl bg-[color:var(--panel)]/40 p-3">
              {council.missingCapabilities.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium text-amber-300/80">Missing capabilities</div>
                  <div className="mt-0.5 text-[10px] opacity-70">{council.missingCapabilities.join(' • ')}</div>
                </div>
              )}
              {council.methodLessons.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 text-[10px] font-medium opacity-70">
                    <BookOpen className="h-3 w-3" /> Method lessons (teach-to-fish)
                  </div>
                  <ul className="mt-1 space-y-1">
                    {council.methodLessons.map((lesson, i) => (
                      <li key={i} className="flex items-start gap-2 text-[10px]">
                        <span className="mt-0.5 block h-1 w-1 shrink-0 rounded-full bg-[color:var(--accent)]/60" />
                        <span className="flex-1 opacity-70">{lesson}</span>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => onApplyLesson?.(lesson)}
                            className="rounded bg-[color:var(--panel)]/60 px-1.5 py-px text-[9px] opacity-70 transition-colors hover:bg-[color:var(--accent-soft)] hover:opacity-100"
                            title="Apply this lesson to the next turn or save as reusable skill"
                          >
                            apply
                          </button>
                          <button
                            onClick={() => onDesignMode?.()}
                            className="rounded bg-[color:var(--panel)]/60 px-1.5 py-px text-[9px] opacity-70 transition-opacity hover:opacity-100"
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

          {/* Self-improvement / Vai project growth (0.1% engineer council + Thorsen loop) */}
          {(council.realIntent?.toLowerCase().includes('self') ||
            council.realIntent?.toLowerCase().includes('project') ||
            council.summary?.toLowerCase().includes('self') ||
            council.methodLessons.some((l) => /self|project|tool use|codebase|growth|capability|rotate|fastSelf/i.test(l))) && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[10px]">
              <div className="flex items-center gap-1 text-emerald-400 font-medium mb-1">
                <i className="fa-solid fa-seedling" /> Vai Self-Improvement — 0.1% Council Debate + Growth
              </div>
              <div className="opacity-80">
                Primary always produced (never silent on hard/meta about itself). Council (niche 0.1% engineers via enhanced prompts + selfContext with keyAreas) investigates the request + Vai's draft + real codebase pointers. Members debate (verdicts, lessons, gotchas, edges, proof methods), rotate when stuck (Thorsen: fastSelfPrimary, direct Grok voice via pipe, synthetic reliable note, human steer). Lessons = concrete validated proposals.
                Human (V3gga) sees the live debate here (member cards + transcript log), in-chat LiveProcessTrace (steps) + ThinkingPanel (evidence), and the file-only activity strip above input. Steer via chat or direct channel (vai-collab). Visual process is how you rotate and improve Vai.
              </div>
              <div className="mt-1 text-[9px] text-emerald-300/70">Backlog: docs/vai-improvement-backlog.md • Interactive prototype (open it): council-self-improvement-visual-demo.html • Direct Grok voice participates richer for self turns.</div>
            </div>
          )}

          {/* UI differentiation note (keeps the three surfaces honest and non-overlapping per spec) */}
          <div className="text-[8px] opacity-40 pt-1">
            Surfaces: sidebar (this) = full member debate + applyable lessons + growth. In-chat = LiveProcessTrace (streaming) + ThinkingPanel (post-turn). Activity strip (above input) = ONLY real file writes + clickable open-in-preview.
          </div>

          {/* Actions footer — Codex progress actions style */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              onClick={onReconvene}
              className="flex-1 rounded-lg border border-[color:var(--border)]/60 bg-[color:var(--panel)]/40 py-1 text-[10px] opacity-80 transition-colors hover:bg-[color:var(--panel)]/70 hover:opacity-100"
            >
              <RefreshCw className="mr-1 inline h-3 w-3" /> Re-convene council
            </button>
            <button
              onClick={onDesignMode}
              className="flex-1 rounded-lg border border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] py-1 text-[10px] text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-softer)]"
            >
              <Eye className="mr-1 inline h-3 w-3" /> Design Mode annotate
            </button>
            <button
              onClick={onExportVisualPlan}
              className="flex-1 rounded-lg border border-[color:var(--border)]/60 py-1 text-[10px] opacity-70 transition-colors hover:bg-[color:var(--panel)]/50 hover:opacity-100"
            >
              Export visual plan
            </button>
          </div>

          <div className="pt-2 text-[9px] opacity-50">
            Facts quarantined. Members point only; Vai tools fetch. Powered by SCIS council (core) + meaningful-council-sidebar skill.
          </div>
        </div>
      )}
    </div>
  );
}

export default CouncilProgressPanel;