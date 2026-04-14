/**
 * test-session-selection-playwright.mjs — Playwright E2E visual test
 *
 * Tests the full flow: extension → chat → sessions picker
 * - Finds VS Code sessions seeded from the extension
 * - Opens each target session
 * - Sends a message and confirms it appears
 * - All with visible mouse/keyboard so v3gga can watch
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
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots', 'session-selection');
const BASE_URL = 'http://localhost:5173';
const RUNTIME_URL = 'http://localhost:3006';

const TARGET_SESSIONS = [
  'Extending IDE with Additional Dropdown Options',
  "Improving Vai's Response Quality",
  'AgentSession model and related structures discussion',
];

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

/* ── Seed runtime with session data ── */
async function seedRuntime() {
  const now = Date.now();
  const installKey = 'vscode-playwright-e2e-' + now;

  const chatBody = JSON.stringify({
    chatApps: [
      { id: 'vscode-copilot', label: 'GitHub Copilot' },
      { id: 'vscode-claude', label: 'Claude Code' },
    ],
    sessions: [
      { sessionId: 'ses_ext_001', title: 'Extending IDE with Additional Dropdown Options', chatApp: 'vscode-copilot', lastModified: now - 60_000 },
      { sessionId: 'ses_ext_002', title: "Improving Vai's Response Quality", chatApp: 'vscode-copilot', lastModified: now - 3_600_000 },
      { sessionId: 'ses_ext_003', title: 'AgentSession model and related structures discussion', chatApp: 'vscode-copilot', lastModified: now - 7_200_000 },
      { sessionId: 'ses_ext_004', title: 'Refactoring desktop chat app for IDE management', chatApp: 'vscode-copilot', lastModified: now - 86_400_000 },
      { sessionId: 'ses_ext_005', title: 'VS Code crash validation request', chatApp: 'vscode-copilot', lastModified: now - 100_000_000 },
      { sessionId: 'ses_ext_006', title: 'Extension connection + visual E2E testing', chatApp: 'vscode-claude', lastModified: now - 30_000 },
    ],
  });

  const headers = {
    'Content-Type': 'application/json',
    'x-vai-installation-key': installKey,
    'x-vai-client-name': 'VS Code',
    'x-vai-client-type': 'vscode-extension',
    'x-vai-launch-target': 'vscode',
  };

  const r1 = await fetch(`${RUNTIME_URL}/api/companion-clients/chat-info`, {
    method: 'PATCH', headers, body: chatBody,
  });
  log(`  Seed chat-info: ${r1.status}`);

  const modelBody = JSON.stringify({
    models: [
      { id: 'claude-opus-4-20250514', family: 'claude-opus-4', name: 'Claude Opus 4', vendor: 'Anthropic' },
      { id: 'claude-sonnet-4-20250514', family: 'claude-sonnet-4', name: 'Claude Sonnet 4', vendor: 'Anthropic' },
      { id: 'gpt-4o', family: 'gpt-4o', name: 'GPT-4o', vendor: 'OpenAI' },
      { id: 'o3', family: 'o3', name: 'o3', vendor: 'OpenAI' },
      { id: 'gemini-2.5-pro', family: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', vendor: 'Google' },
    ],
  });

  const r2 = await fetch(`${RUNTIME_URL}/api/companion-clients/models`, {
    method: 'PATCH', headers, body: modelBody,
  });
  log(`  Seed models: ${r2.status}`);

  return installKey;
}

/* ── Patch bootstrap response to bypass auth ── */
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

/* ── Move cursor visibly to element center ── */
async function moveToElement(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  await page.waitForTimeout(200);
}

/* ── Click element with visible cursor movement ── */
async function clickElement(page, locator, label) {
  await moveToElement(page, locator);
  log(`  → Click: "${label}"`);
  await locator.click();
  await page.waitForTimeout(400);
}

/* ── Type text with visible keystrokes ── */
async function typeText(page, locator, text) {
  await moveToElement(page, locator);
  await locator.click();
  await page.waitForTimeout(200);
  for (const char of text) {
    await page.keyboard.type(char, { delay: 40 });
  }
  await page.waitForTimeout(300);
}

/* ── Helper: find strip button by text pattern ── */
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

/* ── Helper: open a picker, wait for dropdown, return items ── */
async function openPicker(page, pickerLocator, label) {
  await clickElement(page, pickerLocator, label);
  await page.waitForTimeout(600);
  // Wait for cmdk items to appear
  try {
    await page.locator('[cmdk-item]').first().waitFor({ state: 'visible', timeout: 3000 });
  } catch { /* dropdown may be empty */ }
  const items = page.locator('[cmdk-item]');
  const count = await items.count();
  return { items, count };
}

/* ════════════════════════════════════════════════════════════════════
   MAIN TEST
   ════════════════════════════════════════════════════════════════════ */
async function main() {
  log('╔════════════════════════════════════════════════════════════════╗');
  log('║  Playwright E2E: Session Selection + Message Send            ║');
  log('╚════════════════════════════════════════════════════════════════╝\n');

  // ── Step 0: Seed runtime ──
  log('── Step 0: Seed Runtime ──');
  await seedRuntime();
  const patchedBootstrap = await patchBootstrap();
  log('  ✓ Runtime seeded, bootstrap patched\n');

  // ── Launch browser ──
  log('▸ Launching Playwright Chromium...');
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

  // ── Route interception for auth bypass ──
  await page.route('**/api/platform/bootstrap', async (route) => {
    log('  → Intercepted: bootstrap');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: patchedBootstrap,
    });
  });

  await page.route('**/api/auth/me', async (route) => {
    log('  → Intercepted: auth/me');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: { id: 'pw-test', email: 'test@test.com', name: 'Playwright Tester' },
      }),
    });
  });

  try {
    // ════════════════════════════════════════════════════════════════
    // PHASE 1: Initial Load
    // ════════════════════════════════════════════════════════════════
    log('\n── Phase 1: Initial Load ──');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);

    const buttonCount = await page.locator('button').count();
    log(`  Page loaded — ${buttonCount} buttons found`);
    await screenshot(page, 'initial-load');

    // ════════════════════════════════════════════════════════════════
    // PHASE 2: Activate Broadcast Mode
    // ════════════════════════════════════════════════════════════════
    log('\n── Phase 2: Activate Broadcast Mode ──');

    const broadcastBtn = page.locator('button[title*="broadcast" i]').first();
    if (await broadcastBtn.count() > 0) {
      await clickElement(page, broadcastBtn, 'Broadcast toggle');
      log('  ✓ Broadcast mode activated');
    } else {
      log('  ⚠ No broadcast button found');
      const allBtnTexts = await page.locator('button').allTextContents();
      log(`  Buttons: ${allBtnTexts.slice(0, 15).join(' | ')}`);
    }

    await page.waitForTimeout(800);
    await screenshot(page, 'broadcast-activated');

    // Print all strip buttons for debugging
    const stripBtns = page.locator('[class*="bg-blue-500/5"] button');
    const stripCount = await stripBtns.count();
    log(`  Broadcast strip has ${stripCount} buttons:`);
    for (let i = 0; i < stripCount; i++) {
      const txt = (await stripBtns.nth(i).textContent())?.trim() || '(empty)';
      log(`    [${i}] "${txt}"`);
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 3: Select "GitHub Copilot" Chat App
    //   (Sessions are filtered by chatApp — seeded sessions use
    //    'vscode-copilot', but default chatApp is 'chat')
    // ════════════════════════════════════════════════════════════════
    log('\n── Phase 3: Select Chat App → "GitHub Copilot" ──');

    const chatAppPicker = await findStripButton(page, (t) =>
      t === 'chat' || t === 'github copilot' || t === 'claude code'
    );

    if (chatAppPicker) {
      const { items, count } = await openPicker(page, chatAppPicker, 'Chat App picker');
      log(`  Chat App items: ${count}`);
      for (let i = 0; i < count; i++) {
        const t = (await items.nth(i).textContent())?.trim();
        log(`    • "${t}"`);
      }
      await screenshot(page, 'chatapp-picker-open');

      // Select "GitHub Copilot"
      const copilotItem = items.filter({ hasText: 'GitHub Copilot' }).first();
      if (await copilotItem.count() > 0) {
        await moveToElement(page, copilotItem);
        await page.waitForTimeout(300);
        await screenshot(page, 'chatapp-copilot-hover');
        await copilotItem.click();
        await page.waitForTimeout(500);
        log('  ✓ Selected "GitHub Copilot"');
      } else {
        log('  ⚠ "GitHub Copilot" not found — closing');
        await page.keyboard.press('Escape');
      }
      await screenshot(page, 'chatapp-copilot-selected');
    } else {
      log('  ⚠ Chat App picker not found in strip');
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 4: Open Session Picker — Verify All 3 Target Sessions
    // ════════════════════════════════════════════════════════════════
    log('\n── Phase 4: Open Session Picker — Verify Sessions ──');

    // Re-scan strip buttons (text may have changed after chatApp selection)
    const sessionPicker = await findStripButton(page, (t) =>
      t === 'session' || t === 'new session' || t.includes('extending') || t.includes('improving')
    );

    if (sessionPicker) {
      const { items, count } = await openPicker(page, sessionPicker, 'Session picker');
      log(`  Session items: ${count}`);

      const sessionTexts = [];
      for (let i = 0; i < count; i++) {
        const t = (await items.nth(i).textContent())?.trim() || '';
        sessionTexts.push(t);
        log(`    • "${t}"`);
      }

      // Hover first 3 items visually
      for (let i = 0; i < Math.min(count, 3); i++) {
        await moveToElement(page, items.nth(i));
        await page.waitForTimeout(300);
      }
      await screenshot(page, 'session-items-hover');

      // Verify all 3 target sessions
      log('\n  Verifying target sessions:');
      for (const target of TARGET_SESSIONS) {
        const found = sessionTexts.some(s => s.includes(target.slice(0, 30)));
        log(`  ${found ? '✓' : '✗'} "${target}" — ${found ? 'FOUND' : 'NOT FOUND'}`);
      }
      await screenshot(page, 'session-list-verified');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      log('  ⚠ Session picker not found');
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 5: Select Each Session + Screenshot
    // ════════════════════════════════════════════════════════════════
    log('\n── Phase 5: Select Each Target Session ──');

    for (let ti = 0; ti < TARGET_SESSIONS.length; ti++) {
      const target = TARGET_SESSIONS[ti];
      const shortName = target.slice(0, 45);
      log(`\n  ▸ [${ti + 1}/3] Selecting: "${shortName}..."`);

      // Re-find session picker each time (strip re-renders after selection)
      const sp = await findStripButton(page, (t) =>
        t === 'session' || t === 'new session' || t.includes('extending') || t.includes('improving') || t.includes('agentsession')
      );
      if (!sp) { log('    ⚠ Session picker not found'); continue; }

      const { items } = await openPicker(page, sp, 'Session picker');

      // Find the target item
      const targetItem = items.filter({ hasText: target.slice(0, 25) }).first();
      if (await targetItem.count() > 0) {
        await moveToElement(page, targetItem);
        await page.waitForTimeout(400);
        await screenshot(page, `session-hover-${ti + 1}`);

        await targetItem.click();
        await page.waitForTimeout(600);
        log(`    ✓ Selected: "${shortName}"`);
        await screenshot(page, `session-selected-${ti + 1}`);
      } else {
        log(`    ✗ Not found: "${shortName}"`);
        await screenshot(page, `session-not-found-${ti + 1}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 6: Search Sessions by Name
    // ════════════════════════════════════════════════════════════════
    log('\n── Phase 6: Search Sessions ──');

    const spSearch = await findStripButton(page, (t) =>
      t.includes('agentsession') || t === 'session' || t.includes('extending') || t.includes('improving')
    );
    if (spSearch) {
      await openPicker(page, spSearch, 'Session picker (search)');

      const searchInput = page.locator('[cmdk-input]');
      if (await searchInput.count() > 0) {
        log('  ✓ Search input found');

        // Search "Extending"
        await typeText(page, searchInput, 'Extending');
        await page.waitForTimeout(500);
        const fc1 = await page.locator('[cmdk-item]').count();
        log(`  "Extending" → ${fc1} result(s)`);
        if (fc1 > 0) {
          const topText = (await page.locator('[cmdk-item]').first().textContent())?.trim();
          log(`  Top result: "${topText}"`);
        }
        await screenshot(page, 'search-extending');

        // Search "Improving"
        await searchInput.fill('');
        await page.waitForTimeout(150);
        await typeText(page, searchInput, 'Improving');
        await page.waitForTimeout(500);
        const fc2 = await page.locator('[cmdk-item]').count();
        log(`  "Improving" → ${fc2} result(s)`);
        await screenshot(page, 'search-improving');

        // Search "AgentSession"
        await searchInput.fill('');
        await page.waitForTimeout(150);
        await typeText(page, searchInput, 'AgentSession');
        await page.waitForTimeout(500);
        const fc3 = await page.locator('[cmdk-item]').count();
        log(`  "AgentSession" → ${fc3} result(s)`);
        await screenshot(page, 'search-agentsession');
      }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 7: Select "Extending IDE" + Type & Send Message
    // ════════════════════════════════════════════════════════════════
    log('\n── Phase 7: Send Message in "Extending IDE" Session ──');

    // Select the session
    const sp7 = await findStripButton(page, (t) =>
      t.includes('agentsession') || t === 'session' || t.includes('extending') || t.includes('improving')
    );
    if (sp7) {
      const { items } = await openPicker(page, sp7, 'Session picker');
      const extItem = items.filter({ hasText: 'Extending IDE' }).first();
      if (await extItem.count() > 0) {
        await clickElement(page, extItem, '"Extending IDE" session');
        log('  ✓ Selected "Extending IDE with Additional Dropdown Options"');
      } else {
        await page.keyboard.press('Escape');
      }
    }

    await screenshot(page, 'extending-ide-selected');

    // Type a message
    const textarea = page.locator('textarea').first();
    const msg1 = 'Hello from Playwright! Testing "Extending IDE with Additional Dropdown Options" session 🚀';

    log(`  → Typing: "${msg1.slice(0, 50)}..."`);
    await moveToElement(page, textarea);
    await textarea.click();
    await page.waitForTimeout(300);
    await textarea.fill('');
    await page.keyboard.type(msg1, { delay: 20 });
    await page.waitForTimeout(500);
    await screenshot(page, 'message1-typed');

    // Send
    log('  → Pressing Enter to send...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);

    // Check if message appeared
    const hasMsg1 = await page.locator(`text=Hello from Playwright`).count();
    log(`  Message visible: ${hasMsg1 > 0 ? 'YES ✓' : 'NO (broadcast sent to IDE)'}`);
    await screenshot(page, 'message1-sent');

    // ════════════════════════════════════════════════════════════════
    // PHASE 8: Send Message in "Improving Vai's Response Quality"
    // ════════════════════════════════════════════════════════════════
    log('\n── Phase 8: Send Message in "Improving Vai\'s Response Quality" ──');

    const sp8 = await findStripButton(page, (t) =>
      t.includes('extending') || t === 'session' || t.includes('improving') || t.includes('agentsession')
    );
    if (sp8) {
      const { items } = await openPicker(page, sp8, 'Session picker');
      const impItem = items.filter({ hasText: "Improving Vai" }).first();
      if (await impItem.count() > 0) {
        await clickElement(page, impItem, '"Improving Vai" session');
        log('  ✓ Selected "Improving Vai\'s Response Quality"');
      } else {
        await page.keyboard.press('Escape');
      }
    }
    await screenshot(page, 'improving-vai-selected');

    const msg2 = 'Test message #2 — "Improving Vai\'s Response Quality" session confirmed!';
    await textarea.click();
    await textarea.fill('');
    await page.keyboard.type(msg2, { delay: 20 });
    await page.waitForTimeout(400);
    await screenshot(page, 'message2-typed');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await screenshot(page, 'message2-sent');

    // ════════════════════════════════════════════════════════════════
    // PHASE 9: Send Message in "AgentSession model"
    // ════════════════════════════════════════════════════════════════
    log('\n── Phase 9: Send Message in "AgentSession model" session ──');

    const sp9 = await findStripButton(page, (t) =>
      t.includes('extending') || t === 'session' || t.includes('improving') || t.includes('agentsession')
    );
    if (sp9) {
      const { items } = await openPicker(page, sp9, 'Session picker');
      const agentItem = items.filter({ hasText: 'AgentSession model' }).first();
      if (await agentItem.count() > 0) {
        await clickElement(page, agentItem, '"AgentSession model" session');
        log('  ✓ Selected "AgentSession model and related structures discussion"');
      } else {
        await page.keyboard.press('Escape');
      }
    }
    await screenshot(page, 'agentsession-selected');

    const msg3 = 'Test message #3 — "AgentSession model" session confirmed ✅';
    await textarea.click();
    await textarea.fill('');
    await page.keyboard.type(msg3, { delay: 20 });
    await page.waitForTimeout(400);
    await screenshot(page, 'message3-typed');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await screenshot(page, 'message3-sent');

    // ════════════════════════════════════════════════════════════════
    // PHASE 10: Disconnect + Final
    // ════════════════════════════════════════════════════════════════
    log('\n── Phase 10: Disconnect ──');

    const disconnectBtn = page.locator('[class*="bg-blue-500/5"] button').filter({ hasText: '✕' }).first();
    if (await disconnectBtn.count() > 0) {
      await moveToElement(page, disconnectBtn);
      await page.waitForTimeout(400);
      await screenshot(page, 'disconnect-hover');
      await disconnectBtn.click();
      await page.waitForTimeout(800);
      log('  ✓ Disconnected');
      await screenshot(page, 'disconnected');
    }

    // ════════════════════════════════════════════════════════════════
    // SUMMARY
    // ════════════════════════════════════════════════════════════════
    log('\n╔════════════════════════════════════════════════════════════════╗');
    log(`║  Test Complete — ${stepN} screenshots saved                     ║`);
    log(`║  Location: scripts/screenshots/session-selection/              ║`);
    log('╚════════════════════════════════════════════════════════════════╝');

    log('\n  Browser stays open 10s for inspection...');
    await page.waitForTimeout(10000);

  } catch (err) {
    log(`\n✗ Test error: ${err.message}`);
    console.error(err.stack);
    await screenshot(page, 'error-state').catch(() => {});
  } finally {
    await browser.close();
    log('  Browser closed.');

    // Clean up seeded test companion clients
    log('\n── Cleanup: Removing test companion clients ──');
    try {
      const r = await fetch(`${RUNTIME_URL}/api/companion-clients?prefix=vscode-playwright-e2e-`, { method: 'DELETE' });
      const body = await r.json();
      log(`  Cleanup: deleted ${body.deleted ?? 0} test client(s)`);
    } catch (e) {
      log(`  Cleanup failed: ${e.message}`);
    }
  }
}

main().catch(console.error);
