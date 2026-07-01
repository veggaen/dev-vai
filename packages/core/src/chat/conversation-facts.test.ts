import { describe, expect, it } from 'vitest';
import { extractConversationFacts, tryHandleFactRecall } from './conversation-facts.js';

describe('conversation facts', () => {
  it('does not mistake casual lowercase go for the Go language', () => {
    const history = [
      { role: 'user' as const, content: 'project Mica uses TypeScript and SQLite. remember that for later.' },
      { role: 'user' as const, content: 'quick detour before we go back to Mica, what does idempotent mean?' },
    ];
    expect(extractConversationFacts(history).stacks).toEqual(expect.arrayContaining(['TypeScript', 'SQLite']));
    expect(extractConversationFacts(history).stacks).not.toContain('Go');
  });

  it('recalls a named project stack from natural delayed-recall wording', () => {
    const history = [
      { role: 'user' as const, content: 'project Quartz uses Python and Redis. remember that for later.' },
    ];
    const reply = tryHandleFactRecall('what stack did i say project Quartz uses again?', history)?.reply ?? '';
    expect(reply).toContain('**Quartz**');
    expect(reply).toContain('Python');
    expect(reply).toContain('Redis');
  });

  it('keeps matching an existing project name literally when attaching later stacks', () => {
    const history = [
      { role: 'user' as const, content: 'project Brew&Co uses React. remember that.' },
      { role: 'user' as const, content: 'For Brew&Co, switch the storage to SQLite.' },
    ];
    const reply = tryHandleFactRecall('what stack did i say project Brew&Co uses?', history)?.reply ?? '';
    expect(reply).toContain('**Brew&Co**');
    expect(reply).toContain('React');
    expect(reply).toContain('SQLite');
  });

  it('defers a stack question about an external URL to the repo handler (no project hijack)', () => {
    // Regression for the hono trace: "what stack does <github url> use?" was answered from
    // remembered project facts ("you said you're using Hono") instead of reading the repo.
    const history = [
      { role: 'user' as const, content: 'project Hono uses TypeScript. remember that.' },
    ];
    expect(tryHandleFactRecall('What stack does https://github.com/honojs/hono use?', history)).toBeNull();
    // Plain (no URL) recall still works.
    expect(tryHandleFactRecall('what stack does my project use?', history)?.reply).toContain('Hono');
  });
});
