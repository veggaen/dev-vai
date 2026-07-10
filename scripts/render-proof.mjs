/** Pixel/DOM proof for a running app: waits for real content, screenshots it. */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:4101';
const OUT = join('Temporary_files', 'render-proof');
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox', '--window-size=1600,1000'], defaultViewport: null });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
// Wait for meaningful content (SPA hydration + data), up to 45s.
let info = null;
for (let i = 0; i < 45; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  info = await page.evaluate(() => ({
    title: document.title,
    textLen: (document.body?.innerText ?? '').length,
    textHead: (document.body?.innerText ?? '').slice(0, 220).replace(/\s+/g, ' '),
    elements: document.querySelectorAll('*').length,
  })).catch(() => null);
  if (info && info.textLen > 300) break;
}
const file = join(OUT, `${stamp}.png`);
await page.screenshot({ path: file, fullPage: false });
console.log(`title: ${info?.title}`);
console.log(`elements: ${info?.elements} textLen: ${info?.textLen}`);
console.log(`text: "${info?.textHead}"`);
console.log(`pageerrors: ${errors.length ? errors.join(' | ') : 'none'}`);
console.log(`screenshot: ${file}`);
await new Promise((r) => setTimeout(r, 8000));
await browser.close();
