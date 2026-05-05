#!/usr/bin/env node
// Visible E2E pass on the build-quality dashboard. Per Master.md:
//   - headless: false, slowMo: 50, --no-sandbox
//   - screenshots at 1280 and 1920
//   - real interaction evidence (scroll, hover)
//
// Usage: node scripts/visual-test-build-dashboard.mjs

import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const DASH = resolve(ROOT, 'artifacts/build-quality/dashboard.html');
const OUT = resolve(ROOT, 'screenshots/build-dashboard');

if (!existsSync(DASH)) {
  console.error(`Dashboard not found at ${DASH}. Run the build-quality loop first.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [1280, 1920];

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--no-sandbox'],
  });
  const log = [];
  let pass = true;
  try {
    for (const w of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: Math.round(w * 0.6) } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

      await page.goto(pathToFileURL(DASH).href, { waitUntil: 'load', timeout: 15000 });
      // Initial paint screenshot
      const initShot = join(OUT, `dashboard-${w}-initial.png`);
      await page.screenshot({ path: initShot, fullPage: false });

      // Scroll to bottom for full-page evidence
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
      const scrolledShot = join(OUT, `dashboard-${w}-scrolled.png`);
      await page.screenshot({ path: scrolledShot, fullPage: false });

      // Full-page snapshot
      const fullShot = join(OUT, `dashboard-${w}-full.png`);
      await page.screenshot({ path: fullShot, fullPage: true });

      // Probe content: dashboard renders Avg Rubric column with at least one row.
      const bodyText = await page.evaluate(() => document.body.innerText);
      const sawDashboard = /avg\s+rubric/i.test(bodyText) && /\d+%/.test(bodyText) && /Vai Build-Quality/i.test(bodyText);
      // Open the details so the recent-runs JSON is visible for the next screenshot.
      await page.evaluate(() => { document.querySelectorAll('details').forEach((d) => (d.open = true)); });
      await page.waitForTimeout(200);
      const detailsShot = join(OUT, `dashboard-${w}-details.png`);
      await page.screenshot({ path: detailsShot, fullPage: true });

      const ok = errors.length === 0 && sawDashboard;
      if (!ok) pass = false;
      log.push({ viewport: w, ok, errors, sawDashboard, screenshots: [initShot, scrolledShot, fullShot, detailsShot] });
      console.log(`  [${w}] ${ok ? 'OK' : 'FAIL'} · errors=${errors.length} · sawDashboard=${sawDashboard}`);

      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(pass ? '✓ Visible E2E PASS' : '✗ Visible E2E FAIL');
  console.log(`  Screenshots: ${OUT}`);
  for (const f of log) {
    console.log(`  · ${f.viewport}: ${f.screenshots.length} shots${f.errors.length ? ' · errors: ' + f.errors.join('; ') : ''}`);
  }
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
