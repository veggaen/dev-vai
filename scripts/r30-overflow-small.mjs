import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('scripts/screenshots/r30-empty-overflow', { recursive: true });

const SIZES = [
  { w: 1280, h: 720 },
  { w: 1366, h: 768 },
  { w: 1440, h: 900 },
  { w: 1024, h: 768 },
];

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30, args: ['--no-sandbox'] });

  for (const sz of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173/?devAuthBypass=1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // Force sidebar open
    for (let i = 0; i < 3; i++) {
      if (await page.locator('text=Chat History').count()) break;
      await page.keyboard.press('Control+s'); await page.waitForTimeout(300);
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `scripts/screenshots/r30-empty-overflow/${sz.w}x${sz.h}.png`, fullPage: false });

    const m = await page.evaluate(() => {
      const winW = window.innerWidth;
      const docW = document.documentElement.scrollWidth;
      const pick = (sel) => {
        const el = document.querySelector(sel); if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), x: Math.round(r.x), right: Math.round(r.right), scrollW: el.scrollWidth };
      };
      // Find chat window root and the empty-state h1
      return {
        winW, docW, hasOverflow: docW > winW,
        layoutRoot: pick('#layout-root'),
        builderShell: pick('.builder-shell-surface'),
        chatWindow: pick('[class*="bg-[#0a0a0a]"]') || pick('[class*="bg-zinc-950"]'),
        emptyTitle: pick('h1'),
        emptyMaxW4xl: (() => {
          const els = document.querySelectorAll('[class*="max-w-4xl"]');
          if (!els.length) return null;
          const r = els[0].getBoundingClientRect();
          return { count: els.length, w: Math.round(r.width), right: Math.round(r.right) };
        })(),
      };
    });
    console.log(`[${sz.w}x${sz.h}]`, JSON.stringify(m));
    await ctx.close();
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
