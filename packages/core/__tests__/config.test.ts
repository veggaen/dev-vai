import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/index.js';

describe('loadConfig', () => {
  it('enables chat prompt rewrite by default with all conversation modes', () => {
    const config = loadConfig({});

    expect(config.chatPromptRewrite.enabled).toBe(true);
    expect(config.chatPromptRewrite.strategy).toBe('system-message');
    expect(config.chatPromptRewrite.profile).toBe('standard');
    expect(config.chatPromptRewrite.responseDepth).toBe('standard');
    expect(config.chatPromptRewrite.applyToModes).toEqual(['chat', 'agent', 'builder', 'plan', 'debate']);
    expect(config.chatPromptRewrite.rules.disambiguateRepoContext).toBe(true);
  });

  it('parses chat prompt rewrite env overrides conservatively', () => {
    const config = loadConfig({
      VAI_ENABLE_CHAT_PROMPT_REWRITE: 'false',
      VAI_CHAT_PROMPT_REWRITE_MODES: 'chat,plan,invalid-mode',
      VAI_CHAT_PROMPT_REWRITE_MAX_USER_MESSAGE_CHARS: '1500',
      VAI_CHAT_PROMPT_REWRITE_PROFILE: 'strict',
      VAI_CHAT_PROMPT_REWRITE_RESPONSE_DEPTH: 'deep-design-memo',
      VAI_CHAT_PROMPT_REWRITE_RULE_ANSWER_ENGINE: 'false',
    });

    expect(config.chatPromptRewrite.enabled).toBe(false);
    expect(config.chatPromptRewrite.profile).toBe('strict');
    expect(config.chatPromptRewrite.responseDepth).toBe('deep-design-memo');
    expect(config.chatPromptRewrite.applyToModes).toEqual(['chat', 'plan']);
    expect(config.chatPromptRewrite.maxUserMessageChars).toBe(1500);
    expect(config.chatPromptRewrite.rules.groundAnswerEngine).toBe(false);
  });

  it('reads VAI_OWNER_EMAIL', () => {
    expect(loadConfig({}).ownerEmail).toBe('v3ggat@gmail.com');
    expect(loadConfig({ VAI_OWNER_EMAIL: 'ops@example.com' }).ownerEmail).toBe('ops@example.com');
  });
});