import { describe, it, expect } from 'vitest';
import { tryHandleChatMeta, type MetaHistoryMessage } from './meta-router.js';

function turn(role: 'user' | 'assistant', content: string): MetaHistoryMessage {
  return { role, content };
}

describe('tryHandleChatMeta', () => {
  it('returns null for non-meta queries', () => {
    expect(tryHandleChatMeta('what is the capital of France?', [])).toBeNull();
    expect(tryHandleChatMeta('build me a todo app', [turn('user', 'hi')])).toBeNull();
    expect(tryHandleChatMeta('', [])).toBeNull();
  });

  describe('first-user intent', () => {
    it('detects "what was my first message"', () => {
      const history = [turn('user', 'hello world'), turn('assistant', 'hi'), turn('user', 'what was my first message?')];
      const result = tryHandleChatMeta('what was my first message?', history);
      expect(result?.intent).toBe('first-user');
      expect(result?.reply).toContain('"hello world"');
    });

    it('detects "what did I first say"', () => {
      const history = [turn('user', 'pizza'), turn('user', 'what did I first say?')];
      const result = tryHandleChatMeta('what did I first say?', history);
      expect(result?.intent).toBe('first-user');
      expect(result?.reply).toContain('"pizza"');
    });

    it('handles empty history gracefully', () => {
      const result = tryHandleChatMeta('what was my first message?', []);
      expect(result?.intent).toBe('first-user');
      expect(result?.reply).toMatch(/first turn/i);
    });

    it('truncates very long messages', () => {
      const long = 'x'.repeat(500);
      const result = tryHandleChatMeta('what was my first message?', [turn('user', long)]);
      expect(result?.reply).toContain('…');
      expect(result?.reply.length).toBeLessThan(350);
    });
  });

  describe('first-assistant intent', () => {
    it('detects "what was your first reply"', () => {
      const history = [turn('user', 'hi'), turn('assistant', 'hello back'), turn('assistant', 'and again')];
      const result = tryHandleChatMeta('what was your first reply?', history);
      expect(result?.intent).toBe('first-assistant');
      expect(result?.reply).toContain('"hello back"');
    });

    it('detects "what did you first say"', () => {
      const history = [turn('assistant', 'greetings')];
      const result = tryHandleChatMeta('what did you first say?', history);
      expect(result?.intent).toBe('first-assistant');
      expect(result?.reply).toContain('"greetings"');
    });
  });

  describe('last-user intent', () => {
    it('detects "what did I just say" and excludes the current question', () => {
      const history = [
        turn('user', 'first'),
        turn('assistant', 'noted'),
        turn('user', 'second thing'),
        turn('assistant', 'noted again'),
        turn('user', 'what did I just say?'),
      ];
      const result = tryHandleChatMeta('what did I just say?', history);
      expect(result?.intent).toBe('last-user');
      expect(result?.reply).toContain('"second thing"');
    });

    it('says "only message" when there is no prior user turn', () => {
      const history = [turn('user', 'what did I just say?')];
      const result = tryHandleChatMeta('what did I just say?', history);
      expect(result?.intent).toBe('last-user');
      expect(result?.reply).toMatch(/only message/i);
    });
  });

  describe('last-assistant intent', () => {
    it('detects "what did you just say"', () => {
      const history = [
        turn('assistant', 'old reply'),
        turn('user', 'q'),
        turn('assistant', 'newest reply'),
        turn('user', 'what did you just say?'),
      ];
      const result = tryHandleChatMeta('what did you just say?', history);
      expect(result?.intent).toBe('last-assistant');
      expect(result?.reply).toContain('"newest reply"');
    });

    it('detects "your previous response"', () => {
      const history = [turn('assistant', 'because reasons')];
      const result = tryHandleChatMeta('explain your previous response', history);
      expect(result?.intent).toBe('last-assistant');
      expect(result?.reply).toContain('"because reasons"');
    });
  });

  describe('message-count intent', () => {
    it('counts user and assistant turns', () => {
      const history = [
        turn('user', 'a'), turn('assistant', 'b'),
        turn('user', 'c'), turn('assistant', 'd'),
        turn('user', 'how many messages have I sent?'),
      ];
      const result = tryHandleChatMeta('how many messages have I sent?', history);
      expect(result?.intent).toBe('message-count');
      expect(result?.reply).toMatch(/3 messages from you/);
      expect(result?.reply).toMatch(/2 from me/);
    });
  });

  describe('recap intent', () => {
    it('summarizes the conversation', () => {
      const history = [
        turn('user', 'tell me about redbull'),
        turn('assistant', 'a sugary energy drink'),
        turn('user', 'and monster?'),
        turn('assistant', 'similar but blacker'),
        turn('user', 'summarize this chat'),
      ];
      const result = tryHandleChatMeta('summarize this chat', history);
      expect(result?.intent).toBe('recap');
      expect(result?.reply).toMatch(/3 messages from you/);
      expect(result?.reply).toContain('redbull');
      expect(result?.reply).toContain('monster');
    });

    it('detects "what have we talked about"', () => {
      const history = [turn('user', 'recipes'), turn('assistant', 'noted')];
      const result = tryHandleChatMeta('what have we talked about?', history);
      expect(result?.intent).toBe('recap');
    });

    it('handles empty history', () => {
      const result = tryHandleChatMeta('summarize this chat', []);
      expect(result?.intent).toBe('recap');
      expect(result?.reply).toMatch(/no messages|haven't/i);
    });
  });
});
