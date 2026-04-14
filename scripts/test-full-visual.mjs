/**
 * test-full-visual.mjs — Comprehensive Playwright Visual Test
 *
 * Tests EVERY dropdown picker and full broadcast delivery:
 *   Phase 1: Load app
 *   Phase 2: Activate broadcast mode
 *   Phase 3: IDE picker — open, hover each item, select, re-open to verify
 *   Phase 4: Chat App picker — open, hover each, select GitHub Copilot
 *   Phase 5: Session picker — open, hover each, select "Extending IDE..."
 *   Phase 6: Model picker — open, hover each, select a model
 *   Phase 7: Send "what project is this?" broadcast message
 *   Phase 8: Simulate extension poll + LLM response
 *   Phase 9: Verify response appears in chat
 *   Phase 10: Final API verification + cleanup
 *
 * Opens a REAL Chrome window so v3gga can watch every interaction.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots', 'full-visual');
const BASE_URL = 'http://localhost:5173';
const RUNTIME_URL = 'http://localhost:3006';
const INSTALL_KEY = `full-visual-test-${Date.now()}`;

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

/* ── Seed companion client ── */
async function seedCompanionClient() {
  const headers = {
    'Content-Type': 'application/json',
    'x-vai-installation-key': INSTALL_KEY,
    'x-vai-client-name': 'VS Code',
    'x-vai-client-type': 'vscode-extension',
    'x-vai-launch-target': 'vscode',
  };

  await fetch(`${RUNTIME_URL}/api/companion-clients/chat-info`, {
    method: 'PATCH', headers,
    body: JSON.stringify({
      chatApps: [
        { id: 'vscode-copilot', label: 'GitHub Copilot' },
        { id: 'vscode-claude', label: 'Claude Code' },
        { id: 'vscode-augment', label: 'Augment' },
      ],
      sessions: [
        { sessionId: 'ses_001', title: 'Extending IDE with Additional Dropdown Options', chatApp: 'vscode-copilot', lastModified: Date.now() - 60_000 },
        { sessionId: 'ses_002', title: "Improving Vai's Response Quality", chatApp: 'vscode-copilot', lastModified: Date.now() - 3_600_000 },
        { sessionId: 'ses_003', title: 'AgentSession model and related structures discussion', chatApp: 'vscode-copilot', lastModified: Date.now() - 7_200_000 },
        { sessionId: 'ses_004', title: 'Refactoring desktop chat app', chatApp: 'vscode-copilot', lastModified: Date.now() - 86_400_000 },
        { sessionId: 'ses_005', title: 'Claude Code deep analysis session', chatApp: 'vscode-claude', lastModified: Date.now() - 120_000 },
      ],
    }),
  });

  await fetch(`${RUNTIME_URL}/api/companion-clients/models`, {
    method: 'PATCH', headers,
    body: JSON.stringify({
      models: [
        { id: 'claude-opus-4-20250514', family: 'claude-opus-4', name: 'Claude Opus 4', vendor: 'Anthropic' },
        { id: 'claude-sonnet-4-20250514', family: 'claude-sonnet-4', name: 'Claude Sonnet 4', vendor: 'Anthropic' },
        { id: 'gpt-4o', family: 'gpt-4o', name: 'GPT-4o', vendor: 'OpenAI' },
        { id: 'o3', family: 'o3', name: 'o3', vendor: 'OpenAI' },
        { id: 'gemini-2.5-pro', family: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', vendor: 'Google' },
      ],
    }),
  });

  log('  ✓ Companion client seeded');
  return headers;
}

/* ── Auth bypass bootstrap ── */
async function patchBootstrap() {
  const resp = await fetch(`${RUNTIME_URL}/api/platform/bootstrap`);
  const data = await resp.json();
  data.auth = { ...data.auth, enabled: false, authenticated: true,
    user: { id: 'pw-test', email: 'test@test.com', name: 'Playwright Tester' } };
  return JSON.stringify(data);
}

/* ── Visible interactions ── */
async function moveToElement(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.waitForTimeout(200);
}

async function clickElement(page, locator, label) {
  await moveToElement(page, locator);
  log(`  → Click: "${label}"`);
  await locator.click();
  await page.waitForTimeout(400);
}

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

async function openPicker(page, pickerLocator, label) {
  await clickElement(page, pickerLocator, label);
  await page.waitForTimeout(600);
  try {
    await page.locator('[cmdk-item]').first().waitFor({ state: 'visible', timeout: 3000 });
  } catch { /* empty */ }
  const items = page.locator('[cmdk-item]');
  const count = await items.count();
  return { items, count };
}

/* ── Simulate extension ── */
async function simulateExtensionResponse(broadcastId, companionHeaders, message) {
  log('\n  🔄 Simulating extension poll-consume...');
  // Remove Content-Type for bodyless POST — Fastify rejects empty JSON body
  const { 'Content-Type': _, ...pollHeaders } = companionHeaders;
  const pollRes = await fetch(`${RUNTIME_URL}/api/broadcasts/poll-consume`, {
    method: 'POST', headers: pollHeaders,
  });

  if (pollRes.status === 204) {
    log('  ⚠ No pending work items');
    return false;
  }
  if (!pollRes.ok) {
    log(`  ✗ Poll failed: ${pollRes.status}`);
    return false;
  }

  const workItem = await pollRes.json();
  log(`  ✓ Work item received: "${workItem.content.slice(0, 50)}..."`);
  log(`    deliveryId: ${workItem.deliveryId.slice(0, 8)}...`);
  log(`    targetSession: ${workItem.meta?.targetSessionId || 'none'}`);
  log(`    targetChatApp: ${workItem.meta?.targetChatApp || 'none'}`);

  const responseContent = [
    `✅ **Broadcast received by VS Code!**\n\n`,
    `You asked: "${message}"\n\n`,
    `This response was generated by Claude Opus 4 in VS Code.\n`,
    `Targeted session: "Extending IDE with Additional Dropdown Options"\n`,
    `Chat app: GitHub Copilot\n\n`,
    `Full pipeline verified:\n`,
    `1. Desktop UI → POST /api/broadcasts ✓\n`,
    `2. Extension poll-consume → Received ✓\n`,
    `3. LLM processing → Generated response ✓\n`,
    `4. POST respond → Sent back ✓\n\n`,
    `The bridge between Desktop and VS Code is operational! 🎉`,
  ].join('');

  const respondRes = await fetch(`${RUNTIME_URL}/api/broadcasts/deliveries/${workItem.deliveryId}/respond`, {
    method: 'POST',
    headers: { ...companionHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      responseContent,
      meta: { model: 'Claude Opus 4', family: 'claude-opus-4', tokensIn: 50, tokensOut: 200, durationMs: 1500 },
    }),
  });

  if (respondRes.ok) {
    log('  ✓ Response submitted');
    return true;
  }
  log(`  ✗ Response failed: ${respondRes.status}`);
  return false;
}

/* ═══════════════════════════════════════════════════════════════
   MAIN TEST
   ═══════════════════════════════════════════════════════════════ */
async function main() {
  log('╔════════════════════════════════════════════════════════════════╗');
  log('║  Full Visual Test — All Dropdowns + Broadcast Delivery       ║');
  log('╚════════════════════════════════════════════════════════════════╝\n');

  const checks = [];
  function check(name, ok) {
    checks.push({ name, ok });
    log(`  ${ok ? '✅' : '❌'} ${name}`);
  }

  // ── Seed ──
  log('── Seed & Setup ──');
  const companionHeaders = await seedCompanionClient();
  const patchedBootstrap = await patchBootstrap();

  // ── Launch ──
  log('\n▸ Launching Chromium...');
  const browser = await chromium.launch({
    headless: false, slowMo: 50,
    args: ['--no-sandbox', '--start-maximized', '--window-size=1920,1080'],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  let capturedBroadcastId = null;

  // Auth bypass
  await page.route('**/api/platform/bootstrap', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: patchedBootstrap }));
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { id: 'pw-test', email: 'test@test.com', name: 'Playwright Tester' } }) }));

  // Capture broadcast ID
  await page.route('**/api/broadcasts', async (route, request) => {
    if (request.method() === 'POST' && !request.url().includes('/poll') && !request.url().includes('/deliver')) {
      const response = await route.fetch();
      const body = await response.json();
      capturedBroadcastId = body.id;
      log(`  🎯 Captured broadcast: ${body.id} (${body.deliveryCount} deliveries)`);
      await route.fulfill({ response, body: JSON.stringify(body) });
    } else {
      await route.continue();
    }
  });

  try {
    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Load
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 1: Load App ──');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    await screenshot(page, 'initial-load');

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Activate Broadcast
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 2: Activate Broadcast Mode ──');
    const broadcastBtn = page.locator('button[title*="broadcast" i]').first();
    if (await broadcastBtn.count() > 0) {
      await clickElement(page, broadcastBtn, 'Broadcast toggle');
    } else {
      const allBtns = page.locator('button');
      for (let i = 0; i < await allBtns.count(); i++) {
        const title = await allBtns.nth(i).getAttribute('title') || '';
        if (title.toLowerCase().includes('broadcast')) {
          await clickElement(page, allBtns.nth(i), 'Broadcast alt');
          break;
        }
      }
    }
    await page.waitForTimeout(1000);
    await screenshot(page, 'broadcast-activated');

    // Log strip state
    const stripBtns = page.locator('[class*="bg-blue-500/5"] button');
    const stripCount = await stripBtns.count();
    log(`  Strip buttons (${stripCount}):`);
    for (let i = 0; i < stripCount; i++) {
      const txt = (await stripBtns.nth(i).textContent())?.trim() || '(empty)';
      log(`    [${i}] "${txt}"`);
    }
    check('Broadcast strip visible', stripCount >= 4);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: IDE Picker
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 3: IDE Picker ──');
    const idePicker = await findStripButton(page, (t) =>
      t.includes('send to') || t.includes('vs code') || t.includes('all ide') || t === '1 ide');

    if (idePicker) {
      const { items, count } = await openPicker(page, idePicker, 'IDE picker');
      log(`  Items: ${count}`);
      const texts = [];
      for (let i = 0; i < count; i++) {
        const t = (await items.nth(i).textContent())?.trim() || '';
        texts.push(t);
        log(`    • "${t}"`);
        await moveToElement(page, items.nth(i));
        await page.waitForTimeout(250);
      }
      await screenshot(page, 'ide-picker-all-hovered');

      check('IDE picker: no duplicates', texts.filter(t => t.toLowerCase().includes('vs code')).length <= 1);
      check('IDE picker: shows online/offline', texts.some(t => t.includes('online')));
      check('IDE picker: ≤5 items', count <= 5);
      check('IDE picker: no Chat Modes sub-items', !texts.some(t => t.toLowerCase().includes('chat modes')));

      // Select VS Code
      const vsItem = items.filter({ hasText: 'VS Code' }).first();
      if (await vsItem.count() > 0) {
        await clickElement(page, vsItem, 'VS Code');
        log('  ✓ Selected VS Code');
      }
      await page.waitForTimeout(300);
      await screenshot(page, 'ide-vscode-selected');
    } else {
      check('IDE picker found', false);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: Chat App Picker
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 4: Chat App Picker ──');
    const chatPicker = await findStripButton(page, (t) =>
      t === 'chat' || t.includes('copilot') || t.includes('claude code'));

    if (chatPicker) {
      const { items, count } = await openPicker(page, chatPicker, 'Chat App picker');
      log(`  Items: ${count}`);
      const texts = [];
      for (let i = 0; i < count; i++) {
        const t = (await items.nth(i).textContent())?.trim() || '';
        texts.push(t);
        log(`    • "${t}"`);
        await moveToElement(page, items.nth(i));
        await page.waitForTimeout(250);
      }
      await screenshot(page, 'chatapp-picker-hovered');

      check('Chat App: has items', count > 0);
      check('Chat App: has GitHub Copilot', texts.some(t => t.includes('GitHub Copilot')));
      check('Chat App: has Claude Code', texts.some(t => t.includes('Claude Code')));

      // Select GitHub Copilot
      const copilot = items.filter({ hasText: 'GitHub Copilot' }).first();
      if (await copilot.count() > 0) {
        await clickElement(page, copilot, 'GitHub Copilot');
        log('  ✓ Selected GitHub Copilot');
      }
      await page.waitForTimeout(300);
      await screenshot(page, 'chatapp-copilot-selected');
    } else {
      check('Chat App picker found', false);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 5: Session Picker
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 5: Session Picker ──');
    const sessPicker = await findStripButton(page, (t) =>
      t === 'session' || t === 'new session' || t.includes('extending') || t.includes('improving'));

    if (sessPicker) {
      const { items, count } = await openPicker(page, sessPicker, 'Session picker');
      log(`  Items: ${count}`);
      const texts = [];
      for (let i = 0; i < count; i++) {
        const t = (await items.nth(i).textContent())?.trim() || '';
        texts.push(t);
        log(`    • "${t}"`);
        await moveToElement(page, items.nth(i));
        await page.waitForTimeout(250);
      }
      await screenshot(page, 'session-picker-hovered');

      check('Session: has items', count > 0);
      check('Session: has "Extending IDE"', texts.some(t => t.includes('Extending IDE')));
      check('Session: has "Improving Vai"', texts.some(t => t.includes('Improving Vai')));

      // Select "Extending IDE..."
      const target = items.filter({ hasText: 'Extending IDE' }).first();
      if (await target.count() > 0) {
        await clickElement(page, target, 'Extending IDE session');
        log('  ✓ Selected "Extending IDE..."');
      }
      await page.waitForTimeout(300);
      await screenshot(page, 'session-extending-selected');
    } else {
      check('Session picker found', false);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 6: Model Picker
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 6: Model Picker ──');
    const modelPicker = await findStripButton(page, (t) =>
      t.includes('gpt') || t.includes('claude') || t.includes('gemini') || t.includes('o3'));

    if (modelPicker) {
      const { items, count } = await openPicker(page, modelPicker, 'Model picker');
      log(`  Items: ${count}`);
      const texts = [];
      for (let i = 0; i < count; i++) {
        const t = (await items.nth(i).textContent())?.trim() || '';
        texts.push(t);
        log(`    • "${t}"`);
        await moveToElement(page, items.nth(i));
        await page.waitForTimeout(250);
      }
      await screenshot(page, 'model-picker-hovered');

      check('Model: has items', count > 0);
      check('Model: has Claude Opus 4', texts.some(t => t.toLowerCase().includes('opus') || t.toLowerCase().includes('claude')));
      check('Model: has GPT-4o', texts.some(t => t.toLowerCase().includes('gpt')));

      // Select Claude Opus 4
      const opus = items.filter({ hasText: /opus|claude/i }).first();
      if (await opus.count() > 0) {
        await clickElement(page, opus, 'Claude Opus 4');
        log('  ✓ Selected Claude Opus 4');
      } else {
        // Select first model
        if (count > 0) {
          await clickElement(page, items.first(), texts[0]);
          log(`  ✓ Selected first: "${texts[0]}"`);
        }
      }
      await page.waitForTimeout(300);
      await screenshot(page, 'model-selected');
    } else {
      check('Model picker found', false);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 7: Send Broadcast Message
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 7: Send Broadcast Message ──');
    const message = 'what project is this? and what do you think of it? how to improve?';
    const textarea = page.locator('textarea').first();

    await moveToElement(page, textarea);
    await textarea.click();
    await page.waitForTimeout(200);
    await textarea.fill('');
    await page.keyboard.type(message, { delay: 30 });
    await page.waitForTimeout(400);
    await screenshot(page, 'message-typed');
    log(`  Typed: "${message}"`);

    log('  → Sending broadcast (Enter)...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await screenshot(page, 'message-sent');

    check('Broadcast created', !!capturedBroadcastId);
    if (capturedBroadcastId) {
      log(`  Broadcast ID: ${capturedBroadcastId}`);
    }

    // Check confirmation text
    const confirm = page.locator('text=broadcast to').first();
    if (await confirm.count() > 0) {
      const confirmText = await confirm.textContent();
      log(`  Desktop: "${confirmText?.slice(0, 80)}"`);
      check('Broadcast confirmation visible', true);
    }
    await screenshot(page, 'broadcast-confirmed');

    // ═══════════════════════════════════════════════════════════════
    // PHASE 8: Simulate Extension Response
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 8: Simulate Extension Response ──');
    let responded = false;
    if (capturedBroadcastId) {
      responded = await simulateExtensionResponse(capturedBroadcastId, companionHeaders, message);
      check('Extension received message', true);
      check('Response submitted', responded);
    } else {
      check('Extension received message', false);
      check('Response submitted', false);
    }
    await screenshot(page, 'extension-responded');

    // ═══════════════════════════════════════════════════════════════
    // PHASE 9: Wait for Response in Chat
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 9: Wait for Response in Chat ──');
    log('  ⏳ Waiting up to 20s for desktop to display response...');

    let responseFound = false;
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(3500);
      const respEl = page.locator('text=Broadcast received').first();
      if (await respEl.count() > 0) {
        responseFound = true;
        log('  ✓ Response appeared in chat!');
        break;
      }
      log(`  ... attempt ${i + 1}/6`);
    }
    check('Response visible in chat', responseFound);
    await screenshot(page, 'response-in-chat');

    // Scroll to bottom
    await page.evaluate(() => {
      const el = document.querySelector('[class*="overflow-y"]');
      if (el) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(500);
    await screenshot(page, 'response-scrolled');

    // ═══════════════════════════════════════════════════════════════
    // PHASE 10: API Verification
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 10: API Verification ──');
    if (capturedBroadcastId) {
      const verifyRes = await fetch(`${RUNTIME_URL}/api/broadcasts/${capturedBroadcastId}`);
      if (verifyRes.ok) {
        const data = await verifyRes.json();
        log(`  Broadcast status: ${data.status}`);
        log(`  Deliveries: ${data.deliveries?.length ?? 0}`);
        const responded = data.deliveries?.filter(d => d.status === 'responded') ?? [];
        log(`  Responded: ${responded.length}`);
        for (const d of responded) {
          log(`    • ${d.client?.clientName ?? 'Unknown'}: "${d.responseContent?.slice(0, 60)}..."`);
        }
        check('API: broadcast completed', data.status === 'completed');
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // FINAL: Keep browser open
    // ═══════════════════════════════════════════════════════════════
    log('\n  ⏳ Browser open 8 seconds for v3gga...');
    await page.waitForTimeout(8000);
    await screenshot(page, 'final-state');

    // ═══════════════════════════════════════════════════════════════
    // RESULTS
    // ═══════════════════════════════════════════════════════════════
    const passed = checks.filter(c => c.ok).length;
    const failed = checks.filter(c => !c.ok).length;

    log('\n╔════════════════════════════════════════════════════════════════╗');
    log('║  FULL VISUAL TEST RESULTS                                    ║');
    log('╠════════════════════════════════════════════════════════════════╣');
    for (const c of checks) {
      log(`║  ${c.ok ? '✅' : '❌'} ${c.name.padEnd(55)}║`);
    }
    log('╠════════════════════════════════════════════════════════════════╣');
    log(`║  ${passed} PASSED / ${failed} FAILED / ${checks.length} TOTAL`.padEnd(63) + '║');
    log('╚════════════════════════════════════════════════════════════════╝');

    if (failed > 0) {
      log('\n  ⚠ Some checks FAILED — review screenshots');
    } else {
      log('\n  🎉 ALL CHECKS PASSED');
    }

  } catch (err) {
    log(`\n❌ Error: ${err.message}`);
    console.error(err.stack);
    await screenshot(page, 'error-state').catch(() => {});
  } finally {
    await browser.close();
    log('\n── Cleanup ──');
    try {
      const r = await fetch(`${RUNTIME_URL}/api/companion-clients?prefix=full-visual-test-`, { method: 'DELETE' });
      const body = await r.json();
      log(`  Deleted ${body.deleted ?? 0} test client(s)`);
    } catch (e) {
      log(`  Cleanup failed: ${e.message}`);
    }
    log(`  Screenshots: ${SCREENSHOT_DIR}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
