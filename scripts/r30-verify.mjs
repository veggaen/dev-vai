/**
 * R30 verification: empty-state responsiveness + sensible follow-ups
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'scripts/screenshots/r30-verify';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50, args: ['--no-sandbox'] });

  // (1) Empty-state at narrow viewport with sidebar open
  for (const sz of [{w:1024,h:768},{w:1280,h:720},{w:1440,h:900}]) {
    const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173/?devAuthBypass=1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    for (let i = 0; i < 3; i++) {
      if (await page.locator('text=Chat History').count()) break;
      await page.keyboard.press('Control+s'); await page.waitForTimeout(300);
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/empty-${sz.w}x${sz.h}.png` });

    // Measure: is the right edge of every empty-state card inside the chat panel?
    const m = await page.evaluate(() => {
      const winW = window.innerWidth;
      const chat = document.querySelector('[class*="bg-[#0a0a0a]"]');
      const chatRight = chat ? chat.getBoundingClientRect().right : winW;
      const lanes = Array.from(document.querySelectorAll('button.group\\/lane'));
      const overflowingLanes = lanes.filter(el => el.getBoundingClientRect().right > chatRight + 1);
      return { winW, chatRight, lanesCount: lanes.length, overflowingLaneCount: overflowingLanes.length };
    });
    console.log(`[empty ${sz.w}x${sz.h}]`, JSON.stringify(m));
    await ctx.close();
  }

  // (2) Follow-ups: ask "what is the capital of Norway?" and capture follow-ups
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  await page2.goto('http://localhost:5173/?devAuthBypass=1', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(1500);
  const ta = page2.locator('textarea').first();
  await ta.click(); await ta.fill('what is the capital of Norway?'); await ta.press('Enter');
  // Wait for response to settle
  for (let i = 0; i < 60; i++) {
    await page2.waitForTimeout(1000);
    const streaming = await page2.locator('[data-streaming]').count();
    if (streaming === 0 && await page2.locator('[data-chat-message-role="assistant"]').count() > 0) {
      // wait one more cycle for follow-ups to attach
      await page2.waitForTimeout(2000);
      break;
    }
  }
  await page2.screenshot({ path: `${OUT}/followups-capital.png`, fullPage: true });
  const followUps = await page2.evaluate(() => {
    // Follow-ups appear as buttons with onClick handlers near the assistant message
    const nodes = Array.from(document.querySelectorAll('button'));
    return nodes
      .map(b => b.textContent?.trim() || '')
      .filter(t => /^(?:What|How|Why|Where|When|Who|Which|Rank|Give|Show|Narrow)\b/.test(t) && t.length < 120)
      .slice(0, 15);
  });
  console.log('[follow-ups capital]', JSON.stringify(followUps, null, 2));

  // Try one more: "who founded apple?"
  const ta2 = page2.locator('textarea').first();
  await ta2.click(); await ta2.fill('who founded apple?'); await ta2.press('Enter');
  for (let i = 0; i < 60; i++) {
    await page2.waitForTimeout(1000);
    const streaming = await page2.locator('[data-streaming]').count();
    if (streaming === 0) { await page2.waitForTimeout(2000); break; }
  }
  await page2.screenshot({ path: `${OUT}/followups-founder.png`, fullPage: true });
  const fu2 = await page2.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('button'));
    return nodes
      .map(b => b.textContent?.trim() || '')
      .filter(t => /^(?:What|How|Why|Where|When|Who|Which|Rank|Give|Show|Narrow)\b/.test(t) && t.length < 120)
      .slice(-10);
  });
  console.log('[follow-ups founder]', JSON.stringify(fu2, null, 2));

  await page2.waitForTimeout(2500);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
