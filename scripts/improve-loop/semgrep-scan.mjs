/**
 * Semgrep OSS scan — a FREE, LOCAL static-analysis check for the audit→fix loop (Phase 1 of
 * "use all free tools"). Runs `semgrep` on a file/path and returns structured findings, so the
 * loop can (a) flag a proposed fix that introduces a security/quality issue, and (b) feed the
 * Thorsen 5-phase audit with real pattern findings — no cloud, no key, no cost.
 *
 * Graceful: Semgrep is an OPTIONAL local binary. If it isn't installed we return
 * { available:false, findings:[] } and the loop simply proceeds without it — never a blocker.
 * The runner is injected so this unit-tests offline (no semgrep, no fs).
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/** Severity rank for sorting/gating (higher = worse). */
export const SEMGREP_SEVERITY_RANK = { ERROR: 3, WARNING: 2, INFO: 1 };

/** Default runner: shells semgrep with JSON output. Returns { code, stdout, notFound }. */
function defaultRunner(targets, configArg, timeoutMs) {
  const r = spawnSync('semgrep', ['--config', configArg, '--json', '--quiet', '--timeout', '60', ...targets], {
    cwd: ROOT, encoding: 'utf8', timeout: timeoutMs,
  });
  // ENOENT (binary missing) surfaces on r.error with code 'ENOENT'.
  if (r.error && r.error.code === 'ENOENT') return { notFound: true, code: -1, stdout: '' };
  return { notFound: false, code: r.status ?? 1, stdout: r.stdout ?? '' };
}

/**
 * Scan `targets` (file/dir paths relative to repo root) with Semgrep.
 * @param opts { targets, config?, runner?, timeoutMs? }
 * @returns { available, findings:[{path,line,ruleId,severity,message}], error? }
 */
export function semgrepScan({ targets = ['.'], config = 'auto', runner = defaultRunner, timeoutMs = 120_000 } = {}) {
  const list = Array.isArray(targets) ? targets : [targets];
  const res = runner(list, config, timeoutMs);
  if (res.notFound) {
    return { available: false, findings: [], error: 'semgrep not installed (free: pip install semgrep) — skipped' };
  }
  // semgrep exits 0 (no findings) or 1 (findings present); both yield JSON on stdout.
  let parsed;
  try { parsed = JSON.parse(res.stdout || '{}'); } catch { return { available: true, findings: [], error: 'unparseable semgrep output' }; }
  const findings = (parsed.results ?? []).map((f) => ({
    path: f.path,
    line: f.start?.line ?? 0,
    ruleId: f.check_id ?? 'unknown',
    severity: (f.extra?.severity ?? 'INFO').toUpperCase(),
    message: (f.extra?.message ?? '').split('\n')[0].slice(0, 200),
  })).sort((a, b) => (SEMGREP_SEVERITY_RANK[b.severity] ?? 0) - (SEMGREP_SEVERITY_RANK[a.severity] ?? 0));
  return { available: true, findings };
}

/** True when a scan turned up an ERROR-severity finding (the loop's "don't auto-apply" signal). */
export function hasBlockingFinding(scan) {
  return scan.available && scan.findings.some((f) => f.severity === 'ERROR');
}

/** Compact one-liner for the loop log. */
export function formatSemgrep(scan) {
  if (!scan.available) return `semgrep: ${scan.error}`;
  if (scan.findings.length === 0) return 'semgrep: clean (0 findings)';
  const e = scan.findings.filter((f) => f.severity === 'ERROR').length;
  const w = scan.findings.filter((f) => f.severity === 'WARNING').length;
  return `semgrep: ${scan.findings.length} findings (${e} error, ${w} warning) — top: ${scan.findings[0].ruleId}`;
}
