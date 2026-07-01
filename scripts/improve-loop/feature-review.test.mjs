import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSelfMatch,
  parsePeerVote,
  aggregatePeerVotes,
  buildRebuildBrief,
  parseKeepChasing,
  decideShelve,
  tokenizeRejectedIdea,
  ideaOverlap,
  shelveRejectedIdea,
  checkShelvedIdeas,
  flagIdeaRevivable,
  runFeatureReview,
  REVIEW_OUTCOME,
  PEER_ACCEPT_SCORE,
  MODERN_SCALE_FLOOR,
} from './feature-review.mjs';

// ── self-match parsing ──────────────────────────────────────────────────────────
test('parseSelfMatch: reads match/score/gap', () => {
  const p = parseSelfMatch('MATCH: yes\nSCORE: 0.9\nGAP: none');
  assert.equal(p.match, 'yes');
  assert.equal(p.score, 0.9);
  assert.equal(p.gap, 'none');
  assert.ok(p.parsed);
});

test('parseSelfMatch: an out-of-[0,1] score is unparseable (not clamped to a pass)', () => {
  const p = parseSelfMatch('MATCH: yes\nSCORE: 8\nGAP: none');
  assert.equal(p.parsed, false);
  assert.equal(p.score, null);
});

// ── peer vote parsing ──────────────────────────────────────────────────────────
test('parsePeerVote: full accept vote parses with modern/scale/tip', () => {
  const v = parsePeerVote('perf', 'VERDICT: accept\nSCORE: 0.8\nMODERN: 0.7\nSCALE: 0.9\nREASON: clean\nTIP: none');
  assert.equal(v.verdict, 'accept');
  assert.equal(v.score, 0.8);
  assert.equal(v.modern, 0.7);
  assert.equal(v.scale, 0.9);
  assert.equal(v.tip, null, 'TIP: none normalises to null');
  assert.ok(v.parsed);
});

test('parsePeerVote: reject carries reason + tip', () => {
  const v = parsePeerVote('sec', 'VERDICT: reject\nSCORE: 0.3\nMODERN: 0.4\nSCALE: 0.2\nREASON: unvalidated input\nTIP: validate at the gate');
  assert.equal(v.verdict, 'reject');
  assert.equal(v.reason, 'unvalidated input');
  assert.equal(v.tip, 'validate at the gate');
});

test('parsePeerVote: garbage reply is not a vote', () => {
  assert.equal(parsePeerVote('x', 'the change looks fine to me').parsed, false);
});

// ── aggregation: the modernization/scale bias ───────────────────────────────────
test('aggregatePeerVotes: majority accept + good modern/scale → accept', () => {
  const votes = [
    parsePeerVote('a', 'VERDICT: accept\nSCORE: 0.8\nMODERN: 0.8\nSCALE: 0.8\nREASON: ok\nTIP: none'),
    parsePeerVote('b', 'VERDICT: accept\nSCORE: 0.75\nMODERN: 0.7\nSCALE: 0.7\nREASON: ok\nTIP: none'),
    parsePeerVote('c', 'VERDICT: reject\nSCORE: 0.4\nMODERN: 0.5\nSCALE: 0.5\nREASON: nit\nTIP: rename'),
  ];
  const agg = aggregatePeerVotes(votes);
  assert.equal(agg.accept, true);
  assert.equal(agg.acceptCount, 2);
  assert.equal(agg.rejectCount, 1);
});

test('aggregatePeerVotes: majority accept but LOW modern/scale is HELD, not accepted', () => {
  // Everyone likes it locally, but it entrenches a legacy pattern (modern/scale below floor).
  const votes = [
    parsePeerVote('a', 'VERDICT: accept\nSCORE: 0.9\nMODERN: 0.2\nSCALE: 0.2\nREASON: works\nTIP: none'),
    parsePeerVote('b', 'VERDICT: accept\nSCORE: 0.9\nMODERN: 0.3\nSCALE: 0.3\nREASON: works\nTIP: none'),
  ];
  const agg = aggregatePeerVotes(votes);
  assert.equal(agg.accept, false, 'not accepted despite unanimous local approval');
  assert.equal(agg.heldForScale, true, 'flagged as held for scale');
  assert.ok(agg.modernScale < MODERN_SCALE_FLOOR);
});

test('aggregatePeerVotes: an accept vote BELOW the peer score floor counts as a reject', () => {
  const votes = [
    parsePeerVote('a', `VERDICT: accept\nSCORE: ${(PEER_ACCEPT_SCORE - 0.1).toFixed(2)}\nMODERN: 0.9\nSCALE: 0.9\nREASON: meh\nTIP: none`),
    parsePeerVote('b', 'VERDICT: reject\nSCORE: 0.2\nMODERN: 0.9\nSCALE: 0.9\nREASON: no\nTIP: redo'),
  ];
  const agg = aggregatePeerVotes(votes);
  assert.equal(agg.acceptCount, 0, 'lukewarm accept does not count as an accept');
  assert.equal(agg.accept, false);
});

test('aggregatePeerVotes: unparsed replies do not sway the ratio', () => {
  const votes = [
    parsePeerVote('a', 'VERDICT: accept\nSCORE: 0.8\nMODERN: 0.8\nSCALE: 0.8\nREASON: ok\nTIP: none'),
    parsePeerVote('b', 'totally unparseable'),
  ];
  const agg = aggregatePeerVotes(votes);
  assert.equal(agg.parsedCount, 1);
  assert.equal(agg.ratio, 1, 'ratio computed over parsed votes only');
  assert.equal(agg.accept, true);
});

test('aggregatePeerVotes: no parseable votes → not accepted', () => {
  const agg = aggregatePeerVotes([parsePeerVote('a', 'junk'), parsePeerVote('b', 'more junk')]);
  assert.equal(agg.accept, false);
  assert.equal(agg.parsedCount, 0);
});

// ── rebuild brief ──────────────────────────────────────────────────────────────
test('buildRebuildBrief: carries every reject reason + tip', () => {
  const agg = aggregatePeerVotes([
    parsePeerVote('sec', 'VERDICT: reject\nSCORE: 0.3\nMODERN: 0.5\nSCALE: 0.5\nREASON: hostile input path\nTIP: validate at gate'),
    parsePeerVote('perf', 'VERDICT: reject\nSCORE: 0.4\nMODERN: 0.5\nSCALE: 0.5\nREASON: extra model call\nTIP: short-circuit'),
  ]);
  const brief = buildRebuildBrief(agg, { instruction: 'add X' });
  assert.match(brief, /hostile input path/);
  assert.match(brief, /validate at gate/);
  assert.match(brief, /short-circuit/);
  assert.match(brief, /add X/);
});

test('buildRebuildBrief: notes the scale hold when heldForScale', () => {
  const agg = aggregatePeerVotes([
    parsePeerVote('a', 'VERDICT: accept\nSCORE: 0.9\nMODERN: 0.2\nSCALE: 0.2\nREASON: works\nTIP: none'),
    parsePeerVote('b', 'VERDICT: accept\nSCORE: 0.9\nMODERN: 0.2\nSCALE: 0.2\nREASON: works\nTIP: none'),
  ]);
  const brief = buildRebuildBrief(agg, { instruction: 'add X' });
  assert.match(brief, /modern\/scalable/i);
});

// ── keep-chasing + shelve decision ──────────────────────────────────────────────
test('parseKeepChasing: reads the extra question', () => {
  const k = parseKeepChasing('a', 'VERDICT: reject\nREASON: dead end\nKEEP_CHASING: no');
  assert.equal(k.keepChasing, false);
  assert.equal(k.reason, 'dead end');
});

test('decideShelve: ALL peers say stop → shelve', () => {
  const votes = [
    parseKeepChasing('a', 'VERDICT: reject\nREASON: x\nKEEP_CHASING: no'),
    parseKeepChasing('b', 'VERDICT: reject\nREASON: y\nKEEP_CHASING: no'),
  ];
  const d = decideShelve(votes);
  assert.equal(d.shelve, true);
});

test('decideShelve: one champion (keep=yes) → do NOT shelve, hold instead', () => {
  const votes = [
    parseKeepChasing('a', 'VERDICT: reject\nREASON: x\nKEEP_CHASING: no'),
    parseKeepChasing('b', 'VERDICT: reject\nREASON: but promising\nKEEP_CHASING: yes'),
  ];
  const d = decideShelve(votes);
  assert.equal(d.shelve, false);
  assert.deepEqual(d.championIds, ['b']);
});

test('decideShelve: a peer who flipped to accept counts as a champion', () => {
  const votes = [
    parseKeepChasing('a', 'VERDICT: accept\nREASON: fixed now\nKEEP_CHASING: no'),
    parseKeepChasing('b', 'VERDICT: reject\nREASON: x\nKEEP_CHASING: no'),
  ];
  assert.equal(decideShelve(votes).shelve, false);
});

test('decideShelve: no parseable votes → do not shelve on silence', () => {
  assert.equal(decideShelve([parseKeepChasing('a', 'huh')]).shelve, false);
});

// ── tokenized shelf + overlap ───────────────────────────────────────────────────
test('tokenizeRejectedIdea: order-independent, stopwords dropped, stable id', () => {
  // Same salient words, different ORDER (and stopwords sprinkled differently) → same key.
  const a = tokenizeRejectedIdea({ instruction: 'add a voice barge-in interrupt to streaming', file: 'x.ts', reasons: ['scope creep'] });
  const b = tokenizeRejectedIdea({ instruction: 'the streaming interrupt: barge-in for voice', file: 'x.ts', reasons: ['creep of scope'] });
  assert.equal(a.key, b.key, 'same salient tokens regardless of order/phrasing');
  assert.equal(a.id, b.id, 'stable hash id');
  assert.ok(!a.tokens.includes('the') && !a.tokens.includes('add'), 'stopwords excluded');
  assert.ok(a.tokens.includes('barge-in') || a.tokens.includes('barge'), 'salient token kept');
});

test('ideaOverlap: Jaccard of token sets', () => {
  assert.equal(ideaOverlap(['a', 'b', 'c'], ['a', 'b', 'c']), 1);
  assert.equal(ideaOverlap(['a', 'b'], ['c', 'd']), 0);
  assert.equal(ideaOverlap([], ['a']), 0);
  assert.ok(Math.abs(ideaOverlap(['a', 'b', 'c', 'd'], ['a', 'b']) - 0.5) < 1e-9);
});

// ── shelf DB round-trip with an in-memory fake ──────────────────────────────────
function fakeKnowledgeStore() {
  const rows = new Map(); // key -> { claim, confirmations, contradictions, evidence, kind }
  return {
    rows,
    recordKnowledge(_db, { scope, claim, confirm = true, evidence, kind }) {
      const id = `${scope}::${claim}`;
      const cur = rows.get(id) ?? { claim, confirmations: 0, contradictions: 0, evidence: null, kind };
      cur.confirmations += confirm ? 1 : 0;
      cur.contradictions += confirm ? 0 : 1;
      if (evidence != null) cur.evidence = evidence;
      rows.set(id, cur);
    },
    topKnowledge(_db, scope) {
      return [...rows.entries()].filter(([id]) => id.startsWith(`${scope}::`)).map(([, r]) => r);
    },
    knowledgeConfidence(r) {
      const c = Number(r?.confirmations ?? 0);
      const x = Number(r?.contradictions ?? 0);
      return (c + 1) / (c + x + 2);
    },
  };
}

test('shelveRejectedIdea → checkShelvedIdeas: a similar message pulls the shelved idea', () => {
  const store = fakeKnowledgeStore();
  const db = {};
  shelveRejectedIdea(db, { instruction: 'add a crypto price ticker widget to the dashboard', file: 'd.ts', reasons: ['out of scope'] }, store);
  const hits = checkShelvedIdeas(db, 'can you build a dashboard crypto price ticker widget', store);
  assert.equal(hits.length, 1, 'the overlapping shelved idea is surfaced');
  assert.equal(hits[0].revivable, false, 'freshly shelved (high confidence) is still-dead, not revivable');
});

test('checkShelvedIdeas: an unrelated message pulls nothing', () => {
  const store = fakeKnowledgeStore();
  const db = {};
  shelveRejectedIdea(db, { instruction: 'add a crypto price ticker widget', file: 'd.ts', reasons: ['scope'] }, store);
  assert.equal(checkShelvedIdeas(db, 'what is the capital of Japan', store).length, 0);
});

test('flagIdeaRevivable: enough revival flags flip a shelved idea to revivable', () => {
  const store = fakeKnowledgeStore();
  const db = {};
  const fp = shelveRejectedIdea(db, { instruction: 'streaming voice barge-in interrupt support', file: 'v.ts', reasons: ['too early'] }, store);
  // Freshly shelved: not revivable.
  assert.equal(checkShelvedIdeas(db, 'streaming voice barge-in interrupt', store)[0].revivable, false);
  // Several members flag new knowledge → contradictions accumulate → confidence decays below floor.
  flagIdeaRevivable(db, fp.key, { personaId: 'a', evidence: 'STT now local' }, store);
  flagIdeaRevivable(db, fp.key, { personaId: 'b', evidence: 'barge-in lib added' }, store);
  flagIdeaRevivable(db, fp.key, { personaId: 'c' }, store);
  const hit = checkShelvedIdeas(db, 'streaming voice barge-in interrupt', store)[0];
  assert.equal(hit.revivable, true, 'new knowledge from several members makes it revivable again');
});

// ── the full state machine ──────────────────────────────────────────────────────
function peerVotes(specs) {
  // specs: [[personaId, rawReply], ...]
  return specs.map(([id, raw]) => parsePeerVote(id, raw));
}

test('runFeatureReview: accept on first pass → INTEGRATED', async () => {
  const effects = {
    build: async () => ({ file: 'f.ts', summary: 'did X', diff: '+ did X' }),
    selfMatch: async () => 'MATCH: yes\nSCORE: 0.9\nGAP: none',
    peerReview: async () => peerVotes([
      ['a', 'VERDICT: accept\nSCORE: 0.85\nMODERN: 0.8\nSCALE: 0.8\nREASON: ok\nTIP: none'],
      ['b', 'VERDICT: accept\nSCORE: 0.8\nMODERN: 0.7\nSCALE: 0.7\nREASON: ok\nTIP: none'],
    ]),
    keepChasing: async () => { throw new Error('should not be called'); },
    integrate: async () => ({ ok: true, detail: 'committed' }),
    shelve: async () => { throw new Error('should not shelve'); },
  };
  const r = await runFeatureReview({ instruction: 'build X' }, effects);
  assert.equal(r.outcome, REVIEW_OUTCOME.INTEGRATED);
});

test('runFeatureReview: reject → rebuild → accept → INTEGRATED', async () => {
  let builds = 0;
  const effects = {
    build: async () => { builds++; return { file: 'f.ts', summary: `v${builds}`, diff: `+ v${builds}` }; },
    selfMatch: async () => 'MATCH: yes\nSCORE: 0.8\nGAP: none',
    peerReview: async () => (builds === 1
      ? peerVotes([['a', 'VERDICT: reject\nSCORE: 0.3\nMODERN: 0.5\nSCALE: 0.5\nREASON: nope\nTIP: do Y']])
      : peerVotes([['a', 'VERDICT: accept\nSCORE: 0.9\nMODERN: 0.8\nSCALE: 0.8\nREASON: better\nTIP: none']])),
    keepChasing: async () => { throw new Error('should not reach keep-chasing'); },
    integrate: async () => ({ ok: true }),
    shelve: async () => { throw new Error('no shelve'); },
  };
  const r = await runFeatureReview({ instruction: 'build X' }, effects);
  assert.equal(r.outcome, REVIEW_OUTCOME.INTEGRATED);
  assert.equal(builds, 2, 'rebuilt exactly once');
});

test('runFeatureReview: reject twice + all say stop → SHELVED with a fingerprint', async () => {
  const effects = {
    build: async () => ({ file: 'f.ts', summary: 'v', diff: '+ v' }),
    selfMatch: async () => 'MATCH: partial\nSCORE: 0.5\nGAP: still missing Y',
    peerReview: async () => peerVotes([
      ['a', 'VERDICT: reject\nSCORE: 0.3\nMODERN: 0.5\nSCALE: 0.5\nREASON: bad\nTIP: redo'],
      ['b', 'VERDICT: reject\nSCORE: 0.3\nMODERN: 0.5\nSCALE: 0.5\nREASON: worse\nTIP: rethink'],
    ]),
    keepChasing: async () => [
      parseKeepChasing('a', 'VERDICT: reject\nREASON: dead\nKEEP_CHASING: no'),
      parseKeepChasing('b', 'VERDICT: reject\nREASON: end\nKEEP_CHASING: no'),
    ],
    integrate: async () => { throw new Error('should not integrate'); },
    shelve: async (idea) => shelveRejectedIdea({}, idea, fakeKnowledgeStore()),
  };
  const r = await runFeatureReview({ instruction: 'build the impossible thing' }, effects);
  assert.equal(r.outcome, REVIEW_OUTCOME.SHELVED);
  assert.ok(r.fingerprint?.id, 'a tokenized fingerprint was produced');
});

test('runFeatureReview: reject twice but a champion remains → HELD (not shelved)', async () => {
  const effects = {
    build: async () => ({ file: 'f.ts', summary: 'v', diff: '+ v' }),
    selfMatch: async () => 'MATCH: yes\nSCORE: 0.7\nGAP: none',
    peerReview: async () => peerVotes([['a', 'VERDICT: reject\nSCORE: 0.3\nMODERN: 0.5\nSCALE: 0.5\nREASON: no\nTIP: redo']]),
    keepChasing: async () => [
      parseKeepChasing('a', 'VERDICT: reject\nREASON: but close\nKEEP_CHASING: yes'),
    ],
    integrate: async () => { throw new Error('no'); },
    shelve: async () => { throw new Error('should not shelve with a champion'); },
  };
  const r = await runFeatureReview({ instruction: 'build X' }, effects);
  assert.equal(r.outcome, REVIEW_OUTCOME.HELD);
});

test('runFeatureReview: build produces nothing → ABORTED', async () => {
  const effects = {
    build: async () => null,
    selfMatch: async () => { throw new Error('no'); },
    peerReview: async () => { throw new Error('no'); },
    keepChasing: async () => { throw new Error('no'); },
    integrate: async () => { throw new Error('no'); },
    shelve: async () => { throw new Error('no'); },
  };
  const r = await runFeatureReview({ instruction: 'x' }, effects);
  assert.equal(r.outcome, REVIEW_OUTCOME.ABORTED);
});

test('runFeatureReview: a hard self-match "no" blocks integration even if peers accept', async () => {
  let builds = 0;
  const effects = {
    build: async () => { builds++; return { file: 'f.ts', summary: `v${builds}`, diff: `+ v${builds}` }; },
    // Self says we did NOT build the asked thing — must not integrate on the first pass.
    selfMatch: async () => (builds === 1 ? 'MATCH: no\nSCORE: 0.2\nGAP: the asked behaviour is missing' : 'MATCH: yes\nSCORE: 0.9\nGAP: none'),
    peerReview: async () => peerVotes([['a', 'VERDICT: accept\nSCORE: 0.9\nMODERN: 0.9\nSCALE: 0.9\nREASON: looks fine\nTIP: none']]),
    keepChasing: async () => { throw new Error('should not reach'); },
    integrate: async () => ({ ok: true }),
    shelve: async () => { throw new Error('no'); },
  };
  const r = await runFeatureReview({ instruction: 'build X' }, effects);
  assert.equal(r.outcome, REVIEW_OUTCOME.INTEGRATED);
  assert.equal(builds, 2, 'self-match=no forced a rebuild before integrating');
});
