/**
 * Driven live test: paperclip → Folder → REAL Explorer (v3gga selects manually)
 * → scan/review → dev server → preview iframe → PIXEL PROOF from inside the frame.
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'binder-folder-e2e', STAMP);
mkdirSync(OUT, { recursive: true });

const log = (m) => console.log(m);
const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  📸 ${OUT}\\${name}.png`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await shot(page, '01-loaded');

  // Click the paperclip.
  const clipClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.getAttribute('title') ?? '').startsWith('Attach a file or open a project folder'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  log(clipClicked ? '✓ Paperclip clicked' : '✗ Paperclip not found');
  await sleep(600);
  await shot(page, '02-menu-open');

  // Click "Folder".
  const folderClicked = await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((b) => b.textContent?.trim().startsWith('Folder'));
    if (!item) return false;
    item.click();
    return true;
  });
  log(folderClicked ? '✓ "Folder" clicked — Explorer should be opening NOW. Take your time, v3gga.' : '✗ Folder menu item not found');
  await shot(page, '03-after-folder-click');

  // Wait for the user's selection to flow through: the OpenFolderDialog appears
  // with scanning/review, then the pipeline runs. Poll for a live preview frame.
  let previewFrame = null;
  let clickedStart = false;
  for (let i = 0; i < 300; i += 1) {
    await sleep(1000);
    // Auto-continue the review card if it appears (warnings) — the user already chose.
    if (!clickedStart) {
      clickedStart = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find((b) => /^(Start|Start anyway)$/.test(b.textContent?.trim() ?? '') && !b.disabled);
        if (!btn) return false;
        btn.click();
        return true;
      }).catch(() => false);
      if (clickedStart) { log('✓ Review card → Start'); await shot(page, '04-review-started'); }
    }
    previewFrame = browser.targets().length && page.frames().find((f) => /localhost:\d+/.test(f.url()) && !f.url().includes(':5173') && !f.url().includes('about:blank'));
    if (previewFrame) break;
    if (i === 60) { log('  …still waiting (60s) — select the folder in Explorer if you haven\'t'); await shot(page, 'debug-60s'); }
    if (i === 150) { log('  …still waiting (150s)'); await shot(page, 'debug-150s'); }
  }

  if (!previewFrame) {
    log('✗ No preview frame appeared within 5 minutes');
    await shot(page, '09-timeout');
  } else {
    log(`✓ Preview frame attached — ${previewFrame.url()}`);
    // Give the app time to compile + paint, then PIXEL PROOF from inside the frame.
    await sleep(12_000);
    let proof = null;
    try {
      proof = await previewFrame.evaluate(() => ({
        title: document.title,
        textLen: (document.body?.innerText ?? '').length,
        textHead: (document.body?.innerText ?? '').slice(0, 160).replace(/\s+/g, ' '),
        elementCount: document.querySelectorAll('*').length,
      }));
    } catch (e) {
      log(`  frame evaluate blocked: ${String(e).slice(0, 120)}`);
    }
    if (proof) {
      log(`✓ RENDER PROOF — title="${proof.title}" elements=${proof.elementCount} textLen=${proof.textLen}`);
      log(`  text: "${proof.textHead}"`);
    }
    await shot(page, '05-preview-live');
  }

  log(`\nEvidence: ${OUT}`);
  await sleep(12_000);
} finally {
  await browser.close();
}
