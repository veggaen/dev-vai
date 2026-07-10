/**
 * Visible-browser proof for the external dev-lawn preview after chat repairs.
 *
 * Usage: node scripts/verify-dev-lawn-preview-visual.mjs [url]
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:4100/';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'dev-lawn-preview-proof', STAMP);
mkdirSync(OUT, { recursive: true });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 40,
  args: ['--no-sandbox', '--window-size=1440,960'],
  defaultViewport: null,
});

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const response = await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  log('Preview HTTP status is 200', response?.status() === 200, String(response?.status() ?? 'no response'));

  const text = await page.evaluate(() => document.body.innerText);
  log('Renders setup-required screen', /Setup required/i.test(text));
  log('Lists Clerk env var', /VITE_CLERK_PUBLISHABLE_KEY/i.test(text));
  log('Lists Convex env var', /VITE_CONVEX_URL/i.test(text));
  log('Does not render crash page', !/Internal Server Error|Error:\s+Missing VITE_/i.test(text));
  log('No browser console errors during load', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

  const file = join(OUT, '01-preview-rendered.png');
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}`);

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} steps passed. Evidence: ${OUT}`);
  if (passed !== results.length) process.exitCode = 1;
  await new Promise((resolve) => setTimeout(resolve, 8000));
} finally {
  await browser.close();
}
