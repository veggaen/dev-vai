// Run: node --test scripts/improve-loop/capability-context.test.mjs
// Pure/injectable module — no node:sqlite, no real disk/network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERPETUAL_GOAL,
  distillGoal,
  distillBacklog,
  distillUserGoals,
  summarizeToolingGuide,
  composeContext,
  assembleContext,
  fetchIntrospect,
} from './capability-context.mjs';

test('distillGoal: extracts "My app is …" intent and appends north-star', () => {
  const g = distillGoal('( ... My app is a Interface + Voice interaction that lets V3gga speak to Vai. but only ... )');
  assert.ok(/My app is a Interface \+ Voice/.test(g));
  assert.ok(/North-star:/.test(g));
});

test('distillGoal: falls back to PERPETUAL_GOAL when no match', () => {
  assert.equal(distillGoal('nothing relevant here'), PERPETUAL_GOAL);
  assert.equal(distillGoal(''), PERPETUAL_GOAL);
});

test('distillBacklog: pulls bold headlines under ## Open only', () => {
  const md = [
    '# Backlog', '## Open', '- **Item A - first**', '  detail', '- **Item B - second**',
    '## Done', '- **Item C - should be ignored**',
  ].join('\n');
  const heads = distillBacklog(md);
  assert.deepEqual(heads, ['Item A - first', 'Item B - second']);
});

test('distillBacklog: empty input returns []', () => {
  assert.deepEqual(distillBacklog(''), []);
});

test('distillUserGoals: keeps substantive, de-dups near-identical drafts', () => {
  const long = 'I want Vai to use real tools and respond via voice and images without losing any details across the whole task.';
  const dump = [
    '--- #1 (10c) ---', 'short', // dropped: too short
    `--- #2 (200c) ---`, long,
    `--- #3 (200c) ---`, long + ' (a second near-identical draft of the same ask)', // dropped: dup by first 60
  ].join('\n');
  const goals = distillUserGoals(dump, { minLen: 40 });
  assert.equal(goals.length, 1);
  assert.ok(/use real tools and respond via voice/.test(goals[0]));
});

test('composeContext: includes sections only when present, stays bounded', () => {
  const ctx = composeContext({
    goal: 'GOAL', agents: 'Vai is an institution', backlog: ['B1'], userGoals: ['G1'],
    responseLoop: 'Improve random user messages and the verifier/updater.',
    toolingGuide: JSON.stringify({ commands: [{ id: 'chat-policy-tests', command: 'vitest chat policy' }] }),
    introspect: { models: [{ name: 'qwen3:8b' }], pipeline: { stages: ['architect', 'coder'] } },
  });
  assert.ok(ctx.includes('PERPETUAL GOAL'));
  assert.ok(ctx.includes('AGENTS.md'));
  assert.ok(ctx.includes('- B1'));
  assert.ok(ctx.includes('- G1'));
  assert.ok(ctx.includes('RESPONSE CAPABILITY LOOP BRIEF'));
  assert.ok(ctx.includes('random user messages'));
  assert.ok(ctx.includes('AGENT TOOLING + VERIFIER MAP'));
  assert.ok(ctx.includes('chat-policy-tests: vitest chat policy'));
  assert.ok(ctx.includes('qwen3:8b'));
  assert.ok(ctx.length <= 4601);
});

test('composeContext: omits optional sections when empty', () => {
  const ctx = composeContext({ goal: 'GOAL' });
  assert.ok(ctx.includes('GOAL'));
  assert.ok(!ctx.includes('AGENTS.md'));
  assert.ok(!ctx.includes('ALREADY IN FLIGHT'));
});

test('assembleContext: reads via injected fs and merges injected introspect', async () => {
  const files = {
    'MASTER_PROMPT.md': '( My app is a voice interface for V3gga. but only Vegga )',
    'AGENTS.md': 'Vai is the institution, models are staff.',
    'docs/vai-improvement-backlog.md': '## Open\n- **Bridge - x to y**\n',
    'docs/vai-response-capability-loop.md': 'Council Mission Prompt: improve random user messages and verifier/updater self-improvement.',
    'docs/agent-tooling-guide.json': '{"commands":[{"id":"chat-policy-tests","command":"vitest chat policy"}],"delegation":{"visibility":"show who was asked and why"}}',
    'Temporary_files/_vetles_user_msgs.txt':
      '--- #1 (200c) ---\nMake the council chain tools and delegate execution between agents so that nothing is ever lost between turns, and Vai can use real tools to finish any task end to end.',
  };
  const fsImpl = { readFileSync: (p) => { if (files[p] == null) throw new Error('nf'); return files[p]; } };
  const r = await assembleContext({ fsImpl, introspect: { models: [{ name: 'qwen3:8b' }] } });
  assert.ok(/voice interface/.test(r.goal));
  assert.deepEqual(r.parts.backlog, ['Bridge - x to y']);
  assert.equal(r.parts.userGoals.length, 1);
  assert.ok(r.parts.responseLoop.includes('random user messages'));
  assert.ok(r.parts.toolingGuide.includes('chat-policy-tests'));
  assert.ok(r.context.includes('qwen3:8b'));
  assert.ok(r.context.includes('institution'));
  assert.ok(r.context.includes('verifier/updater'));
  assert.ok(r.context.includes('show who was asked and why'));
});

test('assembleContext: missing files degrade to north-star, no throw', async () => {
  const fsImpl = { readFileSync: () => { throw new Error('nf'); } };
  const r = await assembleContext({ fsImpl });
  assert.equal(r.goal, PERPETUAL_GOAL);
  assert.deepEqual(r.parts.backlog, []);
  assert.deepEqual(r.parts.userGoals, []);
});

test('summarizeToolingGuide: extracts cheap verifier lanes from JSON guide', () => {
  const text = JSON.stringify({
    commands: [
      { id: 'agent-bootstrap', command: 'pnpm agent:bootstrap' },
      { id: 'chat-policy-tests', command: 'node vitest chat-policy' },
      { id: 'visual-qa', command: 'heavy visual command' },
    ],
    delegation: {
      localCodex: 'delegate bounded work',
      vaiCouncil: 'ask best-fit specialist',
      visibility: 'show why',
    },
  });
  const summary = summarizeToolingGuide(text);
  assert.ok(summary.includes('agent-bootstrap: pnpm agent:bootstrap'));
  assert.ok(summary.includes('chat-policy-tests: node vitest chat-policy'));
  assert.ok(!summary.includes('heavy visual command'));
  assert.ok(summary.includes('ask best-fit specialist'));
});

test('fetchIntrospect: returns null on non-ok / throw (best-effort)', async () => {
  assert.equal(await fetchIntrospect('http://x', { fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await fetchIntrospect('http://x', { fetchImpl: async () => { throw new Error('down'); } }), null);
  const ok = await fetchIntrospect('http://x', { fetchImpl: async () => ({ ok: true, json: async () => ({ models: [] }) }) });
  assert.deepEqual(ok, { models: [] });
});
