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
}

const BUILD_MODES = new Set<AutoSandboxMode>(['builder', 'agent']);
const EXPLICIT_STARTER_REQUEST = /\b(?:next(?:\.js|\s*js)?|vinext)\b/i;
const EXPLICIT_STARTER_ACTION = /\b(?:install|set\s*up|setup|fresh|from\s+scratch|new|default|plain|vanilla|clean)\b/i;
const EXPLICIT_BUILD_ACTION = /\b(?:build|create|make|start|spin\s*up|launch|scaffold|generate|ship)\b/i;
const EXPLICIT_BUILD_TARGET = /\b(?:app|application|project|site|website|dashboard|tool|mvp|workspace|shell|preview|page|landing|portfolio|gallery|blog)\b/i;
const EXPLICIT_TRY_INTENT = /\b(?:try|preview|open|run|use|test)\b/i;
const FRESH_PROJECT_REQUEST = /\b(?:fresh|from\s+scratch|new\s+app|new\s+project|start\s+over|clean)\b/i;
const CURRENT_APP_REFERENCE = /\b(?:current|existing|active|this|same)\b/i;
const NEW_BUILD_REQUEST = /^(?:now\s+)?(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:make|build|create|generate|design|develop|scaffold|start)\b/i;

export function resolveAutoSandboxIntent(input: ResolveAutoSandboxIntentInput): ResolvedAutoSandboxIntent {
  const { userPrompt, mode, hasActiveProject, hasPackageJsonOutput } = input;
  const isBuildMode = BUILD_MODES.has(mode);
  const explicitStarterRequest = EXPLICIT_STARTER_REQUEST.test(userPrompt)
    && EXPLICIT_STARTER_ACTION.test(userPrompt);
  const explicitChatBuildRequest = mode === 'chat'
    && EXPLICIT_BUILD_ACTION.test(userPrompt)
    && (EXPLICIT_BUILD_TARGET.test(userPrompt) || EXPLICIT_TRY_INTENT.test(userPrompt));
  const explicitChatEditRequest = mode === 'chat' && Boolean(detectEditIntent(userPrompt, {
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
  const builderNewBuildRequest = mode === 'builder'
    && NEW_BUILD_REQUEST.test(userPrompt)
    && EXPLICIT_BUILD_TARGET.test(userPrompt);
  const sandboxIntent = resolveAutoSandboxIntent({
    userPrompt,
    mode,
    hasActiveProject,
    hasPackageJsonOutput: false,
  });

  const shouldPrimeBuilder = sandboxIntent.explicitStarterRequest
    || builderNewBuildRequest
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
      'Treat this turn like a builder execution turn while keeping the normal chat UX.',
      'Do not output research notes, grounding notes, citations, or architecture advice unless they are strictly required to unblock the build.',
      sandboxIntent.explicitStarterRequest
        ? 'Prefer the cleanest starter path, including sandbox template markers when that is the fastest honest way to launch the preview.'
        : freshBuildOnAttachedProject
          ? 'The user phrased this as a fresh build request. Do not mutate the currently attached app unless they explicitly ask to reuse it.'
        : 'Answer briefly and then emit the files and sandbox action markers needed to create or update the runnable preview in this turn.',
      'If you emit files for a new app, include a complete runnable file set with title="path/to/file" code blocks and include package.json.',
      freshBuildOnAttachedProject
        ? 'Prefer a fresh runnable app for this turn instead of iterating the attached preview.'
        : 'If an active preview exists, continue that app unless the user explicitly asked for a fresh rebuild.',
      'If you are truly blocked, ask one short blocking question instead of emitting speculative files.',
    ].join(' '),
  };
}