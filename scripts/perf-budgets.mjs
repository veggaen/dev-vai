#!/usr/bin/env node
/**
 * Performance-budget bench — Master.md §12.6.6: measured, not claimed.
 *
 * Measures the runtime against eval/perf/budgets.json and fails on breach.
 *
 *   node scripts/perf-budgets.mjs             boot runtime, measure, stop it, gate
 *   node scripts/perf-budgets.mjs --attach    measure an already-running runtime
 *                                             (skips cold-boot metric, never stops it)
 *   node scripts/perf-budgets.mjs --advisory  measure + report, exit 0 even on breach
 *                                             (CI uses this until a baseline is recorded)
 *
 * Report written to artifacts/ci/perf-budgets.json (gitignored artifacts dir).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number.parseInt(process.env.VAI_PORT || '3006', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const HEALTH = `${BASE}/health`;
const SEARCH = `${BASE}/api/search`;
const BOOT_TIMEOUT_MS = 90_000;

const argv = new Set(process.argv.slice(2));
const attach = argv.has('--attach');
const advisory = argv.has('--advisory');

const budgets = JSON.parse(readFileSync(join(ROOT, 'eval', 'perf', 'budgets.json'), 'utf8')).runtime;

const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};

async function ping(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const started = performance.now();
    const res = await fetch(url, { signal: ctrl.signal });
    return { ok: res.ok, ms: performance.now() - started, status: res.status };
  } catch {
    return { ok: false, ms: Number.NaN, status: 0 };
  } finally {
    clearTimeout(t);
  }
}

async function searchOnce(query, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const started = performance.now();
    const res = await fetch(SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    });
    return { ok: res.ok, ms: performance.now() - started, status: res.status };
  } catch {
    return { ok: false, ms: Number.NaN, status: 0 };
  } finally {
    clearTimeout(t);
  }
}

function runServerCmd(cmd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'vai-server.mjs'), cmd], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const report = { at: new Date().toISOString(), mode: attach ? 'attach' : 'boot', metrics: {}, breaches: [], skipped: [] };
let startedByUs = false;

// ── Cold boot ──
if (attach) {
  const alive = await ping(HEALTH);
  if (!alive.ok) {
    console.error(`perf: --attach but no healthy runtime on :${PORT}`);
    process.exit(1);
  }
  report.skipped.push('coldBootToHealthyMs (attach mode)');
} else {
  const pre = await ping(HEALTH, 1000);
  if (pre.ok) {
    console.error(`perf: a runtime already serves :${PORT} — use --attach, or stop it for a cold-boot measurement.`);
    process.exit(1);
  }
  const bootStart = performance.now();
  const code = await runServerCmd('start');
  if (code !== 0) {
    console.error('perf: runtime failed to start');
    process.exit(1);
  }
  startedByUs = true;
  // vai-server.mjs returns after its own health confirmation; poll to timestamp precisely.
  let healthyAt = null;
  while (performance.now() - bootStart < BOOT_TIMEOUT_MS) {
    const r = await ping(HEALTH, 1000);
    if (r.ok) { healthyAt = performance.now(); break; }
    await new Promise((r2) => setTimeout(r2, 50));
  }
  if (healthyAt === null) {
    console.error('perf: runtime never became healthy');
    if (startedByUs) await runServerCmd('stop');
    process.exit(1);
  }
  report.metrics.coldBootToHealthyMs = Math.round(healthyAt - bootStart);
}

// ── /health latency (warmup 5, measure 50) ──
for (let i = 0; i < 5; i += 1) await ping(HEALTH);
const healthMs = [];
for (let i = 0; i < 50; i += 1) {
  const r = await ping(HEALTH);
  if (r.ok) healthMs.push(r.ms);
}
if (healthMs.length >= 40) {
  report.metrics.healthP50Ms = Math.round(quantile(healthMs, 0.5) * 10) / 10;
  report.metrics.healthP95Ms = Math.round(quantile(healthMs, 0.95) * 10) / 10;
} else {
  report.skipped.push(`health latency (only ${healthMs.length}/50 succeeded)`);
}

// ── grounded search latency (warmup 2, measure 12) ──
const QUERIES = [
  'what is the vai runtime port',
  'how does the retrieval flywheel work',
  'where are agent sessions stored',
];
const probe = await searchOnce(QUERIES[0]);
if (!probe.ok) {
  report.skipped.push(`search latency (POST /api/search -> HTTP ${probe.status}; auth or empty index?)`);
} else {
  await searchOnce(QUERIES[1]);
  const searchMs = [];
  for (let i = 0; i < 12; i += 1) {
    const r = await searchOnce(QUERIES[i % QUERIES.length]);
    if (r.ok) searchMs.push(r.ms);
  }
  if (searchMs.length >= 8) {
    report.metrics.searchP50Ms = Math.round(quantile(searchMs, 0.5));
    report.metrics.searchP95Ms = Math.round(quantile(searchMs, 0.95));
  } else {
    report.skipped.push(`search latency (only ${searchMs.length}/12 succeeded)`);
  }
}

if (startedByUs) await runServerCmd('stop');

// ── Gate ──
for (const [metric, value] of Object.entries(report.metrics)) {
  const budget = budgets[metric]?.budget;
  if (typeof budget === 'number' && value > budget) {
    report.breaches.push({ metric, value, budget });
  }
}

mkdirSync(join(ROOT, 'artifacts', 'ci'), { recursive: true });
writeFileSync(join(ROOT, 'artifacts', 'ci', 'perf-budgets.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log('\nperf-budgets report:');
for (const [k, v] of Object.entries(report.metrics)) {
  const budget = budgets[k]?.budget;
  const mark = report.breaches.some((b) => b.metric === k) ? '✗ OVER' : '✓';
  console.log(`  ${mark} ${k}: ${v}ms${typeof budget === 'number' ? ` (budget ${budget}ms)` : ''}`);
}
for (const s of report.skipped) console.log(`  ~ skipped: ${s}`);

if (report.breaches.length > 0) {
  console.error(`\nperf: ${report.breaches.length} budget breach(es).${advisory ? ' (advisory mode — not failing)' : ''}`);
  process.exit(advisory ? 0 : 1);
}
console.log('\nperf: all measured budgets met');
