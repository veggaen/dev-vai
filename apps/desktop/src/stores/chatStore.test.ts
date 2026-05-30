import { describe, expect, it } from 'vitest';
import { resolveConversationSandboxProjectIdOption } from './chatStore.js';

describe('resolveConversationSandboxProjectIdOption', () => {
  it('uses the active sandbox when no explicit option is provided', () => {
    expect(resolveConversationSandboxProjectIdOption(undefined, 'active-sandbox')).toBe('active-sandbox');
  });

  it('preserves an explicit sandbox id option', () => {
    expect(resolveConversationSandboxProjectIdOption({ sandboxProjectId: 'chosen-sandbox' }, 'active-sandbox')).toBe('chosen-sandbox');
  });

  it('preserves explicit null as a clean conversation request', () => {
    expect(resolveConversationSandboxProjectIdOption({ sandboxProjectId: null }, 'active-sandbox')).toBeNull();
  });
});
