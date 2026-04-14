export interface GroundedBuildBriefActionInput {
  readonly intent: 'build' | 'edit';
  readonly focusLabel: string;
  readonly summary: string;
  readonly recommendation: string;
  readonly nextStep: string;
  readonly reasons: readonly string[];
  readonly sourceDomains: readonly string[];
  readonly confidence: number;
}

export function getGroundedBuildBriefActionLabel(brief: GroundedBuildBriefActionInput): string {
  return brief.intent === 'edit' ? 'Apply to current app' : 'Build first slice';
}

export function buildGroundedBuildBriefExecutionPrompt(brief: GroundedBuildBriefActionInput): string {
  const reasons = brief.reasons.length > 0
    ? brief.reasons.map((reason) => `- ${reason}`).join('\n')
    : '- Follow the grounded brief without expanding scope.';
  const domains = brief.sourceDomains.length > 0
    ? brief.sourceDomains.join(', ')
    : 'No source domains recorded';
  const executionLine = brief.intent === 'edit'
    ? 'Update the current app if one exists and emit only the changed files using title="path/to/file" code blocks.'
    : 'Create the first grounded slice now. Continue the current preview if one exists; otherwise emit the runnable files or the fastest honest starter action needed to launch it.';

  return [
    'Use the grounded build brief above as the execution contract.',
    `Focus: ${brief.focusLabel}`,
    `Summary: ${brief.summary}`,
    `Recommendation: ${brief.recommendation}`,
    `Next step: ${brief.nextStep}`,
    `Confidence: ${Math.round(brief.confidence * 100)}%`,
    `Supporting domains: ${domains}`,
    'Reasons:',
    reasons,
    '',
    'Now convert that into runnable output.',
    executionLine,
    'Do not restate the brief. Do not explain the plan. Emit runnable output only.',
  ].join('\n');
}