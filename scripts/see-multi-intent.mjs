#!/usr/bin/env node
/**
 * see-multi-intent — drive ONE hard prompt through the LIVE app (localhost:5173)
 * and capture what actually happens: the assistant answer text + the process
 * timeline rows. This is the honest "before" picture for the multi-intent /
 * timeline work — the existing audit scripts test for behavior that does not
 * exist yet, so we look with our own eyes first.
 *
 * Usage: node scripts/see-multi-intent.mjs [--prompt "..."] [--mode agent]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:5173';
const RUNTIME = 'http://127.0.0.1:3006';

const args = process.argv.slice(2);
function argVal(flag, def) { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : def; }
const PROMPT = argVal('--prompt', 'Explain how JWT auth works and how to use it, and then build me a photographer portfolio app with nature images only, login for altered/unaltered states, and a social page when logged in.');
const MODE = argVal('--mode', 'agent');

const outDir = path.join(__dirname, '..', 'screenshots', 'multi-intent', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(outDir, { recursive: true });

async function bootstrapAuthBypass() {
  const res = await fetch(`${RUNTIME}/api/platform/bootstrap`);
  const payload = await res.json();
  payload.auth = { ...payload.auth, enabled: false, authenticated: true, user: { id: 'see', email: 'see@test.local', name: 'See' } };
  return JSON.stringify(payload);
}

async function shot(page, step, name) {
  const p = path.join(outDir, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log('  shot:', path.basename(p));
}

(async () => {
  const patched = await bootstrapAuthBypass();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route(`${RUNTIME}/api/platform/bootstrap`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: patched }));

  console.log('prompt:', PROMPT);
  console.log('mode  :', MODE);
  await page.goto(`${BASE}?devAuthBypass=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await shot(page, 1, 'loaded');

  // Type + send.
  const textarea = page.locator('textarea').first();
  await textarea.click();
  await page.keyboard.type(PROMPT, { delay: 8 });
  await shot(page, 2, 'typed');
  await page.keyboard.press('Enter');

  // Watch the timeline for up to 180s, snapshotting periodically.
  const deadline = Date.now() + 180000;
  let step = 3;
  let lastRowCount = -1;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    // Count process rows + capture their text to build a legibility report.
    const rows = await page.locator('[data-process-node], [class*="ProcessTree"] li, [data-chat-message-role]').allTextContents().catch(() => []);
    if (rows.length !== lastRowCount) {
      lastRowCount = rows.length;
      await shot(page, step++, `t${Math.round((Date.now() - (deadline - 180000)) / 1000)}s`);
    }
    const done = await page.locator('[data-chat-message-role="assistant"]').count();
    if (done > 0) {
      const txt = (await page.locator('[data-chat-message-role="assistant"]').last().textContent()) ?? '';
      if (txt.trim().length > 40) { await page.waitForTimeout(3000); break; }
    }
  }
  await shot(page, step++, 'final');

  // Dump the assistant answer + the visible process trace text.
  const answer = (await page.locator('[data-chat-message-role="assistant"]').last().textContent().catch(() => '')) ?? '';
  const trace = await page.locator('[data-process-node], [class*="ProcessTree"]').allTextContents().catch(() => []);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ prompt: PROMPT, mode: MODE, answerHead: answer.slice(0, 1200), traceRows: trace.slice(0, 60) }, null, 2));
  console.log('\nANSWER HEAD:\n', answer.slice(0, 800));
  console.log('\nreport + shots in:', outDir);
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
