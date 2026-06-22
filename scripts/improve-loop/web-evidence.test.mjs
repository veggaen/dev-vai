// Run: node --test scripts/improve-loop/web-evidence.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFixWebEvidence, fixSearchQuery } from './web-evidence.mjs';

test('fixSearchQuery builds a focused query from symptom, empty when nothing', () => {
  assert.match(fixSearchQuery('routing/x', 'guard treats build verb as disqualifying'), /how to correctly handle/i);
  assert.equal(fixSearchQuery('', ''), '');
});

test('returns a prompt-ready block from /api/search sources', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ sources: [
    { title: 'MDN: Array.flat', text: 'flat() creates a new array with sub-array elements concatenated.' },
    { domain: 'stackoverflow.com', snippet: 'use Number.isFinite not isNaN' },
  ] }) });
  const block = await fetchFixWebEvidence({ query: 'q', fetchImpl });
  assert.match(block, /FREE WEB EVIDENCE/);
  assert.match(block, /MDN: Array\.flat/);
  assert.match(block, /stackoverflow\.com/);
});

test('empty query → no fetch, empty block', async () => {
  let called = false;
  await fetchFixWebEvidence({ query: '', fetchImpl: async () => { called = true; return {}; } });
  assert.equal(called, false);
});

test('best-effort: a failed/!ok fetch yields empty (never blocks the fix)', async () => {
  assert.equal(await fetchFixWebEvidence({ query: 'q', fetchImpl: async () => { throw new Error('down'); } }), '');
  assert.equal(await fetchFixWebEvidence({ query: 'q', fetchImpl: async () => ({ ok: false }) }), '');
  assert.equal(await fetchFixWebEvidence({ query: 'q', fetchImpl: async () => ({ ok: true, json: async () => ({ sources: [] }) }) }), '');
});
