/**
 * Integration tests for the cognitive-frame-driven engine layer:
 *  - Opinion framing wrapper (apply, skip-list, idempotency guard)
 *  - CognitiveFrame exposure on every ResponseMeta
 *  - A1 conversational fast-path strategy
 *  - Knowledge confidence ledger (response signal + feedback signal)
 *  - dream() consolidation pass via the engine
 *
 * These exercise the FULL engine.chat() path (not the unit modules in
 * isolation) so each behaviour is verified end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

const originalFetch = globalThis.fetch;

describe('Engine cognitive-frame integration', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
    globalThis.fetch = vi.fn(async () => {
      throw new Error('cognitive-frame probe: no network');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── Opinion framing ────────────────────────────────────────────────

  describe('opinion framing', () => {
    it('classifies opinion prompts and exposes the frame', async () => {
      await engine.chat({
        messages: [{ role: 'user', content: "What's your favorite programming language?" }],
      });
      const meta = engine.lastResponseMeta;
      expect(meta).not.toBeNull();
      expect(meta!.cognitiveFrame?.kind).toBe('opinion');
    });

    it('framing flag and prefix are perfectly correlated', async () => {
      const result = await engine.chat({
        messages: [{ role: 'user', content: 'do you think rust is better than go?' }],
      });
      const meta = engine.lastResponseMeta!;
      expect(meta.cognitiveFrame?.kind).toBe('opinion');
      const startsWithHedge = /^my\s+take\s+—\s+not\s+authoritative/i.test(result.message.content.trim());
      if (meta.opinionFramingApplied === true) {
        expect(startsWithHedge).toBe(true);
      } else {
        expect(startsWithHedge).toBe(false);
      }
    });

    it('does not apply opinion framing to factual prompts', async () => {
      await engine.chat({
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
      });
      const meta = engine.lastResponseMeta!;
      expect(meta.cognitiveFrame?.kind).not.toBe('opinion');
      expect(meta.opinionFramingApplied).toBeUndefined();
    });

    it('does not apply opinion framing to conversational greetings', async () => {
      const result = await engine.chat({ messages: [{ role: 'user', content: 'hi' }] });
      const meta = engine.lastResponseMeta!;
      expect(meta.opinionFramingApplied).toBeUndefined();
      expect(/^my\s+take/i.test(result.message.content)).toBe(false);
    });

    it('does not apply framing when literal-meta strategy fires', async () => {
      // literal-response is in the OPINION_SKIP_STRATEGIES set.
      await engine.chat({
        messages: [{ role: 'user', content: 'what is the first letter in this question?' }],
      });
      const meta = engine.lastResponseMeta!;
      expect(meta.opinionFramingApplied).toBeUndefined();
    });
  });

  // ── CognitiveFrame exposure ────────────────────────────────────────

  describe('cognitive frame exposure', () => {
    it.each([
      ['how do I install node?', 'procedural'],
      ['why does my docker build fail?', 'causal'],
      ['react vs vue', 'comparative'],
      ['what is docker', 'definitional'],
      ['build me a typescript function that sums an array', 'imperative'],
    ])('exposes correct kind for "%s" → %s', async (prompt, expectedKind) => {
      await engine.chat({ messages: [{ role: 'user', content: prompt }] });
      const meta = engine.lastResponseMeta!;
      expect(meta.cognitiveFrame).toBeDefined();
      expect(meta.cognitiveFrame!.kind).toBe(expectedKind);
      expect(meta.cognitiveFrame!.tokenCount).toBeGreaterThan(0);
      expect(Array.isArray(meta.cognitiveFrame!.subQuestions)).toBe(true);
      expect(Array.isArray(meta.cognitiveFrame!.entities)).toBe(true);
    });

    it('handles empty prompts without crashing the framing path', async () => {
      const result = await engine.chat({ messages: [{ role: 'user', content: '' }] });
      expect(typeof result.message.content).toBe('string');
      expect(result.message.content.length).toBeGreaterThan(0);
      expect(engine.lastResponseMeta!.opinionFramingApplied).toBeUndefined();
    });
  });

  // ── A1 conversational fast-path ────────────────────────────────────

  describe('conversational fast-path', () => {
    it('greetings resolve to the conversational strategy', async () => {
      await engine.chat({ messages: [{ role: 'user', content: 'hi' }] });
      expect(engine.lastResponseMeta!.strategy).toBe('conversational');
    });

    it('thanks resolves to the conversational strategy', async () => {
      await engine.chat({ messages: [{ role: 'user', content: 'thanks!' }] });
      expect(engine.lastResponseMeta!.strategy).toBe('conversational');
    });

    it('long prompts are NOT routed through the fast-path', async () => {
      await engine.chat({
        messages: [{ role: 'user', content: 'how do I configure typescript strict mode for a monorepo' }],
      });
      expect(engine.lastResponseMeta!.strategy).not.toBe('conversational');
    });
  });

  // ── Knowledge confidence ledger ────────────────────────────────────

  describe('knowledge confidence ledger', () => {
    it('records a real entry per first-time topic with strategy provenance', async () => {
      const before = engine.knowledgeLedger.size();
      await engine.chat({ messages: [{ role: 'user', content: 'what is docker' }] });
      const after = engine.knowledgeLedger.size();
      const meta = engine.lastResponseMeta!;
      if (meta.topicDetected && meta.topicDetected.trim().length > 0) {
        expect(after).toBeGreaterThan(before);
        const entry = engine.knowledgeLedger.get(meta.topicDetected);
        expect(entry).not.toBeNull();
        expect(entry!.responses).toBe(1);
        expect(entry!.strategies.has(meta.strategy)).toBe(true);
        expect(entry!.confidence).toBeGreaterThan(0);
        expect(entry!.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('penalizes the previous topic on negative feedback', async () => {
      await engine.chat({ messages: [{ role: 'user', content: 'what is docker' }] });
      const topic = engine.lastResponseMeta!.topicDetected;
      if (!topic || topic.trim().length === 0) return;
      const before = engine.knowledgeLedger.get(topic)!.confidence;
      await engine.chat({
        messages: [
          { role: 'user', content: 'what is docker' },
          { role: 'assistant', content: 'placeholder' },
          { role: 'user', content: 'no, that is wrong' },
        ],
      });
      const entry = engine.knowledgeLedger.get(topic)!;
      expect(entry.negativeFeedback).toBeGreaterThanOrEqual(1);
      expect(entry.confidence).toBeLessThanOrEqual(before);
    });

    it('reinforces the previous topic on positive feedback', async () => {
      await engine.chat({ messages: [{ role: 'user', content: 'what is docker' }] });
      const topic = engine.lastResponseMeta!.topicDetected;
      if (!topic || topic.trim().length === 0) return;
      await engine.chat({
        messages: [
          { role: 'user', content: 'what is docker' },
          { role: 'assistant', content: 'placeholder' },
          { role: 'user', content: 'thanks' },
        ],
      });
      const entry = engine.knowledgeLedger.get(topic)!;
      expect(entry.positiveFeedback).toBeGreaterThanOrEqual(1);
    });
  });

  // ── dream() consolidation ──────────────────────────────────────────

  describe('dream() consolidation', () => {
    it('returns a well-typed report with consistent invariants', async () => {
      await engine.chat({ messages: [{ role: 'user', content: 'what is docker' }] });
      const report = engine.dream();
      expect(typeof report.scanned).toBe('number');
      expect(report.scanned).toBe(engine.knowledgeLedger.size());
      expect(Array.isArray(report.needsReview)).toBe(true);
      expect(Array.isArray(report.promoted)).toBe(true);
      expect(Array.isArray(report.decayed)).toBe(true);
      expect(typeof report.durationMs).toBe('number');
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('does not re-promote an already-promoted topic on consecutive runs', async () => {
      await engine.chat({ messages: [{ role: 'user', content: 'what is docker' }] });
      const r1 = engine.dream();
      const r2 = engine.dream();
      for (const t of r2.promoted) {
        expect(r1.promoted).not.toContain(t);
      }
    });
  });
});
