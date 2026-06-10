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
});
