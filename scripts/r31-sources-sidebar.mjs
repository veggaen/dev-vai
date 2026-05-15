/**
 * R31 verify: conversation-wide sources sidebar.
 * - Send 2 prompts that yield sources (factual lookups), confirm sidebar collects both.
 * - Open sidebar via toolbar toggle.
 * - Confirm it slides from right to left, pushes chat content (not floating overlay),
 *   shows aggregated count and each source.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'scripts/screenshots/r31-sources-sidebar';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50, args: ['--no-sandbox', '--start-maximized'] });
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/?devAuthBypass=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${OUT}/01-initial.png` });

  // Send first prompt
  const ta = page.locator('textarea').first();
  await ta.click(); await ta.fill('what is the capital of Norway?'); await ta.press('Enter');
  await waitSettle(page);
  await page.screenshot({ path: `${OUT}/02-after-q1.png` });

  // Toggle sidebar — should be empty/no-sources or have first source
  const toggle = page.locator('[data-conversation-sources-toggle]');
  await toggle.click();
  await page.waitForTimeout(900); // wait for slide-in
  await page.screenshot({ path: `${OUT}/03-sidebar-open-after-q1.png` });

  const countBeforeQ2 = await page.locator('[data-conversation-source-item]').count();
  console.log(`[count after Q1]`, countBeforeQ2);

  // Send second prompt
  await ta.click(); await ta.fill('what is general relativity?'); await ta.press('Enter');
  await waitSettle(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/04-after-q2-sidebar-still-open.png` });

  const countAfterQ2 = await page.locator('[data-conversation-source-item]').count();
  console.log(`[count after Q2]`, countAfterQ2);

  // Verify the chat composer/messages don't horizontally overflow with sidebar open
  const m = await page.evaluate(() => {
    const winW = window.innerWidth;
    const docW = document.documentElement.scrollWidth;
    const sb = document.querySelector('[data-conversation-sources="panel"]');
    const sbRect = sb?.getBoundingClientRect();
    const chat = document.querySelector('[class*="bg-[#0a0a0a]"]');
    const chatRect = chat?.getBoundingClientRect();
    return {
      winW, docW, hasOverflow: docW > winW,
      sidebar: sbRect ? { x: Math.round(sbRect.x), w: Math.round(sbRect.width), right: Math.round(sbRect.right) } : null,
      chat: chatRect ? { x: Math.round(chatRect.x), w: Math.round(chatRect.width), right: Math.round(chatRect.right) } : null,
    };
  });
  console.log('[layout]', JSON.stringify(m));

  // Close sidebar
  await page.locator('[data-conversation-sources-close]').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/05-sidebar-closed.png` });

  await page.waitForTimeout(2500);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

async function waitSettle(page) {
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    const streaming = await page.locator('[data-streaming]').count();
    const stopBtn = await page.locator('button[title="Stop generating"]').count();
    if (streaming === 0 && stopBtn === 0) {
      await page.waitForTimeout(1500); // let sources attach
      return;
    }
  }
}
