import { isProductEngineeringPlanningPrompt, classifyAgentBuildIntent, needsLiveExternalEvidence } from '@vai/core/browser';
import { detectEditIntent } from './intent-detector.js';

export type AutoSandboxMode = 'chat' | 'agent' | 'builder' | 'plan' | 'debate';

export interface ResolveAutoSandboxIntentInput {
  userPrompt: string;
  mode: AutoSandboxMode;
  hasActiveProject: boolean;
  hasPackageJsonOutput: boolean;
}

export interface ResolvedAutoSandboxIntent {
  readonly isBuildMode: boolean;
  readonly explicitStarterRequest: boolean;
  readonly explicitChatBuildRequest: boolean;
  readonly explicitChatEditRequest: boolean;
  readonly canAutoApplyFiles: boolean;
  readonly canAutoApplyDeploy: boolean;
  readonly shouldReportMissingAction: boolean;
  readonly forceFreshProject: boolean;
}

export type SendTimeWorkIntent = 'none' | 'build' | 'edit';

export interface TerminalNoActionStatus {
  readonly step: 'ready' | 'failed';
  readonly message: string;
}

export interface ResolveSendTimeWorkIntentInput {
  userPrompt: string;
  mode: AutoSandboxMode;
  hasActiveProject: boolean;
}

export interface ResolvedSendTimeWorkIntent {
  readonly intent: SendTimeWorkIntent;
  readonly shouldPrimeBuilder: boolean;
  readonly buildStatusMessage?: string;
  readonly requestSystemPrompt?: string;
  /**
   * True when agent mode saw a build-ISH ask but isn't sure the user wants an app scaffolded
   * (e.g. "make this more useful", "improve the timeline"). The composer should ask one short
   * confirm ("answer this, or build an app for it?") instead of silently entering the builder.
   * Never set when {@link shouldPrimeBuilder} is true — a clear build doesn't need confirming.
   */
  readonly needsBuildConfirm?: boolean;
}

/**
 * Agent is the autonomous chat + code mode. Its file output is constrained by
 * the attached-project router, council validation, and reversible sandbox
 * revisions, so stopping again at a diff queue breaks the mode's contract.
 * Builder and Chat still honour the user's explicit review preference.
 */
export function shouldStageGeneratedFilesForReview(input: {
  readonly mode: AutoSandboxMode;
  readonly requireDiffApproval: boolean;
}): boolean {
  return input.requireDiffApproval && input.mode !== 'agent';
}

const BUILD_MODES = new Set<AutoSandboxMode>(['builder', 'agent']);
const EXPLICIT_STARTER_REQUEST = /\b(?:next(?:\.js|\s*js)?|vinext)\b/i;
const EXPLICIT_STARTER_ACTION = /\b(?:install|set\s*up|setup|fresh|from\s+scratch|new|default|plain|vanilla|clean)\b/i;
const EXPLICIT_BUILD_TARGET = /\b(?:app|application|project|site|website|dashboard|tool|mvp|workspace|shell|preview|page|landing|portfolio|gallery|blog)\b/i;
const EXPLICIT_TRY_INTENT = /\b(?:try|preview|open|run|use|test)\b/i;
const FRESH_PROJECT_REQUEST = /\b(?:fresh|from\s+scratch|new\s+app|new\s+project|start\s+over|clean)\b/i;
const CURRENT_APP_REFERENCE = /\b(?:current|existing|active|this|same)\b/i;
const NEW_BUILD_REQUEST = /^(?:now\s+)?(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:make|build|create|generate|design|develop|scaffold|start|prototype)\b/i;
const EXPLICIT_BUILD_REQUEST =
  /^(?:now\s+)?(?:(?:can|could|would|will)\s+you\s+|please\s+|let['â€™]?s\s+)?(?:make|build|create|generate|design|develop|scaffold|start|spin\s*up|launch|ship|prototype)\b|\b(?:i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to)\s+(?:make|build|create|generate|design|develop|scaffold|start|spin\s*up|launch|ship|prototype)\b/i;
const DISCUSSION_OR_RECOMMENDATION_REQUEST = /\b(?:what\s+(?:is|are|would|should|could)|which\s+(?:is|are|would|should)|why\s+(?:is|are|would|should)|(?:how|where)\s+(?:would|should|could|can)\s+(?:i|we|you)|single\s+best|best\s+next|engineering\s+task|recommend|recommendation|advice|strategy|plan|explain|help\s+(?:me|us)\b|go\s+deeper|tell\s+me\s+exactly\s+what\s+you\s+would\s+implement)\b/i;
function isFactualMarketQuery(prompt: string): boolean {
  return needsLiveExternalEvidence(prompt);
}

export function isChatOnlyAssistantTurn(message: {
  readonly turnKind?: 'conversational' | 'research' | 'builder' | 'analysis';
  readonly content: string;
}, fileCount: number): boolean {
  if (fileCount > 0) return false;
  if (!message.turnKind || message.turnKind === 'builder') return false;
  return true;
}

/**
 * Settle builder chrome when a completed answer intentionally contains no
 * actionable file payload. Ordinary Agent conversation returns null, while a
 * build/edit refusal becomes a short, terminal and truthful status.
 */
export function resolveTerminalNoActionStatus(input: {
  readonly workIntent: SendTimeWorkIntent;
  readonly hasActiveProject: boolean;
  readonly assistantContent: string;
}): TerminalNoActionStatus | null {
  if (input.workIntent === 'none') return null;

  const safelyRefused = /(?:did(?:n't| not) apply|left unchanged|no changes (?:were )?applied|blocking issue|below the quality bar)/i
    .test(input.assistantContent);
  if (input.hasActiveProject) {
    return {
      step: 'ready',
      message: safelyRefused
        ? 'No changes applied — Vai stopped safely and the preview is unchanged.'
        : 'Vai finished without a validated code update. The preview is unchanged.',
    };
  }
  return {
    step: 'failed',
    message: safelyRefused
      ? 'No changes applied — Vai stopped safely before creating a preview.'
      : 'Vai finished without producing a runnable update.',
  };
}

export function resolveAutoSandboxIntent(input: ResolveAutoSandboxIntentInput): ResolvedAutoSandboxIntent {
  const { userPrompt, mode, hasActiveProject, hasPackageJsonOutput } = input;
  const isBuildMode = BUILD_MODES.has(mode);
  const productEngineeringPlanning = isProductEngineeringPlanningPrompt(userPrompt);
  const explicitStarterRequest = EXPLICIT_STARTER_REQUEST.test(userPrompt)
    && EXPLICIT_STARTER_ACTION.test(userPrompt)
    && !productEngineeringPlanning;
  const explicitChatBuildRequest = mode === 'chat'
    && !productEngineeringPlanning
    && !DISCUSSION_OR_RECOMMENDATION_REQUEST.test(userPrompt)
    && EXPLICIT_BUILD_REQUEST.test(userPrompt)
    && (EXPLICIT_BUILD_TARGET.test(userPrompt) || EXPLICIT_TRY_INTENT.test(userPrompt));
  // Agent is the auto chat+code home mode. Once a real project is attached, a
  // clear edit belongs to that project and must not fall into the ambiguous
  // "answer or build an app?" confirmation path.
  const explicitChatEditRequest = (mode === 'chat' || mode === 'agent')
    && hasActiveProject
    && !productEngineeringPlanning
    && Boolean(detectEditIntent(userPrompt, {
      hasActiveProject,
      isBuildMode,
    }));
  const freshBuildOnAttachedProject = hasActiveProject
    && NEW_BUILD_REQUEST.test(userPrompt)
    && EXPLICIT_BUILD_TARGET.test(userPrompt)
    && !CURRENT_APP_REFERENCE.test(userPrompt)
    && !explicitChatEditRequest;
  const canAutoApplyFiles = isBuildMode || explicitChatBuildRequest || explicitChatEditRequest;
  const canAutoApplyDeploy = isBuildMode || explicitChatBuildRequest;
  const shouldReportMissingAction = isBuildMode || explicitChatBuildRequest || explicitChatEditRequest;
  const forceFreshProject = hasPackageJsonOutput
    && !explicitChatEditRequest
    && (FRESH_PROJECT_REQUEST.test(userPrompt) || freshBuildOnAttachedProject);

  return {
    isBuildMode,
    explicitStarterRequest,
    explicitChatBuildRequest,
    explicitChatEditRequest,
    canAutoApplyFiles,
    canAutoApplyDeploy,
    shouldReportMissingAction,
    forceFreshProject,
  };
}

export function resolveSendTimeWorkIntent(input: ResolveSendTimeWorkIntentInput): ResolvedSendTimeWorkIntent {
  const { userPrompt, mode, hasActiveProject } = input;
  if (isProductEngineeringPlanningPrompt(userPrompt)) {
    return {
      intent: 'none',
      shouldPrimeBuilder: false,
    };
  }

  if (isFactualMarketQuery(userPrompt)) {
    return {
      intent: 'none',
      shouldPrimeBuilder: false,
    };
  }

  const sandboxIntent = resolveAutoSandboxIntent({
    userPrompt,
    mode,
    hasActiveProject,
    hasPackageJsonOutput: false,
  });

  // Agent mode: grade the build intent so we don't silently scaffold an app on
  // an ambiguous ask. A recognized attached-project edit is not ambiguous.
  const agentBuildIntent = mode === 'agent' ? classifyAgentBuildIntent(userPrompt) : 'answer';
  const agentNewBuildRequest = mode === 'agent' && agentBuildIntent === 'build';
  if (mode === 'agent' && agentBuildIntent === 'ambiguous' && !sandboxIntent.explicitChatEditRequest) {
    return {
      intent: 'none',
      shouldPrimeBuilder: false,
      needsBuildConfirm: true,
    };
  }
  const builderNewBuildRequest = mode === 'builder'
    && NEW_BUILD_REQUEST.test(userPrompt)
    && EXPLICIT_BUILD_TARGET.test(userPrompt);

  const shouldPrimeBuilder = sandboxIntent.explicitStarterRequest
    || builderNewBuildRequest
    || agentNewBuildRequest
    || sandboxIntent.explicitChatBuildRequest
    || sandboxIntent.explicitChatEditRequest;
  const stickyBuilderEdit = mode === 'builder'
    && hasActiveProject
    && !builderNewBuildRequest
    && !sandboxIntent.explicitStarterRequest;
  const freshBuildOnAttachedProject = hasActiveProject
    && builderNewBuildRequest
    && EXPLICIT_BUILD_TARGET.test(userPrompt)
    && !CURRENT_APP_REFERENCE.test(userPrompt)
    && !sandboxIntent.explicitChatEditRequest;

  if (!shouldPrimeBuilder && !stickyBuilderEdit) {
    return {
      intent: 'none',
      shouldPrimeBuilder: false,
    };
  }

  if (sandboxIntent.explicitChatEditRequest || stickyBuilderEdit) {
    return {
      intent: 'edit',
      shouldPrimeBuilder: true,
      buildStatusMessage: 'Preparing targeted updates for the current app...',
      requestSystemPrompt: [
        stickyBuilderEdit
          ? 'This user message continues an active builder session with a live app already attached.'
          : 'This user message is an execute-now request to edit the active app.',
        'Treat this turn like a builder execution turn, not a discussion turn.',
        'Do not output research notes, grounding notes, citations, or conceptual advice unless they are strictly required to unblock the edit.',
        'Answer briefly and emit only the changed files using title="path/to/file" code blocks.',
        'Keep the existing app structure and current preview working unless the user explicitly asked for a fresh rebuild.',
        'Do not re-emit unchanged files.',
        'If you are truly blocked, ask one short blocking question instead of emitting speculative files.',
      ].join(' '),
    };
  }

  return {
    intent: 'build',
    shouldPrimeBuilder: true,
    buildStatusMessage: sandboxIntent.explicitStarterRequest
      ? 'Preparing a clean starter preview...'
      : freshBuildOnAttachedProject
        ? 'Preparing a fresh runnable preview...'
      : hasActiveProject
        ? 'Preparing a runnable update for the current app...'
        : 'Preparing a runnable preview from this request...',
    requestSystemPrompt: [
      'This user message is an execute-now build request, not a discussion request.',
      'Treat this turn like a