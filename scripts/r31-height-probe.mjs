import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'scripts/screenshots/r31-height';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30, args: ['--no-sandbox'] });
  for (const [w, h, name] of [[1366, 768, 'landscape-1366x768'], [768, 1366, 'portrait-768x1366'], [1920, 1080, 'fullhd-1920x1080']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173/?devAuthBypass=1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
      const root = document.getElementById('layout-root');
      const shell = document.querySelector('.builder-shell-surface');
      const panel = document.querySelector('.layout-panel.relative');
      const group = panel?.querySelector('[data-panel-group]');
      const chatPanel = panel?.querySelector('[data-panel-id="chat"]');
      const chatRoot = document.querySelector('[class*="bg-[#0a0a0a]"]');
      return {
        win: { w: window.innerWidth, h: window.innerHeight },
        layoutRoot: r(root),
        shell: r(shell),
        layoutPanel: r(panel),
        panelGroup: r(group),
        chatPanel: r(chatPanel),
        chatRoot: r(chatRoot),
      };
    });
    console.log(`\n=== ${name} ===`);
    console.log(JSON.stringify(m, null, 2));
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
