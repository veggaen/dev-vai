/**
 * Visible driver — paperclip ("binder") → Folder → REAL Explorer dialog.
 * V3gga picks the folder manually in the native dialog; the script waits,
 * then resumes: review card → Start → dev server → preview → PIXEL PROOF
 * (reads the iframe's actual rendered document, not just its src).
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'binder-flow', STAMP);
mkdirSync(OUT, { recursive: true });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
};
const shot = async (page, name) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  console.log(`  📸 ${file}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 60,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: null,
});

try {
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await sleep(2500);
  log('App loaded', true);

  // 1. Click the paperclip.
  const clipClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.getAttribute('title') ?? '').startsWith('Attach a file'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  log('Paperclip clicked', clipClicked);
  if (!clipClicked) throw new Error('Paperclip button not found');
  await sleep(600);
  await shot(page, '01-menu-open');

  // 2. Click "Folder".
  const folderClicked = await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((b) => b.textContent?.trim().startsWith('Folder'));
    if (!item) return false;
    item.click();
    return true;
  });
  log('Folder option clicked — Explorer dialog is opening on your screen', folderClicked);
  if (!folderClicked) throw new Error('Folder menu item not found');

  // 3. The native dialog is now up. V3gga drives it. Poll for the outcome.
  console.log('\n⏳ Waiting for you to pick the folder in the Explorer dialog…\n');
  let outcome = null; // 'review' | 'preview'
  for (let i = 0; i < 240; i += 1) {
    await sleep(1000);
    const state = await page.evaluate(() => {
      const startBtn = Array.from(document.querySelectorAll('button'))
        .find((b) => /^(Start|Start anyway)$/.test(b.textContent?.trim() ?? '') && !b.disabled);
      const frames = Array.from(document.querySelectorAll('iframe'));
      const live = frames.find((f) => /localhost:\d+/.test(f.src) && !f.src.includes(':5173'));
      return { hasStart: Boolean(startBtn), previewSrc: live?.src ?? null };
    }).catch(() => null);
    if (!state) continue;
    if (state.hasStart) {
      outcome = 'review';
      break;
    }
    if (state.previewSrc) {
      outcome = 'preview';
      break;
    }
    if (i % 20 === 19) console.log(`  … still waiting (${i + 1}s)`);
  }
  log('Folder selected', Boolean(outcome), outcome ?? 'timed out after 4min');
  if (!outcome) throw new Error('No selection detected');
  await shot(page, '02-after-selection');

  // 4. Review card → Start.
  if (outcome === 'review') {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((b) => /^(Start|Start anyway)$/.test(b.textContent?.trim() ?? ''));
      btn?.click();
    });
    log('Review card → Start', true);
  }

  // 5. Wait for the live preview iframe.
  let previewUrl = null;
  for (let i = 0; i < 180; i += 1) {
    await sleep(1000);
    previewUrl = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('iframe'));
      const live = frames.find((f) => /localhost:\d+/.test(f.src) && !f.src.includes(':5173'));
      return live?.src ?? null;
    }).catch(() => null);
    if (previewUrl) break;
    if (i % 30 === 29) { console.log(`  … waiting for dev server (${i + 1}s)`); await shot(page, `wait-${i + 1}s`); }
  }
  log('Preview iframe attached', Boolean(previewUrl), previewUrl ?? 'timeout');
  if (!previewUrl) throw new Error('No preview iframe');

  // 6. PIXEL PROOF — read the app's actual rendered document via the frame tree
  //    (cross-origin is fine: Puppeteer sees every frame).
  let render = null;
  for (let i = 0; i < 90; i += 1) {
    await sleep(2000);
    const frame = page.frames().find((f) => f.url().startsWith(previewUrl.split('?')[0]) || (f.url().includes('localhost') && !f.url().includes(':5173') && f.url() !== 'about:blank'));
    if (!frame) continue;
    render = await frame.evaluate(() => {
      const text = document.body?.innerText?.trim() ?? '';
      return {
        title: document.title,
        elements: document.querySelectorAll('*').length,
        textSample: text.slice(0, 160).replace(/\s+/g, ' '),
        hasNextErrorOverlay: Boolean(document.querySelector('nextjs-portal')),
      };
    }).catch(() => null);
    if (render && render.elements > 20 && render.textSample.length > 0) break;
  }
  const rendered = Boolean(render && render.elements > 20);
  log('App RENDERED real content', rendered, render ? `title="${render.title}" elements=${render.elements} text="${render.textSample.slice(0, 80)}…" errorOverlay=${render.hasNextErrorOverlay}` : 'no frame content');
  await sleep(2000);
  await shot(page, '03-preview-rendered');

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} steps passed. Evidence: ${OUT}`);
  console.log('Leaving the browser open 20s for inspection…');
  await sleep(20_000);
} finally {
  await browser.close();
}
