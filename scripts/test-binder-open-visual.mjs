/**
 * Visible E2E — the BINDER BUTTON path, exactly as a human uses it:
 *   1. Click the composer paperclip → the runtime opens a REAL Windows Explorer dialog.
 *   2. A PowerShell watcher types the target folder into that real dialog and confirms
 *      (navigate into folder → accept the "Choose this folder" placeholder).
 *   3. The app scans → review card (click Start if shown) → dev server → preview.
 *   4. PROOF = painted pixels: pierce the preview iframe, read its DOM (element count,
 *      visible text), and screenshot the rendered app. No "src exists" shortcuts.
 *
 * Usage: node scripts/test-binder-open-visual.mjs [folderPath]
 */

import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FOLDER = process.argv[2] ?? 'C:\\Users\\v3gga\\Documents\\DEV_MPM\\mpm-frontend';
const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'binder-open-e2e', STAMP);
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

/** Types the folder path into the REAL Explorer dialog when it appears. */
function armDialogTyper(folder) {
  const script = `
$wshell = New-Object -ComObject wscript.shell
$deadline = (Get-Date).AddSeconds(40)
$found = $false
while ((Get-Date) -lt $deadline) {
  if ($wshell.AppActivate('Open a project folder')) { $found = $true; break }
  Start-Sleep -Milliseconds 400
}
if (-not $found) { Write-Output 'DIALOG-NOT-FOUND'; exit 1 }
Start-Sleep -Milliseconds 900
$wshell.SendKeys('${folder.replace(/\\/g, '\\\\')}{ENTER}')
Start-Sleep -Milliseconds 1400
$wshell.SendKeys('Choose this folder{ENTER}')
Write-Output 'DIALOG-DRIVEN'
`;
  const child = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => console.log(`  [dialog-typer] ${d.toString().trim()}`));
  return child;
}

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 50,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: null,
});

try {
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await sleep(2500);
  await shot(page, '01-loaded');
  log('App loaded', true);

  // Arm the real-dialog typer BEFORE clicking the paperclip.
  const typer = armDialogTyper(FOLDER);

  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.getAttribute('title') ?? '').startsWith('Attach a file or open a project folder'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  log('Paperclip (binder) clicked', clicked);
  if (!clicked) throw new Error('Paperclip button not found');

  // The native dialog is now on screen; the typer drives it. Wait for the app
  // to receive the folder and run the pipeline. Click Start on the review card
  // whenever it shows up.
  const clickStartIfPresent = async () => page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => /^(Start|Start anyway)$/.test(b.textContent?.trim() ?? '') && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  }).catch(() => false);

  let startClicked = false;
  let previewFrame = null;
  for (let i = 0; i < 210; i += 1) {
    await sleep(1000);
    if (!startClicked) {
      startClicked = await clickStartIfPresent();
      if (startClicked) { log('Review card → Start', true); await shot(page, '02-review-card'); }
    }
    previewFrame = page.frames().find((f) => /localhost:4\d{3}/.test(f.url()));
    if (previewFrame) break;
    if (i > 0 && i % 45 === 0) await shot(page, `debug-${i}s`);
  }
  log('Preview iframe attached', Boolean(previewFrame), previewFrame?.url() ?? 'timeout');
  if (!previewFrame) throw new Error('No preview frame');

  // ── RENDER PROOF: read the actual DOM inside the app's iframe ──
  let render = null;
  for (let i = 0; i < 90; i += 1) {
    await sleep(2000);
    try {
      render = await previewFrame.evaluate(() => {
        const body = document.body;
        if (!body) return null;
        const els = body.querySelectorAll('*').length;
        const text = (body.innerText ?? '').trim().slice(0, 300);
        const hasNextErrorOverlay = Boolean(document.querySelector('nextjs-portal'));
        return { els, text, hasNextErrorOverlay, title: document.title };
      });
    } catch { /* frame mid-navigation */ }
    if (render && render.els > 20 && render.text.length > 10) break;
    previewFrame = page.frames().find((f) => /localhost:4\d{3}/.test(f.url())) ?? previewFrame;
  }
  const rendered = Boolean(render && render.els > 20 && render.text.length > 10);
  log('App RENDERED real pixels', rendered, render ? `${render.els} elements · title "${render.title}" · text: ${JSON.stringify(render.text.slice(0, 120))}` : 'no DOM');
  if (render?.hasNextErrorOverlay) log('Next.js error overlay present', false, 'app rendered but with a dev-overlay error');

  await sleep(2000);
  await shot(page, '03-final-rendered');

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} steps passed. Evidence: ${OUT}`);
  console.log('Leaving the window open 20s for inspection…');
  await sleep(20_000);
  typer.kill();
} finally {
  await browser.close();
}
