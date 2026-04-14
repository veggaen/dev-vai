import { describe, expect, it } from 'vitest';
import { getDeepDesignMemoHeadings } from '../src/chat/deep-design-memo-schemas.js';
import { rewriteChatPrompt } from '../src/chat/prompt-rewrite.js';

const deepMemoConfig = {
  profile: 'strict',
  responseDepth: 'deep-design-memo',
} as const;

function getSystemMessage(userContent: string): string {
  const result = rewriteChatPrompt({
    userContent,
    mode: 'chat',
    config: deepMemoConfig,
  });

  expect(result.applied).toBe(true);
  expect(result.systemMessage).toBeDefined();
  return result.systemMessage ?? '';
}

describe('rewriteChatPrompt', () => {
  it('uses shared answer-engine deep memo headings for layered answer engine prompts', () => {
    const systemMessage = getSystemMessage(
      'Design a layered answer engine for developer research. Cover retrieval, ranking, synthesis, verification, guardrails, failure modes, and rollout.',
    );

    expect(systemMessage).toContain(
      getDeepDesignMemoHeadings('answer-engine').join(', '),
    );
    expect(systemMessage).not.toContain(
      getDeepDesignMemoHeadings('repo-native-architecture').join(', '),
    );
  });

  it('uses shared repo-native architecture deep memo headings for context engine prompts', () => {
    const systemMessage = getSystemMessage(
      'Design a repo-native context engine for a large monorepo. Cover signals, retrieval loop, working set, guardrails, metrics, rollout, and failure modes.',
    );

    expect(systemMessage).toContain(
      getDeepDesignMemoHeadings('repo-native-architecture').join(', '),
    );
    expect(systemMessage).not.toContain(
      getDeepDesignMemoHeadings('answer-engine').join(', '),
    );
  });
});