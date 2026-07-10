import { describe, expect, it } from 'vitest';
import {
  assistantMessageIds,
  selectNextAutoSandboxMessage,
  shouldMarkConversationHistoryProcessed,
} from './auto-sandbox-message-selection.js';
import type { ChatMessage } from '../stores/chatStore.js';

function assistant(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content };
}

describe('selectNextAutoSandboxMessage', () => {
  it('prefers actionable file output over newer project update notes', () => {
    const selection = selectNextAutoSandboxMessage([
      assistant('code', '```tsx title="src/App.tsx"\nexport default function App() { return <div/> }\n```'),
      assistant('artifact', 'Project update: Applied 1 file.\n\n[vai-artifact]\n{"kind":"update"}\n[/vai-artifact]'),
    ], new Set());

    expect(selection.candidate?.id).toBe('code');
    expect(selection.skippedIds).toEqual(['artifact']);
  });

  it('returns the latest assistant message when nothing actionable exists', () => {
    const selection = selectNextAutoSandboxMessage([
      assistant('a', 'Thinking...'),
      assistant('b', 'No runnable update yet.'),
    ], new Set());

    expect(selection.candidate?.id).toBe('b');
    expect(selection.skippedIds).toEqual(['a']);
  });
});

describe('conversation history replay guards', () => {
  it('marks loaded assistant messages as already processed after selecting a settled chat', () => {
    const messages = [
      { id: 'user-1', role: 'user', content: 'Change the hero copy.' } as ChatMessage,
      assistant('assistant-1', 'Applied edit. {{replace:%7B%7D}}'),
      assistant('project-update', 'Project update: Applied one exact text edit.'),
    ];

    expect(shouldMarkConversationHistoryProcessed({
      activeConversationId: 'chat-1',
      isStreaming: false,
      streamingConversationId: null,
      messages,
    })).toBe(true);
    expect(assistantMessageIds(messages)).toEqual(['assistant-1', 'project-update']);
  });

  it('marks history even while another conversation is streaming', () => {
    expect(shouldMarkConversationHistoryProcessed({
      activeConversationId: 'opened-chat',
      isStreaming: true,
      streamingConversationId: 'other-chat',
      messages: [assistant('assistant-1', 'Old exact edit marker')],
    })).toBe(true);
  });

  it('does not mark the selected conversation while its own assistant turn is streaming', () => {
    expect(shouldMarkConversationHistoryProcessed({
      activeConversationId: 'chat-1',
      isStreaming: true,
      streamingConversationId: 'chat-1',
      messages: [assistant('temp-1-assistant', 'Still writing files...')],
    })).toBe(false);
  });

  it('does not mark a conversation-resolved temp assistant as history while streaming', () => {
    expect(shouldMarkConversationHistoryProcessed({
      activeConversationId: 'server-chat-id',
      isStreaming: true,
      streamingConversationId: 'local-chat-id',
      messages: [assistant('temp-1-assistant', 'Final answer is still arriving...')],
    })).toBe(false);
  });
});
