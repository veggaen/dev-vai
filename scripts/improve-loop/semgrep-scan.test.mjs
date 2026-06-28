// Run: node --test scripts/improve-loop/semgrep-scan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semgrepScan, hasBlockingFinding, formatSemgrep } from './semgrep-scan.mjs';

const okRunner = (stdout) => () => ({ notFound: false, code: stdout.includes('"results": [') ? 0 : 1, stdout });

test('graceful when semgrep is not installed (free, optional binary)', () => {
  const scan = semgrepScan({ runner: () => ({ notFound: true, code: -1, stdout: '' }) });
  assert.equal(scan.available, false);
  assert.equal(scan.findings.length, 0);
  assert.match(scan.error, /not installed/);
  assert.equal(hasBlockingFinding(scan), false); // unavailable never blocks
});

test('parses + sorts findings by severity (ERROR first)', () => {
  const json = JSON.stringify({ results: [
    { path: 'a.ts', start: { line: 5 }, check_id: 'js.lint.warn', extra: { severity: 'WARNING', message: 'minor' } },
    { path: 'b.ts', start: { line: 9 }, check_id: 'js.sec.eval', extra: { severity: 'ERROR', message: 'eval is dangerous' } },
  ] });
  const scan = semgrepScan({ runner: okRunner(json) });
  assert.equal(scan.available, true);
  assert.equal(scan.findings[0].severity, 'ERROR'); // sorted worst-first
  assert.equal(scan.findings[0].ruleId, 'js.sec.eval');
  assert.equal(hasBlockingFinding(scan), true);
});

test('clean scan (no results) → no blocking, clean message', () => {
  const scan = semgrepScan({ runner: okRunner('{"results": []}') });
  assert.equal(scan.findings.length, 0);
  assert.equal(hasBlockingFinding(scan), false);
  assert.match(formatSemgrep(scan), /clean/);
});

test('a non-zero run failure (exit >= 2) is not a clean scan and blocks', () => {
  // exit 2 = semgrep crashed/config-errored — must NOT read as clean (CodeRabbit #25).
  const scan = semgrepScan({ runner: () => ({ notFound: false, code: 2, stdout: 'panic: not json' }) });
  assert.equal(scan.available, true);
  assert.equal(scan.failed, true);
  assert.match(scan.error, /run failed/);
  assert.equal(hasBlockingFinding(scan), true);
});

test('unparseable output on a normal exit is handled (available, no findings, error noted)', () => {
  const scan = semgrepScan({ runner: () => ({ notFound: false, code: 1, stdout: 'panic: not json' }) });
  assert.equal(scan.available, true);
  assert.match(scan.error, /unparseable/);
  assert.equal(hasBlockingFinding(scan), true); // a scan we couldn't read is not a green light
});
