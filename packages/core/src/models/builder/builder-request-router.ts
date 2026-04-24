export type BuilderRequestRouteKind =
  | 'fresh-build-empty-sandbox'
  | 'active-sandbox-edit'
  | 'active-project-iteration'
  | 'active-sandbox-needs-context'
  | 'non-builder';

export interface BuilderRequestRouteInput {
  readonly input: string;
  readonly activeMode: string;
  readonly hasActiveSandboxContext: boolean;
  readonly snapshotPaths: readonly string[];
}

export interface BuilderRequestRoute {
  readonly kind: BuilderRequestRouteKind;
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly shouldGenerateFreshBuild: boolean;
  readonly shouldPatchActiveSandbox: boolean;
}

function normalize(input: string): string {
  return input.toLowerCase();
}

export function isFreshBuildRequestForEmptySandbox(input: string, lower = normalize(input), snapshotPaths: readonly string[] = []): boolean {
  if (snapshotPaths.length > 0) return false;

  const hasFreshBuildLanguage = /^(?:now\s+)?(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:build|create|make|design|generate|develop|scaffold|start)\b/i.test(input)
    || /\b(?:build|create|make|design|generate|develop|scaffold|start)\s+(?:the\s+)?(?:first\s+)?(?:runnable\s+)?(?:version|app|application|project|site|website|web\s*site|landing\s*page|preview)\b/i.test(lower)
    || /\bfirst\s+runnable\s+version\b/i.test(lower)
    || /\bpreview\s+must\s+(?:visibly\s+)?include\b/i.test(lower)
    || /\bseed\s+mock\s+data\b/i.test(lower)
    || /\bdo\s+not\s+use\s+(?:a\s+)?(?:starter|template|starter\s+template|generic\s+scaffold)\b/i.test(lower);
  const freshBuildTarget = /\b(?:website|web\s*site|app|application|project|portfolio|gallery|landing\s*page|homepage|site|store|shop|dashboard|blog|workspace|platform|preview|page|version)\b/i.test(lower);
  const trueCurrentAppReference = /\b(?:current|existing|active|same|this)\s+(?:app|project|preview|page|site|workspace|landing\s*page)\b/i.test(lower)
    || /\bkeep\s+(?:the\s+)?(?:same|current|existing|active)\b/i.test(lower)
    || /\b(?:reuse|iterate\s+on)\s+(?:the\s+)?(?:current|existing|active|same|this)\b/i.test(lower)
    || /\bdo\s+not\s+rebuild\s+from\s+scratch\b/i.test(lower);

  return hasFreshBuildLanguage && freshBuildTarget && !trueCurrentAppReference;
}

export function routeBuilderRequest(input: BuilderRequestRouteInput): BuilderRequestRoute {
  const lower = normalize(input.input);
  if (input.activeMode !== 'builder' || !input.hasActiveSandboxContext) {
    return {
      kind: 'non-builder',
      confidence: 0.98,
      reasons: ['No active builder sandbox context.'],
      shouldGenerateFreshBuild: false,
      shouldPatchActiveSandbox: false,
    };
  }

  if (isFreshBuildRequestForEmptySandbox(input.input, lower, input.snapshotPaths)) {
    return {
      kind: 'fresh-build-empty-sandbox',
      confidence: 0.94,
      reasons: ['The prompt asks for a first runnable build and the sandbox has no file snapshots yet.'],
      shouldGenerateFreshBuild: true,
      shouldPatchActiveSandbox: false,
    };
  }

  const wantsVisualEdit = /\b(?:edit|update|change|improve|polish|refine|make|turn|switch|rename|add|style|animate|include|insert)\b/i.test(lower);
  const visualSignals = [
    /\blanding\s+page\b/i,
    /\bhero\b/i,
    /\bheading\b/i,
    /\bheadline\b/i,
    /\bcta\b/i,
    /\bbutton\b/i,
    /\bbackground\b/i,
    /\bcolor\b/i,
    /\bpalette\b/i,
    /\btheme\b/i,
    /\bmotion\b/i,
    /\banimation\b/i,
    /\banimate\b/i,
    /\bkinetic\b/i,
    /\btransition\b/i,
    /\bentrance\b/i,
    /\breveal\b/i,
  ].filter((pattern) => pattern.test(lower)).length;

  if (wantsVisualEdit && visualSignals >= 2) {
    if (input.snapshotPaths.length > 0) {
      return {
        kind: 'active-sandbox-edit',
        confidence: 0.88,
        reasons: ['The prompt is a visual/style iteration and active file snapshots are available.'],
        shouldGenerateFreshBuild: false,
        shouldPatchActiveSandbox: true,
      };
    }
    return {
      kind: 'active-sandbox-needs-context',
      confidence: 0.73,
      reasons: ['The prompt looks like an edit, but no file snapshots are available yet.'],
      shouldGenerateFreshBuild: false,
      shouldPatchActiveSandbox: false,
    };
  }

  const wantsProjectIteration = /\b(?:add|change|modify|update|convert|switch|remove|delete|include|insert|replace|refactor|fix|use|rename|polish|improve|refine|tighten)\b/i.test(lower)
    || /\b(?:auth(?:entication)?|login|sign[\s-]?in|session|middleware|filters?|dashboard|chart|date range|traffic sources)\b/i.test(lower);

  if (wantsProjectIteration) {
    return {
      kind: input.snapshotPaths.length > 0 ? 'active-project-iteration' : 'active-sandbox-needs-context',
      confidence: input.snapshotPaths.length > 0 ? 0.82 : 0.68,
      reasons: [input.snapshotPaths.length > 0 ? 'The prompt asks to iterate on an active project.' : 'The prompt asks to iterate, but the active project has no file snapshots yet.'],
      shouldGenerateFreshBuild: false,
      shouldPatchActiveSandbox: input.snapshotPaths.length > 0,
    };
  }

  return {
    kind: 'non-builder',
    confidence: 0.54,
    reasons: ['No strong fresh-build or active-edit signal.'],
    shouldGenerateFreshBuild: false,
    shouldPatchActiveSandbox: false,
  };
}
