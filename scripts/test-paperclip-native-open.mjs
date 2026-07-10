/**
 * Visible E2E — the paperclip native-picker flow, driven like a human:
 *
 *   1. Click the composer paperclip in a real browser.
 *   2. A REAL Windows Explorer dialog opens (served by the runtime).
 *   3. A PowerShell watcher activates THAT dialog by exact window title
 *      (never types blind), navigates into the target folder, and confirms
 *      the "Choose this folder" placeholder.
 *   4. The app must then open the project SILENTLY (no modal unless review),
 *      start its dev server, and paint REAL PIXELS in the preview iframe.
 *
 * PASS requires reading actual rendered content from inside the app frame —
 * an attached iframe or a 200 response is NOT enough.
 *
 * Usage: node scripts/test-paperclip-native-open.mjs [folder]
 */

import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FOLDER = process.argv[2] ?? 'C:\\Users\\v3gga\\Documents\\DEV_MPM\\mpm-frontend';
const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const DIALOG_TITLE = 'Open a project folder (click Open inside it) or pick a single file';

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'paperclip-e2e', STAMP);
mkdirSync(OUT, { recursive: true });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
};
const shot = async (page, name) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${file}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Drive the native dialog by TITLE — refuses to type anywhere else. */
function startDialogDriver(folder) {
  const ps = `
$title = '${DIALOG_TITLE}'
$sh = New-Object -ComObject WScript.Shell
$deadline = (Get-Date).AddSeconds(60)
$activated = $false
while ((Get-Date) -lt $deadline) {
  if ($sh.AppActivate($title)) { $activated = $true; break }
  Start-Sleep -Milliseconds 300
}
if (-not $activated) { Write-Output 'DIALOG_NOT_FOUND'; exit 1 }
Start-Sleep -Milliseconds 600
$sh.SendKeys('${folder.replace(/\\/g, '\\\\')}')
Start-Sleep -Milliseconds 400
$sh.SendKeys('{ENTER}')
Start-Sleep -Milliseconds 1600
if (-not $sh.AppActivate($title)) { Write-Output 'DIALOG_LOST_FOCUS'; exit 1 }
$sh.SendKeys('Choose this folder')
Start-Sleep -Milliseconds 400
$sh.SendKeys('{ENTER}')
Write-Output 'DIALOG_DRIVEN'
`.trim();
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  return new Promise((resolvePromise) => {
    const proc = spawn('powershell', ['-NoProfile', '-EncodedCommand', encoded], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', () => resolvePromise(out.trim()));
  });
}

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 40,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: null,
});

try {
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await sleep(2500);
  log('App loaded', true);
  await shot(page, '01-loaded');

  // Start the title-locked dialog driver BEFORE clicking the paperclip.
  const driverPromise = startDialogDriver(FOLDER);

  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.getAttribute('title') ?? '').startsWith('Attach a file or open a project folder'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  log('Paperclip clicked', clicked);
  if (!clicked) throw new Error('Paperclip button not found');

  const driverResult = await driverPromise;
  log('Native dialog driven by title', driverResult === 'DIALOG_DRIVEN', driverResult);
  await sleep(1500);
  await shot(page, '02-after-dialog');

  // If the scan legitimately needs review, the modal appears — click Start.
  for (let i = 0; i < 20; i += 1) {
    const started = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((b) => /^(Start|Start anyway)$/.test(b.textContent?.trim() ?? '') && !b.disabled);
      if (!btn) return false;
      btn.click();
      return true;
    }).catch(() => false);
    if (started) { log('Review card → Start', true); break; }
    await sleep(1000);
  }

  // No modal should be blocking now; wait for the app frame and demand pixels.
  let paint = null;
  for (let i = 0; i < 180; i += 1) {
    await sleep(1000);
    const frame = page.frames().find((f) => /localhost:4\d{3}/.test(f.url()));
    if (frame) {
      try {
        paint = await frame.evaluate(() => ({
          url: location.href,
          title: document.title,
          textLength: (document.body?.innerText ?? '').trim().length,
          elementCount: document.querySelectorAll('*').length,
          textSample: (document.body?.innerText ?? '').trim().slice(0, 160),
        }));
        if (paint.textLength > 40 && paint.elementCount > 25) break;
      } catch { /* frame navigating */ }
    }
    if (i % 30 === 29) console.log(`  … waiting for painted app (${i + 1}s)`);
  }
  const painted = Boolean(paint && paint.textLength > 40 && paint.elementCount > 25 && !/refused|can.t be reached/i.test(paint.textSample));
  log('REAL PIXELS painted in app window', painted, paint ? `title="${paint.title}" text=${paint.textLength} chars, ${paint.elementCount} elements — "${paint.textSample.slice(0, 80)}"` : 'no app frame');
  await shot(page, '03-app-painted');

  // Regression: the dialog keystrokes must NOT leak into the chat.
  const leak = await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    const composerLeak = (ta?.value ?? '').includes('Choose this folder');
    const messageLeak = Array.from(document.querySelectorAll('[data-role="user"], .whitespace-pre-wrap'))
      .some((el) => el.textContent?.trim() === 'Choose this folder');
    return composerLeak || messageLeak;
  });
  log('No keystroke leak into chat', !leak);

  await shot(page, '04-final');
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} steps passed. Evidence: ${OUT}`);
  console.log('Leaving the browser open for 12s…');
  await sleep(12_000);
} finally {
  await browser.close();
}
