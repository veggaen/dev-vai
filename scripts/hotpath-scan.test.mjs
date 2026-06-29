// Run: node --test scripts/hotpath-scan.test.mjs
// Verifies the AST detectors fire on the real patterns and DON'T fire on the safe
// equivalents — precision is the point (a scanner that cries wolf is worse than none).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCANNER = join(import.meta.dirname, 'hotpath-scan.mjs');

function scan(source) {
  const dir = mkdtempSync(join(tmpdir(), 'hpscan-'));
  const file = join(dir, 'sample.ts');
  writeFileSync(file, source, 'utf8');
  try {
    const out = execFileSync('node', [SCANNER, file, '--json'], { encoding: 'utf8' });
    return JSON.parse(out).findings;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const detectors = (findings) => new Set(findings.map((f) => f.detector));

test('flags new RegExp built inside a for-loop (the real anti-pattern)', () => {
  const f = scan(`
    function findKey(text: string, keys: string[]) {
      for (const k of keys) {
        const re = new RegExp("\\\\b" + k + "\\\\b", "i");
        if (re.test(text)) return k;
      }
      return null;
    }
  `);
  assert.ok(detectors(f).has('regex-in-loop'), 'should detect regex-in-loop');
});

test('flags new RegExp inside an iterator callback', () => {
  const f = scan(`
    function pick(text: string, keys: string[]) {
      return keys.filter((k) => new RegExp(k, "i").test(text));
    }
  `);
  assert.ok(detectors(f).has('regex-in-loop'), 'iterator-callback regex should be flagged');
});

test('does NOT flag a module-scope constant regex (the correct hoist)', () => {
  const f = scan(`
    const RE = /\\bfoo\\b/i;
    export function check(text: string) { return RE.test(text); }
  `);
  assert.ok(!detectors(f).has('regex-in-loop'));
  assert.ok(!detectors(f).has('regex-per-call'));
});

test('does NOT flag a constant-string new RegExp at module scope', () => {
  const f = scan(`const RE = new RegExp("\\\\bfoo\\\\b", "i");`);
  assert.equal(f.length, 0);
});

test('flags a nested loop (O(n*m) candidate)', () => {
  const f = scan(`
    function pairs(a: number[], b: number[]) {
      const out = [];
      for (const x of a) { for (const y of b) { out.push(x + y); } }
      return out;
    }
  `);
  assert.ok(detectors(f).has('nested-loop'));
});

test('flags new RegExp recompiled per call inside a function (dynamic arg)', () => {
  const f = scan(`
    function match(text: string, key: string) {
      const re = new RegExp(key, "i");
      return re.test(text);
    }
  `);
  assert.ok(detectors(f).has('regex-per-call'));
});

test('clean code produces no findings', () => {
  const f = scan(`
    const RE = /\\d+/;
    export function count(text: string) { return (text.match(RE) ?? []).length; }
  `);
  assert.equal(f.length, 0);
});
