import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterOf, chooseCapability, formatChoice } from './capability-select.mjs';

const P = (title, capability, council_overall) => ({ title, capability, council_overall, first_slice: 'do x' });

test('clusterOf groups near-duplicates into one idea-family', () => {
  assert.equal(clusterOf({ title: 'Basic Image Input Support' }), 'image-vision');
  assert.equal(clusterOf({ title: 'Image Capture for Task Analysis' }), 'image-vision');
  assert.equal(clusterOf({ title: 'Convergence Vote Step' }), 'council-vote');
  assert.equal(clusterOf({ title: 'Streaming STT with Barge-in' }), 'voice'); // voice wins over streaming
});

test('dedups same-cluster near-duplicates into one candidate', () => {
  const c = chooseCapability([
    P('Convergence Vote Step', 'council votes to converge', 8.8),
    P('Convergence Vote for Decisions', 'council votes again to converge', 8.0),
  ], { minScore: 7 });
  assert.equal(c.ranked.length, 1, 'two council-vote variants collapse to one');
  assert.equal(c.pick.council_overall, 8.8, 'keeps the higher-scored variant');
});

test('prefers high USER-VALUE clusters over council-navel-gazing even at equal council score', () => {
  const c = chooseCapability([
    P('Convergence Vote Step', 'council internal voting', 8.8),     // council-vote: low user value
    P('Basic Image Input Support', 'Vai can see images', 8.8),       // image: high user value
  ], { minScore: 7 });
  assert.equal(c.pick.cluster, 'image-vision', formatChoice(c));
});

test('rejects a capability that already exists in the app (not novel)', () => {
  const c = chooseCapability([
    P('Conversation Memory', 'remember across turns', 9),
    P('Basic Image Input Support', 'see images', 8),
  ], { minScore: 7, seenInApp: (p) => /memory|remember/i.test(p.capability) });
  assert.ok(c.pick, 'still picks something');
  assert.notEqual(c.pick.cluster, 'memory', 'the already-existing one is rejected');
  assert.ok(c.rejected.some((r) => /already exists/.test(r.why)));
});

test('rejects below-floor proposals', () => {
  const c = chooseCapability([P('Weak idea', 'meh', 5)], { minScore: 7 });
  assert.equal(c.pick, null);
  assert.match(c.headline, /nothing to build/);
});

test('returns null cleanly on empty input', () => {
  const c = chooseCapability([], {});
  assert.equal(c.pick, null);
});

test('the real situation: 15 proposals → picks a meaningful, novel feature', () => {
  const real = [
    P('Basic Image Input Support', 'Vai can receive and process image inputs', 8.8),
    P('Convergence Vote Step', 'council escalate mechanism', 8.8),
    P('Image Capture for Task Analysis', 'capture and analyze images', 7.5),
    P('Convergence Vote for Council Decisions', 'vote to converge', 7.5),
    P('Real-World Tool Invocation', 'invoke shell/file/API tools', 7.5),
    P('Streaming Council Enrichment', 'real-time council view', 7.5),
    P('Voice-Driven Task Execution', 'voice interaction', 7.3),
    P('Contextual Backlog Retention', 'retain context across turns', 7.5),
  ];
  const c = chooseCapability(real, { minScore: 7 });
  // image-vision (1.0 user value) should win; the 2 image + 2 vote variants dedup away.
  assert.equal(c.pick.cluster, 'image-vision');
  assert.ok(c.ranked.length <= 6, 'deduped from 8 to distinct ideas');
});
