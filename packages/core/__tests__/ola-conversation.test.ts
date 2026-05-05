/**
 * Ola conversation — acceptance spec.
 *
 * Captures the second brutal live conversation V3gga showed (2026-04-28).
 * Five turns, five embarrassing failures.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

describe('Ola conversation — five-turn acceptance', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
  });

  it('Q1: nickname + future-ask prelude must acknowledge the nickname, not just say "Yes."', async () => {
    const input = 'Hello, I am telling you this now as a test and usualy my nickname is ola and I am going to ask you to tell me my name + the name of the current us president by full name, can you do this please?';
    const r = await engine.chat({ messages: [{ role: 'user', content: input }] });
    const content = r.message.content;
    // Must NOT be a one-word affirmation.
    expect(content.trim().length).toBeGreaterThan(10);
    expect(content.trim()).not.toMatch(/^yes[.!]?$/i);
    // Should reference the nickname OR offer to answer.
    const acknowledgesNickname = /ola/i.test(content);
    const offersToAnswer = /(?:ask|go\s+ahead|sure|of\s+course|happy\s+to)/i.test(content);
    expect(acknowledgesNickname || offersToAnswer).toBe(true);
  });

  it('Q2: "tell me then?" follow-up must NOT dump unrelated web search results', async () => {
    const history = [
      { role: 'user' as const, content: 'usualy my nickname is ola and I am going to ask you to tell me my name' },
      { role: 'assistant' as const, content: 'Got it, Ola — go ahead and ask.' },
    ];
    const r = await engine.chat({ messages: [...history, { role: 'user', content: 'tell me then?' }] });
    const content = r.message.content.toLowerCase();
    // Hard fail signatures from the screenshot: scraped iOS toolkit content.
    expect(content).not.toMatch(/freshos|nsobject|uilabel|ios\s+toolset/);
    expect(content).not.toMatch(/a\s+pain\s+to\s+maintain/i);
    // Should be conversational / contextual / short.
    expect(content.length).toBeLessThan(600);
  });

  it('Q4: "what day is tomorrow" must answer tomorrow, not today', async () => {
    const r = await engine.chat({ messages: [{ role: 'user', content: 'what day is it tomorrow?' }] });
    const content = r.message.content;
    // The actual tomorrow's date is dynamic; assert it's labeled "tomorrow" and
    // NOT the literal "Today is" prefix.
    expect(content).toMatch(/tomorrow/i);
    expect(content).not.toMatch(/^today\s+is/i);
  });

  it('Q5a: "what is the date in 10 days" must compute a future date', async () => {
    const r = await engine.chat({ messages: [{ role: 'user', content: 'what is the date in 10 days?' }] });
    const content = r.message.content;
    expect(content).toMatch(/in\s+10\s+days/i);
    expect(content).not.toMatch(/^today\s+is/i);
  });

  it('Q5b: "how many messages have I sent" must count user turns', async () => {
    const history = [
      { role: 'user' as const, content: 'first message' },
      { role: 'assistant' as const, content: 'reply 1' },
      { role: 'user' as const, content: 'second message' },
      { role: 'assistant' as const, content: 'reply 2' },
    ];
    const r = await engine.chat({ messages: [...history, { role: 'user', content: 'how many messages have I sent you in this chat?' }] });
    const content = r.message.content;
    // 2 prior user msgs + 1 current = 3
    expect(content).toMatch(/\b3\s+message/i);
  });
});
