/**
 * Bench-shape visual proof: send 4 shape-styled prompts and screenshot the
 * responses. One Playwright session, viewport: null + start-maximized so the
 * page reflows on F11/resize. Visible browser per repo policy.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'scripts/screenshots/bench-shape-visual';
fs.mkdirSync(OUT, { recursive: true });

const PROMPTS = [
  { id: 'one-sentence',  text: 'in one sentence, what is sweden?' },
  { id: 'short-fact',    text: 'give me a short fact about japan' },
  { id: 'list-5',        text: 'give me 5 interesting facts about france as a numbered list' },
  { id: 'bullet-4',      text: '4 bullet points about aristotle' },
];

async function waitSettle(page) {
  await page.waitForTimeout(400);
  // Wait for any "thinking" indicator and then for a stable transcript length.
  let prev = 0; let stable = 0;
  for (let i = 0; i < 60; i++) {
    const len = await page.evaluate(() => document.body.innerText.length);
    if (len === prev) { stable++; if (stable >= 3) break; } else { stable = 0; prev = len; }
    await page.waitForTimeout(300);
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--no-sandbox', '--start-maximized'],
  });
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/?devAuthBypass=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/00-initial.png` });

  const ta = page.locator('textarea').first();

  for (const p of PROMPTS) {
    await ta.click();
    await ta.fill(p.text);
    await page.waitForTimeout(150);
    await ta.press('Enter');
    await waitSettle(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${p.id}.png`, fullPage: false });

    // Capture the last assistant message text for the log.
    const last = await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('[class*="prose"], [data-message-role="assistant"], [data-role="assistant"]'));
      const tail = bubbles[bubbles.length - 1];
      return tail ? tail.innerText.slice(0, 280) : null;
    });
    console.log(`\n[${p.id}] Q: ${p.text}`);
    console.log(`  A: ${JSON.stringify(last?.slice(0, 240))}`);
  }

  // Scroll proof and final screenshot.
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/zz-final.png`, fullPage: true });

  console.log(`\nScreenshots written to ${OUT}/`);
  console.log('Browser staying open 8s so you can inspect.');
  await page.waitForTimeout(8000);
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
