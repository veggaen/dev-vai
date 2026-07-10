/**
 * drive-lawn-e2e.mjs — full "user using dev-vai like base44" E2E on the REAL exe.
 *
 * Flow (all through the rendered UI, human-paced):
 *   1. Launch veggaai.exe (isolated WebView2 profile, CDP attach).
 *   2. Sign in with a minted platform session token (legit DB session).
 *   3. Chat 1 → bind C:\Users\v3gga\Documents\dev-lawn → attach → dev server
 *      auto-launch → verify the LAWN APP renders in the App window.
 *   4. Ask for a real edit (docs/setup.md heading) in natural language,
 *      wait for the turn, capture diff/proposal evidence, check disk.
 *   5. Chat 2 → bind web3-social (old Next 15 repo) → attach → verify launch
 *      attempt outcome is SURFACED (running preview or failure in terminal).
 *
 * Usage: node scripts/drive-lawn-e2e.mjs --token <sessionToken>
 * Evidence → screenshots/lawn-e2e/
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const TOKEN = argOf('--token');
if (!TOKEN) { console.error('need --token'); process.exit(1); }

const EXE = argOf('--exe') ?? 'apps/desktop/src-tauri/target/release/veggaai.exe';
const CDP_PORT = 9224;
const OUT = 'screenshots/lawn-e2e';
const LAWN = 'C:/Users/v3gga/Documents/dev-lawn';
const HEX = 'C:/Users/v3gga/Documents/DEV-HEX-SOSIAL/web3-social';
mkdirSync(OUT, { recursive: true });

const results = [];
const log = (name, ok, note = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function humanClick(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box');
  await page.mouse.move(box.x + box.width / 2 - 18, box.y + box.height / 2 - 8, { steps: 10 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await sleep(140);
  await page.mouse.down(); await sleep(50); await page.mouse.up();
}
async function humanType(page, locator, text) {
  await humanClick(page, locator);
  for (const ch of text) { await page.keyboard.type(ch); await sleep(18 + Math.random() * 40); }
}

/** In-page API call carrying the bearer token (same thing the app's apiFetch does). */
async function api(page, method, url, body) {
  return page.evaluate(async ({ method, url, body, token }) => {
    const res = await fetch(`http://127.0.0.1:3006${url}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }, { method, url, body, token: TOKEN });
}

async function bindAndOpenChat(page, title, folder) {
  // AGENT mode (auto-routing, per V3gga: exercise the agentic muscle, not forced
  // builder) + server-persisted workspaceRoot — the binding follows the chat to
  // any client, which is exactly what this test proves.
  const conv = await api(page, 'POST', '/api/conversations', {
    title, modelId: 'vai:v0', mode: 'agent', workspaceRoot: folder.replace(/\//g, '\\'),
  });
  if (conv.status !== 200 && conv.status !== 201) return { ok: false, why: `conversation create ${conv.status}` };
  const convId = conv.json?.id;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(4500);
  // Open the Sessions sidebar panel (rail label is "Sessions (⌘2)") and expand it.
  const chatsBtn = page.locator('button[aria-label^="Sessions"]').first();
  if (await chatsBtn.count()) { await humanClick(page, chatsBtn); await sleep(1200); }
  const row = page.getByText(title, { exact: false }).first();
  if (!(await row.isVisible().catch(() => false))) return { ok: false, why: 'conversation row not visible' };
  await humanClick(page, row);
  await sleep(5000); // bindConversation → saved binding → attachLocal (real fs)
  return { ok: true, convId };
}

/** Wait until streaming stops (send button back / "working" gone), max 4 min. */
async function waitForTurn(page) {
  const deadline = Date.now() + 240_000;
  await sleep(4000);
  while (Date.now() < deadline) {
    const busy = await page.getByText(/Vai is working|Thinking|council/i).first().isVisible().catch(() => false);
    const streamingAttr = await page.locator('[data-streaming="true"]').count().catch(() => 0);
    if (!busy && streamingAttr === 0) return true;
    await sleep(3000);
  }
  return false;
}

// ── launch + attach ───────────────────────────────────────────────────────────
const dataDir = path.resolve(OUT, '.webview2-profile');
mkdirSync(dataDir, { recursive: true });
const app = spawn(path.resolve(EXE), [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: dataDir,
  },
  stdio: 'ignore',
});
process.on('exit', () => { try { app.kill(); } catch { /* gone */ } });

let browser = null;
for (let i = 0; i < 20 && !browser; i += 1) {
  await sleep(1000);
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`); } catch { /* boot */ }
}
if (!browser) { log('CDP attach', false); process.exit(1); }
log('CDP attach', true);

try {
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await sleep(2000);

  // ── sign in with the minted session ────────────────────────────────────────
  await page.evaluate((token) => localStorage.setItem('vai-platform-session-token', token), TOKEN);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const me = await api(page, 'GET', '/api/auth/me');
  log('signed in via session token', me.json?.authenticated === true, me.json?.user?.email ?? `status ${me.status}`);
  await page.screenshot({ path: `${OUT}/01-signed-in.png` });

  // ══ SCENARIO 1: dev-lawn ════════════════════════════════════════════════════
  const lawn = await bindAndOpenChat(page, 'lawn-e2e', LAWN);
  log('chat bound to dev-lawn', lawn.ok, lawn.why ?? lawn.convId);
  await page.screenshot({ path: `${OUT}/02-lawn-attached.png` });

  if (lawn.ok) {
    // Old build auto-launches; new build shows the ask card — approve if present.
    const ask = page.getByRole('button', { name: /Run once/i }).first();
    if (await ask.isVisible().catch(() => false)) { await humanClick(page, ask); log('approved run', true); }

    // Wait for the lawn app to come alive in the App window.
    let lawnLive = false;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline && !lawnLive) {
      await sleep(5000);
      lawnLive = await page.locator('iframe[title*="preview" i]').first().isVisible().catch(() => false);
    }
    await page.screenshot({ path: `${OUT}/03-lawn-appview.png` });
    log('dev-lawn renders in App view', lawnLive, lawnLive ? 'iframe live' : 'no preview in 3min — see screenshot/terminal');

    // ── the docs edit, in natural language ───────────────────────────────────
    const composer = page.locator('textarea').first();
    await humanType(page, composer,
      'Open docs/setup.md in this project and change the top heading "# Setup" to "# Welcome to the Setup". Keep everything else exactly as it is.');
    await page.screenshot({ path: `${OUT}/04-edit-request-typed.png` });
    await page.keyboard.press('Enter');

    // New routing sends this to the IDE council → proposals → diff review.
    // Wait for review UI (or chat-turn completion as fallback), up to 6 min.
    let reviewReady = false;
    const reviewDeadline = Date.now() + 360_000;
    while (Date.now() < reviewDeadline && !reviewReady) {
      await sleep(4000);
      reviewReady = await page.getByRole('button', { name: /Approve/i }).first().isVisible().catch(() => false);
    }
    await page.screenshot({ path: `${OUT}/05-edit-turn-done.png` });
    log('edit produced reviewable work', reviewReady, reviewReady ? 'diff review visible' : 'no approve UI within 6min');

    // Approve pending diffs in the review panel, then apply.
    const approveAll = page.getByRole('button', { name: /Approve all|Approve/i }).first();
    if (await approveAll.isVisible().catch(() => false)) {
      await humanClick(page, approveAll);
      await sleep(2000);
      const apply = page.getByRole('button', { name: /Apply approved|Apply/i }).first();
      if (await apply.isVisible().catch(() => false)) { await humanClick(page, apply); await sleep(3500); }
      await page.screenshot({ path: `${OUT}/06-diff-approved.png` });
      log('diff review interacted', true);
    } else {
      log('diff review interacted', false, 'no approval UI shown');
    }

    const setupNow = readFileSync('C:/Users/v3gga/Documents/dev-lawn/docs/setup.md', 'utf8');
    const edited = setupNow.startsWith('# Welcome to the Setup');
    log('docs/setup.md actually edited on disk', edited, setupNow.split('\n')[0]);
  }

  // ══ SCENARIO 2: web3-social (old broken Next repo) ═══════════════════════════
  const hex = await bindAndOpenChat(page, 'hex-e2e', HEX);
  log('chat bound to web3-social', hex.ok, hex.why ?? hex.convId);
  if (hex.ok) {
    const ask2 = page.getByRole('button', { name: /Run once/i }).first();
    if (await ask2.isVisible().catch(() => false)) await humanClick(page, ask2);
    // Outcome either way must be VISIBLE: live preview or surfaced failure.
    let outcome = 'none';
    const deadline2 = Date.now() + 150_000;
    while (Date.now() < deadline2 && outcome === 'none') {
      await sleep(5000);
      if (await page.locator('iframe[title*="preview" i]').first().isVisible().catch(() => false)) outcome = 'preview-live';
      else if (await page.getByText(/Dev server failed|no live port|✗/i).first().isVisible().catch(() => false)) outcome = 'failure-surfaced';
    }
    await page.screenshot({ path: `${OUT}/07-hex-outcome.png` });
    log('web3-social outcome visible (run or honest failure)', outcome !== 'none', outcome);
  }

  const realErrors = errors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  log('zero page errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
} finally {
  console.log('\n--- SUMMARY ---');
  console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await sleep(4000);
  await browser.close().catch(() => {});
  try { app.kill(); } catch { /* gone */ }
}
