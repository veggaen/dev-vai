import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolCall } from './agent.mjs';

test('parses a bare strict JSON tool call (the easy case)', () => {
  const o = parseToolCall('{"tool":"grep_repo","pattern":"FRESH_DATA"}');
  assert.equal(o.tool, 'grep_repo');
});

test('RESCUES a reasoning model: strips <think> and finds the real tool call after it', () => {
  // deepseek-r1 style: long reasoning (with its own braces) then the answer.
  const raw = '<think>I should look at {the regex} and consider {edge cases}…</think>\n{"tool":"propose","file":"a.ts","find":"const X = /a/;","replace":"const X = /a|b/;"}';
  const o = parseToolCall(raw);
  assert.ok(o, 'must not be silenced');
  assert.equal(o.tool, 'propose');
  assert.equal(o.file, 'a.ts');
});

test('RESCUES a fenced ```json block (common "final answer" format)', () => {
  const raw = 'Here is my fix:\n```json\n{"tool":"propose","file":"b.ts","find":"if (a)","replace":"if (a && b)"}\n```\nDone.';
  const o = parseToolCall(raw);
  assert.equal(o.tool, 'propose');
  assert.equal(o.find, 'if (a)');
});

test('prefers the POST-reasoning object when a stray brace object precedes it', () => {
  const raw = 'My plan: {"note":"first I will grep"} then:\n{"tool":"read_file","path":"x.ts"}';
  const o = parseToolCall(raw);
  assert.equal(o.tool, 'read_file', 'the real tool call wins over the reasoning object');
});

test('handles nested braces in the value (balance-scan, not greedy regex)', () => {
  const raw = '{"tool":"propose","file":"c.ts","find":"obj = { a: 1 }","replace":"obj = { a: 2 }"}';
  const o = parseToolCall(raw);
  assert.equal(o.tool, 'propose');
  assert.match(o.replace, /a: 2/);
});

test('returns null on genuinely empty / non-JSON output (honest abstain)', () => {
  assert.equal(parseToolCall('I am not sure how to fix this.'), null);
  assert.equal(parseToolCall(''), null);
  assert.equal(parseToolCall(null), null);
});
