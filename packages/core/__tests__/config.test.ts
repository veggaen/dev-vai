import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/index.js';
import { decideVaiFallback, pickFallbackModelId } from '../src/chat/vai-fallback.js';

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

  it('reads VAI_ADMIN_EMAILS as a server-owned role allow-list', () => {
    expect(loadConfig({}).adminEmails).toEqual([]);
    expect(loadConfig({ VAI_ADMIN_EMAILS: 'admin@example.com, support@example.com' }).adminEmails)
      .toEqual(['admin@example.com', 'support@example.com']);
  });
});

describe('local-first generative fallback (Master.md §12.5)', () => {
  it('keeps the historical single-entry chain when nothing generative is enabled', () => {
    expect(loadConfig({}).fallbackChain.models).toEqual(['vai:v0']);
  });

  it('auto-joins the local open-weight model to the escalation chain when enabled — no external opt-in flag', () => {
    const config = loadConfig({
      LOCAL_MODEL_URL: 'http://localhost:11434',
      LOCAL_MODEL: 'qwen2.5-coder:7b',
    });
    // local escalates first, vai:v0 stays as the terminal deterministic safety net
    expect(config.fallbackChain.models).toEqual(['local:qwen2.5-coder:7b', 'vai:v0']);
  });

  it('prefers the local model over cloud accelerators when both are enabled (local-first)', () => {
    const config = loadConfig({
      LOCAL_MODEL_URL: 'http://localhost:11434',
      LOCAL_MODEL: 'llama3.1:8b',
      VAI_ENABLE_EXTERNAL_CHAT_FALLBACK: 'true',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    expect(config.fallbackChain.models[0]).toBe('local:llama3.1:8b');
    expect(config.fallbackChain.models).toContain('vai:v0');

    // pickFallbackModelId surfaces the local model as the escalation target
    const picked = pickFallbackModelId(
      config.fallbackChain.models,
      () => true,
      { content: 'is swallowing errors bad practice?', mode: 'chat' },
    );
    expect(picked).toBe('local:llama3.1:8b');
  });

  it('only escalates when the deterministic core declines or is low-confidence', () => {
    // Confident curated/idiom answer → no escalation (curated always wins).
    expect(decideVaiFallback({ text: 'A `Set` keeps only distinct values.', confidence: 0.9 }).shouldFallback)
      .toBe(false);
    // Canonical decline → escalate to the generative module.
    expect(decideVaiFallback({ text: "That isn't in my knowledge yet." }).shouldFallback).toBe(true);
    // Low confidence → escalate.
    expect(decideVaiFallback({ text: 'Maybe.', confidence: 0.2 }).shouldFallback).toBe(true);
  });
});
