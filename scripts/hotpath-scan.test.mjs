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

function scan(source, fileName = 'sample.ts', extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'hpscan-'));
  const file = join(dir, fileName);
  writeFileSync(file, source, 'utf8');
  try {
    const out = execFileSync('node', [SCANNER, file, '--json', ...extraArgs], { encoding: 'utf8' });
    return JSON.parse(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const findingsFor = (source, fileName = 'sample.ts', extraArgs = []) => scan(source, fileName, extraArgs).findings;
const detectors = (findings) => new Set(findings.map((f) => f.detector));

test('flags new RegExp built inside a for-loop (the real anti-pattern)', () => {
  const f = findingsFor(`
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
  const f = findingsFor(`
    function pick(text: string, keys: string[]) {
      return keys.filter((k) => new RegExp(k, "i").test(text));
    }
  `);
  assert.ok(detectors(f).has('regex-in-loop'), 'iterator-callback regex should be flagged');
});

test('does NOT flag a module-scope constant regex (the correct hoist)', () => {
  const f = findingsFor(`
    const RE = /\\bfoo\\b/i;
    export function check(text: string) { return RE.test(text); }
  `);
  assert.ok(!detectors(f).has('regex-in-loop'));
  assert.ok(!detectors(f).has('regex-per-call'));
});

test('does NOT flag a constant-string new RegExp at module scope', () => {
  const f = findingsFor(`const RE = new RegExp("\\\\bfoo\\\\b", "i");`);
  assert.equal(f.length, 0);
});

test('does NOT flag module-scope iterator callbacks used to precompile regex tables', () => {
  const f = findingsFor(`
    const CLAUSES = [/foo/i, /bar/i];
    const ANCHORED = CLAUSES.map((clause) => new RegExp("^" + clause.source, "i"));
    export function check(text: string) { return ANCHORED.some((re) => re.test(text)); }
  `);
  assert.equal(f.length, 0);
});

test('flags a nested loop (O(n*m) candidate)', () => {
  const f = findingsFor(`
    function pairs(a: number[], b: number[]) {
      const out = [];
      for (const x of a) { for (const y of b) { out.push(x + y); } }
      return out;
    }
  `);
  assert.ok(detectors(f).has('nested-loop'));
});

test('flags new RegExp recompiled per call inside a function (dynamic arg)', () => {
  const f = findingsFor(`
    function match(text: string, key: string) {
      const re = new RegExp(key, "i");
      return re.test(text);
    }
  `);
  assert.ok(detectors(f).has('regex-per-call'));
});

test('clean code produces no findings', () => {
  const f = findingsFor(`
    const RE = /\\d+/;
    export function count(text: string) { return (text.match(RE) ?? []).length; }
  `);
  assert.equal(f.length, 0);
});

test('parses TSX files when scanning UI code', () => {
  const f = findingsFor(`
    export function Search({ keys, text }: { keys: string[]; text: string }) {
      const hits = keys.filter((key) => new RegExp(key, "i").test(text));
      return <div>{hits.length}</div>;
    }
  `, 'sample.tsx');
  assert.ok(detectors(f).has('regex-in-loop'), 'TSX iterator regex should be flagged');
});

test('parses MJS files when scanning scripts', () => {
  const f = findingsFor(`
    export function find(text, keys) {
      for (const key of keys) {
        if (new RegExp(key, "i").test(text)) return key;
      }
      return null;
    }
  `, 'sample.mjs');
  assert.ok(detectors(f).has('regex-in-loop'), 'MJS loop regex should be flagged');
});

test('json output includes roots and per-detector summary', () => {
  const report = scan(`
    function match(text: string, key: string) {
      return new RegExp(key, "i").test(text);
    }
  `);
  assert.equal(report.scanned, 1);
  assert.deepEqual(report.roots.length, 1);
  assert.equal(report.summary['regex-per-call'], 1);
});

test('--all uses the broad codebase root set when no explicit root is passed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hpscan-empty-'));
  try {
    const out = execFileSync('node', [SCANNER, '--all', '--json'], { cwd: dir, encoding: 'utf8' });
    const report = JSON.parse(out);
    assert.ok(report.roots.includes('packages/core/src'));
    assert.ok(report.roots.includes('apps/desktop/src'));
    assert.ok(report.roots.includes('scripts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
