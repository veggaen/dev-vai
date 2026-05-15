/**
 * Quick visual smoke: open the app, capture default windowed + fullscreen.
 * Verifies (1) sidebar doesn't cover the whole page in fullscreen
 *          (2) chat content doesn't overflow the right viewport edge.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'scripts/screenshots/r30-overflow-check';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 60, args: ['--no-sandbox', '--start-maximized'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto('http://localhost:5173/?devAuthBypass=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Send one prompt to populate the chat area
  const ta = page.locator('textarea').first();
  await ta.waitFor({ state: 'visible', timeout: 15_000 });
  await ta.click(); await ta.fill('what is the capital of Norway?');
  await ta.press('Enter');
  await page.waitForTimeout(2500);

  // Cycle Ctrl+S to ensure sidebar EXPANDED
  for (let i = 0; i < 3; i++) {
    if (await page.locator('text=Chat History').count()) break;
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '01-sidebar-open-windowed.png') });

  // Check for horizontal overflow of body
  const overflow = await page.evaluate(() => {
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    const main = document.querySelector('main, [class*="builder-shell-surface"]');
    return { docW, winW, hasOverflow: docW > winW, mainScrollW: main ? main.scrollWidth : null, mainClientW: main ? main.clientWidth : null };
  });
  console.log('windowed overflow check:', overflow);

  // Try fullscreen
  await page.keyboard.press('F11');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '02-sidebar-open-fullscreen.png') });
  const overflow2 = await page.evaluate(() => {
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    return { docW, winW, hasOverflow: docW > winW };
  });
  console.log('fullscreen overflow check:', overflow2);

  await page.waitForTimeout(2500);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
