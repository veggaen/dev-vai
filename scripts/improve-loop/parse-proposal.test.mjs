import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProposal, repairJsonRegexEscapes } from './parse-proposal.mjs';

test('parseProposal: plain valid JSON still parses', () => {
  const o = parseProposal('{"file":"a.ts","find":"x","replace":"y","why":"z"}');
  assert.equal(o.file, 'a.ts');
});

test('parseProposal: a regex find with \\b and \\s parses (the live false-reject)', () => {
  const raw = String.raw`{"file":"r.ts","find":"if (/\b(?:vs|versus)\b/.test(lower) && !/\s/.test(x)) return false;","replace":"if (false) return false;","why":"narrow"}`;
  const o = parseProposal(raw);
  assert.ok(o, 'should parse via repair');
  // The literal regex escapes must survive so the find still matches source verbatim.
  assert.ok(o.find.includes(String.raw`\b`), 'literal \\b preserved');
  assert.ok(o.find.includes(String.raw`\s`), 'literal \\s preserved');
});

test('parseProposal: extracts the object even with prose around it', () => {
  const o = parseProposal('Here is the fix:\n{"file":"a","find":"f","replace":"r","why":"w"}\nThanks');
  assert.equal(o.find, 'f');
});

test('parseProposal: returns null on no JSON', () => {
  assert.equal(parseProposal('no json here'), null);
  assert.equal(parseProposal(''), null);
  assert.equal(parseProposal(null), null);
});

test('repairJsonRegexEscapes: does not corrupt \\" or \\\\', () => {
  // A find containing an escaped quote must stay valid.
  const raw = String.raw`{"find":"a \"b\" c","x":1}`;
  const o = parseProposal(raw);
  assert.equal(o.find, 'a "b" c');
});

test('repairJsonRegexEscapes: \\d \\w \\. all preserved literally', () => {
  const raw = String.raw`{"find":"/\d+\.\w+/"}`;
  const o = parseProposal(raw);
  assert.equal(o.find, String.raw`/\d+\.\w+/`);
});
