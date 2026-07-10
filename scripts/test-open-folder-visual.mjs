/**
 * Visible-browser E2E: open a local folder as a live workspace.
 *
 * Proves the full user path in one visible session:
 *   1. Load the desktop app (dev auth bypass).
 *   2. Ctrl+Shift+O → Open-folder dialog appears.
 *   3. Type a real project path (dev-lawn) and press Enter.
 *   4. Pipeline runs (scan → dev server) and the live app appears in the preview iframe.
 *   5. Console command deck shows build/lint/test buttons.
 *
 * Screenshots land in Temporary_files/open-folder-e2e/<stamp>/.
 * Usage: node scripts/test-open-folder-visual.mjs [folderPath]
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FOLDER = process.argv[2] ?? 'C:\\Users\\v3gga\\Documents\\dev-lawn';
const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'open-folder-e2e', STAMP);
mkdirSync(OUT, { recursive: true });

const results = [];
const framedAppError = (info) => {
  if (!info) return 'no framed document content';
  const text = `${info.title ?? ''} ${info.textSample ?? ''}`;
  if (info.hasNextErrorOverlay) return 'framework error overlay present';
  if (/^\s*\{\s*"status"\s*:\s*5\d\d/i.test(info.textSample ?? '')) return 'iframe rendered a raw HTTP 5xx JSON response';
  if (/\b(HTTPError|Internal Server Error|Missing VITE_[A-Z0-9_]+|Vite Error)\b/i.test(text)) {
    return 'iframe rendered an application error';
  }
  return null;
};
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
};

const shot = async (page, name) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${file}`);
};

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 50,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: null, // follow the real window — stays responsive if v3gga resizes/fullscreens
});

try {
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 2500));
  await shot(page, '01-fresh-load');
  log('App loaded', true);

  // Keyboard-led: Ctrl+Shift+O opens the dialog.
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyO');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 700));

  const dialogInput = await page.$('input[aria-label="Folder path"]');
  log('Ctrl+Shift+O opens dialog', Boolean(dialogInput));
  await shot(page, '02-dialog-open');
  if (!dialogInput) throw new Error('Open-folder dialog did not appear');

  await dialogInput.type(FOLDER, { delay: 12 });
  await shot(page, '03-path-typed');
  await page.keyboard.press('Enter');
  log('Path submitted', true, FOLDER);

  // Review card step: projects with setup requirements show a review card first.
  await new Promise((r) => setTimeout(r, 2000));
  let startButton = null;
  let hasReview = false;
  for (let i = 0; i < 20; i += 1) {
    const candidate = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find((b) => {
        const text = (b.textContent ?? '').replace(/\s+/g, ' ').trim();
        const compact = text.replace(/\s+/g, '');
        return /^Start$/i.test(text) || /^Startanyway$/i.test(compact) || /^Start anyway$/i.test(text);
      }) ?? null;
    });
    hasReview = await page.evaluate((el) => Boolean(el), candidate);
    if (hasReview) {
      startButton = candidate;
      break;
    }
    await candidate.dispose();
    await new Promise((r) => setTimeout(r, 500));
  }
  if (hasReview) {
    await shot(page, '03b-review-card');
    log('Review card shown (setup requirements surfaced)', true);
    // Expand setup notes if present, for evidence.
    await page.evaluate(() => {
      const notes = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Setup notes'));
      notes?.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await shot(page, '03c-setup-notes');
    await startButton?.asElement()?.click();
    log('Start clicked from review card', true);
  }

  // Wait for the pipeline: scanning → (install) → dev server → preview iframe.
  // The desktop app can reload mid-pipeline (WS reconnect) — tolerate detached frames.
  let previewSrc = null;
  let failureStateText = null;
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const state = await page.evaluate(() => {
        const frames = Array.from(document.querySelectorAll('iframe'));
        const live = frames.find((f) => /localhost:\d+/.test(f.src) && !f.src.includes(':5173'));
        const text = document.body.innerText;
        const failed = /App stopped|This build did not reach a runnable state/i.test(text);
        const cause = failed
          ? (/Reported cause\s+([\s\S]*?)(?:Existing files stay in place|Restart preview|Stage repair prompt|View console|$)/i.exec(text)?.[1] ?? '').trim()
          : null;
        return {
          previewSrc: live?.src ?? null,
          failureStateText: failed ? (cause ? `App stopped — ${cause}` : 'App stopped') : null,
        };
      });
      previewSrc = state.previewSrc;
      failureStateText = state.failureStateText;
    } catch {
      continue; // page navigated/reloaded — retry on the fresh document
    }
    if (previewSrc || failureStateText) break;
    if (i === 20) await shot(page, '04-pipeline-running').catch(() => {});
  }
  log('Live app iframe appeared', Boolean(previewSrc), previewSrc ?? 'timed out');
  if (failureStateText) log('Preview failure state appeared', true, failureStateText);
  await new Promise((r) => setTimeout(r, 3000));
  await shot(page, '05-preview-live');

  // RENDER PROOF — do not trust iframe.src. Read the framed document itself:
  // real pixels means the frame has a title/body with actual content and the
  // handoff shell overlay is gone.
  let renderProof = null;
  for (let i = 0; !failureStateText && i < 45; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const frame = page.frames().find((f) => f.url() && /localhost:\d+/.test(f.url()) && !f.url().includes(':5173'));
      if (!frame) continue;
      const info = await frame.evaluate(() => ({
        title: document.title,
        textLength: (document.body?.innerText ?? '').length,
        textSample: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160),
        hasNextErrorOverlay: Boolean(document.querySelector('nextjs-portal')),
      })).catch(() => null);
      if (info && (info.textLength > 20 || info.title)) { renderProof = info; break; }
    } catch { /* frame swap mid-poll — retry */ }
  }
  const renderFailure = framedAppError(renderProof);
  const overlayGone = await page.evaluate(() => !document.body.innerText.includes('Connecting the live app'));
  log('Framed app rendered real content', Boolean(renderProof && renderProof.textLength > 20 && !renderFailure),
    renderProof ? `title="${renderProof.title}" text[0..160]="${renderProof.textSample}"${renderFailure ? ` (${renderFailure})` : ''}` : renderFailure);
  log('Handoff shell overlay dismissed', overlayGone);
  if (renderProof?.hasNextErrorOverlay) log('WARNING: Next.js error overlay present in frame', false, 'the app itself is erroring');
  await shot(page, '05b-render-proof');

  // Command deck: build/lint buttons in the console area.
  const deck = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons
      .filter((b) => /^(build|lint|test|typecheck|check|format)$/.test(b.textContent?.trim() ?? ''))
      .map((b) => b.textContent.trim());
  });
  log('Command deck visible', deck.length > 0, deck.join(', ') || 'no script buttons found (console may be collapsed)');
  await shot(page, '06-final-state');

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} steps passed. Evidence: ${OUT}`);
  if (passed !== results.length) {
    process.exitCode = 1;
  }
  console.log('Leaving the browser open for 15s so you can inspect it…');
  await new Promise((r) => setTimeout(r, 15_000));
} finally {
  await browser.close();
}
