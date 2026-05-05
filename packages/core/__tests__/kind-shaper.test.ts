/**
 * Unit + integration tests for the kind-aware response shaper
 * (Strategy 0.0001 follow-through). Verifies that CognitiveFrame.kind
 * actually drives response transformation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shapeByKind } from '../src/cognitive/shaper.js';
import { analyze } from '../src/cognitive/index.js';
import { VaiEngine } from '../src/models/vai-engine.js';

const SKIP = new Set([
  'empty', 'gibberish', 'keyboard-noise', 'fallback',
  'conversational', 'literal-response', 'trick-question',
  'strict-format', 'math', 'binary',
]);
const originalFetch = globalThis.fetch;

function frameWith(kind: string, opts: Partial<Record<string, unknown>> = {}): any {
  return {
    kind,
    kindConfidence: 0.9,
    isCompound: false,
    subQuestions: [],
    entities: [],
    hasConstraints: false,
    tokenCount: 5,
    signals: { endsWithQuestionMark: true, hasCodeFence: false, hasNumberRange: false, mentionsSelf: false },
    ...opts,
  };
}

// ── Unit: gates ────────────────────────────────────────────────────

describe('shapeByKind gates', () => {
  it('returns null when no frame', () => {
    expect(shapeByKind(null, 'whatever response here, plenty of length to clear the floor.', 'analytical', SKIP).shape).toBeNull();
  });

  it('returns null for skip-list strategies', () => {
    const f = frameWith('procedural');
    const r = 'First, install. Then, configure. Finally, run the daemon and check status.';
    expect(shapeByKind(f, r, 'fallback', SKIP).shape).toBeNull();
  });

  it('returns null when response has a code fence', () => {
    const f = frameWith('procedural');
    const r = 'First, do this. Then, do that. Finally, do the last.\n```sh\necho hi\n```';
    expect(shapeByKind(f, r, 'analytical', SKIP).shape).toBeNull();
  });

  it('returns null when kindConfidence < 0.7', () => {
    const f = frameWith('procedural', { kindConfidence: 0.4 });
    const r = 'First, install. Then, configure. Finally, run the daemon.';
    expect(shapeByKind(f, r, 'analytical', SKIP).shape).toBeNull();
  });

  it('returns null when response is too short', () => {
    const f = frameWith('procedural');
    expect(shapeByKind(f, 'too short', 'analytical', SKIP).shape).toBeNull();
  });

  it('returns null for kinds with no transform (definitional, factual, opinion, ...)', () => {
    for (const k of ['definitional', 'factual', 'opinion', 'meta', 'conversational', 'imperative', 'unknown']) {
      const f = frameWith(k);
      const r = 'A long enough response that would otherwise be eligible for shaping but the kind has no transform.';
      expect(shapeByKind(f, r, 'analytical', SKIP).shape).toBeNull();
    }
  });
});

// ── Unit: procedural → numbered steps ──────────────────────────────

describe('shapeByKind procedural → numbered-steps', () => {
  it('converts ordinal prose to a numbered list', () => {
    const f = frameWith('procedural');
    const r = 'First, install node from nodejs.org. Then, open a terminal and verify with node -v. Finally, run npm init in your project folder.';
    const out = shapeByKind(f, r, 'analytical', SKIP);
    expect(out.shape?.transform).toBe('numbered-steps');
    expect(out.shape?.changed).toBe(true);
    expect(out.response).toMatch(/^1\. /m);
    expect(out.response).toMatch(/^2\. /m);
    expect(out.response).toMatch(/^3\. /m);
    // Ordinal prefix should be stripped from the steps themselves.
    expect(out.response).not.toMatch(/^1\.\s+First,/m);
  });

  it('does NOT fire when response is already numbered', () => {
    const f = frameWith('procedural');
    const r = '1. First install node.\n2. Then verify with node -v.\n3. Finally run npm init.';
    const out = shapeByKind(f, r, 'analytical', SKIP);
    expect(out.shape?.changed).toBe(false);
    expect(out.response).toBe(r);
  });

  it('does NOT fire with fewer than 3 ordinal markers', () => {
    const f = frameWith('procedural');
    const r = 'First, install node from nodejs.org. Then, open a terminal and check node -v works fine.';
    expect(shapeByKind(f, r, 'analytical', SKIP).shape).toBeNull();
  });

  it('preserves a non-ordinal preamble before the numbered block', () => {
    const f = frameWith('procedural');
    const r = 'You will need admin rights for this. First, download the installer. Then, run it as administrator. Finally, restart the machine.';
    const out = shapeByKind(f, r, 'analytical', SKIP);
    expect(out.response.startsWith('You will need admin rights for this.')).toBe(true);
    expect(out.response).toMatch(/\n\n1\. /);
  });

  it('is idempotent: re-shaping the output is a no-op (already-numbered)', () => {
    const f = frameWith('procedural');
    const r = 'First, do A. Then, do B. Finally, do C and verify the output looks right.';
    const once = shapeByKind(f, r, 'analytical', SKIP);
    const twice = shapeByKind(f, once.response, 'analytical', SKIP);
    expect(twice.shape?.changed).toBe(false);
    expect(twice.response).toBe(once.response);
  });
});

// ── Unit: comparative → comparison header ──────────────────────────

describe('shapeByKind comparative → comparison-header', () => {
  it('prepends a "Comparing X and Y:" header when entities are present', () => {
    const f = frameWith('comparative', { entities: ['React', 'Vue'] });
    const r = 'Both libraries are mature and have strong ecosystems with different design philosophies behind them.';
    const out = shapeByKind(f, r, 'analytical', SKIP);
    expect(out.shape?.transform).toBe('comparison-header');
    expect(out.shape?.changed).toBe(true);
    expect(out.response.startsWith('Comparing React and Vue:')).toBe(true);
  });

  it('does NOT fire when fewer than 2 entities exist', () => {
    const f = frameWith('comparative', { entities: ['React'] });
    const r = 'Both libraries are mature and have strong ecosystems with different design philosophies behind them.';
    expect(shapeByKind(f, r, 'analytical', SKIP).shape).toBeNull();
  });

  it('is idempotent: response already starting with "Comparing " is left alone', () => {
    const f = frameWith('comparative', { entities: ['React', 'Vue'] });
    const r = 'Comparing React and Vue:\n\nBoth libraries are mature and have strong ecosystems with different design philosophies behind them.';
    const out = shapeByKind(f, r, 'analytical', SKIP);
    expect(out.shape?.changed).toBe(false);
    expect(out.response).toBe(r);
  });

  it('de-duplicates entity picks case-insensitively', () => {
    const f = frameWith('comparative', { entities: ['react', 'React', 'Vue'] });
    const r = 'Both libraries are mature and have strong ecosystems with different design philosophies behind them.';
    const out = shapeByKind(f, r, 'analytical', SKIP);
    expect(out.response.startsWith('Comparing react and Vue:')).toBe(true);
  });
});

// ── Unit: causal → causal prefix ───────────────────────────────────

describe('shapeByKind causal → causal-prefix', () => {
  it('prepends "Likely cause:" when no causal connective exists', () => {
    const f = frameWith('causal');
    const r = 'A stale build cache combined with a mismatched node_modules tree.';
    const out = shapeByKind(f, r, 'analytical', SKIP);
    expect(out.shape?.transform).toBe('causal-prefix');
    expect(out.shape?.changed).toBe(true);
    expect(out.response.startsWith('Likely cause: ')).toBe(true);
  });

  it('does NOT fire when response already contains "because"', () => {
    const f = frameWith('causal');
    const r = 'It fails because the base image upgraded glibc and your prebuilt binary expects the older version.';
    expect(shapeByKind(f, r, 'analytical', SKIP).shape).toBeNull();
  });

  it('does NOT fire when response already contains "due to"', () => {
    const f = frameWith('causal');
    const r = 'The build breaks due to a stale layer cache that pins the previous base image digest.';
    expect(shapeByKind(f, r, 'analytical', SKIP).shape).toBeNull();
  });

  it('does NOT fire on long responses (> 400 chars)', () => {
    const f = frameWith('causal');
    const r = 'A'.repeat(401) + ' end.';
    expect(shapeByKind(f, r, 'analytical', SKIP).shape).toBeNull();
  });

  it('is idempotent: response already starting with "Likely cause:" is left alone', () => {
    const f = frameWith('causal');
    const r = 'Likely cause: a stale build cache combined with a mismatched node_modules tree.';
    const out = shapeByKind(f, r, 'analytical', SKIP);
    expect(out.shape?.changed).toBe(false);
    expect(out.response).toBe(r);
  });
});

// ── Integration: engine surfaces meta.kindShape ────────────────────

describe('VaiEngine kind-shape integration', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
    globalThis.fetch = vi.fn(async () => {
      throw new Error('kind-shape probe: no network');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('classifies kind on every chat turn', async () => {
    await engine.chat({ messages: [{ role: 'user', content: 'how do I install node on windows?' }] });
    expect(engine.lastResponseMeta?.cognitiveFrame?.kind).toBe('procedural');
  });

  it('does not attach kindShape when no transform fires', async () => {
    await engine.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(engine.lastResponseMeta?.kindShape).toBeUndefined();
  });

  it('CognitiveFrame.kind drives at least one observable response transform', () => {
    // Direct unit verification that the wiring contract holds: passing the
    // engine's own classifier into the shaper produces a shape object whose
    // `kind` matches the frame.kind (active routing, not passive metadata).
    const frame = analyze('how do I install node? first do A. then do B. finally do C.');
    const fakeResponse = 'First, install node from nodejs.org. Then, open a terminal and run node -v to verify. Finally, run npm init in your folder.';
    const out = shapeByKind(frame, fakeResponse, 'analytical', SKIP);
    expect(out.shape).not.toBeNull();
    expect(out.shape!.kind).toBe(frame.kind);
  });
});
