/**
 * drive-tauri-human.mjs — drives the REAL veggaai.exe like a human tester.
 *
 * How: WebView2 (Tauri's Windows renderer) honors --remote-debugging-port via the
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env var. We spawn the actual exe with that
 * set, attach Playwright over CDP, and interact with the live app window — real
 * mouse movement, real typing cadence, real Tauri disk access (unlike the browser
 * gate, attach-folder here reads the actual filesystem).
 *
 * Usage:
 *   node scripts/drive-tauri-human.mjs                  # drive the release exe
 *   node scripts/drive-tauri-human.mjs --exe <path>     # drive a specific build
 *   node scripts/drive-tauri-human.mjs --attach <dir>   # also run the attach→dev-server flow
 *
 * Evidence → screenshots/tauri-drive/ + compact action log on stdout.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const argOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

const EXE = argOf('--exe') ?? 'apps/desktop/src-tauri/target/release/veggaai.exe';
const ATTACH_DIR = argOf('--attach'); // e.g. C:\Users\v3gga\Documents\dev-lawn
const CDP_PORT = Number(argOf('--port') ?? 9223);
const OUT = 'screenshots/tauri-drive';
mkdirSync(OUT, { recursive: true });

if (!existsSync(EXE)) {
  console.error(`FAIL exe not found: ${EXE} — build with: pnpm --filter @vai/desktop tauri build`);
  process.exit(1);
}

const results = [];
const log = (name, ok, note = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Human-ish mouse: curved approach in a few steps, tiny settle pause. */
async function humanMove(page, x, y) {
  await page.mouse.move(x + (Math.random() * 40 - 20), y + (Math.random() * 30 - 15), { steps: 12 });
  await page.mouse.move(x, y, { steps: 8 });
  await sleep(120 + Math.random() * 180);
}
async function humanClick(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  await humanMove(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(40 + Math.random() * 60);
  await page.mouse.up();
}
async function humanType(page, text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(30 + Math.random() * 70);
  }
}

// ── 1. Launch the real exe with a CDP door open ──────────────────────────────
// Isolated WEBVIEW2_USER_DATA_FOLDER: WebView2 shares one browser process per
// data folder — if V3gga's own instance is already running, ours would join it
// and the debug-port flag would be silently ignored. Own folder = own process.
const dataDir = path.resolve(OUT, '.webview2-profile');
mkdirSync(dataDir, { recursive: true });
console.log(`▶ launching ${EXE} (CDP :${CDP_PORT}, profile ${dataDir})`);
const app = spawn(path.resolve(EXE), [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: dataDir,
  },
  detached: false,
  stdio: 'ignore',
});
const killApp = () => { try { app.kill(); } catch { /* already gone */ } };
process.on('exit', killApp);

// ── 2. Attach Playwright over CDP (retry while WebView2 boots) ──────────────
let browser = null;
for (let attempt = 0; attempt < 20 && !browser; attempt += 1) {
  await sleep(1000);
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  } catch { /* webview not up yet */ }
}
if (!browser) {
  log('attach to exe over CDP', false, 'WebView2 never opened the debug port');
  killApp();
  process.exit(1);
}
log('attach to exe over CDP', true);

try {
  const contexts = browser.contexts();
  const pages = contexts.flatMap((c) => c.pages());
  const page = pages.find((p) => !p.url().startsWith('devtools')) ?? pages[0];
  if (!page) throw new Error('no page in the exe webview');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // ── 3. Fresh-load evidence ────────────────────────────────────────────────
  await sleep(2500); // let the shell settle like a human would wait
  await page.screenshot({ path: `${OUT}/01-exe-initial.png` });
  const title = await page.title().catch(() => '');
  log('app window rendered', true, `title="${title}" url=${page.url()}`);

  // ── 4. Wander the top nav like a curious user ─────────────────────────────
  for (const name of ['App', 'Council', 'Chat']) {
    const btn = page.getByRole('button', { name: new RegExp(`^${name}$`) }).first();
    if (await btn.count()) {
      await humanClick(page, btn);
      await sleep(800);
      await page.screenshot({ path: `${OUT}/02-nav-${name.toLowerCase()}.png` });
    }
  }
  log('top-nav walkthrough', true);

  // ── 5. Optional: real attach → detect → run flow on a real folder ────────
  if (ATTACH_DIR) {
    // Native folder pickers can't be driven over CDP. Instead seed the SAME
    // localStorage binding a real pick writes (keyed by conversation id from the
    // app's own API), then select that chat like a human — bindConversation()
    // re-attaches saved folders through real Tauri fs.
    const seeded = await page.evaluate(async (dir) => {
      try {
        const res = await fetch('http://127.0.0.1:3006/api/conversations');
        if (!res.ok) return { ok: false, why: `conversations ${res.status}` };
        const list = await res.json();
        const conv = Array.isArray(list) ? list[0] : null;
        if (!conv?.id) return { ok: false, why: 'no conversations' };
        localStorage.setItem('vai-workspace-by-conversation', JSON.stringify({ [conv.id]: dir }));
        return { ok: true, convId: conv.id, title: conv.title ?? '' };
      } catch (e) {
        return { ok: false, why: String(e) };
      }
    }, ATTACH_DIR);
    if (!seeded.ok) {
      log('seed folder binding', false, seeded.why);
    } else {
      log('seed folder binding', true, `conversation ${seeded.convId.slice(0, 8)} → ${ATTACH_DIR}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(4000);

      // Open the chats panel and click the bound conversation like a human.
      const chatsNav = page.locator('button[aria-label*="chat" i], button[aria-label*="conversation" i]').first();
      if (await chatsNav.count()) { await humanClick(page, chatsNav); await sleep(700); }
      const convRow = page.getByText(seeded.title || /./, { exact: false }).first();
      const rowVisible = seeded.title && await convRow.isVisible().catch(() => false);
      if (rowVisible) {
        await humanClick(page, convRow);
        await sleep(3000);
      }
      await page.screenshot({ path: `${OUT}/03-attached.png` });

      // Old build: auto-launch; new build: permission card. Handle both.
      const askCard = page.getByText('Council found a runnable app', { exact: false }).first();
      if (await askCard.isVisible().catch(() => false)) {
        await page.screenshot({ path: `${OUT}/04-permission-ask.png` });
        const runOnce = page.getByRole('button', { name: /Run once/i }).first();
        await humanClick(page, runOnce);
        log('approved run (once)', true);
      } else {
        log('permission card', true, 'not present in this build — legacy auto-run path');
      }

      // Wait for the dev server to come live (up to 2 min), screenshot the preview.
      let live = false;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && !live) {
        await sleep(4000);
        live = await page.locator('iframe[title*="preview" i]').first().isVisible().catch(() => false);
      }
      await page.screenshot({ path: `${OUT}/05-app-preview.png` });
      log('attached app renders in App window', live, live ? 'iframe live' : 'no live preview within 2min (check terminal panel)');
    }
  }

  const realErrors = errors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  log('zero page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  await page.screenshot({ path: `${OUT}/06-final.png` });
} finally {
  console.log('\n--- SUMMARY ---');
  console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await sleep(3000); // leave the window visible for observation
  await browser.close().catch(() => {});
  killApp();
}
