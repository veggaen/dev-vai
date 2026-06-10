import { useState } from 'react';
import {
  AlertTriangle,
  Brain,
  ChevronRight,
  Database,
  GitBranch,
  Route,
  Search,
  Timer,
  Terminal,
  FileText,
  Zap,
  Link2,
  Wrench,
  Cpu,
  ExternalLink,
  Check,
  Copy,
  BookOpen,
  ShieldCheck,
  Save,
  Users,
  Scale,
} from 'lucide-react';
import type { ChatProgressStep, CouncilThinkingUI, ResearchTraceUI, ResponseVerificationUI, TurnThinkingUI } from '../../stores/chatStore.js';
import type { TurnEvidenceUI } from './ThinkingPanel.logic.js';
import { buildAdvisorLessons, buildThinkingPanelModel, buildReasoningNarrative, humanizeStrategy, formatDuration, summarizeProcessTrace, buildTurnEvidence } from './ThinkingPanel.logic.js';
import { useChatStore } from '../../stores/chatStore.js';

interface ThinkingPanelProps {
  readonly thinking: TurnThinkingUI;
  readonly researchTrace?: ResearchTraceUI;
  readonly verification?: ResponseVerificationUI;
  /** The model that actually produced the answer (e.g. local:qwen2.5:7b). */
  readonly respondingModelId?: string;
  /** Set when another voice "spoke up" because Vai's own take was weak. */
  readonly fallback?: { readonly fromModelId: string; readonly toModelId: string; readonly reason: 'low-confidence' | 'no-knowledge' };
  /** Engine-narrated progress steps, kept so their detail survives in the settled log. */
  readonly progressSteps?: readonly ChatProgressStep[];
  /** Code blocks Vai produced this turn (from the answer markdown). */
  readonly fileChanges?: readonly { path: string; content?: string; language?: string }[];
}

/**
 * Codex-style reasoning panel. Collapsed: one quiet line ("Thought it through ·
 * answered by X"). Expanded: a short, plain-language account of how the turn was
 * answered — reads like whoever had the best take speaking up, not a model-switch
 * log. Flat throughout: no pills, no nested rounded boxes. A suspected misroute
 * starts expanded for quick diagnosis.
 */
export function ThinkingPanel({ thinking, researchTrace, verification, respondingModelId, fallback, progressSteps, fileChanges }: ThinkingPanelProps) {
  const model = buildThinkingPanelModel(thinking);
  const [expanded, setExpanded] = useState(model.defaultExpanded);
  const flagged = model.misrouteSuspected;

  const evidence = buildTurnEvidence({ progressSteps, fileChanges });
  const plan = thinking.routePlan;
  const [copiedJson, setCopiedJson] = useState(false);

  // Analyst counters — the questions a reviewer asks first: what ran, what
  // changed, what was consulted. Explicit zeros matter as much as counts.
  const commandCount = evidence.filter((e) => e.kind === 'command').length;
  const fileCount = evidence.filter((e) => e.kind === 'file').length;
  const sourceCount = researchTrace?.sourceCount
    ?? evidence.filter((e) => e.kind === 'search').reduce((sum, e) => sum + (e.kind === 'search' ? e.results.length : 0), 0);
  const responderName = (fallback?.toModelId ?? respondingModelId ?? 'Vai').replace(/^(?:local|openai|anthropic|google):/, '');
  const advisorModel = evidence.find((e) => e.kind === 'steering' && e.advisor?.modelId);
  const modelsConsulted = [...new Set([
    'Vai (routing)',
    ...(advisorModel && advisorModel.kind === 'steering' && advisorModel.advisor
      ? [`${advisorModel.advisor.modelId.replace(/^(?:local|openai|anthropic|google):/, '')} (advisor)`]
      : []),
    ...(thinking.council ? [`council ×${thinking.council.members.length}`] : []),
    `${responderName} (answer)`,
  ])];
  const narrative = buildReasoningNarrative(model, {
    respondingModelId,
    fallback,
    candidateCount: plan?.candidates.length,
    belowFloor: plan?.belowFloor,
    chosenCandidate: plan?.candidates.find((c) => c.chosen)?.name ?? thinking.strategy,
    chosenScore: plan?.candidates.find((c) => c.chosen)?.score,
    researchSourceCount: researchTrace?.sourceCount,
  });

  // Structured, copyable decision record — the "data for review" surface. A
  // human or another AI can paste this to audit how Vai chose its answer.
  const copyDecisionJson = () => {
    const record = {
      intent: thinking.intent,
      strategy: thinking.strategy,
      confidence: thinking.confidence,
      trustBadge: thinking.trustBadge,
      topic: thinking.topic,
      durationMs: thinking.durationMs,
      why: narrative.why,
      recipe: narrative.steps,
      routePlan: thinking.routePlan,
      processTrace: thinking.processTrace,
      verification,
      evidence,
    };
    navigator.clipboard.writeText(JSON.stringify(record, null, 2)).then(() => {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    });
  };

  return (
    <div className="mb-4 text-xs" data-testid="thinking-panel" data-misroute={flagged ? '1' : '0'}>
      <div className={expanded ? 'thinking-panel-expanded overflow-hidden rounded-xl thinking-surface' : ''}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`thinking-panel-trigger group flex w-full items-center gap-3 px-2.5 py-2 text-left text-zinc-500 transition-colors thinking-hover hover:text-[color:var(--chat-body)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] ${
          expanded ? 'rounded-none border-b border-[color:var(--panel-border-soft)]' : 'rounded-xl'
        }`}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} answer process`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]">
          <Brain aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-[color:var(--chat-body)]">How this answer was made</span>
          <span className="mt-0.5 block truncate text-[11px] leading-4 text-[color:var(--chat-muted)]">{narrative.summary}</span>
        </span>
        {flagged && <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
        <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform group-hover:text-[color:var(--chat-body)] ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="space-y-4 p-4 sm:p-5">
          {model.misrouteHint && (
            <p className="thinking-callout-warn px-3 py-2.5 text-[11px] leading-5 text-[color:var(--tone-warn)]">
              {model.misrouteHint}
            </p>
          )}

          {/* At-a-glance metrics */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-analyst-stats="1">
            <ProcessMetric label="Intent" value={model.intentLabel} />
            <ProcessMetric label="Answered by" value={responderName} />
            {model.durationMs !== undefined && <ProcessMetric label="Elapsed" value={formatDuration(model.durationMs)} />}
            <ProcessMetric
              label="Evidence"
              value={verification?.grounding ? humanizeStrategy(verification.grounding) : model.trustLabel ?? 'Conversation only'}
            />
            <ProcessMetric label="Commands" value={String(commandCount)} />
            <ProcessMetric label="Files changed" value={String(fileCount)} />
            <ProcessMetric label="Web sources" value={String(sourceCount)} />
            <ProcessMetric label="Models" value={modelsConsulted.join(' → ')} />
          </div>

          {commandCount === 0 && fileCount === 0 && (
            <p className="text-[11px] leading-5 text-[color:var(--chat-muted)]" data-no-side-effects="1">
              No commands ran and no project files changed — answer came from {responderName}.
            </p>
          )}

          {/* Decision */}
          <section className="thinking-surface-soft rounded-lg p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[color:var(--chat-strong)]">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--tone-good)]" />
              Why this answer
            </div>
            <p className="text-[12px] leading-6 text-[color:var(--chat-body)]">{narrative.why}</p>
          </section>

          {/* Steps timeline */}
          <section className="thinking-surface-soft rounded-lg p-3.5">
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--chat-eyebrow)]">
              Steps taken
            </div>
            <ol className="relative space-y-0 border-l border-[color:var(--panel-border)] pl-4">
              {narrative.steps.map((line, index) => (
                <li key={index} className="relative pb-3 text-[11px] leading-5 text-[color:var(--chat-body)] last:pb-0">
                  <span
                    aria-hidden
                    className="absolute -left-[calc(0.5rem+1px)] top-1.5 h-2 w-2 rounded-full border border-[color:var(--panel-border)] bg-[color:var(--panel-bg-elevated)]"
                  />
                  {line}
                </li>
              ))}
            </ol>
          </section>

          {thinking.council && <CouncilSection council={thinking.council} />}

          {verification && verification.action !== 'pass' && (
            <section className="thinking-callout px-3.5 py-3" data-verification={verification.action}>
              <div className="flex items-start gap-2.5">
                <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--tone-info)]" />
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-[color:var(--tone-info)]">Quality note kept out of the answer</div>
                  <p className="mt-1 text-[11px] leading-5 text-[color:var(--chat-muted)]">
                    Vai marked this answer as {verification.action}. Details stay here, not in the reply.
                  </p>
                </div>
              </div>
            </section>
          )}

          {evidence.length > 0 && <EvidenceLog items={evidence} />}
          {plan && plan.candidates.length > 0 && <RoutePlanDetails plan={plan} />}
          {thinking.processTrace && thinking.processTrace.length > 0 && <ProcessTraceExplorer trace={thinking.processTrace} />}
          {researchTrace && <ResearchTraceExplorer trace={researchTrace} />}

          <section className="thinking-surface-soft rounded-lg p-3.5" data-audit-export="1">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-[color:var(--chat-strong)]">
              <Copy aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--chat-muted)]" />
              Audit export
            </div>
            <p className="mb-3 text-[11px] leading-5 text-[color:var(--chat-muted)]">
              Structured routing record for debugging — intent, strategy, verification, and evidence. Copy as JSON to paste into another review tool.
            </p>
            <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] sm:grid-cols-3">
              <div>
                <dt className="font-semibold uppercase tracking-[0.12em] text-[color:var(--chat-eyebrow)]">Intent</dt>
                <dd className="mt-0.5 text-[color:var(--chat-body)]">{model.intentLabel}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-[0.12em] text-[color:var(--chat-eyebrow)]">Strategy</dt>
                <dd className="mt-0.5 truncate text-[color:var(--chat-body)]" title={model.strategy}>{model.strategy || '—'}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-[0.12em] text-[color:var(--chat-eyebrow)]">Evidence</dt>
                <dd className="mt-0.5 text-[color:var(--chat-body)]">{verification?.grounding ? humanizeStrategy(verification.grounding) : model.trustLabel ?? 'Conversation only'}</dd>
              </div>
              {verification && (
                <div>
                  <dt className="font-semibold uppercase tracking-[0.12em] text-[color:var(--chat-eyebrow)]">Verification</dt>
                  <dd className="mt-0.5 text-[color:var(--chat-body)]">{verification.action}</dd>
                </div>
              )}
              {model.topic && (
                <div className="col-span-2 sm:col-span-1">
                  <dt className="font-semibold uppercase tracking-[0.12em] text-[color:var(--chat-eyebrow)]">Topic</dt>
                  <dd className="mt-0.5 truncate text-[color:var(--chat-body)]" title={model.topic}>{model.topic}</dd>
                </div>
              )}
            </dl>
            <button
              type="button"
              onClick={copyDecisionJson}
              data-evidence-export="json"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--panel-border-soft)] bg-[color:var(--panel-bg-elevated)] px-2.5 py-1.5 text-[10px] font-medium text-[color:var(--chat-body)] transition-colors hover:text-[color:var(--chat-strong)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
              title="Copy this turn's full decision record as JSON"
              aria-live="polite"
            >
              {copiedJson ? <Check aria-hidden="true" className="h-3 w-3 text-emerald-500" /> : <Copy aria-hidden="true" className="h-3 w-3" />}
              {copiedJson ? 'Decision JSON copied' : 'Copy decision JSON'}
            </button>
          </section>
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * "What I did" — the typed evidence log. Each item renders with chrome that fits
 * its kind: a file expands to its code, a search to its queries + results, a
 * command to its output, a note carries the engine's own step narration. This is
 * the panel-side of the Codex-style "see what actually happened" view.
 */
function EvidenceLog({ items }: { items: readonly TurnEvidenceUI[] }) {
  return (
    <section className="thinking-surface-soft rounded-lg p-3.5" data-evidence-log={items.length}>
      <div className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--chat-eyebrow)]">
        <Wrench aria-hidden="true" className="h-3 w-3 text-[color:var(--chat-muted)]" />
        Actions & evidence
        <span className="ml-auto tabular-nums text-[color:var(--chat-muted)]">{items.length}</span>
      </div>
      <ol className="space-y-2">
        {items.map((item, index) => (
          <EvidenceItem key={index} item={item} />
        ))}
      </ol>
    </section>
  );
}

function advisorQualitySummary(item: Extract<TurnEvidenceUI, { kind: 'steering' }>): string[] {
  const contract = item.advisor?.qualityContract;
  if (!contract) return [];
  return [
    `${contract.answerLength} answer`,
    contract.mustBeGuiding ? 'guide the user' : 'answer directly',
    contract.mustBeCurrent ? 'use fresh evidence' : 'fresh evidence not required',
    contract.mustUseJson ? 'return JSON' : '',
    contract.shouldAskClarifyingQuestion ? 'ask one clarifying question' : '',
  ].filter(Boolean);
}

function EvidenceItem({ item }: { item: TurnEvidenceUI }) {
  const postSteer = useChatStore((state) => state.postSteer);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const [lessonState, setLessonState] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});

  const saveLesson = async (
    lesson: ReturnType<typeof buildAdvisorLessons>[number],
  ) => {
    if (!activeConversationId || !lesson.signal || !lesson.handler) return;
    setLessonState((current) => ({ ...current, [lesson.id]: 'saving' }));
    const result = await postSteer({
      conversationId: activeConversationId,
      signal: lesson.signal,
      handler: lesson.handler,
      note: lesson.detail,
      scope: 'class',
      matchTokens: [...lesson.matchTokens],
    });
    setLessonState((current) => ({
      ...current,
      [lesson.id]: result.ok ? 'saved' : 'error',
    }));
  };

  if (item.kind === 'steering') {
    const advisor = item.advisor;
    const lessons = buildAdvisorLessons(advisor);
    const qualitySummary = advisorQualitySummary(item);
    const hasStructuredAdvice = Boolean(
      advisor?.taskShape
      || qualitySummary.length
      || advisor?.routeGuidance.length
      || advisor?.riskFlags.length
      || advisor?.retrievalHints.length,
    );

    return (
      <li className="thinking-inset-row px-3 py-2.5 text-[11px]" data-evidence="steering" data-advisor-state={advisor?.state}>
        <div className="flex items-start gap-2">
          <Brain aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--accent-text)]" />
          <div className="min-w-0 flex-1">
            <div>
              <span className="font-medium text-[color:var(--chat-strong)]">Advisor contribution</span>
              {item.status && <span className="ml-2 text-[9px] uppercase tracking-[0.12em] text-[color:var(--accent-text)]">{item.status}</span>}
            </div>
            <span className="mt-1 block text-[11px] leading-5 text-zinc-500">
              Qwen reviewed the route and quality risks. Vai remained responsible for the final answer.
            </span>
            {advisor && (
              <div className="mt-1.5 flex flex-wrap gap-x-2 text-[9px] uppercase tracking-[0.1em] text-zinc-600">
                <span>{advisor.modelId}</span>
                {advisor.durationMs !== undefined && <span>{formatDuration(advisor.durationMs)}</span>}
              </div>
            )}
          </div>
        </div>

        {lessons.length > 0 && (
          <div className="ml-5 mt-3 space-y-2" data-advisor-lessons={lessons.length}>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--accent-text)]">
              <BookOpen aria-hidden="true" className="h-3 w-3" />
              What Vai can reuse
            </div>
            {lessons.map((lesson) => {
              const state = lessonState[lesson.id];
              const canSave = Boolean(activeConversationId && lesson.signal && lesson.handler);
              return (
                <div key={lesson.id} className="px-1 py-1.5">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-[color:var(--chat-body)]">{lesson.title}</div>
                      <p className="mt-1 text-[11px] leading-5 text-zinc-500">{lesson.detail}</p>
                    </div>
                    {canSave && (
                      <button
                        type="button"
                        onClick={() => { void saveLesson(lesson); }}
                        disabled={state === 'saving' || state === 'saved'}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg thinking-chip px-2 py-1.5 text-[9px] font-medium text-[color:var(--chat-eyebrow)] transition-colors thinking-hover hover:text-[color:var(--chat-strong)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] disabled:cursor-default disabled:text-zinc-600"
                      >
                        {state === 'saved' ? <Check aria-hidden="true" className="h-3 w-3 text-emerald-400" /> : <Save aria-hidden="true" className="h-3 w-3" />}
                        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Try Again' : 'Use Next Time'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {advisor && hasStructuredAdvice && (
          <details className="group/advisor ml-5 mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-zinc-500 thinking-hover hover:text-[color:var(--chat-body)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]">
              <ChevronRight aria-hidden="true" className="h-3 w-3 transition-transform group-open/advisor:rotate-90" />
              Advisor details
            </summary>
            <div className="mt-2 space-y-2 px-2 text-[11px] leading-5 text-[color:var(--chat-eyebrow)]">
              {advisor.taskShape && (
                <div>
                  <span className="text-zinc-600">Read the task as </span>
                  <span className="text-[color:var(--chat-body)]">{humanizeStrategy(advisor.taskShape)}</span>
                </div>
              )}
              {qualitySummary.length > 0 && (
                <div>
                  <div className="mb-0.5 text-zinc-600">Quality contract</div>
                  <div className="text-[color:var(--chat-body)]">{qualitySummary.join(' / ')}</div>
                </div>
              )}
              {advisor.riskFlags.length > 0 && (
                <div>
                  <div className="mb-0.5 text-zinc-600">Risks</div>
                  <div className="text-[color:var(--tone-warn)]">{advisor.riskFlags.map(humanizeStrategy).join(' / ')}</div>
                </div>
              )}
              {advisor.routeGuidance.length > 0 && (
                <div>
                  <div className="mb-0.5 text-zinc-600">Route advice</div>
                  <ol className="space-y-1">
                    {advisor.routeGuidance.map((guidance, index) => (
                      <li key={`${guidance.signal}-${guidance.handler}-${index}`}>
                        <span className={guidance.signal === 'prefer' ? 'text-[color:var(--tone-good)]' : 'text-[color:var(--tone-bad)]'}>
                          {guidance.signal}
                        </span>
                        {' '}
                        <span className="text-[color:var(--chat-body)]">{humanizeStrategy(guidance.handler)}</span>
                        <span className="text-zinc-600">: {guidance.reason}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {advisor.retrievalHints.length > 0 && (
                <div>
                  <div className="mb-0.5 text-zinc-600">Retrieval hints</div>
                  <div className="text-[color:var(--chat-body)]">{advisor.retrievalHints.join(' / ')}</div>
                </div>
              )}
            </div>
          </details>
        )}
      </li>
    );
  }

  if (item.kind === 'note') {
    const isPeerReview = item.stage === 'friend-review';
    return (
      <li
        className={isPeerReview ? 'thinking-inset-row rounded-lg px-3 py-2.5 text-[11px]' : 'flex items-start gap-2 text-[11px]'}
        data-evidence={isPeerReview ? 'peer-review' : 'note'}
      >
        {isPeerReview ? (
          <>
            <div className="flex items-center gap-2 font-medium text-[color:var(--chat-strong)]">
              <Users aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--accent-text)]" />
              Peer review
            </div>
            <span className="mt-1 block text-[color:var(--chat-body)]">{item.label}</span>
            {item.detail && <span className="mt-1 block text-[10px] leading-5 text-[color:var(--chat-muted)]">{item.detail}</span>}
          </>
        ) : (
          <>
            <Route className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
            <div className="min-w-0">
              <span className="text-[color:var(--chat-body)]">{item.label}</span>
              {item.detail && <span className="mt-0.5 block text-[10px] leading-4 text-[color:var(--chat-muted)]">{item.detail}</span>}
            </div>
          </>
        )}
      </li>
    );
  }

  if (item.kind === 'file') {
    const hasDelta = item.added !== undefined || item.removed !== undefined;
    return (
      <li data-evidence="file">
        <details className="group/ev">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] text-[color:var(--chat-body)] hover:text-[color:var(--chat-strong)]">
            <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open/ev:rotate-90" />
            <FileText className="h-3 w-3 shrink-0 text-teal-400" />
            <span className="min-w-0 flex-1 truncate font-mono">{item.path}</span>
            {hasDelta && (
              <span className="shrink-0 tabular-nums text-[10px]">
                {item.added !== undefined && <span className="text-emerald-400">+{item.added}</span>}
                {item.removed !== undefined && <span className="ml-1 text-red-400">-{item.removed}</span>}
              </span>
            )}
          </summary>
          {(item.diff || item.content) && (
            <pre className="mt-1.5 max-h-64 overflow-auto rounded-md thinking-code p-2 text-[10px] leading-4 text-[color:var(--chat-body)]">
              <code>{item.diff || item.content}</code>
            </pre>
          )}
        </details>
      </li>
    );
  }

  if (item.kind === 'search') {
    return (
      <li data-evidence="search">
        <details className="group/ev">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] text-[color:var(--chat-body)] hover:text-[color:var(--chat-strong)]">
            <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open/ev:rotate-90" />
            <Search className="h-3 w-3 shrink-0 text-sky-400" />
            <span className="min-w-0 flex-1 truncate">
              Searched {item.queries.length} quer{item.queries.length === 1 ? 'y' : 'ies'} → {item.results.length} result{item.results.length === 1 ? '' : 's'}
            </span>
          </summary>
          <div className="mt-1.5 space-y-2">
            {item.queries.length > 0 && (
              <ol className="space-y-0.5">
                {item.queries.map((query, i) => (
                  <li key={`q-${i}`} className="flex gap-2 text-[10px] leading-4 text-[color:var(--chat-eyebrow)]">
                    <span className="tabular-nums text-zinc-700">{i + 1}</span>
                    <span className="min-w-0">{query}</span>
                  </li>
                ))}
              </ol>
            )}
            {item.results.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {item.results.map((result, i) => (
                  <li key={`r-${i}`} className="min-w-0 text-[10px] leading-4">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 font-medium text-[color:var(--chat-strong)] hover:text-sky-300"
                    >
                      <span className="truncate">{result.title}</span>
                      {result.url && <ExternalLink className="h-2.5 w-2.5 shrink-0 text-zinc-600" />}
                    </a>
                    {result.snippet && <span className="mt-0.5 block text-zinc-500 line-clamp-2">{result.snippet}</span>}
                    {result.domain && <span className="text-[9px] uppercase tracking-[0.12em] text-zinc-600">{result.domain}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </li>
    );
  }

  // command
  return (
    <li data-evidence="command">
      <details className="group/ev">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] text-[color:var(--chat-body)] hover:text-[color:var(--chat-strong)]">
          <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open/ev:rotate-90" />
          <Terminal className="h-3 w-3 shrink-0 text-amber-400" />
          <span className="min-w-0 flex-1 truncate font-mono">{item.command}</span>
          {item.exitCode !== undefined && (
            <span className={`shrink-0 tabular-nums text-[10px] ${item.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              exit {item.exitCode}
            </span>
          )}
        </summary>
        {item.output && (
          <pre className="mt-1.5 max-h-64 overflow-auto rounded-md thinking-code p-2 text-[10px] leading-4 text-[color:var(--chat-body)]">
            <code>{item.output}</code>
          </pre>
        )}
      </details>
    </li>
  );
}

/**
 * SCIS council consensus — who weighed in on Vai's draft and what they agreed he
 * should do. Renders the read intent, the consensus outcome (ship / act /
 * escalate), each member's call, and what method was missing. Members only point;
 * Vai fetches — so no member-authored fact appears here.
 */
function CouncilSection({ council }: { council: CouncilThinkingUI }) {
  const outcomeStyle =
    council.outcome === 'ship'
      ? { label: 'Cleared for release', tone: 'text-[color:var(--tone-good)]', dot: 'bg-emerald-400/80' }
      : council.outcome === 'act'
        ? { label: 'Vai should act first', tone: 'text-[color:var(--tone-warn)]', dot: 'bg-amber-400/80' }
        : { label: 'Escalated for stronger help', tone: 'text-[color:var(--tone-info)]', dot: 'bg-sky-400/80' };
  const actionLabel = humanizeStrategy(council.recommendedAction);

  return (
    <section className="space-y-3 rounded-xl thinking-surface-soft p-3.5" data-council={council.outcome}>
      <div className="flex flex-wrap items-center gap-2">
        <Users aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--accent-text)]" />
        <span className="text-[11px] font-medium text-[color:var(--chat-strong)]">Council consensus</span>
        <span className={`flex items-center gap-1.5 text-[10px] font-medium ${outcomeStyle.tone}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${outcomeStyle.dot}`} />
          {outcomeStyle.label}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[10px] tabular-nums text-zinc-500" title="Inter-member agreement">
          <Scale aria-hidden="true" className="h-3 w-3" />
          {Math.round(council.agreement * 100)}% agree · {council.topic}
        </span>
      </div>

      <p className="text-[11px] leading-5 text-[color:var(--chat-eyebrow)]">{council.summary}</p>

      {council.realIntent && (
        <p className="text-[11px] leading-5 text-zinc-500">
          <span className="text-[color:var(--chat-eyebrow)]">Read the real ask as:</span> {council.realIntent}
        </p>
      )}

      {council.outcome !== 'ship' && (
        <p className="text-[11px] leading-5 text-[color:var(--chat-eyebrow)]">
          <span className="text-zinc-500">Recommendation:</span> {actionLabel}
        </p>
      )}

      <ol className="space-y-1.5">
        {council.members.map((member, index) => {
          const verdictTone =
            member.failed ? 'text-zinc-600'
              : member.verdict === 'good' ? 'text-[color:var(--tone-good)]'
                : member.verdict === 'bad' ? 'text-[color:var(--tone-bad)]'
                  : 'text-[color:var(--tone-warn)]';
          return (
            <li key={`${member.name}-${index}`} className="flex min-w-0 items-start gap-2 text-[10px] leading-4">
              <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${member.failed ? 'bg-zinc-700' : 'bg-[color:var(--accent)]'}`} />
              <span className="min-w-0">
                <span className="text-[color:var(--chat-body)]">{member.name}</span>
                <span className="text-zinc-600"> [{member.topic}]</span>
                {!member.failed && (
                  <>
                    {' · '}<span className={verdictTone}>{member.verdict}</span>
                    <span className="text-zinc-600"> @ {Math.round(member.confidence * 100)}% → {humanizeStrategy(member.action)}</span>
                  </>
                )}
                {member.note && <span className="mt-0.5 block text-zinc-600">{member.note}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      {(council.missingCapabilities.length > 0 || council.methodLessons.length > 0) && (
        <div className="space-y-1.5 border-t border-[color:var(--shell-line-soft)] pt-2.5">
          {council.missingCapabilities.length > 0 && (
            <div className="text-[10px] leading-4">
              <span className="text-zinc-600">Missing capability: </span>
              <span className="text-[color:var(--tone-warn)]">{council.missingCapabilities.join('; ')}</span>
            </div>
          )}
          {council.methodLessons.length > 0 && (
            <div className="text-[10px] leading-4">
              <span className="flex items-center gap-1 text-zinc-600"><BookOpen className="h-3 w-3" /> How to fish this next time</span>
              <ul className="mt-1 space-y-0.5">
                {council.methodLessons.map((lesson, i) => (
                  <li key={i} className="text-[color:var(--chat-eyebrow)]">— {lesson}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The candidate approaches Vai weighed this turn, behind a flat disclosure so
 * the default view stays the clean narrative. Each row: who was considered,
 * whether it won or stepped aside, its fit %, and inline steer ("Vai should /
 * shouldn't take this"). No pills, no score-bar chrome — just rows.
 */
function RoutePlanDetails({ plan }: { plan: NonNullable<TurnThinkingUI['routePlan']> }) {
  const postSteer = useChatStore((s) => s.postSteer);
  const activeConversationId = useChatStore((s) => s.activeConversationId);

  const handleSteer = async (signal: 'avoid' | 'prefer', handler: string) => {
    if (!activeConversationId) return;
    try {
      await postSteer({
        conversationId: activeConversationId,
        signal,
        handler,
        note: 'steered from thinking panel (UI)',
        scope: 'class',
      });
      // eslint-disable-next-line no-console
      console.log('[steer] posted', { signal, handler });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[steer] failed', e);
    }
  };

  return (
    <details className="group/cand py-1" data-route-plan={plan.chosen ?? 'none'}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-medium text-zinc-500 hover:text-[color:var(--chat-body)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]">
        <ChevronRight aria-hidden="true" className="h-3 w-3 transition-transform group-open/cand:rotate-90" />
        Routing decision
        <span className="ml-auto text-zinc-600">{plan.candidates.length} considered</span>
        {plan.belowFloor && <span className="text-[color:var(--tone-warn)]">No clear match</span>}
      </summary>

      <ol className="mt-3 space-y-1.5">
        {plan.candidates.map((candidate, index) => {
          const clamp = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100);
          const pct = clamp(candidate.score);
          const basePct = candidate.baseScore !== undefined ? clamp(candidate.baseScore) : undefined;
          const moved = basePct !== undefined && basePct !== pct;
          const outcome = candidate.chosen ? 'won' : candidate.declined ? 'declined' : 'not reached';
          return (
            <li
              key={`${candidate.name}-${index}`}
              className={`px-3 py-2 text-[10px] ${
                candidate.chosen ? 'bg-emerald-400/[0.055]' : 'thinking-surface-soft'
              }`}
              data-route-candidate={candidate.name}
              data-chosen={candidate.chosen ? '1' : '0'}
            >
              <div
                className={`flex items-center gap-2 ${
                  candidate.chosen ? 'text-[color:var(--tone-good)]' : candidate.declined ? 'text-zinc-600' : 'text-[color:var(--chat-eyebrow)]'
                }`}
              >
                <span className="w-3 shrink-0 text-center">{candidate.chosen ? '›' : candidate.declined ? '·' : ''}</span>
                <span className="min-w-0 flex-1 truncate">
                  {humanizeStrategy(candidate.name)}
                </span>
                <span className="shrink-0 text-[9px] text-zinc-600">{candidate.chosen ? 'selected' : outcome}</span>
                {candidate.guidance && (
                  <span className="shrink-0 text-[9px] text-[color:var(--tone-warn)]" title="Friend guidance steered this candidate">
                    {candidate.guidance}
                  </span>
                )}
                <span
                  className="shrink-0 text-right tabular-nums text-zinc-600"
                  title={moved ? `base ${basePct}% → ${pct}% after guidance` : undefined}
                >
                  {moved ? `${basePct}→${pct}%` : `${pct}%`}
                </span>
                {!candidate.chosen && (
                  <span className="ml-1 flex shrink-0 gap-2 text-[9px]">
                    <button
                      onClick={() => handleSteer('avoid', candidate.name)}
                      title={`Tell Vai to avoid ${humanizeStrategy(candidate.name)} for similar turns`}
                      className="rounded px-1 py-0.5 text-zinc-600 hover:bg-red-400/8 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-red-400/30"
                    >
                      avoid
                    </button>
                    <button
                      onClick={() => handleSteer('prefer', candidate.name)}
                      title={`Tell Vai to prefer ${humanizeStrategy(candidate.name)} for similar turns`}
                      className="rounded px-1 py-0.5 text-zinc-600 hover:bg-emerald-400/8 hover:text-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-400/30"
                    >
                      prefer
                    </button>
                  </span>
                )}
              </div>
              {candidate.reason && (
                <div className="ml-5 mt-1 text-[10px] leading-4 text-zinc-600">{candidate.reason}</div>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function ProcessTraceExplorer({ trace }: { trace: NonNullable<TurnThinkingUI['processTrace']> }) {
  const { rows, totalMs } = summarizeProcessTrace(trace);

  const getStageIcon = (stage: string) => {
    const s = stage.toLowerCase();
    if (s.includes('powershell') || s.includes('cmd') || s.includes('terminal') || s.includes('exec')) return <Terminal className="h-3 w-3" />;
    if (s.includes('tool') || s.includes('action') || s.includes('work') || s.includes('run')) return <Wrench className="h-3 w-3" />;
    if (s.includes('file') || s.includes('read') || s.includes('write') || s.includes('attach') || s.includes('context')) return <FileText className="h-3 w-3" />;
    if (s.includes('bridge') || s.includes('pipe') || s.includes('channel') || s.includes('collab')) return <Link2 className="h-3 w-3" />;
    if (s.includes('synth') || s.includes('assemble') || s.includes('think') || s.includes('reason')) return <Brain className="h-3 w-3" />;
    if (s.includes('search') || s.includes('retriev') || s.includes('ingest')) return <Search className="h-3 w-3" />;
    if (s.includes('cpu') || s.includes('compute') || s.includes('calc')) return <Cpu className="h-3 w-3" />;
    if (s.includes('zap') || s.includes('fast') || s.includes('quick')) return <Zap className="h-3 w-3" />;
    return <Route className="h-3 w-3" />;
  };

  const getStageColor = (stage: string) => {
    const s = stage.toLowerCase();
    if (s.includes('powershell') || s.includes('cmd') || s.includes('terminal') || s.includes('exec')) return 'text-amber-400';
    if (s.includes('tool') || s.includes('action') || s.includes('work')) return 'text-orange-400';
    if (s.includes('bridge') || s.includes('pipe') || s.includes('channel')) return 'text-emerald-400';
    if (s.includes('synth') || s.includes('assemble')) return 'text-violet-400';
    if (s.includes('search') || s.includes('retriev')) return 'text-sky-400';
    if (s.includes('attach') || s.includes('context') || s.includes('file')) return 'text-teal-400';
    return 'text-[color:var(--chat-eyebrow)]';
  };

  return (
    <details className="group/trace py-1" data-process-trace="vai">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-medium text-zinc-500 hover:text-[color:var(--chat-body)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]">
        <ChevronRight aria-hidden="true" className="h-3 w-3 transition-transform group-open/trace:rotate-90" />
        Time breakdown
        <span className="ml-auto tabular-nums text-zinc-600">{formatDuration(totalMs)}</span>
      </summary>
      <p className="mt-2 pl-5 text-[11px] leading-5 text-zinc-600">
        Where the time went — the reasoning itself is in the steps above.
      </p>
      <div className="mt-3 pl-5">
        {/* timeline rail */}
        <ol className="space-y-3">
          {rows.map((row, index) => {
            const icon = getStageIcon(row.stage);
            const color = getStageColor(row.stage);
            const isAction = /powershell|cmd|terminal|exec|tool|action|work/i.test(row.stage);
            // Plain-English "what this is", with the per-turn fact folded in.
            const explainLine = row.explanation
              ? `${row.explanation}${row.detail ? ` Here: ${row.detail}.` : ''}`
              : row.detail;
            const width = totalMs > 0 ? Math.max(2, Math.round((row.stepMs / totalMs) * 100)) : 2;
            return (
              <li key={`${row.stage}-${index}`} className={`flex items-start gap-2.5 text-[11px] leading-5 ${row.isMarker ? 'opacity-55' : ''}`}>
                <span className={`mt-1 h-3 w-3 shrink-0 ${row.isMarker ? 'text-zinc-600' : color}`} title={row.stage}>
                  {icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`truncate font-medium ${row.isMarker ? 'text-zinc-500' : isAction ? 'text-[color:var(--chat-strong)]' : 'text-[color:var(--chat-body)]'}`} title={row.stage}>{row.label}</span>
                    <span className="ml-auto tabular-nums text-zinc-600">{formatDuration(row.stepMs)}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.035]">
                    <div
                      className={`h-full rounded-full ${row.isMarker ? 'bg-zinc-700' : 'bg-[color:var(--accent)] opacity-60'}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  {explainLine && <div className="mt-1 text-[11px] leading-5 text-zinc-600">{explainLine}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </details>
  );
}

function ResearchTraceExplorer({ trace }: { trace: ResearchTraceUI }) {
  const modeLabel = trace.mode === 'wormhole' ? 'Accelerated' : trace.mode === 'parallel' ? 'Parallel' : 'Linear';

  return (
    <section className="py-1" data-research-trace={trace.mode}>
      <div className="flex flex-wrap items-center gap-2">
        <GitBranch aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--tone-info)]" />
        <span className="text-[10px] font-medium text-[color:var(--chat-eyebrow)]">Research path</span>
        <span className="ml-auto text-[10px] text-[color:var(--tone-info)]">{modeLabel}</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 px-3 py-2.5">
        <Metric icon={<Database className="h-3 w-3" />} label="Fetched" value={trace.rawResultCount} />
        <Metric icon={<Search className="h-3 w-3" />} label="Selected" value={trace.sourceCount} />
        <Metric icon={<Timer className="h-3 w-3" />} label="Latency" value={formatDuration(trace.latencyMs)} />
      </div>

      <ol className="mt-3 space-y-1.5">
        {trace.stages.map((stage, index) => (
          <li
            key={`${stage.step}-${index}`}
            className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-2 px-2 py-2"
            data-research-stage={stage.step}
          >
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sky-400/80" />
            <span className="min-w-0">
              <span className="block text-[11px] font-medium text-[color:var(--chat-strong)]">{stage.label}</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-zinc-500">{stage.detail}</span>
            </span>
            <span className="text-[10px] tabular-nums text-zinc-600">{formatDuration(stage.durationMs)}</span>
          </li>
        ))}
      </ol>

      {(trace.fanOutQueries.length > 0 || trace.entities.length > 0) && (
        <details className="group/trace mt-2 px-2 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-medium text-zinc-500 hover:text-[color:var(--chat-body)] focus-visible:ring-2 focus-visible:ring-sky-400/30">
            <Route aria-hidden="true" className="h-3 w-3" />
            Queries and entities
            <ChevronRight aria-hidden="true" className="ml-auto h-3 w-3 transition-transform group-open/trace:rotate-90" />
          </summary>

          {trace.entities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {trace.entities.map((entity) => <Badge key={entity} label="entity" value={entity} />)}
            </div>
          )}

          {trace.fanOutQueries.length > 0 && (
            <ol className="mt-2 space-y-1.5">
              {trace.fanOutQueries.map((query, index) => (
                <li key={`${query}-${index}`} className="flex gap-2 text-[10px] leading-4 text-zinc-500">
                  <span className="tabular-nums text-zinc-700">{index + 1}</span>
                  <span>{query}</span>
                </li>
              ))}
            </ol>
          )}
        </details>
      )}
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-1 px-2 first:pl-0 last:pr-0">
      <span className="flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] text-zinc-600">
        {icon}
        {label}
      </span>
      <span className="truncate text-[11px] font-medium tabular-nums text-[color:var(--chat-body)]">{value}</span>
    </span>
  );
}

/** Compact stat tile used in the process record header grid. */
function ProcessMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="thinking-stat min-w-0">
      <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--chat-eyebrow)]">{label}</span>
      <span className="mt-1 block truncate text-[11px] font-medium text-[color:var(--chat-strong)]" title={value}>{value}</span>
    </div>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</span>
      <span className="text-[color:var(--chat-body)]">{value}</span>
    </span>
  );
}
