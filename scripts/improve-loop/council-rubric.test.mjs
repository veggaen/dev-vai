// Run: node --test scripts/improve-loop/council-rubric.test.mjs
// Pure module (no node:sqlite) — the --experimental-sqlite flag is NOT required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreCapabilityProposal,
  scoreCouncilProcess,
  buildsOnAnother,
  GOAL_KEYWORDS,
} from './council-rubric.mjs';

const strongProposal = {
  area: 'voice',
  title: 'Add voice turn loop',
  capability: 'Let V3gga speak to Vai and hear spoken replies via a streaming voice turn.',
  evidence: ['packages/core/src/chat/service.ts:42', 'scripts/improve-loop/driver.mjs'],
  steps: ['add STT adapter', 'wire TTS', 'stream to ChatService'],
  firstSlice: 'add a STT adapter behind a feature flag',
  verify: 'speak a prompt, assert transcript matches and audio plays',
};

test('scoreCapabilityProposal: a strong, grounded, goal-fit proposal scores high', () => {
  const r = scoreCapabilityProposal(strongProposal);
  assert.ok(r.impact >= 7, `expected strong impact, got ${r.impact}`);
  assert.equal(r.evidenceCount, 2);
  assert.equal(r.area, 'voice');
  assert.ok(r.scores.goalFit >= 7);
  assert.ok(r.scores.actionability >= 8);
});

test('scoreCapabilityProposal: a vague, ungrounded idea scores low', () => {
  const r = scoreCapabilityProposal({ area: 'misc', title: 'make it better', capability: 'improve' });
  assert.ok(r.impact < 4, `expected weak impact, got ${r.impact}`);
  assert.equal(r.evidenceCount, 0);
  assert.equal(r.scores.grounding, 0);
});

test('scoreCapabilityProposal: only real file refs count as evidence', () => {
  const r = scoreCapabilityProposal({
    ...strongProposal,
    evidence: ['just a sentence with no file', 'another vague note'],
  });
  assert.equal(r.evidenceCount, 0);
  assert.equal(r.scores.grounding, 0);
});

test('scoreCapabilityProposal: empty/garbage input does not throw', () => {
  const r = scoreCapabilityProposal();
  assert.equal(r.evidenceCount, 0);
  assert.equal(r.area, 'unscoped');
  assert.ok(r.impact >= 0 && r.impact <= 10);
});

test('scoreCapabilityProposal: a bounded single-concern change beats a sprawling wall (review burden)', () => {
  const bounded = scoreCapabilityProposal(strongProposal);
  const sprawling = scoreCapabilityProposal({
    ...strongProposal,
    capability: `${strongProposal.capability} `.repeat(6), // wall-of-text > 240 chars
    steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],       // 8-step sprawl = high review burden
  });
  assert.ok(bounded.scores.reviewBurden >= 8, `bounded should be low-burden, got ${bounded.scores.reviewBurden}`);
  assert.ok(sprawling.scores.reviewBurden < bounded.scores.reviewBurden,
    `sprawl should raise burden: ${bounded.scores.reviewBurden} -> ${sprawling.scores.reviewBurden}`);
  assert.ok(sprawling.impact < bounded.impact, `sprawl should lower impact: ${bounded.impact} -> ${sprawling.impact}`);
});

test('GOAL_KEYWORDS covers the north-star themes', () => {
  for (const w of ['voice', 'image', 'tool', 'council', 'delegate', 'verify']) {
    assert.ok(GOAL_KEYWORDS.includes(w), `missing goal keyword: ${w}`);
  }
});

test('scoreCouncilProcess: a broad, converging, grounded round scores well', () => {
  const round = {
    proposals: [
      strongProposal,
      { area: 'voice', title: 'Voice barge-in', capability: 'allow interrupting Vai mid-speech',
        evidence: ['apps/desktop/src/components/ChatWindow.tsx:10'], steps: ['detect speech', 'cancel TTS'],
        firstSlice: 'add a cancel signal', verify: 'interrupt and assert stop' },
      { area: 'tooling', title: 'Tool chaining', capability: 'chain tool outputs into one synthesis',
        evidence: ['scripts/improve-loop/tools.mjs:160'], steps: ['define chain', 'pass results'],
        firstSlice: 'build a two-step chain', verify: 'assert chained result' },
    ],
  };
  const r = scoreCouncilProcess(round);
  assert.ok(r.overall >= 5, `expected workable+, got ${r.overall}`);
  assert.equal(r.lensesUsed, 3);
  assert.equal(r.distinctAreas, 2);
  assert.equal(r.topClusterSize, 2);
  assert.ok(r.dimensions.convergence >= 6); // 2 voice lenses agree
  assert.ok(/council .* lenses .* areas/.test(r.headline));
  assert.ok(/weakest council dimension/.test(r.lesson));
});

test('scoreCouncilProcess: a single ungrounded lens scores poorly + names weakest', () => {
  const r = scoreCouncilProcess({ proposals: [{ area: 'misc', title: 'x', capability: 'do stuff' }] });
  assert.ok(r.overall < 5, `expected weak, got ${r.overall}`);
  assert.equal(r.lensesUsed, 1);
  assert.ok(['broken', 'weak'].includes(r.verdict));
});

test('scoreCouncilProcess: empty round does not throw and is broken', () => {
  const r = scoreCouncilProcess();
  assert.equal(r.lensesUsed, 0);
  assert.equal(r.overall, 0);
  assert.equal(r.verdict, 'broken');
});

test('scoreCouncilProcess: proposals missing title/capability are not counted', () => {
  const r = scoreCouncilProcess({ proposals: [{ area: 'voice' }, { area: 'voice', title: 'ok' }] });
  assert.equal(r.lensesUsed, 0); // neither has BOTH title and capability
});

test('buildsOnAnother: matches a sibling by title/area words, false without a ref', () => {
  const all = [{ area: 'voice', title: 'Voice turn loop' }, { area: 'tooling', title: 'Tool chain' }];
  assert.equal(buildsOnAnother({ buildsOn: 'extends the voice turn' }, all), true); // title words
  assert.equal(buildsOnAnother({ buildsOn: 'tooling' }, all), true);                 // area word
  assert.equal(buildsOnAnother({ buildsOn: '' }, all), false);
  assert.equal(buildsOnAnother({}, all), false);
});

test('scoreCouncilProcess: an explicit buildsOn lifts convergence above isolated proposals', () => {
  const base = { capability: 'c', evidence: ['a.ts:1'], steps: ['x', 'y'], firstSlice: 's', verify: 'v' };
  const isolated = scoreCouncilProcess({ proposals: [
    { ...base, area: 'voice', title: 'Voice turn' },
    { ...base, area: 'tooling', title: 'Tool chain' },
  ] });
  const converging = scoreCouncilProcess({ proposals: [
    { ...base, area: 'voice', title: 'Voice turn' },
    { ...base, area: 'tooling', title: 'Tool chain', buildsOn: 'Voice turn' },
  ] });
  assert.equal(isolated.crossRefs, 0);
  assert.equal(converging.crossRefs, 1);
  assert.ok(converging.dimensions.convergence > isolated.dimensions.convergence,
    `expected convergence lift, got ${isolated.dimensions.convergence} -> ${converging.dimensions.convergence}`);
});
