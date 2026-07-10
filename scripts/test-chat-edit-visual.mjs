/**
 * Visible-browser E2E: chat-to-edit on a real opened local project.
 *
 * The core product promise: open a folder → app runs live → ASK IN CHAT for a
 * change → council edit writes the file → HMR repaints → the change is visible.
 *
 * Sequence (one visible session):
 *   1. Open the desktop app, Ctrl+Shift+O, open the target folder.
 *   2. Wait for the live preview iframe.
 *   3. Screenshot BEFORE. Send the edit request in the builder chat.
 *   4. Poll the project file via API until the expected text lands (council + local model can take minutes).
 *   5. Wait for HMR, verify the rendered iframe contains the new text, screenshot AFTER.
 *   6. Revert the revision via API (leave the user's project untouched) and verify restoration.
 *
 * Usage: node scripts/test-chat-edit-visual.mjs
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FOLDER = 'C:\\Users\\v3gga\\Documents\\DEV_MPM\\mpm-frontend';
const TARGET_FILE = 'components/Navbar.tsx';
const EXPECTED_TEXT = 'MPM Pro';
const EDIT_PROMPT = 'In components/Navbar.tsx, change the navbar brand text "MPM" to "MPM Pro". Keep everything else in the file exactly the same.';
const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const API = 'http://localhost:3006';
const HEADERS = { 'Content-Type': 'application/json', 'x-vai-dev-auth-bypass': '1' };

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'chat-edit-e2e', STAMP);
mkdirSync(OUT, { recursive: true });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
};
const shot = async (page, name) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${file}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init) {
  // The runtime can stall for minutes while local models occupy the machine —
  // a failed poll must degrade, never throw the whole run away.
  try {
    const res = await fetch(`${API}${path}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(20_000),
      ...init,
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 50,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: null, // follow the real window — stays responsive if v3gga resizes/fullscreens
});

let projectId = null;
try {
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await sleep(2500);
  log('App loaded', true);

  // ── Open the folder ──
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyO');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(700);
  const dialogInput = await page.$('input[aria-label="Folder path"]');
  if (!dialogInput) throw new Error('Open-folder dialog did not appear');
  await dialogInput.type(FOLDER, { delay: 10 });
  await page.keyboard.press('Enter');
  await sleep(1500);

  // Review card (if any warnings) → click Start. The scan is async, so the card
  // can appear later than a fixed delay — keep trying inside the wait loop too.
  const clickStartIfPresent = async () => {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find((b) => /^(Start|Start anyway)$/.test(b.textContent?.trim() ?? ''));
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    }).catch(() => false);
    return clicked;
  };
  if (await clickStartIfPresent()) {
    log('Review card → Start', true);
  }

  // ── Wait for the live preview ──
  let previewFrameUrl = null;
  let startClicked = false;
  for (let i = 0; i < 150; i += 1) {
    await sleep(1000);
    if (!startClicked) {
      startClicked = await clickStartIfPresent();
      if (startClicked) log('Review card → Start (late)', true);
    }
    try {
      previewFrameUrl = await page.evaluate(() => {
        const frames = Array.from(document.querySelectorAll('iframe'));
        const live = frames.find((f) => /localhost:\d+/.test(f.src) && !f.src.includes(':5173'));
        return live?.src ?? null;
      });
    } catch { /* transient page reload */ }
    if (previewFrameUrl) break;
    if (i > 0 && i % 30 === 0) {
      const debug = await page.evaluate(() => ({
        iframes: Array.from(document.querySelectorAll('iframe')).map((f) => f.src || '(empty)'),
        dialogOpen: Boolean(document.querySelector('input[aria-label="Folder path"]')),
      })).catch(() => null);
      console.log(`  [debug t+${i}s] iframes=${JSON.stringify(debug?.iframes)} dialogOpen=${debug?.dialogOpen}`);
      await shot(page, `debug-${i}s`);
    }
  }
  log('Live preview attached', Boolean(previewFrameUrl), previewFrameUrl ?? 'timeout');
  if (!previewFrameUrl) throw new Error('No preview iframe');

  // Resolve projectId from the runtime (newest project matching our folder).
  const list = await api('/api/sandbox');
  projectId = (list.body ?? []).find((p) => p.name?.includes('mpm'))?.id ?? null;
  if (!projectId) {
    // fallback: open-folder is idempotent for the same path
    const reopen = await api('/api/sandbox/open-folder', { method: 'POST', body: JSON.stringify({ path: FOLDER }) });
    projectId = reopen.body?.id ?? null;
  }
  log('Project resolved', Boolean(projectId), projectId ?? 'not found');
  if (!projectId) throw new Error('No project id');

  const before = await api(`/api/sandbox/${projectId}/file?path=${encodeURIComponent(TARGET_FILE)}`);
  const beforeContent = before.body?.content ?? '';
  log('Target file readable', beforeContent.length > 0, `${beforeContent.length} chars`);
  if (beforeContent.includes(EXPECTED_TEXT)) throw new Error('Target file already contains the expected text — pick a different edit');

  await sleep(4000); // let the first Next.js compile settle before screenshotting
  await shot(page, '01-before-edit');

  // ── Send the edit request in chat ──
  const textarea = await page.$('textarea');
  if (!textarea) throw new Error('Chat composer not found');
  await textarea.click();
  await page.keyboard.type(EDIT_PROMPT, { delay: 12 });
  await shot(page, '02-prompt-typed');
  await page.keyboard.press('Enter');
  log('Edit request sent', true);

  // ── Poll the file for the change (council + local model: allow up to 8 min) ──
  let fileChanged = false;
  let failedPolls = 0;
  for (let i = 0; i < 160; i += 1) {
    await sleep(3000);
    const cur = await api(`/api/sandbox/${projectId}/file?path=${encodeURIComponent(TARGET_FILE)}`);
    if (cur.status === 0) {
      failedPolls += 1;
      if (failedPolls % 10 === 1) console.log(`  … runtime busy (local models under load), poll ${i}`);
      continue;
    }
    if (cur.body?.content?.includes(EXPECTED_TEXT)) { fileChanged = true; break; }
    if (i === 40) await shot(page, '03-council-working');
  }
  log('File updated on disk by chat edit', fileChanged, fileChanged ? TARGET_FILE : `timed out after 8 min (${failedPolls} stalled polls)`);

  let rendered = false;
  if (fileChanged) {
    // ── Verify the rendered app shows it (HMR) ──
    await sleep(6000);
    for (let i = 0; i < 10; i += 1) {
      const frame = page.frames().find((f) => /localhost:\d+/.test(f.url()) && !f.url().includes(':5173'));
      if (frame) {
        try {
          rendered = await frame.evaluate((text) => document.body?.innerText?.includes(text) ?? false, EXPECTED_TEXT);
        } catch { /* frame mid-reload */ }
      }
      if (rendered) break;
      await sleep(2000);
    }
    log('Change visible in the rendered app (HMR)', rendered);
    await shot(page, '04-after-edit');
  }

  // ── Cleanup: revert the chat's revision so the user's project is untouched ──
  const revs = await api(`/api/sandbox/${projectId}/revisions?limit=5`);
  const latest = revs.body?.revisions?.[0];
  if (fileChanged && latest) {
    const revert = await api(`/api/sandbox/${projectId}/revisions/${latest.id}/revert`, { method: 'POST' });
    const after = await api(`/api/sandbox/${projectId}/file?path=${encodeURIComponent(TARGET_FILE)}`);
    const restored = revert.ok && after.body?.content === beforeContent;
    log('Project restored to original (revision revert)', restored);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} steps passed. Evidence: ${OUT}`);
  console.log('Leaving the browser open for 12s…');
  await sleep(12_000);
} finally {
  await browser.close();
}
