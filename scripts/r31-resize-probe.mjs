import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'scripts/screenshots/r31-resize';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30, args: ['--no-sandbox', '--start-maximized'] });
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/?devAuthBypass=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Send a prompt, wait for response
  const ta = page.locator('textarea').first();
  await ta.click(); await ta.fill('what is general relativity?'); await ta.press('Enter');
  for (let i=0;i<60;i++) {
    await page.waitForTimeout(1000);
    const s = await page.locator('[data-streaming]').count();
    const b = await page.locator('button[title="Stop generating"]').count();
    if (s===0 && b===0) { await page.waitForTimeout(1500); break; }
  }
  // Open sidebar
  await page.locator('[data-conversation-sources-toggle]').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/before-resize.png` });

  // Resize to user's reported sizes
  for (const [w, h, name] of [[1366, 768, 'after-1366x768'], [800, 1200, 'after-800x1200']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
      const root = document.getElementById('layout-root');
      const panel = document.querySelector('.layout-panel.relative');
      const chatRoot = document.querySelector('[class*="bg-[#0a0a0a]"]');
      const composer = document.querySelector('textarea')?.closest('.rounded-2xl, .rounded-xl, [class*="rounded"]');
      return {
        win: { w: window.innerWidth, h: window.innerHeight },
        layoutRoot: r(root),
        layoutPanel: r(panel),
        chatRoot: r(chatRoot),
        composer: r(composer),
      };
    });
    console.log(`\n=== ${name} ===`);
    console.log(JSON.stringify(m, null, 2));
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }

  await page.waitForTimeout(2000);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
