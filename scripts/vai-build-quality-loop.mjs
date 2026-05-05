#!/usr/bin/env node
/**
 * Vai Build-Quality Loop
 *
 * Iterates Vai across a corpus of build prompts, scores each generation with:
 *   - File-presence + rubric checks (always)
 *   - Lighthouse + Playwright visible browser (static-framework projects only)
 *   - Optional judge model via VAI_JUDGE_PROVIDER env (anthropic|openai|none)
 *
 * Self-tunes by writing failure patterns to Temporary_files/build-quality-tuning.md
 * (Master.md is protected per its own authority rules) and POSTing knowledge
 * captures to Vai's /api/capture so it learns from its own failures.
 *
 * Usage:
 *   node scripts/vai-build-quality-loop.mjs                   # 1 chunk = 1 iter over all 15
 *   node scripts/vai-build-quality-loop.mjs --iterations 5    # 5 iters, all 15 projects
 *   node scripts/vai-build-quality-loop.mjs --project t3-todo-app --iterations 3
 *   node scripts/vai-build-quality-loop.mjs --target 100      # resume toward 100 total iters
 *   node scripts/vai-build-quality-loop.mjs --headless        # run Playwright headless
 *   node scripts/vai-build-quality-loop.mjs --skip-lighthouse # skip LH (faster)
 *
 * Resumable. State at artifacts/build-quality/state.json.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ARTIFACTS = join(ROOT, 'artifacts', 'build-quality');
const TUNING_FILE = join(ROOT, 'Temporary_files', 'build-quality-tuning.md');
const STATE_FILE = join(ARTIFACTS, 'state.json');
const CORPUS_FILE = join(ROOT, 'eval', 'build-quality', 'projects.json');

const VAI_BASE = process.env.VAI_API?.trim() || 'http://localhost:3006';
const VAI_MODEL = process.env.VAI_MODEL?.trim() || 'vai:v0';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.VAI_REQUEST_TIMEOUT_MS || '180000', 10);

// ── CLI ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { iterations: 1, projectFilter: null, target: null, headless: false, skipLighthouse: false, multiTurn: false, maxTurns: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], n = argv[i + 1];
    if (k === '--iterations' || k === '-n') { a.iterations = Math.max(1, parseInt(n, 10) || 1); i++; }
    else if (k === '--project' || k === '-p') { a.projectFilter = n; i++; }
    else if (k === '--target') { a.target = parseInt(n, 10); i++; }
    else if (k === '--headless') a.headless = true;
    else if (k === '--skip-lighthouse') a.skipLighthouse = true;
    else if (k === '--multi-turn') a.multiTurn = true;
    else if (k === '--max-turns') { a.maxTurns = Math.max(1, parseInt(n, 10) || 1); i++; }
    else if (k === '--help' || k === '-h') a.help = true;
  }
  return a;
}

function help() {
  console.log(`Vai Build-Quality Loop
  --iterations N         iterations to run this invocation (default 1)
  --project ID           run only one project from the corpus
  --target N             resume toward N total iterations across runs
  --headless             headless Playwright (default: visible)
  --skip-lighthouse      skip Lighthouse (faster smoke)
  --multi-turn           run project.turns follow-ups (default: single-turn only)
  --max-turns N          cap follow-up turns at N (default: all defined)
  --help                 show this`);
}

// ── State ────────────────────────────────────────────────────
function loadState() {
  mkdirSync(ARTIFACTS, { recursive: true });
  if (!existsSync(STATE_FILE)) return { runs: 0, perProject: {}, history: [] };
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { runs: 0, perProject: {}, history: [] }; }
}
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

// ── Vai HTTP client ─────────────────────────────────────────
async function vaiHealth() {
  try {
    const r = await fetch(`${VAI_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch { return false; }
}

async function waitForHealthy(maxWaitMs = 60000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await vaiHealth()) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function createConversation() {
  const r = await fetch(`${VAI_BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: VAI_MODEL, mode: 'builder', title: `bq-${Date.now()}` }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`POST /api/conversations ${r.status}: ${await r.text()}`);
  const { id } = await r.json();
  return id;
}

async function sendMessage(conversationId, prompt, timeoutMs = REQUEST_TIMEOUT_MS) {
  const startedAt = Date.now();
  const r = await fetch(`${VAI_BASE}/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: prompt }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`POST messages ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return {
    text: typeof data.content === 'string' ? data.content : '',
    latencyMs: Date.now() - startedAt,
    usage: data.usage || {},
  };
}

async function askVai(prompt) {
  const conversationId = await createConversation();
  const m = await sendMessage(conversationId, prompt);
  return { conversationId, ...m };
}

async function captureLearning(title, content) {
  try {
    await fetch(`${VAI_BASE}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'BUILD_QUALITY_FEEDBACK',
        title,
        content,
        url: 'internal://build-quality-loop',
        meta: { source: 'vai-build-quality-loop', ts: new Date().toISOString() },
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) { /* non-fatal */ }
}

// ── File extraction (mirrors vai-browser-test.mjs) ──────────
const PATH_ATTR_RE = /\b(?:title|path|file|filename)=["']([^"']+)["']/i;
function extractFiles(markdown) {
  const files = [];
  const re = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const info = m[1].trim();
    const pathMatch = info.match(PATH_ATTR_RE);
    if (!pathMatch) continue;
    const path = pathMatch[1].trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
    if (!path) continue;
    const content = m[2].trimEnd();
    const idx = files.findIndex(f => f.path === path);
    if (idx >= 0) files[idx] = { path, content };
    else files.push({ path, content });
  }
  return files;
}

function writeProjectFiles(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const full = join(dir, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.content, 'utf-8');
  }
}

// ── Rubric scoring ──────────────────────────────────────────
function scoreRubric(project, files, responseText) {
  const rubric = project.rubric || {};
  const result = { passed: 0, failed: 0, checks: [] };

  // expectFiles
  for (const expected of project.expectFiles || []) {
    const has = files.some(f => f.path === expected || f.path.endsWith(`/${expected}`));
    result.checks.push({ kind: 'file', label: expected, ok: has });
    if (has) result.passed++; else result.failed++;
  }

  // mustContain
  const haystack = files.map(f => f.content).join('\n') + '\n' + responseText;
  for (const needle of rubric.mustContain || []) {
    const ok = haystack.includes(needle);
    result.checks.push({ kind: 'contain', label: needle, ok });
    if (ok) result.passed++; else result.failed++;
  }
  for (const needle of rubric.mustNotContain || []) {
    const bad = haystack.includes(needle);
    result.checks.push({ kind: 'avoid', label: needle, ok: !bad });
    if (!bad) result.passed++; else result.failed++;
  }

  // size floor
  if (rubric.minBytesIndex) {
    const idx = files.find(f => f.path === 'index.html');
    const ok = !!idx && Buffer.byteLength(idx.content, 'utf-8') >= rubric.minBytesIndex;
    result.checks.push({ kind: 'minBytes', label: `index.html >= ${rubric.minBytesIndex}`, ok });
    if (ok) result.passed++; else result.failed++;
  }
  if (rubric.minBytesApp) {
    const totalApp = files
      .filter(f => /^src\//.test(f.path) || /^app\//.test(f.path))
      .reduce((n, f) => n + Buffer.byteLength(f.content, 'utf-8'), 0);
    const ok = totalApp >= rubric.minBytesApp;
    result.checks.push({ kind: 'minBytes', label: `app code >= ${rubric.minBytesApp}`, ok });
    if (ok) result.passed++; else result.failed++;
  }

  const total = result.passed + result.failed;
  result.score = total === 0 ? 0 : result.passed / total;
  return result;
}

// ── Static server for Lighthouse + Playwright ───────────────
function startStaticServer(rootDir) {
  return new Promise((resolveServer) => {
    const server = createServer(async (req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
        const full = join(rootDir, urlPath);
        if (!full.startsWith(rootDir)) { res.statusCode = 403; res.end('forbidden'); return; }
        if (!existsSync(full)) { res.statusCode = 404; res.end('not found'); return; }
        const ext = full.split('.').pop().toLowerCase();
        const ct = ({
          html: 'text/html; charset=utf-8',
          css: 'text/css; charset=utf-8',
          js: 'application/javascript; charset=utf-8',
          json: 'application/json; charset=utf-8',
          svg: 'image/svg+xml',
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        })[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(full));
      } catch (e) { res.statusCode = 500; res.end(String(e?.message || e)); }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolveServer({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

// ── Shared Chrome/Playwright pool (Thorsen: reuse what's expensive) ──
const pool = { chrome: null, lighthouse: null, browser: null };
async function getSharedChrome() {
  if (pool.chrome) return pool.chrome;
  const { launch } = await import('chrome-launcher');
  pool.lighthouse = (await import('lighthouse')).default;
  pool.chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
  return pool.chrome;
}
async function getSharedBrowser(headless) {
  if (pool.browser) return pool.browser;
  pool.browser = await chromium.launch({ headless, slowMo: headless ? 0 : 50, args: ['--no-sandbox'] });
  return pool.browser;
}
async function closePool() {
  try { if (pool.browser) await pool.browser.close(); } catch {}
  try { if (pool.chrome) await pool.chrome.kill(); } catch {}
  pool.chrome = null; pool.lighthouse = null; pool.browser = null;
}

// ── Lighthouse (reuses shared Chrome) ───────────────────────
async function runLighthouse(url) {
  const chrome = await getSharedChrome();
  const result = await pool.lighthouse(url, {
    port: chrome.port, output: 'json', logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
  });
  const c = result?.lhr?.categories || {};
  return {
    performance: c.performance?.score ?? null,
    accessibility: c.accessibility?.score ?? null,
    'best-practices': c['best-practices']?.score ?? null,
    seo: c.seo?.score ?? null,
  };
}

// ── Playwright visible pass (reuses shared browser) ─────────
async function runVisualPass(url, viewports, screenshotDir, headless) {
  mkdirSync(screenshotDir, { recursive: true });
  const browser = await getSharedBrowser(headless);
  const findings = [];
  for (const w of viewports) {
    const ctx = await browser.newContext({ viewport: { width: w, height: Math.round(w * 0.6) } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(headless ? 200 : 800);
      const shot = join(screenshotDir, `viewport-${w}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      findings.push({ viewport: w, ok: errors.length === 0, errors, screenshot: shot });
    } catch (e) {
      findings.push({ viewport: w, ok: false, errors: [String(e.message || e)], screenshot: null });
    } finally {
      await ctx.close();
    }
  }
  return findings;
}

// ── Self-tuning ─────────────────────────────────────────────
function ensureTuningHeader() {
  mkdirSync(dirname(TUNING_FILE), { recursive: true });
  if (!existsSync(TUNING_FILE)) {
    writeFileSync(TUNING_FILE,
`# Build-Quality Self-Tuning Notes

> Auto-appended by \`scripts/vai-build-quality-loop.mjs\`.
> This file is **subordinate to Master.md** per its authority rules.
> Vegga reviews these notes and decides which become permanent guidance.

`);
  }
}

function appendTuningSection(runIndex, summary, failurePatterns) {
  ensureTuningHeader();
  const ts = new Date().toISOString();
  let block = `\n## Run ${runIndex} — ${ts}\n\n`;
  block += `- Projects: ${summary.total} | Passed: ${summary.passed} | Failed: ${summary.failed} | Avg rubric: ${(summary.avgRubric * 100).toFixed(1)}%\n`;
  if (summary.avgLighthouse) {
    block += `- Avg Lighthouse: perf ${(summary.avgLighthouse.performance * 100).toFixed(0)} / a11y ${(summary.avgLighthouse.accessibility * 100).toFixed(0)} / bp ${(summary.avgLighthouse['best-practices'] * 100).toFixed(0)}\n`;
  }
  if (failurePatterns.length === 0) {
    block += `- No new failure patterns to teach.\n`;
  } else {
    block += `\n### Failure patterns observed\n\n`;
    for (const p of failurePatterns) {
      block += `- **${p.projectId}**: ${p.summary}\n`;
    }
  }
  appendFileSync(TUNING_FILE, block);
}

// ── Main per-project iteration ──────────────────────────────
function mergeFiles(existing, incoming) {
  const map = new Map(existing.map(f => [f.path, f]));
  for (const f of incoming) map.set(f.path, f);
  return [...map.values()];
}

function mergedRubric(project, opts) {
  const base = project.rubric || {};
  const turns = opts.multiTurn ? (project.turns || []).slice(0, opts.maxTurns ?? Infinity) : [];
  const merged = {
    mustContain: [...(base.mustContain || [])],
    mustNotContain: [...(base.mustNotContain || [])],
    minBytesIndex: base.minBytesIndex,
    minBytesApp: base.minBytesApp,
  };
  const expectFiles = [...(project.expectFiles || [])];
  for (const t of turns) {
    if (t.rubric?.mustContain) merged.mustContain.push(...t.rubric.mustContain);
    if (t.rubric?.mustNotContain) merged.mustNotContain.push(...t.rubric.mustNotContain);
    if (t.expectFiles) expectFiles.push(...t.expectFiles);
  }
  return { rubric: merged, expectFiles, turns };
}

async function runOneIteration(project, runIndex, opts) {
  const start = Date.now();
  const projDir = join(ARTIFACTS, `run-${runIndex}`, project.id);
  const shotDir = join(projDir, '__screenshots');
  mkdirSync(projDir, { recursive: true });

  const { rubric: combinedRubric, expectFiles, turns } = mergedRubric(project, opts);
  const turnPrompts = [project.prompt, ...turns.map(t => t.prompt)];
  console.log(`\n  ▶ ${project.id} (run ${runIndex})${turns.length ? ` · ${turnPrompts.length} turns` : ''}`);

  let files = [], rubric, lighthouse = null, visual = [], err = null;
  let combinedText = '';
  const turnSummaries = [];
  let conversationId = null;
  try {
    conversationId = await createConversation();
    const FOLLOWUP_TIMEOUT_MS = Number.parseInt(process.env.VAI_FOLLOWUP_TIMEOUT_MS || '30000', 10);
    for (let ti = 0; ti < turnPrompts.length; ti++) {
      const prompt = turnPrompts[ti];
      const isFollowUp = ti > 0;
      try {
        const m = await sendMessage(conversationId, prompt, isFollowUp ? FOLLOWUP_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
        const turnFiles = extractFiles(m.text);
        files = mergeFiles(files, turnFiles);
        combinedText += '\n' + m.text;
        writeFileSync(join(projDir, `__response-turn-${ti + 1}.md`), m.text);
        turnSummaries.push({ turn: ti + 1, latencyMs: m.latencyMs, chars: m.text.length, newOrUpdatedFiles: turnFiles.length, ok: true });
        console.log(`    turn ${ti + 1}/${turnPrompts.length}: +${turnFiles.length} files (${m.latencyMs}ms)`);
      } catch (e) {
        const msg = String(e.message || e);
        turnSummaries.push({ turn: ti + 1, latencyMs: 0, chars: 0, newOrUpdatedFiles: 0, ok: false, error: msg });
        console.log(`    turn ${ti + 1}/${turnPrompts.length}: ⚠ ${msg.slice(0, 80)} (continuing with prior turns)`);
        if (!isFollowUp) throw e; // first turn failure is fatal
      }
    }
    writeProjectFiles(projDir, files);

    // Score against combined rubric (project + all turn rubric additions)
    const scoringProject = { ...project, rubric: combinedRubric, expectFiles };
    rubric = scoreRubric(scoringProject, files, combinedText);

    const isStaticBuildable = project.framework === 'static' && files.some(f => f.path === 'index.html');
    if (isStaticBuildable) {
      const { server, url } = await startStaticServer(projDir);
      try {
        if (!opts.skipLighthouse) {
          try { lighthouse = await runLighthouse(url); }
          catch (e) { console.log(`    ⚠ lighthouse failed: ${e.message}`); }
        }
        try { visual = await runVisualPass(url, project.viewports || [1280], shotDir, opts.headless); }
        catch (e) { console.log(`    ⚠ playwright failed: ${e.message}`); }
      } finally {
        server.close();
      }
    }
  } catch (e) {
    err = String(e.message || e);
    console.log(`    ❌ ${err}`);
  }

  const result = {
    projectId: project.id,
    runIndex,
    durationMs: Date.now() - start,
    err,
    turns: turnSummaries,
    files: files.map(f => ({ path: f.path, bytes: Buffer.byteLength(f.content, 'utf-8') })),
    rubric,
    lighthouse,
    visual: visual.map(v => ({ viewport: v.viewport, ok: v.ok, errorCount: v.errors.length, screenshot: v.screenshot })),
    response: turnSummaries.length ? { totalLatencyMs: turnSummaries.reduce((n, t) => n + t.latencyMs, 0), turns: turnSummaries.length, totalChars: combinedText.length } : null,
  };

  writeFileSync(join(projDir, '__result.json'), JSON.stringify(result, null, 2));

  const rubricPct = rubric ? (rubric.score * 100).toFixed(0) : 'n/a';
  const lhStr = lighthouse
    ? `LH ${Math.round((lighthouse.performance || 0) * 100)}/${Math.round((lighthouse.accessibility || 0) * 100)}/${Math.round((lighthouse['best-practices'] || 0) * 100)}`
    : 'LH skipped';
  console.log(`    rubric ${rubricPct}% · ${files.length} files · ${lhStr} · ${result.durationMs}ms`);
  return result;
}

// ── Aggregation ─────────────────────────────────────────────
function summarize(results) {
  const valid = results.filter(r => r.rubric);
  const total = results.length;
  const avgRubric = valid.length === 0 ? 0 : valid.reduce((n, r) => n + r.rubric.score, 0) / valid.length;
  const lhValid = results.filter(r => r.lighthouse);
  const avgLighthouse = lhValid.length === 0 ? null : {
    performance: avg(lhValid.map(r => r.lighthouse.performance || 0)),
    accessibility: avg(lhValid.map(r => r.lighthouse.accessibility || 0)),
    'best-practices': avg(lhValid.map(r => r.lighthouse['best-practices'] || 0)),
  };
  const passed = valid.filter(r => r.rubric.score >= 0.7 && !r.err).length;
  return { total, passed, failed: total - passed, avgRubric, avgLighthouse };
}
const avg = arr => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

function extractFailurePatterns(results) {
  const patterns = [];
  for (const r of results) {
    if (!r.rubric) {
      if (r.err) patterns.push({ projectId: r.projectId, summary: `Generation error: ${r.err.slice(0, 160)}` });
      continue;
    }
    const failedChecks = r.rubric.checks.filter(c => !c.ok);
    if (failedChecks.length > 0) {
      const top = failedChecks.slice(0, 3).map(c => `${c.kind}:${c.label}`).join(', ');
      patterns.push({ projectId: r.projectId, summary: `Missed ${failedChecks.length} rubric checks (e.g. ${top})` });
    }
    if (r.lighthouse && r.lighthouse.performance !== null) {
      const target = (results.find(_ => true) && r.lighthouse) ? null : null;
      // (keep it simple: report perf < 0.7)
      if (r.lighthouse.performance < 0.7) {
        patterns.push({ projectId: r.projectId, summary: `Lighthouse performance ${(r.lighthouse.performance * 100).toFixed(0)} below 70` });
      }
    }
  }
  return patterns;
}

// ── Dashboard ───────────────────────────────────────────────
function writeDashboard(state) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Vai Build-Quality Dashboard</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;margin:0;padding:24px;background:#0b0d10;color:#e6e8eb}
  h1{margin:0 0 8px;font-size:20px}
  .meta{color:#8a93a0;margin-bottom:24px}
  table{border-collapse:collapse;width:100%;background:#11141a;border-radius:8px;overflow:hidden}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #1d2128;font-size:13px}
  th{background:#161a21;color:#8a93a0;font-weight:500}
  .ok{color:#7ee787}.warn{color:#f0b429}.bad{color:#ff7b72}
  .bar{display:inline-block;height:8px;border-radius:4px;background:#7ee787;vertical-align:middle}
  .pid{font-family:monospace;color:#79c0ff}
  details{margin-top:8px}
  summary{cursor:pointer;color:#8a93a0}
  pre{background:#0b0d10;padding:8px;border-radius:4px;overflow:auto;max-height:200px;font-size:11px}
</style></head><body>
<h1>Vai Build-Quality Dashboard</h1>
<div class="meta">Total runs: ${state.runs} · Generated ${new Date().toISOString()}</div>
<table>
<thead><tr><th>Project</th><th>Iters</th><th>Avg Rubric</th><th>Avg LH Perf</th><th>Avg LH A11y</th><th>Last error</th></tr></thead>
<tbody>
${Object.entries(state.perProject).map(([id, p]) => {
  const r = (p.avgRubric * 100).toFixed(0);
  const colorClass = p.avgRubric >= 0.85 ? 'ok' : p.avgRubric >= 0.6 ? 'warn' : 'bad';
  const perf = p.avgLighthouse?.performance != null ? Math.round(p.avgLighthouse.performance * 100) : '—';
  const a11y = p.avgLighthouse?.accessibility != null ? Math.round(p.avgLighthouse.accessibility * 100) : '—';
  return `<tr>
    <td class="pid">${id}</td>
    <td>${p.iters}</td>
    <td class="${colorClass}">${r}% <span class="bar" style="width:${r}px;background:${p.avgRubric >= 0.85 ? '#7ee787' : p.avgRubric >= 0.6 ? '#f0b429' : '#ff7b72'}"></span></td>
    <td>${perf}</td><td>${a11y}</td>
    <td class="bad">${p.lastError ? p.lastError.slice(0, 80) : ''}</td>
  </tr>`;
}).join('')}
</tbody></table>
<details><summary>Recent runs (last 20)</summary>
<pre>${JSON.stringify(state.history.slice(-20), null, 2)}</pre>
</details>
</body></html>`;
  writeFileSync(join(ARTIFACTS, 'dashboard.html'), html);
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { help(); return; }

  const corpus = JSON.parse(readFileSync(CORPUS_FILE, 'utf-8'));
  const projects = args.projectFilter
    ? corpus.projects.filter(p => p.id === args.projectFilter)
    : corpus.projects;
  if (projects.length === 0) { console.error(`No projects matched filter "${args.projectFilter}"`); process.exit(2); }

  if (!await vaiHealth()) {
    console.error(`Vai server not reachable at ${VAI_BASE}. Start it with: node scripts/vai-server.mjs`);
    process.exit(1);
  }

  const state = loadState();
  const startRun = state.runs;
  const targetRuns = args.target ?? (startRun + args.iterations);
  const itersThisInvocation = Math.max(0, Math.min(args.iterations, targetRuns - startRun));

  console.log(`\n═══ Vai Build-Quality Loop ═══`);
  console.log(`  Projects: ${projects.length}    Iterations this run: ${itersThisInvocation}    Total target: ${targetRuns}`);
  console.log(`  Headless: ${args.headless}    Skip Lighthouse: ${args.skipLighthouse}\n`);

  for (let i = 0; i < itersThisInvocation; i++) {
    const runIndex = state.runs + 1;
    console.log(`\n── Iteration ${runIndex} / ${targetRuns} ──`);
    const results = [];
    for (const project of projects) {
      // Health gate: if server is down (e.g. previous turn wedged it), wait for it.
      if (!(await vaiHealth())) {
        console.log(`    ⚠ Vai unhealthy before ${project.id}, waiting up to 60s...`);
        if (!(await waitForHealthy(60000))) {
          console.log(`    ❌ Vai still down. Skipping remainder of iteration.`);
          break;
        }
      }
      const r = await runOneIteration(project, runIndex, args);
      results.push(r);

      // Update per-project rolling state
      const ps = state.perProject[project.id] || { iters: 0, avgRubric: 0, avgLighthouse: null, lastError: null };
      const newIters = ps.iters + 1;
      const rs = r.rubric ? r.rubric.score : 0;
      ps.avgRubric = (ps.avgRubric * ps.iters + rs) / newIters;
      if (r.lighthouse) {
        const cur = ps.avgLighthouse || { performance: 0, accessibility: 0, 'best-practices': 0, _n: 0 };
        const n = cur._n + 1;
        cur.performance = (cur.performance * cur._n + (r.lighthouse.performance || 0)) / n;
        cur.accessibility = (cur.accessibility * cur._n + (r.lighthouse.accessibility || 0)) / n;
        cur['best-practices'] = (cur['best-practices'] * cur._n + (r.lighthouse['best-practices'] || 0)) / n;
        cur._n = n;
        ps.avgLighthouse = cur;
      }
      ps.iters = newIters;
      ps.lastError = r.err;
      state.perProject[project.id] = ps;
    }

    const summary = summarize(results);
    const failures = extractFailurePatterns(results);
    state.runs = runIndex;
    state.history.push({ runIndex, ts: new Date().toISOString(), summary, failureCount: failures.length });
    saveState(state);
    appendTuningSection(runIndex, summary, failures);
    writeDashboard(state);

    // Self-tune: feed top failure patterns back to Vai
    if (failures.length > 0) {
      const learnedTitle = `Build-quality run ${runIndex} failure patterns`;
      const learnedBody = failures.map(f => `- ${f.projectId}: ${f.summary}`).join('\n');
      await captureLearning(learnedTitle, learnedBody);
    }

    console.log(`\n  Iteration ${runIndex} summary: ${summary.passed}/${summary.total} passed · avg rubric ${(summary.avgRubric * 100).toFixed(1)}%`);
  }

  console.log(`\n✓ Done. Dashboard: ${join(ARTIFACTS, 'dashboard.html')}`);
  console.log(`  Self-tuning notes: ${TUNING_FILE}`);
  await closePool();
}

main().catch(async e => { console.error(e); await closePool(); process.exit(1); });
