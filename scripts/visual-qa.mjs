/**
 * visual-qa — drive the LIVE dev app (localhost:5173) with a real Chromium and capture
 * VIDEO + a Playwright TRACE (DOM-snapshot timeline + per-action screenshots + network), which
 * are far better than static screenshots for auditing transitions/transformations: you can scrub
 * the motion, inspect any frame's DOM, and replay every interaction.
 *
 * Why this over screenshots: a screenshot freezes one instant; a trace records the easing curve,
 * layout-shift, focus/hover/expand state changes over time, and the network/console alongside —
 * the exact things a transformation audit needs. Open the trace with:
 *     npx playwright show-trace c:/tmp/vai-qa/trace.zip
 *
 * Uses the project's already-installed playwright-core + cached Chromium (no extra install).
 * Loads ?devAuthBypass=1 so it can drive real turns without auth.
 *
 * Usage:
 *   node scripts/visual-qa.mjs                       # default scripted exploration of the app
 *   node scripts/visual-qa.mjs --url http://localhost:5173 --out c:/tmp/vai-qa
 *   node scripts/visual-qa.mjs --prompt "tell me about your engine"   # also send a real turn
 *
 *   # Council Process-UI states WITHOUT a model — renders the real ProcessTree in the dev QA
 *   # harness (apps/desktop/qa-harness.html) with fixture data, expands it, and records it:
 *   node scripts/visual-qa.mjs --scenario council-dissent
 *   node scripts/visual-qa.mjs --scenario all            # sweep every scenario, one trace each
 *
 * Scenario ids mirror QA_SCENARIOS in apps/desktop/src/qa/qa-harness.tsx:
 *   council-clean · council-dissent · council-grounding · council-thin · council-full
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--url', 'http://localhost:5173');
const OUT = opt('--out', 'c:/tmp/vai-qa');
const PROMPT = opt('--prompt', '');           // optional: send a real turn (needs a model up)
const SCENARIO = opt('--scenario', '');       // council Process-UI state via the dev QA harness
const VIEWPORT = { width: Number(opt('--w', '1280')), height: Number(opt('--h', '880')) };

// Scenario ids — kept in sync with QA_SCENARIOS in apps/desktop/src/qa/qa-harness.tsx.
const COUNCIL_SCENARIOS = ['council-clean', 'council-dissent', 'council-grounding', 'council-thin', 'council-full'];

mkdirSync(OUT, { recursive: true });

const log = (m) => process.stdout.write(`[visual-qa] ${m}\n`);

/**
 * Render ONE council scenario in the dev QA harness, expand the settled ProcessTree, and capture
 * video + trace + a screenshot — no model needed. Returns the console errors seen.
 */
async function runScenario(browser, id) {
  const out = `${OUT}/${id}`;
  mkdirSync(out, { recursive: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: `${out}/video`, size: VIEWPORT },
    reducedMotion: 'no-preference',
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

  let tracingStopped = false;
  try {
    await page.goto(`${BASE}/qa-harness.html?scenario=${id}`, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForSelector('[data-testid="qa-scenario"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/settled.png` });

    // Expand the settled tree (the summary button) — capture the expand transformation.
    const summary = page.locator('[data-testid="process-tree"] button[aria-expanded]').first();
    if (await summary.count()) {
      await summary.hover(); await page.waitForTimeout(250);
      await summary.click(); await page.waitForTimeout(600); // let the height/opacity ease settle
      await page.screenshot({ path: `${out}/expanded.png`, fullPage: true });
    }
    // Hover a child row to capture the row hover-state transformation.
    const row = page.locator('.process-tree__row').nth(1);
    if (await row.count()) { await row.hover(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/row-hover.png` }); }

    await context.tracing.stop({ path: `${out}/trace.zip` });
    tracingStopped = true;
  } finally {
    // Always release Playwright resources even if a goto/selector/assert above threw, or this scenario
    // leaks a browser context + page on every failure (CodeRabbit #25).
    if (!tracingStopped) await context.tracing.stop({ path: `${out}/trace.zip` }).catch(() => {});
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
  log(`  ${id}: console errors ${errors.length || 'none'} · shots ${out}/{settled,expanded,row-hover}.png · trace ${out}/trace.zip`);
  return errors;
}

async function main() {
  // Scenario mode: render council Process-UI states via the dev harness (no model).
  if (SCENARIO) {
    const browser = await chromium.launch({ headless: true });
    const ids = SCENARIO === 'all' ? COUNCIL_SCENARIOS : [SCENARIO];
    log(`council scenario capture → ${ids.join(', ')}`);
    let totalErrors = 0;
    for (const id of ids) { totalErrors += (await runScenario(browser, id)).length; }
    await browser.close();
    log(`done. total console errors across scenarios: ${totalErrors}`);
    log(`open any trace: npx playwright show-trace ${OUT}/<scenario>/trace.zip`);
    return;
  }
  return appExploration();
}

async function appExploration() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: `${OUT}/video`, size: VIEWPORT },
    reducedMotion: 'no-preference', // we WANT to see motion
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  log(`loading ${BASE}/?devAuthBypass=1`);
  await page.goto(`${BASE}/?devAuthBypass=1`, { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-initial.png` });

  // Transformation 1: composer depth control hover→activation (state change).
  const depth = page.locator('text=/Quick|Balanced|Deep/i').first();
  if (await depth.count()) {
    await depth.hover(); await page.waitForTimeout(350);
    await depth.click({ force: true }).catch(() => {}); await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/02-depth-activated.png` });
  }

  // Transformation 2: composer focus + typing (focus-state + caret).
  const ta = page.locator('textarea, [contenteditable=true]').first();
  if (await ta.count()) {
    await ta.click().catch(() => {}); await page.waitForTimeout(250);
    await ta.type('Audit the council transparency rows', { delay: 22 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/03-composer-typed.png` });
  }

  // Optional: send a real turn and watch the Process UI transform live (needs a model).
  if (PROMPT && await ta.count()) {
    await ta.fill('').catch(() => {});
    await ta.type(PROMPT, { delay: 18 }).catch(() => {});
    await page.keyboard.press('Enter');
    log(`sent turn: "${PROMPT}" — recording the live Process UI…`);
    // Capture the process tree appearing + streaming + settling.
    await page.waitForSelector('[data-testid="process-tree"]', { timeout: 20000 }).catch(() => {});
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/turn-${i}.png` }); }
  }

  await context.tracing.stop({ path: `${OUT}/trace.zip` });
  await page.close(); // flush video
  const videoPath = await page.video()?.path();
  await context.close();
  await browser.close();

  log(`console errors: ${consoleErrors.length ? '\n  - ' + consoleErrors.slice(0, 8).join('\n  - ') : 'none'}`);
  log(`video: ${videoPath}`);
  log(`trace: ${OUT}/trace.zip   →  npx playwright show-trace ${OUT}/trace.zip`);
  log(`shots: ${OUT}/*.png`);
}

main().catch((e) => { console.error('[visual-qa] failed:', e.message); process.exit(1); });
