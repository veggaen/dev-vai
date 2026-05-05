import type {
  GroundedBuildBriefUI,
  SearchSourceUI,
  SourcePresentationUI,
  TurnKindUI,
} from '../stores/chatStore.js';

export function hasStructuredSources(sources?: readonly SearchSourceUI[] | null): boolean {
  return Boolean(sources && sources.length > 0);
}

export function shouldUseResearchMessageLayout(input: {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly sources?: readonly SearchSourceUI[] | null;
  readonly sourcePresentation?: SourcePresentationUI;
  readonly turnKind?: TurnKindUI;
  readonly groundedBuildBrief?: GroundedBuildBriefUI | null;
}): boolean {
  if (input.role === 'user') return false;
  if (input.groundedBuildBrief) return true;

  if (!hasStructuredSources(input.sources)) {
    return false;
  }

  if (input.sourcePresentation === 'supporting') {
    return false;
  }

  return input.sourcePresentation === 'research'
    || (!input.sourcePresentation && input.turnKind === 'research');
}
