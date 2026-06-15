/**
 * Record a short WebM of a live chat turn (process strip + ProcessTree transitions).
 * Requires: dev servers on :5173 and :3006, `pnpm exec playwright install chromium` once.
 *
 * Usage: node scripts/record-vai-process-demo.mjs
 * Output: artifacts/process-demo/vai-process-demo.webm
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'artifacts', 'process-demo');
const VIDEO_PATH = path.join(OUT_DIR, 'vai-process-demo.webm');

fs.mkdirSync(OUT_DIR, { recursive: true });

const APP_URL = process.env.VAI_DEMO_URL ?? 'http://127.0.0.1:5173/?devAuthBypass=1';
const QUERY = process.env.VAI_DEMO_QUERY
  ?? 'Who is the current prime minister of Norway? Cite an official source.';

async function waitForServers() {
  for (const url of ['http://127.0.0.1:5173/', 'http://127.0.0.1:3006/api/agent/introspect']) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) throw new Error(`Server not ready: ${url}`);
  }
}

await waitForServers();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

console.log(`[record] navigating → ${APP_URL}`);
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea', { timeout: 90_000 });
await page.waitForTimeout(1500);

console.log('[record] sending query…');
const textarea = page.locator('textarea').first();
await textarea.click();
await textarea.fill(QUERY);
await page.keyboard.press('Enter');

console.log('[record] capturing live process (up to ~45s)…');
await page.waitForSelector('[data-testid="composer-process-strip"], [data-testid="process-tree"]', {
  timeout: 20_000,
}).catch(() => {});

// Hold through streaming + settle
await page.waitForTimeout(12_000);
await page.waitForSelector('button[title="Send message (Enter)"]:not([disabled])', {
  timeout: 120_000,
}).catch(() => {});
await page.waitForTimeout(2500);

const video = page.video();
await page.close();
await context.close();
if (video) {
  await video.saveAs(VIDEO_PATH);
  console.log(`[record] saved → ${VIDEO_PATH}`);
} else {
  console.warn('[record] no video attachment — check Playwright version');
}
await browser.close();
