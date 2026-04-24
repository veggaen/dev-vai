import { describe, it, expect } from 'vitest';
import {
  ShadowRouter,
  extractShadowFeatures,
  contextFromHistory,
} from '../src/models/shadow-router.js';

describe('ShadowRouter — feature extraction', () => {
  it('is deterministic for the same input', () => {
    const a = extractShadowFeatures('build me a react counter component', 0, null);
    const b = extractShadowFeatures('build me a react counter component', 0, null);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it('encodes the build-verb marker for scaffold-ish prompts', () => {
    const v = extractShadowFeatures('build me a react counter component', 0, null);
    expect(v.has('__verb_build')).toBe(true);
    expect(v.has('__short')).toBe(false);
  });

  it('encodes refinement markers for short follow-ups', () => {
    const v = extractShadowFeatures('simpler please', 1, 'code-gen');
    expect(v.has('__marker_refine')).toBe(true);
    expect(v.has('__short')).toBe(true);
    expect(v.has('__turns_1')).toBe(true);
    expect(v.has('__prior:code-gen')).toBe(true);
  });

  it('encodes code fence and URL markers', () => {
    const v = extractShadowFeatures('```js\nconsole.log(1)\n```\nwhy does this print 1?', 0, null);
    expect(v.has('__code_fence')).toBe(true);
    expect(v.has('__qmark')).toBe(true);
    const u = extractShadowFeatures('check https://github.com/foo/bar', 0, null);
    expect(u.has('__url')).toBe(true);
  });
});

describe('ShadowRouter — context from history', () => {
  it('counts prior user turns (excluding final)', () => {
    const ctx = contextFromHistory([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'final' },
    ]);
    expect(ctx.priorTurnCount).toBe(2);
    expect(ctx.priorStrategy).toBeNull();
  });
});

describe('ShadowRouter — training & prediction', () => {
  it('recovers the dominant class on well-separated samples', () => {
    const router = new ShadowRouter();
    const train: Array<{ input: string; priorTurnCount: number; priorStrategy: string | null; actualStrategy: string }> = [
      { input: 'build me a counter in react', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'code-gen' },
      { input: 'write a todo app in vue', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'code-gen' },
      { input: 'generate a landing page', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'code-gen' },
      { input: 'create a node express server', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'code-gen' },
      { input: 'what is docker', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'short-topic-curated' },
      { input: 'explain http', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'short-topic-curated' },
      { input: 'tell me about typescript', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'short-topic-curated' },
      { input: 'describe rest apis', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'short-topic-curated' },
      { input: 'fix this bug', priorTurnCount: 1, priorStrategy: 'code-gen', actualStrategy: 'refinement-synth' },
      { input: 'simpler please', priorTurnCount: 1, priorStrategy: 'code-gen', actualStrategy: 'refinement-synth' },
      { input: 'try a different approach', priorTurnCount: 1, priorStrategy: 'code-gen', actualStrategy: 'refinement-synth' },
    ];
    for (const t of train) router.observe(t);

    const p1 = router.predict('make me a flask api', 0, null, 3);
    expect(p1[0].strategy).toBe('code-gen');

    const p2 = router.predict('what is graphql', 0, null, 3);
    expect(p2[0].strategy).toBe('short-topic-curated');

    const p3 = router.predict('simpler please', 1, 'code-gen', 3);
    expect(p3[0].strategy).toBe('refinement-synth');
  });

  it('accumulates agreement stats across observations', () => {
    const router = new ShadowRouter();
    const samples = [
      { input: 'build me a counter in react', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'code-gen' },
      { input: 'write a todo app', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'code-gen' },
      { input: 'what is docker', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'short-topic-curated' },
      { input: 'explain http', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'short-topic-curated' },
      { input: 'generate a landing page', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'code-gen' },
      { input: 'describe rest apis', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'short-topic-curated' },
    ];
    for (const s of samples) router.observe(s);
    const stats = router.getAgreementStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.top1Rate).toBeGreaterThanOrEqual(0);
    expect(stats.top1Rate).toBeLessThanOrEqual(1);
    expect(stats.top3Rate).toBeGreaterThanOrEqual(stats.top1Rate);
    expect(Object.keys(stats.byStrategy).length).toBeGreaterThan(0);
  });

  it('round-trips through JSON without changing predictions', () => {
    const router = new ShadowRouter();
    const train = [
      { input: 'build me a counter', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'code-gen' },
      { input: 'what is docker', priorTurnCount: 0, priorStrategy: null, actualStrategy: 'short-topic-curated' },
      { input: 'simpler please', priorTurnCount: 1, priorStrategy: 'code-gen', actualStrategy: 'refinement-synth' },
    ];
    for (const t of train) router.observe(t);

    const snapshot = router.toJSON();
    const restored = ShadowRouter.fromJSON(snapshot);
    const q = { input: 'make a fresh api', turns: 0, prior: null };
    const a = router.predict(q.input, q.turns, q.prior, 3);
    const b = restored.predict(q.input, q.turns, q.prior, 3);
    expect(a.map((r) => r.strategy)).toEqual(b.map((r) => r.strategy));
    for (let i = 0; i < a.length; i++) expect(a[i].score).toBeCloseTo(b[i].score, 10);
  });

  it('returns no predictions before any observation', () => {
    const router = new ShadowRouter();
    expect(router.predict('anything', 0, null)).toEqual([]);
  });
});
