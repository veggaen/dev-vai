export interface GroundedExecutionBrief {
  readonly intent: 'build' | 'edit';
  readonly focusLabel: string;
  readonly summary: string;
  readonly recommendation: string;
  readonly nextStep: string;
  readonly reasons: readonly string[];
  readonly sourceDomains: readonly string[];
  readonly sourceCount: number;
  readonly confidence: number;
}

export interface GroundedExecutionIntentContext {
  readonly isBuildMode: boolean;
  readonly explicitStarterRequest: boolean;
  readonly shouldReportMissingAction: boolean;
}

export interface GroundedExecutionRepairPlan {
  readonly buildStatusMessage: string;
  readonly toastMessage: string;
  readonly repairPrompt: string;
  readonly systemPrompt: string;
}

function renderDomains(domains: readonly string[]): string {
  if (domains.length === 0) return 'No source domains recorded';
  return domains.join(', ');
}

function renderReasons(reasons: readonly string[]): string {
  if (reasons.length === 0) return '- No additional reasoning captured';
  return reasons.map((reason) => `- ${reason}`).join('\n');
}

export function shouldTriggerGroundedExecutionRepair(input: {
  groundedBrief?: GroundedExecutionBrief;
  looksIncomplete: boolean;
  sandboxIntent: GroundedExecutionIntentContext;
}): boolean {
  const { groundedBrief, looksIncomplete, sandboxIntent } = input;
  if (!groundedBrief || looksIncomplete) return false;
  return sandboxIntent.isBuildMode || sandboxIntent.shouldReportMissingAction;
}

export function buildGroundedExecutionRepairPlan(input: {
  groundedBrief: GroundedExecutionBrief;
  sandboxIntent: GroundedExecutionIntentContext;
  hasActiveProject: boolean;
  attempt: number;
  maxAttempts: number;
  userPrompt: string;
}): GroundedExecutionRepairPlan {
  const { groundedBrief, sandboxIntent, hasActiveProject, attempt, maxAttempts, userPrompt } = input;
  const preferChangedFiles = hasActiveProject || groundedBrief.intent === 'edit';
  const outputDirective = preferChangedFiles
    ? 'Output only the changed files using title="path/to/file" code blocks and keep the current preview working.'
    : sandboxIntent.explicitStarterRequest
      ? 'Emit the fastest honest runnable starter path now, including sandbox template or deploy markers when that is the cleanest way to launch the preview.'
      : 'Emit a complete runnable file set using title="path/to/file" code blocks. Use sandbox starter or deploy markers only if that is the fastest honest execution path.';

  const repairPrompt = [
    `The previous response produced a grounded build brief but no runnable output (attempt ${attempt}/${maxAttempts}).`,
    '',
    'Original user request:',
    userPrompt.trim() || 'No original prompt captured.',
    '',
    'Grounded build brief:',
    `- Intent: ${groundedBrief.intent}`,
    `- Focus: ${groundedBrief.focusLabel}`,
    `- Summary: ${groundedBrief.summary}`,
    `- Recommendation: ${groundedBrief.recommendation}`,
    `- Next step: ${groundedBrief.nextStep}`,
    `- Confidence: ${Math.round(groundedBrief.confidence * 100)}%`,
    `- Supporting domains: ${renderDomains(groundedBrief.sourceDomains)}`,
    '- Reasons:',
    renderReasons(groundedBrief.reasons),
    '',
    'Convert that brief into execution now.',
    outputDirective,
    'Do not restate the brief. Do not explain the plan again. Emit only runnable output.',
  ].join('\n');

  const systemPrompt = [
    'SYSTEM: This is an automatic execution recovery request.',
    'The previous answer produced grounded research but failed to emit runnable output.',
    'Respond with execution output only.',
    preferChangedFiles
      ? 'Emit only changed files using title="path/to/file" code blocks.'
      : 'Emit complete runnable files or honest starter markers only.',
    'Do not repeat the brief or add narrative explanation.',
  ].join(' ');

  return {
    buildStatusMessage: `Execution recovery ${attempt}/${maxAttempts}: turning grounded research into runnable output...`,
    toastMessage: `Execution recovery ${attempt}/${maxAttempts}: asking Vai to emit runnable output...`,
    repairPrompt,
    systemPrompt,
  };
}