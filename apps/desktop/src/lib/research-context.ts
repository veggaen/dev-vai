import type { ChatMessage, SearchSourceUI } from '../stores/chatStore.js';

export interface LatestResearchContext {
  assistantIndex: number;
  question: string;
  sources: readonly SearchSourceUI[];
}

export function summarizeResearchPrompt(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 72) return cleaned;
  return `${cleaned.slice(0, 69).trimEnd()}...`;
}

export function resolveLatestResearchContext(
  messages: readonly Pick<ChatMessage, 'role' | 'content' | 'sources' | 'sourcePresentation' | 'turnKind'>[],
): LatestResearchContext | null {
  if (messages.length === 0) return null;

  let latestRenderableIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const role = messages[i]?.role;
    if (role === 'assistant' || role === 'user') {
      latestRenderableIndex = i;
      break;
    }
  }

  if (latestRenderableIndex < 0) return null;

  const latestRenderable = messages[latestRenderableIndex];
  const hasResearchPresentation = latestRenderable.sourcePresentation === 'research'
    || (!latestRenderable.sourcePresentation && latestRenderable.turnKind === 'research');
  if (
    latestRenderable.role !== 'assistant'
    || !latestRenderable.sources
    || latestRenderable.sources.length === 0
    || !hasResearchPresentation
  ) {
    return null;
  }

  let question = 'this answer';
  for (let i = latestRenderableIndex - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      question = summarizeResearchPrompt(messages[i].content);
      break;
    }
  }

  return {
    assistantIndex: latestRenderableIndex,
    question,
    sources: latestRenderable.sources,
  };
}
