#!/usr/bin/env node
/**
 * test-16-templates-visual.mjs — Deploy & screenshot all 16 stack×tier templates.
 *
 * For each combo: deploy via API → wait for dev server → take screenshot → clean up.
 * Saves screenshots to screenshots/templates/ and prints a summary table.
 *
 * Usage:
 *   node scripts/test-16-templates-visual.mjs              # All 16
 *   node scripts/test-16-templates-visual.mjs pern-basic    # Single combo
 *   node scripts/test-16-templates-visual.mjs nextjs-*      # Glob pattern
 *
 * Requires: runtime server on :3006, Puppeteer (npx puppeteer browsers install chrome)
 */

import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const API_BASE = 'http://localhost:3006';
const SCREENSHOT_DIR = './screenshots/templates';
const VIEWPORT = { width: 1920, height: 1080 };
const DEPLOY_TIMEOUT = 300_000; // 5 min per template
const PAGE_LOAD_WAIT = 5_000;   // Wait for SPA hydration

const ALL_COMBOS = [
  ['pern', 'basic'],       ['pern', 'solid'],       ['pern', 'battle-tested'],       ['pern', 'vai'],
  ['mern', 'basic'],       ['mern', 'solid'],       ['mern', 'battle-tested'],       ['mern', 'vai'],
  ['nextjs', 'basic'],     ['nextjs', 'solid'],     ['nextjs', 'battle-tested'],     ['nextjs', 'vai'],
  ['t3', 'basic'],         ['t3', 'solid'],         ['t3', 'battle-tested'],         ['t3', 'vai'],
  ['vinext', 'basic'],     ['vinext', 'solid'],     ['vinext', 'battle-tested'],     ['vinext', 'vai'],
];

/* ── Parse CLI args ── */
const args = process.argv.slice(2);
const noScreenshot = args.includes('--no-screenshot');
const filtered = args.filter(a => !a.startsWith('--'));

function matchesFilter(stackId, tier) {
  if (!filtered.length) return true;
  const tag = `${stackId}-${tier}`;
  return filtered.some(f => {
    if (f.includes('*')) {
      const re = new RegExp('^' + f.replace(/\*/g, '.*') + '$');
      return re.test(tag);
    }
    return tag === f;
  });
}

const combos = ALL_COMBOS.filter(([s, t]) => matchesFilter(s, t));

/* ── Deploy helper ── */
function deploy(stackId, tier) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Deploy timeout')), DEPLOY_TIMEOUT);
    const opts = {
      hostname: 'localhost', port: 3006,
      path: '/api/sandbox/deploy', method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        clearTimeout(timer);
        const events = data.trim().split('\n').map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
        const steps = events.filter(e => e.step);
        const failed = steps.filter(s => s.status === 'failed');
        const passed = steps.filter(s => s.status === 'done');
        // Extract port and projectId
        const startEvt = events.find(e => e.step === 'start' && e.port);
        const scaffoldEvt = events.find(e => e.step === 'scaffold' && e.projectId);
        resolve({
          steps, failed, passed,
          port: startEvt?.port ?? null,
          projectId: scaffoldEvt?.projectId ?? null,
        });
      });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.write(JSON.stringify({ stackId, tier }));
    req.end();
  });
}

/* ── Delete sandbox ── */
async function destroySandbox(projectId) {
  if (!projectId) return;
  try {
    await fetch(`${API_BASE}/api/sandbox/${projectId}`, { method: 'DELETE' });
  } catch { /* ok */ }
}

/* ── Health check ── */
async function checkHealth(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/* ── Main ── */
await mkdir(SCREENSHOT_DIR, { recursive: true });

let browser = null;
if (!noScreenshot) {
  browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    slowMo: 50,
    args: ['--no-sandbox', '--disable-setuid-sandbox', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
  });
}

console.log(`\n╔════════════════════════════════════════════════╗`);
console.log(`║  VeggaAI — 16-Template Visual Test Suite       ║`);
console.log(`╚════════════════════════════════════════════════╝`);
console.log(`  Templates: ${combos.length} | Screenshots: ${!noScreenshot}`);
console.log(`  Output:    ${path.resolve(SCREENSHOT_DIR)}\n`);

const results = [];

for (let i = 0; i < combos.length; i++) {
  const [stackId, tier] = combos[i];
  const tag = `${stackId}-${tier}`;
  const num = String(i + 1).padStart(2, '0');
  const prefix = `[${num}/${combos.length}]`;

  process.stdout.write(`${prefix} ${tag.padEnd(24)} `);
  const start = Date.now();

  const result = {
    tag, stackId, tier,
    deployOk: false, buildOk: false, serverOk: false,
    screenshotOk: false, healthOk: false,
    port: null, projectId: null,
    elapsed: 0, errors: [], pageErrors: [],
  };

  try {
    // 1. Deploy
    const deploy_result = await deploy(stackId, tier);
    result.projectId = deploy_result.projectId;
    result.port = deploy_result.port;

    const failedSteps = deploy_result.failed.map(f => f.step);
    const passedSteps = deploy_result.passed.map(p => p.step);

    result.deployOk = !failedSteps.includes('scaffold') && !failedSteps.includes('install');
    result.buildOk = passedSteps.includes('build') || !failedSteps.includes('build');
    result.serverOk = !!result.port && passedSteps.includes('start');

    if (deploy_result.failed.length) {
      result.errors = deploy_result.failed.map(f => `${f.step}: ${f.message || 'failed'}`);
    }

    // 2. Screenshot (if server started)
    if (result.serverOk && browser) {
      try {
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        await page.goto(`http://localhost:${result.port}`, {
          waitUntil: 'networkidle2',
          timeout: 30_000,
        });
        await new Promise((r) => setTimeout(r, PAGE_LOAD_WAIT));

        // Get page info
        const pageInfo = await page.evaluate(() => ({
          title: document.title,
          bodyText: document.body?.innerText?.slice(0, 200) || '',
          hasContent: (document.body?.innerText?.length ?? 0) > 10,
          elementCount: document.querySelectorAll('*').length,
        }));

        const screenshotPath = `${SCREENSHOT_DIR}/${num}-${tag}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });
        result.screenshotOk = true;
        result.pageErrors = pageErrors;
        result.pageInfo = pageInfo;

        await page.close();
      } catch (err) {
        result.errors.push(`screenshot: ${err.message}`);
      }
    }

    // 3. Health check
    if (result.port) {
      const health = await checkHealth(result.port);
      result.healthOk = health.ok;
    }

  } catch (err) {
    result.errors.push(err.message);
  }

  result.elapsed = Date.now() - start;
  results.push(result);

  // Clean up sandbox
  await destroySandbox(result.projectId);

  // Print inline result
  const secs = Math.round(result.elapsed / 1000);
  const parts = [];
  parts.push(result.deployOk ? '✓deploy' : '✗deploy');
  parts.push(result.buildOk ? '✓build' : '✗build');
  parts.push(result.serverOk ? '✓server' : '✗server');
  if (!noScreenshot) parts.push(result.screenshotOk ? '✓screenshot' : '✗screenshot');
  parts.push(result.healthOk ? '✓health' : '✗health');

  const allOk = result.deployOk && result.buildOk && result.serverOk &&
                (noScreenshot || result.screenshotOk);
  const icon = allOk ? '✅' : '❌';

  console.log(`${icon} ${parts.join(' | ')} (${secs}s)`);

  if (result.errors.length) {
    result.errors.forEach(e => console.log(`     ⚠ ${e}`));
  }
  if (result.pageErrors?.length) {
    console.log(`     ⚠ ${result.pageErrors.length} page error(s)`);
  }
}

if (browser) await browser.close();

/* ── Summary ── */
console.log('\n╔════════════════════════════════════════════════╗');
console.log('║  Summary                                       ║');
console.log('╠════════════════════════════════════════════════╣');

const pass = results.filter(r => r.deployOk && r.buildOk && r.serverOk);
const fail = results.filter(r => !r.deployOk || !r.buildOk || !r.serverOk);

console.log(`║  Total:  ${results.length}                                      ║`);
console.log(`║  Pass:   ${pass.length}                                      ║`);
console.log(`║  Fail:   ${fail.length}                                      ║`);
console.log('╚════════════════════════════════════════════════╝');

if (fail.length) {
  console.log('\nFailed templates:');
  fail.forEach(r => {
    const reasons = [];
    if (!r.deployOk) reasons.push('deploy');
    if (!r.buildOk) reasons.push('build');
    if (!r.serverOk) reasons.push('server');
    console.log(`  ❌ ${r.tag}: ${reasons.join(', ')}`);
    r.errors.forEach(e => console.log(`     ${e}`));
  });
}

// Build summary table
console.log('\n┌────────────┬─────────┬─────────┬────────────────┬─────────┐');
console.log('│ Stack      │ Basic   │ Solid   │ Battle-Tested  │ Vai     │');
console.log('├────────────┼─────────┼─────────┼────────────────┼─────────┤');
for (const stack of ['pern', 'mern', 'nextjs', 't3']) {
  const cols = ['basic', 'solid', 'battle-tested', 'vai'].map(tier => {
    const r = results.find(r => r.stackId === stack && r.tier === tier);
    if (!r) return '  —  ';
    const ok = r.deployOk && r.buildOk && r.serverOk;
    return ok ? '  ✅  ' : '  ❌  ';
  });
  const label = stack.padEnd(10);
  console.log(`│ ${label} │${cols[0]}  │${cols[1]}  │${cols[2]}           │${cols[3]}  │`);
}
console.log('└────────────┴─────────┴─────────┴────────────────┴─────────┘');

// Write JSON results
const jsonPath = `${SCREENSHOT_DIR}/results.json`;
await writeFile(jsonPath, JSON.stringify(results, null, 2));
console.log(`\nResults saved to ${jsonPath}`);

const totalTime = results.reduce((sum, r) => sum + r.elapsed, 0);
console.log(`Total time: ${Math.round(totalTime / 1000)}s`);

process.exit(fail.length ? 1 : 0);
