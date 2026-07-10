/**
 * Visible-browser E2E: open a local project -> click toolbar Env -> verify env setup modal.
 *
 * Usage: node scripts/test-env-setup-modal-visual.mjs [folderPath]
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FOLDER = process.argv[2] ?? 'C:\\Users\\v3gga\\Documents\\dev-lawn';
const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'env-setup-modal-e2e', STAMP);
mkdirSync(OUT, { recursive: true });

const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
};
const shot = async (page, name) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}`);
};

async function clickButtonByText(page, pattern) {
  const clicked = await page.evaluate((source) => {
    const re = new RegExp(source, 'i');
    const button = Array.from(document.querySelectorAll('button')).find((candidate) => {
      const text = (candidate.textContent ?? '').replace(/\s+/g, ' ').trim();
      return re.test(text) && !candidate.disabled;
    });
    if (!button) return false;
    button.click();
    return true;
  }, pattern.source);
  return clicked;
}

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 45,
  args: ['--no-sandbox', '--window-size=1680,1040'],
  defaultViewport: null,
});

try {
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await sleep(2000);
  log('Dev-Vai loaded', true);

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyO');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(600);

  const dialogInput = await page.$('input[aria-label="Folder path"]');
  log('Open-folder dialog visible', Boolean(dialogInput));
  if (!dialogInput) throw new Error('Open-folder dialog did not appear');
  await dialogInput.type(FOLDER, { delay: 8 });
  await page.keyboard.press('Enter');
  await shot(page, '01-folder-submitted');

  let started = false;
  for (let i = 0; i < 35; i += 1) {
    await sleep(500);
    if (await clickButtonByText(page, /^Start\s*anyway$|^Start$/)) {
      started = true;
      break;
    }
  }
  log('Project start clicked', started);
  if (!started) throw new Error('Start button did not appear');

  let envButtonVisible = false;
  for (let i = 0; i < 80; i += 1) {
    await sleep(750);
    envButtonVisible = await page.evaluate(() => Boolean(document.querySelector('button[title="Set local .env values"]:not(:disabled)')));
    if (envButtonVisible) break;
  }
  log('Toolbar Env button visible', envButtonVisible);
  await shot(page, '02-toolbar-env-visible');
  if (!envButtonVisible) throw new Error('Env button did not appear');

  const envClicked = await page.evaluate(() => {
    const button = document.querySelector('button[title="Set local .env values"]:not(:disabled)');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  });
  log('Toolbar Env clicked', envClicked);
  for (let i = 0; i < 20; i += 1) {
    await sleep(500);
    const opened = await page.evaluate(() => /Project setup|Connect the services this app needs/i.test(document.body.innerText));
    if (opened) break;
  }

  const modalText = await page.evaluate(() => document.body.innerText);
  log('Env setup modal opened', /Project setup|Connect the services this app needs/i.test(modalText));
  log('Core values are presented first', modalText.indexOf('Core runtime') >= 0 && modalText.indexOf('Core runtime') < modalText.indexOf('Billing'));
  log('Modal lists Convex URL', /VITE_CONVEX_URL/i.test(modalText));
  log('Modal lists Clerk key', /VITE_CLERK_PUBLISHABLE_KEY/i.test(modalText));
  log('Modal separates server-only values', /Server only/i.test(modalText));
  const getValueLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a')).filter((link) => /Get value/i.test(link.textContent ?? '')).length);
  log('Official get-value links are available', getValueLinks >= 4, `${getValueLinks} links`);
  log('No browser runtime errors', browserErrors.length === 0, browserErrors.slice(0, 2).join(' | '));
  await shot(page, '03-env-modal');

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} steps passed. Evidence: ${OUT}`);
  if (passed !== results.length) process.exitCode = 1;
  await sleep(8000);
} finally {
  await browser.close();
}
