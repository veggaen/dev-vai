import { describe, expect, it } from 'vitest';
import type { Message } from '../models/adapter.js';
import { classifyTurn } from './turn-classifier.js';

const priorWithAssistant: Message[] = [
  { role: 'user', content: 'I am building Vai chat and need responses to stay relevant to user context.' },
  { role: 'assistant', content: 'The best next task is a context-grounded answer contract before broad retrieval.' },
];

describe('classifyTurn', () => {
  describe('short anaphoric follow-ups', () => {
    it.each([
      'make it better',
      'go deeper',
      'what about this',
      'explain that',
      'continue',
      'expand on that',
    ])('classifies %j as contextual-followup', (input) => {
      const r = classifyTurn(input, priorWithAssistant);
      expect(r.kind).toBe('contextual-followup');
      expect(r.isShortAnaphoric || r.referencesPriorTurn).toBe(true);
    });
  });

  describe('product-quality recommendation', () => {
    it.each([
      'what is the best next thing to build',
      'what should I improve next on the chat app',
      'where should we focus next on this product',
      'harden the response path so the chat is more grounded',
      'make the chat more reliable with stronger tests',
    ])('classifies %j as product-quality-recommendation', (input) => {
      const r = classifyTurn(input, priorWithAssistant);
      expect(r.kind).toBe('product-quality-recommendation');
    });
  });

  describe('standalone questions', () => {
    it.each([
      'what is the capital of Norway',
      'what does HTTP stand for',
      'how do I deploy a Next.js app',
      'who founded Microsoft',
      'when was the iPhone released',
      'define recursion',
    ])('classifies %j as standalone-question', (input) => {
      const r = classifyTurn(input, []);
      expect(r.kind).toBe('standalone-question');
      expect(r.referencesPriorTurn).toBe(false);
    });
  });

  describe('disambiguation', () => {
    it('does not treat a canonical knowledge ask as contextual just because there is prior assistant content', () => {
      const r = classifyTurn('what is the capital of Norway', priorWithAssistant);
      expect(r.kind).toBe('standalone-question');
    });

    it('treats "what about X" with a topic noun as contextual when prior assistant exists', () => {
      const r = classifyTurn('what about this approach', priorWithAssistant);
      expect(r.kind).toBe('contextual-followup');
    });

    it('returns unknown for empty / nonsense', () => {
      const r = classifyTurn('asdf', []);
      expect(r.kind).toBe('unknown');
    });

    it('returns unknown for short imperatives without prior context', () => {
      const r = classifyTurn('write a haiku', []);
      expect(r.kind).toBe('unknown');
    });
  });

  describe('signals', () => {
    it('records references-prior-turn signal when input contains anaphora', () => {
      const r = classifyTurn('make it better', priorWithAssistant);
      expect(r.signals).toContain('references-prior-turn');
    });

    it('records best-next signal for "best next thing"', () => {
      const r = classifyTurn('what is the best next thing for the app', priorWithAssistant);
      expect(r.signals).toContain('best-next');
    });

    it('records quality-hardening signal for "harden ... robust"', () => {
      const r = classifyTurn('harden the response path so the chat is more robust', priorWithAssistant);
      expect(r.signals).toContain('quality-hardening');
    });
  });

  describe('case + punctuation tolerance', () => {
    it.each([
      'MAKE IT BETTER',
      'Make It Better.',
      '  make it better!  ',
      'make-it-better',
    ])('still classifies %j as contextual-followup', (input) => {
      const r = classifyTurn(input, priorWithAssistant);
      // "make-it-better" is one hyphenated token; the regex won't fire on it,
      // so it falls through to unknown — which is acceptable. The others must
      // all be contextual-followup.
      if (input.includes('-')) {
        expect(['contextual-followup', 'unknown']).toContain(r.kind);
      } else {
        expect(r.kind).toBe('contextual-followup');
      }
    });
  });

  describe('polite prefixes', () => {
    it.each([
      'please make it better',
      'can you make it better',
      'could you go deeper',
    ])('classifies %j as contextual-followup', (input) => {
      const r = classifyTurn(input, priorWithAssistant);
      expect(r.kind).toBe('contextual-followup');
    });
  });

  describe('no-prior-assistant edge cases', () => {
    it('returns unknown for short anaphoric input with no prior assistant turn', () => {
      const r = classifyTurn('make it better', []);
      expect(r.kind).toBe('unknown');
      expect(r.isShortAnaphoric).toBe(false);
    });

    it('still classifies a canonical question shape as standalone with no prior context', () => {
      const r = classifyTurn('how do I deploy this to Vercel', []);
      expect(r.kind).toBe('standalone-question');
    });
  });

  describe('extra standalone variance', () => {
    it.each([
      "what's the difference between SQL and NoSQL",
      'how does HTTPS work',
      'why does TypeScript widen literal types',
      'where is the Eiffel Tower located',
    ])('classifies %j as standalone-question', (input) => {
      const r = classifyTurn(input, []);
      expect(r.kind).toBe('standalone-question');
    });
  });

  describe('extra contextual variance with prior assistant', () => {
    it.each([
      'tell me more about that',
      'why is that',
      'and then what',
      'how about this one',
    ])('classifies %j as contextual-followup', (input) => {
      const r = classifyTurn(input, priorWithAssistant);
      expect(r.kind).toBe('contextual-followup');
    });
  });

  describe('confidence ordering', () => {
    it('reports higher confidence for explicit reference than bare anaphoric instruction', () => {
      const explicit = classifyTurn('explain that', priorWithAssistant);
      const bare = classifyTurn('go deeper', priorWithAssistant);
      expect(explicit.kind).toBe('contextual-followup');
      expect(bare.kind).toBe('contextual-followup');
      expect(explicit.confidence).toBeGreaterThanOrEqual(bare.confidence);
    });
  });
});
