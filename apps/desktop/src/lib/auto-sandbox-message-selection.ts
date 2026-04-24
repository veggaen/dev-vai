import type { ChatMessage } from '../stores/chatStore.js';
import { extractDeployActions, extractTemplateActions } from './sandbox-actions.js';
import { extractFilesFromMarkdown } from './file-extractor.js';

export interface AutoSandboxMessageSelection {
  candidate: ChatMessage | null;
  skippedIds: string[];
}

export function isProjectUpdateMessage(message: ChatMessage): boolean {
  const trimmed = message.content.trim();
  return trimmed.startsWith('Project update:') || trimmed.includes('[vai-artifact]');
}

export function isActionableAssistantMessage(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false;
  if (!message.content.trim()) return false;
  if (isProjectUpdateMessage(message)) return false;
  if (extractFilesFromMarkdown(message.content).length > 0) return true;
  if (extractTemplateActions(message.content).length > 0) return true;
  if (extractDeployActions(message.content).length > 0) return true;
  return Boolean(message.groundedBuildBrief);
}

export function selectNextAutoSandboxMessage(
  messages: readonly ChatMessage[],
  processedIds: ReadonlySet<string>,
): AutoSandboxMessageSelection {
  const pendingAssistants = messages.filter((message) => (
    message.role === 'assistant'
    && message.content.trim()
    && !processedIds.has(message.id)
  ));

  if (pendingAssistants.length === 0) {
    return { candidate: null, skippedIds: [] };
  }

  const actionable = [...pendingAssistants].reverse().find(isActionableAssistantMessage);
  if (actionable) {
    const actionableIndex = pendingAssistants.findIndex((message) => message.id === actionable.id);
    const skippedIds = pendingAssistants
      .slice(actionableIndex + 1)
      .map((message) => message.id);
    return { candidate: actionable, skippedIds };
  }

  const latest = pendingAssistants[pendingAssistants.length - 1] ?? null;
  return {
    candidate: latest,
    skippedIds: latest ? pendingAssistants.slice(0, -1).map((message) => message.id) : [],
  };
}
