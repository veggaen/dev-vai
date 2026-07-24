// Run: node --test scripts/improve-loop/capability-engine.test.mjs
// Pure/injectable parts — no node:sqlite, no real model/disk needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProposal,
  normalizeProposal,
  dedupeProposals,
  rankProposals,
  formatBacklogEntry,
  appendProposalsToBacklog,
  proposeCapability,
  runCapabilityRound,
  synthesizeRound,
  recordComputeRound,
  computeRoiSeries,
  markRoundAdopted,
} from './capability-engine.mjs';

const LENS = { id: 'multimodal-voice', area: 'voice', title: 't', lens: 'l' };

test('runCapabilityRound: adoption pause prevents direct model and filesystem work', async (t) => {
  let openDb;
  try { ({ openDb } = await import('./db.mjs')); }
  catch { return t.skip('node:sqlite unavailable (run with --experimental-sqlite)'); }
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rmSync } = await import('node:fs');
  const dbPath = join(tmpdir(), `vai-cap-pause-${Date.now()}.sqlite`);
  const db = openDb(dbPath);
  try {
    recordComputeRound(db, { modelCalls: 10, proposals: 4, qualified: 4 });
    recordComputeRound(db, { modelCalls: 10, proposals: 4, qualified: 4 });
    recordComputeRound(db, { modelCalls: 10, proposals: 4, qualified: 4 });
    let generated = 0;
    const out = await runCapabilityRound({
      db,
      fsImpl: { readFileSync: () => { throw new Error('filesystem should not be touched'); } },
      generateFor: async () => { generated += 1; return '{}'; },
    });
    assert.equal(out.paused, true);
    assert.equal(out.compute.modelCalls, 0);
    assert.equal(out.lensesRun, 0);
    assert.equal(generated, 0);
    assert.equal(computeRoiSeries(db, 10).length, 3);
  } finally {
    db.close();
    rmSync(dbPath, { force: true });
  }
});

test('parseProposal: extracts the JSON object, null on garbage', () => {
  assert.equal(parseProposal('blah {"tool":"propose","title":"x"} tail').tool, 'propose');
  assert.equal(parseProposal('no json here'), null);
  assert.equal(parseProposal('{bad json}'), null);
});

test('normalizeProposal: requires title+capability, defaults area from lens, arrays', () => {
  const p = normalizeProposal({ title: 'Voice', capability: 'speak', evidence: 'a.ts:1', steps: ['s1'] }, LENS);
  assert.equal(p.area, 'voice');
  assert.deepEqual(p.evidence, ['a.ts:1']);
  assert.deepEqual(p.steps, ['s1']);
  assert.equal(p.lens, 'multimodal-voice');
  assert.equal(normalizeProposal({ title: 'only title' }, LENS), null);
  assert.equal(normalizeProposal(null), null);
});

test('dedupeProposals: drops self-dups, backlog matches, and prior capabilities', () => {
  const props = [
    { area: 'voice', title: 'Add voice turn loop' },
    { area: 'voice', title: 'Add voice turn loop again now' }, // dup by area+first words
    { area: 'tooling', title: 'Tool chaining engine' },
    { area: 'vision', title: 'Image input pipeline' },
  ];
  const out = dedupeProposals(props, {
    backlog: ['Tool chaining engine for agents'],   // first-3-words match → drops tooling one
    prior: [{ area: 'vision', title: 'Image input pipeline' }],
  });
  assert.deepEqual(out.map((p) => p.area), ['voice']);
});

test('rankProposals: attaches scores and sorts highest-impact first', () => {
  const strong = {
    area: 'voice', title: 'Voice turn', capability: 'let V3gga speak to Vai and hear replies',
    evidence: ['packages/core/src/chat/service.ts:42', 'scripts/improve-loop/driver.mjs'],
    steps: ['a', 'b'], firstSlice: 'add STT', verify: 'speak then assert',
  };
  const weak = { area: 'misc', title: 'better', capability: 'improve' };
  const ranked = rankProposals([weak, strong]);
  assert.equal(ranked[0].title, 'Voice turn');
  assert.ok(ranked[0].score.impact > ranked[1].score.impact);
});

test('formatBacklogEntry: renders a dated, scored, propose-only entry', () => {
  const ranked = rankProposals([{
    area: 'voice', title: 'Voice turn', capability: 'speak to Vai',
    evidence: ['a.ts:1'], firstSlice: 'add STT', verify: 'speak then assert',
  }]);
  const council = { overall: 6.2, verdict: 'workable', headline: 'council 6.2/10', lesson: 'weakest: chaining' };
  const md = formatBacklogEntry(ranked, council, { date: '2026-06-24' });
  assert.ok(md.includes('Capability-Innovation 2026-06-24'));
  assert.ok(md.includes('[voice] Voice turn'));
  assert.ok(md.includes('first slice: add STT'));
  assert.ok(md.includes('PROPOSE-only'));
});

test('appendProposalsToBacklog: inserts under ## Open, preserves existing items', () => {
  let written = '';
  const md = '# Vai Improvement Backlog\n\n## Open\n\n- **Existing item**\n';
  const fs = { readFileSync: () => md, writeFileSync: (_p, c) => { written = c; } };
  appendProposalsToBacklog(fs, '- **New entry**\n');
  assert.ok(written.indexOf('## Open') >= 0);
  assert.ok(written.indexOf('New entry') < written.indexOf('Existing item'));
});

test('proposeCapability: investigates then proposes (injected generate)', async () => {
  const calls = [];
  const generate = async (convo) => {
    // First reply: a tool call. After a real result is in the convo: propose.
    if (!convo.includes('[real result]')) return '{"tool":"grep_repo","pattern":"voice"}';
    return JSON.stringify({
      tool: 'propose', area: 'voice', title: 'Voice turn', capability: 'speak to Vai',
      evidence: ['scripts/improve-loop/driver.mjs:1'], firstSlice: 'add STT', verify: 'speak',
    });
  };
  const runToolImpl = async (c) => { calls.push(c.tool); return 'driver.mjs:1: export function ...'; };
  const { proposal, transcript } = await proposeCapability({ lens: LENS, context: 'CTX', generate, runToolImpl });
  assert.equal(proposal.title, 'Voice turn');
  assert.deepEqual(calls, ['grep_repo']);
  assert.ok(transcript.some((t) => /PROPOSE/.test(t)));
});

test('proposeCapability: threads prior proposals + parses buildsOn', async () => {
  let sawRoundSoFar = false;
  const generate = async (convo) => {
    if (convo.includes('ROUND SO FAR')) sawRoundSoFar = true;
    if (!convo.includes('[real result]')) return '{"tool":"grep_repo","pattern":"x"}';
    return JSON.stringify({
      tool: 'propose', area: 'tooling', title: 'Tool chain', capability: 'chain tool outputs',
      evidence: ['scripts/improve-loop/tools.mjs:1'], firstSlice: 'two-step chain', verify: 'assert',
      buildsOn: 'Voice turn',
    });
  };
  const runToolImpl = async () => 'tools.mjs:1: export ...';
  const prior = [{ area: 'voice', title: 'Voice turn', capability: 'speak to Vai' }];
  const { proposal } = await proposeCapability({ lens: LENS, context: 'CTX', generate, runToolImpl, priorProposals: prior });
  assert.equal(sawRoundSoFar, true);
  assert.equal(proposal.buildsOn, 'Voice turn');
});

test('synthesizeRound: chair converges siblings into a grounded, linked proposal', async () => {
  const proposals = [
    { area: 'voice', title: 'Streaming Voice Turn', capability: 'speak to Vai live', evidence: ['a.ts:1'] },
    { area: 'council', title: 'Convergence Vote', capability: 'council agrees on an outcome', evidence: ['b.ts:2'] },
  ];
  const generate = async () => JSON.stringify({
    title: 'Live Voice Council', capability: 'speak to Vai and watch the council converge live',
    buildsOn: ['Streaming Voice Turn', 'Convergence Vote'], firstSlice: 'stream the vote', why: 'voice north-star',
  });
  const synth = await synthesizeRound({ proposals, generate });
  assert.ok(synth.title.startsWith('Synthesis:'));
  assert.equal(synth.area, 'council');
  assert.ok(/Streaming Voice Turn/.test(synth.buildsOn) && /Convergence Vote/.test(synth.buildsOn));
  assert.deepEqual(synth.evidence, ['a.ts:1', 'b.ts:2']); // union of the linked siblings' evidence
});

test('synthesizeRound: returns null when nothing converges or input too small', async () => {
  const none = await synthesizeRound({ proposals: [
    { area: 'voice', title: 'A', capability: 'x' }, { area: 'tooling', title: 'B', capability: 'y' },
  ], generate: async () => '{"none":true}' });
  assert.equal(none, null);
  assert.equal(await synthesizeRound({ proposals: [{ area: 'voice', title: 'A', capability: 'x' }], generate: async () => '{}' }), null);
});

test('runCapabilityRound: full round with injected model/fs, no db', async () => {
  const files = {
    'MASTER_PROMPT.md': '( My app is a voice interface for V3gga. but only Vegga )',
    'AGENTS.md': 'Vai is the institution.',
    'docs/vai-improvement-backlog.md': '# B\n\n## Open\n\n',
    'Temporary_files/_vetles_user_msgs.txt': '',
  };
  let backlogWritten = '';
  const fsImpl = {
    readFileSync: (p) => { if (files[p] == null) throw new Error('nf'); return files[p]; },
    writeFileSync: (p, c) => { if (/backlog/.test(p)) backlogWritten = c; files[p] = c; },
  };
  // Each lens proposes a distinct, well-formed capability after one tool step.
  const generateFor = async (lens, convo) => {
    if (!convo.includes('[real result]')) return '{"tool":"grep_repo","pattern":"x"}';
    return JSON.stringify({
      tool: 'propose', area: lens.area, title: `Upgrade ${lens.area}`,
      capability: `make Vai better at ${lens.area} with real tools and verification`,
      evidence: ['scripts/improve-loop/driver.mjs:1'], steps: ['a', 'b'],
      firstSlice: `ship a small ${lens.area} slice`, verify: 'assert it works',
    });
  };
  const out = await runCapabilityRound({
    db: null, fsImpl, focus: 'voice', maxSteps: 4,
    generateFor, vramGuard: async () => {},
  });
  assert.ok(out.ranked.length >= 1);
  assert.ok(out.council.overall >= 0);
  assert.equal(out.recorded, 0); // no db
  assert.ok(backlogWritten.includes('Capability-Innovation'));
  assert.ok(out.lensesRun >= 1);
});

// node:sqlite roundtrip — skipped without --experimental-sqlite so this file still runs flag-free.
test('markRoundAdopted: turns a recorded round into REALIZED ROI (sqlite)', async (t) => {
  let openDb;
  try { ({ openDb } = await import('./db.mjs')); }
  catch { return t.skip('node:sqlite unavailable (run with --experimental-sqlite)'); }
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rmSync } = await import('node:fs');
  const dbPath = join(tmpdir(), `vai-cap-roi-${Date.now()}.sqlite`);
  const db = openDb(dbPath);
  try {
    const id = recordComputeRound(db, { modelCalls: 10, wallMs: 5000, proposals: 3, qualified: 2 });
    assert.ok(id > 0);
    assert.equal(computeRoiSeries(db, 5)[0].adopted, 0); // never shipped yet → realized 0
    assert.equal(markRoundAdopted(db, id, 1), 1);        // one ships → realized becomes real
    assert.equal(markRoundAdopted(db, id, 2), 3);        // increments, never overwrites
    assert.equal(markRoundAdopted(db, id + 999), 0);     // unknown id → no-op
    assert.equal(markRoundAdopted(db, 0), 0);            // invalid id → no-op
    assert.equal(markRoundAdopted(db, -4), 0);
    assert.equal(computeRoiSeries(db, 5)[0].adopted, 3); // persisted
  } finally {
    db.close();
    rmSync(dbPath, { force: true });
  }
});
