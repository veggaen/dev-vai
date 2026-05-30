// Visible-browser dual audit harness driver.
//   node scripts/visible-format-audit.mjs

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HARNESS = pathToFileURL(resolve('scripts/visible-audit-harness.html')).href;
const OUT_DIR = resolve('_visible_audit');
mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  console.log('Launching visible Chromium…');
  const ctx = await chromium.launchPersistentContext(resolve('_visible_audit/_chrome'), {
    headless: false,
    slowMo: 50,
    viewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--window-size=1920,1080', '--disable-web-security'],
    extraHTTPHeaders: { Origin: 'http://localhost:5173' },
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[browser]', m.text());
  });

  console.log(`Loading harness: ${HARNESS}`);
  await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#runAll');
  await page.screenshot({ path: join(OUT_DIR, '00-initial.png') });

  console.log('Clicking "Run all"…');
  await page.click('#runAll');

  const TOTAL = await page.evaluate(() => document.querySelectorAll('.case').length);
  console.log(`Waiting for ${TOTAL} cases to complete…`);

  let lastDone = -1;
  const start = Date.now();
  while (Date.now() - start < 8 * 60 * 1000) {
    const { pass, done, total } = await page.evaluate(() => {
      const cases = Array.from(document.querySelectorAll('.case'));
      let pass = 0, done = 0;
      cases.forEach(c => {
        const v = c.querySelector('.v')?.textContent || '';
        if (v.includes('pass')) { pass++; done++; }
        else if (v.includes('fail')) { done++; }
      });
      return { pass, done, total: cases.length };
    });
    if (done !== lastDone) {
      console.log(`  ${done}/${total} done, ${pass} pass`);
      await page.screenshot({ path: join(OUT_DIR, `progress-${String(done).padStart(2, '0')}.png`) });
      lastDone = done;
    }
    if (done === total) break;
    await page.waitForTimeout(1000);
  }

  const results = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.case')).map(c => ({
      id: c.querySelector('.id')?.textContent || '',
      prompt: c.querySelector('.p')?.textContent || '',
      verdict: c.querySelector('.v')?.textContent.trim() || '',
    }));
  });

  await page.evaluate(() => {
    const t = document.getElementById('transcript');
    if (t) t.scrollTop = t.scrollHeight;
  });
  await page.screenshot({ path: join(OUT_DIR, 'zz-final-transcript.png'), fullPage: true });

  const responses = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.msg.assistant')).map(m => {
      const role = m.querySelector('.role')?.textContent || '';
      const body = m.lastElementChild?.textContent || '';
      return { role, body };
    });
  });

  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify({ results, responses }, null, 2));

  const passed = results.filter(r => r.verdict.includes('pass')).length;
  console.log(`\n=== ${passed}/${results.length} passed ===`);
  results.forEach(r => console.log(`  ${r.verdict.includes('pass') ? '✓' : '✗'} ${r.id}`));

  console.log('\nKeeping browser open 12s for visual confirmation…');
  await page.waitForTimeout(12000);
  await ctx.close();
  process.exit(passed === results.length ? 0 : 1);
})();
