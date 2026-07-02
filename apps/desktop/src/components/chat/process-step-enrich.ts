import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import { stripAnsi } from '../../lib/strip-ansi.js';

/** Live council view while a turn is still streaming (before thinking.council is attached). */
export function deriveLiveCouncilFromProgressSteps(
  steps: readonly ChatProgressStep[],
  isStreaming: boolean,
): CouncilThinkingUI | null {
  if (!isStreaming || steps.length === 0) return null;

  const councilStep = [...steps].reverse().find((step) =>
    step.stage.startsWith('council')
    && (step.status === 'running' || (step.councilMembers?.length ?? 0) > 0),
  );
  if (!councilStep) return null;

  const members = (councilStep.councilMembers ?? []).map((member) => ({
    name: member.name,
    topic: member.topic ?? 'review',
    verdict: member.verdict,
    confidence: member.confidence,
    action: member.suggestedAction?.trim() ?? '',
    note: stripAnsi(member.note?.trim() ?? ''),
    failed: member.failed,
  }));

  const consensus = councilStep.processLog?.find((entry) => entry.kind === 'verdict');
  const inProgress = councilStep.status === 'running' && members.length === 0;

  return {
    outcome: inProgress ? 'act' : 'act',
    agreement: inProgress ? 0 : 0.5,
    confidence: inProgress ? 0 : 0.5,
    topic: inProgress ? 'review in progress' : 'factual',
    summary: inProgress
      ? councilStep.label
      : (consensus?.body?.split('\n')[0]?.trim() || councilStep.label),
    realIntent: '',
    recommendedAction: inProgress ? 'reviewing' : '',
    missingCapabilities: [],
    methodLessons: [],
    members,
  };
}

/** Rehydrate council detail onto progress steps when only thinking.council survived. */
export function enrichProgressStepsWithCouncil(
  steps: readonly ChatProgressStep[],
  council?: CouncilThinkingUI,
): ChatProgressStep[] {
  if (!council?.members.length) return [...steps];

  const consensusBody = [
    council.summary,
    council.realIntent ? `Real intent: ${council.realIntent}` : '',
    council.recommendedAction ? `Recommended action: ${council.recommendedAction}` : '',
    council.missingCapabilities.length
      ? `Missing capabilities:\n- ${council.missingCapabilities.join('\n- ')}`
      : '',
    council.methodLessons.length
      ? `Method lessons:\n- ${council.methodLessons.join('\n- ')}`
      : '',
    `Outcome: ${council.outcome} · agreement ${Math.round(council.agreement * 100)}%`,
  ].filter(Boolean).join('\n\n');

  const councilMembers = council.members.map((member) => ({
    name: member.name,
    topic: member.topic,
    verdict: member.verdict,
    confidence: member.confidence,
    note: member.note,
    failed: member.failed,
    suggestedAction: member.action,
  }));

  const councilSteps = steps.filter((step) =>
    step.stage.startsWith('council-vai')
    || step.stage.startsWith('council-fallback')
    || step.stage === 'council'
    || step.stage === 'council-vai',
  );
  const primaryCouncilStage = councilSteps.at(-1)?.stage;

  return steps.map((step) => {
    const isCouncilStep = step.stage.startsWith('council');
    if (!isCouncilStep) return step;
    if (step.councilMembers?.length && step.processLog?.length) return step;

    const attachHere = step.stage === primaryCouncilStage
      || (step.stage === 'council-vai' && !steps.some((item) => item.stage.startsWith('council-vai-round')));

    if (!attachHere) return step;

    return {
      ...step,
      councilMembers: step.councilMembers?.length ? step.councilMembers : councilMembers,
      processLog: step.processLog?.length
        ? step.processLog
        : [{
            kind: 'verdict' as const,
            label: 'Where the reviewers landed',
            body: consensusBody,
          }],
    };
  });
}
