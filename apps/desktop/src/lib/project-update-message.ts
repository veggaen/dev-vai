import type { ChatMessage } from '../stores/chatStore.js';

export function mergeProjectUpdateMessage(existing: ChatMessage, replacement: ChatMessage): ChatMessage {
  return {
    ...existing,
    ...replacement,
  };
}