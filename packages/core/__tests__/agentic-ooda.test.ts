/**
 * Unit + integration tests for the AgenticOODA loop (Strategy 0.0002).
 *
 * Unit suite exercises pure functions: shouldActivate, observe, orient,
 * decide, preAct, act. Integration suite exercises engine.chat() so we
 * verify the trace ends up on ResponseMeta.oodaTrace and the Act phase
 * runs at the right moment.
 *
 * Anchored to Master.md §7 (Foundations) and §8 (Anti-Patterns).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shouldActivate,
  observe,
  orient,
  decide,
  preAct,
  act,
  type OodaTrace,
} from '../src/agentic/index.js';
import { analyze } from '../src/cognitive/index.js';
import { VaiEngine } from '../src/models/vai-engine.js';

const originalFetch = globalThis.fetch;

// ── Unit suite ─────────────────────────────────────────────────────

describe('OODA shouldActivate (gate)', () => {
  it('does NOT activate on a simple short prompt with high confidence', () => {
    const frame = analyze('what is docker');
    expect(shouldActivate({ frame, topic: 'docker', topicConfidence: 0.9 })).toBe(false);
  });

  it('activates on compound prompts', () => {
    const frame = analyze('what is docker? how do I install it?');
    expect(shouldActivate({ frame, topic: 'docker', topicConfidence: 0.9 })).toBe(true);
  });

  it('activates when the prompt has explicit constraints', () => {
    const frame = analyze('explain in 3 words exactly');
    expect(shouldActivate({ frame, topic: 'x', topicConfidence: 0.9 })).toBe(true);
  });

  it('activates on long prompts (>= 25 tokens)', () => {
    const long = 'how do I configure typescript strict mode for a monorepo with multiple packages and shared eslint config and prettier and vitest and playwright and a custom build script that runs in CI';
    const frame = analyze(long);
    expect(frame.tokenCount).toBeGreaterThanOrEqual(25);
    expect(shouldActivate({ frame, topic: 'typescript', topicConfidence: 0.9 })).toBe(true);
  });

  it('activates when topic confidence is low', () => {
    const frame = analyze('what is xyzzy');
    expect(shouldActivate({ frame, topic: 'xyzzy', topicConfidence: 0.2 })).toBe(true);
  });

  it('activates on causal and comparative kinds', () => {
    expect(shouldActivate({
      frame: analyze('why does my docker build fail?'),
      topic: 'docker',
      topicConfidence: 0.9,
    })).toBe(true);
    expect(shouldActivate({
      frame: analyze('react vs vue'),
      topic: 'frontend',
      topicConfidence: 0.9,
    })).toBe(true);
  });
});

describe('OODA observe → orient → decide', () => {
  it('orient applies first-principles + systems-thinking on causal prompts', () => {
    const frame = analyze('why does my docker build fail?');
    const obs = observe({ frame, topic: 'docker', topicConfidence: 0.7 });
    const ori = orient(obs, frame);
    expect(ori.foundations).toContain('first-principles');
    expect(ori.foundations).toContain('systems-thinking');
    expect(ori.foundations).toContain('intellectual-honesty');
  });

  it('orient applies calibrated-uncertainty when topic confidence is low', () => {
    const frame = analyze('what is gleeb');
    const obs = observe({ frame, topic: 'gleeb', topicConfidence: 0.2 });
    const ori = orient(obs, frame);
    expect(ori.foundations).toContain('calibrated-uncertainty');
    expect(ori.foundations).toContain('meta-learning');
  });

  it('orient surfaces a "first time seeing this topic" assumption', () => {
    const frame = analyze('what is docker');
    const obs = observe({ frame, topic: 'docker', topicConfidence: null });
    const ori = orient(obs, frame);
    expect(ori.assumptions.some((a) => /not seen before/i.test(a))).toBe(true);
  });

  it('decide guards confident-bullshitter on low-confidence topics', () => {
    const frame = analyze('explain xyzzy in detail');
    const obs = observe({ frame, topic: 'xyzzy', topicConfidence: 0.2 });
    const ori = orient(obs, frame);
    const dec = decide(obs, ori);
    expect(dec.guardedAntiPatterns).toContain('confident-bullshitter');
    expect(dec.applyCalibrationPrefix).toBe(true);
    expect(dec.responseShape).toBe('calibrated');
  });

  it('decide guards verbose-hedger on opinion prompts', () => {
    const frame = analyze("what's your favorite framework?");
    const obs = observe({ frame, topic: 'frameworks', topicConfidence: 0.7 });
    const dec = decide(obs, orient(obs, frame));
    expect(dec.guardedAntiPatterns).toContain('verbose-hedger');
    expect(dec.guardedAntiPatterns).toContain('sycophant');
    expect(dec.trimHedges).toBe(true);
  });

  it('decide chooses structured shape for compound prompts', () => {
    const frame = analyze('what is docker? how do I install it?');
    const obs = observe({ frame, topic: 'docker', topicConfidence: 0.7 });
    const dec = decide(obs, orient(obs, frame));
    expect(dec.responseShape).toBe('structured');
    expect(dec.guardedAntiPatterns).toContain('over-generator');
  });
});

describe('OODA preAct (gating)', () => {
  it('returns null when the gate fails', () => {
    const frame = analyze('hi');
    expect(preAct({ frame, topic: '', topicConfidence: null })).toBeNull();
  });

  it('returns a complete trace when the gate fires', () => {
    const frame = analyze('why does my docker build fail when I add a new dependency?');
    const trace = preAct({ frame, topic: 'docker', topicConfidence: 0.4 });
    expect(trace).not.toBeNull();
    expect(trace!.observe).toBeDefined();
    expect(trace!.orient).toBeDefined();
    expect(trace!.decide).toBeDefined();
    expect(trace!.act).toBeUndefined();
  });
});

describe('OODA act (post-processor)', () => {
  function fakeTrace(overrides: Partial<OodaTrace['decide']> = {}): OodaTrace {
    return {
      observe: {
        kind: 'opinion',
        isCompound: false,
        tokenCount: 5,
        topic: 't',
        topicConfidence: 0.3,
        entities: [],
        hasConstraints: false,
      },
      orient: { foundations: ['intellectual-honesty'], subProblems: [], assumptions: [] },
      decide: {
        guardedAntiPatterns: [],
        responseShape: 'normal',
        applyCalibrationPrefix: false,
        trimHedges: false,
        strategyHint: 'unspecified',
        ...overrides,
      },
    };
  }

  it('strips hedge phrases when trimHedges is true', () => {
    const trace = fakeTrace({ trimHedges: true });
    const text = 'I think perhaps maybe rust is fast.';
    const out = act(trace, text);
    expect(out.act.hedgesRemoved).toBeGreaterThan(0);
    expect(out.response.toLowerCase()).not.toMatch(/i\s+think|perhaps|maybe/);
  });

  it('does NOT strip hedges when trimHedges is false', () => {
    const trace = fakeTrace({ trimHedges: false });
    const text = 'I think rust is fast.';
    const out = act(trace, text);
    expect(out.act.hedgesRemoved).toBe(0);
    expect(out.response).toBe(text);
  });

  it('adds calibration prefix exactly once and never double-prefixes', () => {
    const trace = fakeTrace({ applyCalibrationPrefix: true });
    const out1 = act(trace, 'rust is fast');
    expect(out1.response).toMatch(/^calibrated\s+take/i);
    expect(out1.act.calibrationPrefixAdded).toBe(true);
    // Idempotency: running again on the prefixed output must NOT add another.
    const out2 = act(trace, out1.response);
    expect(out2.response).toBe(out1.response);
    expect(out2.act.calibrationPrefixAdded).toBe(false);
  });

  it('reports mutated=false when nothing changed', () => {
    const trace = fakeTrace();
    const text = 'rust is fast';
    const out = act(trace, text);
    expect(out.act.mutated).toBe(false);
    expect(out.response).toBe(text);
  });

  it('finalLength reflects the actual returned text length', () => {
    const trace = fakeTrace({ trimHedges: true });
    const out = act(trace, 'I think perhaps rust is fast');
    expect(out.act.finalLength).toBe(out.response.length);
  });
});

// ── Integration suite ──────────────────────────────────────────────

describe('AgenticOODA engine integration (Strategy 0.0002)', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ooda probe: no network');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does NOT attach an OODA trace for trivial prompts', async () => {
    await engine.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(engine.lastResponseMeta!.oodaTrace).toBeUndefined();
  });

  it('attaches a complete OODA trace for compound prompts', async () => {
    await engine.chat({
      messages: [{ role: 'user', content: 'what is docker? how do I install it on windows?' }],
    });
    const trace = engine.lastResponseMeta!.oodaTrace;
    expect(trace).toBeDefined();
    expect(trace!.observe.isCompound).toBe(true);
    expect(trace!.decide.responseShape).toBe('structured');
    expect(trace!.act).toBeDefined();
    expect(trace!.act!.finalLength).toBe(/* response length */ engine.lastResponseMeta!.responseLength);
  });

  it('attaches a trace for causal prompts and applies foundations', async () => {
    await engine.chat({
      messages: [{ role: 'user', content: 'why does my docker build fail when I add a new dependency?' }],
    });
    const trace = engine.lastResponseMeta!.oodaTrace;
    expect(trace).toBeDefined();
    expect(trace!.orient.foundations).toContain('first-principles');
  });

  it('act phase produces a non-empty response when it fires', async () => {
    const result = await engine.chat({
      messages: [{ role: 'user', content: 'react vs vue for a small e-commerce frontend in 2026' }],
    });
    const trace = engine.lastResponseMeta!.oodaTrace;
    expect(trace).toBeDefined();
    expect(result.message.content.length).toBeGreaterThan(0);
    // Either Act mutated the response or it was already fine — but the
    // act step must exist and its finalLength must match.
    expect(trace!.act).toBeDefined();
    expect(trace!.act!.finalLength).toBe(result.message.content.length);
  });

  it('does not attach an Act phase when the strategy is in the skip-list', async () => {
    // empty input → 'empty' strategy, which is in OPINION_SKIP_STRATEGIES.
    await engine.chat({ messages: [{ role: 'user', content: '' }] });
    const trace = engine.lastResponseMeta!.oodaTrace;
    // Either no trace at all (gate failed) or a trace without Act.
    if (trace) {
      expect(trace.act).toBeUndefined();
    }
  });
});
