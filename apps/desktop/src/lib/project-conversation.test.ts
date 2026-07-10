import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@vai/api-types/responses';
import { pickLatestProjectConversation } from './project-conversation.js';

function conversation(
  id: string,
  sandboxProjectId: string | null,
  updatedAt: string,
): ConversationSummary {
  return {
    id,
    title: id,
    modelId: 'vai:v0',
    sandboxProjectId,
    mode: 'agent',
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('pickLatestProjectConversation', () => {
  it('resumes the newest matching project chat regardless of list order', () => {
    const conversations = [
      conversation('old-failed-turn', 'mpm', '2026-07-08T12:00:00.000Z'),
      conversation('other-project', 'lawn', '2026-07-10T12:00:00.000Z'),
      conversation('latest-mpm-turn', 'mpm', '2026-07-10T09:30:00.000Z'),
    ];

    expect(pickLatestProjectConversation(conversations, 'mpm')?.id).toBe('latest-mpm-turn');
  });

  it('returns null when the project has no linked chat', () => {
    expect(pickLatestProjectConversation([
      conversation('other-project', 'lawn', '2026-07-10T12:00:00.000Z'),
    ], 'mpm')).toBeNull();
  });

  it('keeps a deterministic first match when timestamps are invalid or tied', () => {
    const conversations = [
      conversation('first', 'mpm', 'invalid'),
      conversation('second', 'mpm', 'invalid'),
    ];

    expect(pickLatestProjectConversation(conversations, 'mpm')?.id).toBe('first');
  });
});
