#!/usr/bin/env node
// Visible E2E chat verification — opens the desktop UI in a real browser,
// sends a small flight of prompts, captures screenshots and timing.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.UI_URL || 'http://localhost:5173/?devAuthBypass=1';
const OUT = 'screenshots/iter35-e2e';
mkdirSync(OUT, { recursive: true });

const PROMPTS = [
  'what is rag',                                   // dispatcher hit
  'and how does that compare to fine tuning?',     // multi-turn follow-up
  'write a short typescript function that debounces a callback', // code-gen
  'who is the current king of norway?',            // factual / retrieval path
];

const log = [];
function step(name, extra = {}) { const e = { t: new Date().toISOString(), name, ...extra }; log.push(e); console.log(`[${e.t}] ${name}`, extra); }

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 50,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200)); });

try {
  step('goto', { url: URL });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  // give the bypass-auth bootstrap + chat hydration a beat
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: join(OUT, '00-loaded.png'), fullPage: false });

  // Find the prompt input — try common selectors
  const inputSel = await page.evaluate(() => {
    const candidates = ['textarea[placeholder]', 'textarea', 'input[type="text"][placeholder]', '[contenteditable="true"]'];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && (el.offsetParent !== null)) return sel;
    }
    return null;
  });
  if (!inputSel) throw new Error('No prompt input found on page');
  step('found input', { selector: inputSel });

  for (let i = 0; i < PROMPTS.length; i++) {
    const p = PROMPTS[i];
    const idx = String(i + 1).padStart(2, '0');
    step(`send ${idx}`, { prompt: p });

    await page.click(inputSel);
    await page.evaluate((s) => { const el = document.querySelector(s); if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.value = ''; else el.textContent = ''; }, inputSel);
    await page.type(inputSel, p, { delay: 12 });
    await page.screenshot({ path: join(OUT, `${idx}a-typed.png`) });

    const t0 = Date.now();
    await page.keyboard.press('Enter');

    // Wait for an assistant bubble to grow / stream to finish.
    // Heuristic: poll the page text length, stop when it stops growing for 1500ms or after 25s.
    let prev = 0, stable = 0, totalChars = 0, elapsed = 0;
    while (elapsed < 25000) {
      await new Promise((r) => setTimeout(r, 500));
      elapsed = Date.now() - t0;
      const len = await page.evaluate(() => document.body.innerText.length);
      if (len === prev) { stable += 500; if (stable >= 1500) break; } else { stable = 0; prev = len; }
      totalChars = len;
    }
    const ms = Date.now() - t0;
    await page.screenshot({ path: join(OUT, `${idx}b-response.png`), fullPage: true });

    // Grab the latest assistant message text (best-effort)
    const latest = await page.evaluate(() => {
      const all = document.body.innerText.split(/\n/).filter(Boolean);
      return all.slice(-12).join('\n');
    });
    step(`response ${idx}`, { ms, totalChars, tail: latest.slice(-400) });
  }

  writeFileSync(join(OUT, 'log.json'), JSON.stringify(log, null, 2));
  step('done');
} catch (e) {
  step('FAIL', { err: e.message });
  await page.screenshot({ path: join(OUT, 'zz-error.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  // Keep window open briefly so user can observe
  await new Promise((r) => setTimeout(r, 4000));
  await browser.close();
}
