/**
 * test-ide-picker-visual.mjs — Playwright Visual Confirmation
 *
 * Validates the cleaned-up "Send to…" IDE picker shows:
 *  - IDE types (VS Code) not duplicate client instances
 *  - Online/offline status
 *  - No nested chat modes or sessions sub-items
 *  - Separate Chat App and Session pickers still work
 *
 * Opens a REAL Chrome window so v3gga can watch.
 *
 * Prerequisites:
 *   - Vite dev server on port 5173
 *   - Runtime server on port 3006
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots', 'ide-picker-visual');
const BASE_URL = 'http://localhost:5173';
const RUNTIME_URL = 'http://localhost:3006';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let stepN = 0;
async function screenshot(page, name) {
  stepN++;
  const filename = `${String(stepN).padStart(2, '0')}-${name}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`  📸 [${stepN}] ${filename}`);
  return filepath;
}

function log(msg) { console.log(msg); }

/* ── Seed runtime with ONE VS Code companion client ── */
async function seedRuntime() {
  const now = Date.now();
  const installKey = 'vscode-picker-test-' + now;

  const headers = {
    'Content-Type': 'application/json',
    'x-vai-installation-key': installKey,
    'x-vai-client-name': 'VS Code',
    'x-vai-client-type': 'vscode-extension',
    'x-vai-launch-target': 'vscode',
  };

  const chatBody = JSON.stringify({
    chatApps: [
      { id: 'vscode-copilot', label: 'GitHub Copilot' },
      { id: 'vscode-claude', label: 'Claude Code' },
    ],
    sessions: [
      { sessionId: 'ses_001', title: 'Clean IDE picker test', chatApp: 'vscode-copilot', lastModified: now - 30_000 },
      { sessionId: 'ses_002', title: 'Broadcast E2E pipeline', chatApp: 'vscode-copilot', lastModified: now - 600_000 },
      { sessionId: 'ses_003', title: 'Claude Code session', chatApp: 'vscode-claude', lastModified: now - 120_000 },
    ],
  });

  const r1 = await fetch(`${RUNTIME_URL}/api/companion-clients/chat-info`, {
    method: 'PATCH', headers, body: chatBody,
  });
  log(`  Seed chat-info: ${r1.status}`);

  const modelBody = JSON.stringify({
    models: [
      { id: 'claude-opus-4-20250514', family: 'claude-opus-4', name: 'Claude Opus 4', vendor: 'Anthropic' },
      { id: 'gpt-4o', family: 'gpt-4o', name: 'GPT-4o', vendor: 'OpenAI' },
    ],
  });

  const r2 = await fetch(`${RUNTIME_URL}/api/companion-clients/models`, {
    method: 'PATCH', headers, body: modelBody,
  });
  log(`  Seed models: ${r2.status}`);

  return installKey;
}

/* ── Patch bootstrap to bypass auth ── */
async function patchBootstrap() {
  const resp = await fetch(`${RUNTIME_URL}/api/platform/bootstrap`);
  const data = await resp.json();
  data.auth = {
    ...data.auth,
    enabled: false,
    authenticated: true,
    user: { id: 'pw-test', email: 'test@test.com', name: 'Playwright Tester' },
  };
  return JSON.stringify(data);
}

/* ── Move cursor visibly ── */
async function moveToElement(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  await page.waitForTimeout(200);
}

/* ── Click with visible cursor ── */
async function clickElement(page, locator, label) {
  await moveToElement(page, locator);
  log(`  → Click: "${label}"`);
  await locator.click();
  await page.waitForTimeout(400);
}

/* ── Find a button in the broadcast strip by text ── */
async function findStripButton(page, textMatch) {
  const btns = page.locator('[class*="bg-blue-500/5"] button');
  const count = await btns.count();
  for (let i = 0; i < count; i++) {
    const txt = (await btns.nth(i).textContent())?.trim().toLowerCase() || '';
    if (typeof textMatch === 'function' ? textMatch(txt) : txt.includes(textMatch)) {
      return btns.nth(i);
    }
  }
  return null;
}

/* ── Open a picker → wait for dropdown → return items ── */
async function openPicker(page, pickerLocator, label) {
  await clickElement(page, pickerLocator, label);
  await page.waitForTimeout(600);
  try {
    await page.locator('[cmdk-item]').first().waitFor({ state: 'visible', timeout: 3000 });
  } catch { /* may be empty */ }
  const items = page.locator('[cmdk-item]');
  const count = await items.count();
  return { items, count };
}

/* ════════════════════════════════════════════════════════════════════
   MAIN TEST
   ════════════════════════════════════════════════════════════════════ */
async function main() {
  log('╔════════════════════════════════════════════════════════════════╗');
  log('║  Playwright Visual: IDE Picker Dedup Confirmation            ║');
  log('╚════════════════════════════════════════════════════════════════╝\n');

  const results = { pass: 0, fail: 0, checks: [] };
  function check(name, ok) {
    results[ok ? 'pass' : 'fail']++;
    results.checks.push({ name, ok });
    log(`  ${ok ? '✅' : '❌'} ${name}`);
  }

  // ── Seed ──
  log('── Step 0: Seed Runtime ──');
  await seedRuntime();
  const patchedBootstrap = await patchBootstrap();
  log('  ✓ Seeded + bootstrap patched\n');

  // ── Launch browser ──
  log('▸ Launching Chromium (headless: false)...');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 60,
    args: ['--no-sandbox', '--start-maximized', '--window-size=1920,1080'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // ── Auth bypass ──
  await page.route('**/api/platform/bootstrap', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: patchedBootstrap });
  });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { id: 'pw-test', email: 'test@test.com', name: 'Playwright Tester' } }),
    });
  });

  try {
    // ═══════════════════════════════════════════════════════════
    // PHASE 1: Load Page
    // ═══════════════════════════════════════════════════════════
    log('\n── Phase 1: Initial Load ──');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    await screenshot(page, 'initial-load');

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: Activate Broadcast Mode
    // ═══════════════════════════════════════════════════════════
    log('\n── Phase 2: Activate Broadcast Mode ──');
    const broadcastBtn = page.locator('button[title*="broadcast" i]').first();
    if (await broadcastBtn.count() > 0) {
      await clickElement(page, broadcastBtn, 'Broadcast toggle');
      log('  ✓ Broadcast mode activated');
    } else {
      log('  ⚠ No broadcast button — trying alternatives');
      const allBtns = page.locator('button');
      const count = await allBtns.count();
      for (let i = 0; i < count; i++) {
        const title = await allBtns.nth(i).getAttribute('title') || '';
        const text = (await allBtns.nth(i).textContent())?.trim() || '';
        if (title.toLowerCase().includes('broadcast') || text.toLowerCase().includes('broadcast')) {
          await clickElement(page, allBtns.nth(i), `Alt broadcast btn: "${text || title}"`);
          break;
        }
      }
    }
    await page.waitForTimeout(1000);
    await screenshot(page, 'broadcast-activated');

    // Print strip buttons
    const stripBtns = page.locator('[class*="bg-blue-500/5"] button');
    const stripCount = await stripBtns.count();
    log(`  Strip has ${stripCount} buttons:`);
    for (let i = 0; i < stripCount; i++) {
      const txt = (await stripBtns.nth(i).textContent())?.trim() || '(empty)';
      log(`    [${i}] "${txt}"`);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: Open IDE Picker — Core Validation
    // ═══════════════════════════════════════════════════════════
    log('\n── Phase 3: Open IDE Picker ──');
    const idePicker = await findStripButton(page, (t) =>
      t.includes('send to') || t.includes('vs code') || t.includes('all ide') || t === '1 ide' || t.includes('ide')
    );

    if (idePicker) {
      const { items, count } = await openPicker(page, idePicker, 'IDE Target picker');
      log(`  IDE picker items: ${count}`);

      const itemTexts = [];
      for (let i = 0; i < count; i++) {
        const t = (await items.nth(i).textContent())?.trim() || '';
        itemTexts.push(t);
        log(`    • "${t}"`);
      }
      await screenshot(page, 'ide-picker-open');

      // ── CHECK 1: No duplicate VS Code entries ──
      const vsCodeEntries = itemTexts.filter(t => t.toLowerCase().includes('vs code'));
      check('No duplicate VS Code entries (max 1)', vsCodeEntries.length <= 1);

      // ── CHECK 2: No nested "Chat Modes" or "Sessions" sub-items ──
      const hasChatModesHeader = itemTexts.some(t => t.toLowerCase().includes('chat modes'));
      const hasSessionsHeader = itemTexts.some(t => t.toLowerCase().includes('sessions'));
      check('No "Chat Modes" sub-items in IDE picker', !hasChatModesHeader);
      check('No "Sessions" sub-items in IDE picker', !hasSessionsHeader);

      // ── CHECK 3: Shows online status ──
      const hasOnlineHint = itemTexts.some(t => t.includes('online'));
      check('Shows online/offline status', hasOnlineHint);

      // ── CHECK 4: Total items is small (not bloated) ──
      check(`Picker has ≤5 items (got ${count})`, count <= 5);

      // Hover each item visually
      for (let i = 0; i < count; i++) {
        await moveToElement(page, items.nth(i));
        await page.waitForTimeout(300);
      }
      await screenshot(page, 'ide-picker-hovered');

      // Select VS Code if present
      const vsItem = items.filter({ hasText: 'VS Code' }).first();
      if (await vsItem.count() > 0) {
        await moveToElement(page, vsItem);
        await page.waitForTimeout(300);
        await screenshot(page, 'ide-picker-vscode-hover');
        await vsItem.click();
        await page.waitForTimeout(500);
        log('  ✓ Selected VS Code');
        await screenshot(page, 'ide-picker-vscode-selected');
      }

      // Close picker
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      check('IDE picker found in strip', false);
      log('  ⚠ IDE picker button not found');
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: Verify Chat App Picker (separate)
    // ═══════════════════════════════════════════════════════════
    log('\n── Phase 4: Open Chat App Picker ──');
    const chatAppPicker = await findStripButton(page, (t) =>
      t === 'chat' || t.includes('copilot') || t.includes('claude code') || t === 'chat app'
    );

    if (chatAppPicker) {
      const { items, count } = await openPicker(page, chatAppPicker, 'Chat App picker');
      log(`  Chat App items: ${count}`);
      for (let i = 0; i < count; i++) {
        const t = (await items.nth(i).textContent())?.trim() || '';
        log(`    • "${t}"`);
      }
      await screenshot(page, 'chatapp-picker-open');
      check('Chat App picker has items', count > 0);

      // Select GitHub Copilot
      const copilot = items.filter({ hasText: 'GitHub Copilot' }).first();
      if (await copilot.count() > 0) {
        await clickElement(page, copilot, 'GitHub Copilot');
        log('  ✓ Selected GitHub Copilot');
      }
      await page.waitForTimeout(400);
      await screenshot(page, 'chatapp-selected');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      log('  ⚠ Chat App picker not found');
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 5: Verify Session Picker (separate)
    // ═══════════════════════════════════════════════════════════
    log('\n── Phase 5: Open Session Picker ──');
    const sessionPicker = await findStripButton(page, (t) =>
      t === 'session' || t === 'new session' || t.includes('clean ide') || t.includes('broadcast e2e')
    );

    if (sessionPicker) {
      const { items, count } = await openPicker(page, sessionPicker, 'Session picker');
      log(`  Session items: ${count}`);
      for (let i = 0; i < count; i++) {
        const t = (await items.nth(i).textContent())?.trim() || '';
        log(`    • "${t}"`);
        await moveToElement(page, items.nth(i));
        await page.waitForTimeout(200);
      }
      await screenshot(page, 'session-picker-open');
      check('Session picker has items', count > 0);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      log('  ⚠ Session picker not found');
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 6: Re-open IDE Picker — Confirm No Stale Duplicates
    // ═══════════════════════════════════════════════════════════
    log('\n── Phase 6: Re-open IDE Picker (dedup confirmation) ──');
    const idePicker2 = await findStripButton(page, (t) =>
      t.includes('vs code') || t.includes('all ide') || t === '1 ide' || t.includes('send to')
    );

    if (idePicker2) {
      const { items, count } = await openPicker(page, idePicker2, 'IDE picker (re-open)');
      log(`  Re-opened — ${count} items`);
      for (let i = 0; i < count; i++) {
        const t = (await items.nth(i).textContent())?.trim() || '';
        log(`    • "${t}"`);
      }
      await screenshot(page, 'ide-picker-reopen');

      const vsCount = (await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          const t = (await items.nth(i).textContent())?.trim().toLowerCase() || '';
          return t.includes('vs code') ? 1 : 0;
        })
      )).reduce((a, b) => a + b, 0);

      check(`Re-open: still max 1 VS Code entry (got ${vsCount})`, vsCount <= 1);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // ═══════════════════════════════════════════════════════════
    // FINAL: Screenshot full state
    // ═══════════════════════════════════════════════════════════
    log('\n── Final State ──');
    await screenshot(page, 'final-state');

    // Keep browser open for v3gga to look
    log('\n  ⏳ Keeping browser open for 5 seconds...');
    await page.waitForTimeout(5000);

    // ═══════════════════════════════════════════════════════════
    // RESULTS
    // ═══════════════════════════════════════════════════════════
    log('\n╔════════════════════════════════════════════════════════════════╗');
    log('║  RESULTS                                                      ║');
    log('╚════════════════════════════════════════════════════════════════╝');
    for (const c of results.checks) {
      log(`  ${c.ok ? '✅' : '❌'} ${c.name}`);
    }
    log(`\n  PASSED: ${results.pass}/${results.pass + results.fail}`);

    if (results.fail > 0) {
      log('\n  ⚠ Some checks FAILED — review screenshots');
    } else {
      log('\n  🎉 All checks PASSED — IDE picker is clean!');
    }

  } catch (err) {
    log(`\n❌ Error: ${err.message}`);
    await screenshot(page, 'error-state');
    throw err;
  } finally {
    await browser.close();

    // Clean up seeded test companion clients
    log('\n── Cleanup: Removing test companion clients ──');
    try {
      const r = await fetch(`${RUNTIME_URL}/api/companion-clients?prefix=vscode-picker-test-`, { method: 'DELETE' });
      const body = await r.json();
      log(`  Cleanup: deleted ${body.deleted ?? 0} test client(s)`);
    } catch (e) {
      log(`  Cleanup failed: ${e.message}`);
    }

    log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
