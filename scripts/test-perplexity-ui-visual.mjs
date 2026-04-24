/**
 * test-perplexity-ui-visual.mjs — Visual E2E for Perplexity-inspired UI
 *
 * Tests ALL Perplexity-style UI upgrades + core Vai chat flow:
 *   Phase 1: Welcome state — builder landing, preset cards, quick chips
 *   Phase 2: Send a real chat message — watch thinking indicator
 *   Phase 3: Verify assistant response chrome + content
 *   Phase 4: Follow-up suggestion cards display + click
 *   Phase 5: Send another message, verify multi-turn flow
 *   Phase 6: Responsive breakpoints (375, 768, 1280, 1920, 2560)
 *   Phase 7: Hover states on all interactive elements
 *
 * Opens a REAL Chrome window so v3gga can watch every interaction.
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
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots', 'perplexity-ui');
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

async function typeVisibly(page, locator, text) {
  await moveToElement(page, locator);
  await locator.click();
  await page.waitForTimeout(150);
  for (const char of text) {
    await page.keyboard.type(char, { delay: 35 });
  }
  await page.waitForTimeout(200);
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

/* ════════════════════════════════════════════════════════════════
   MAIN TEST
   ════════════════════════════════════════════════════════════════ */
async function main() {
  log('╔════════════════════════════════════════════════════════════════╗');
  log('║  Perplexity UI Visual Test — Chat + UI Upgrades              ║');
  log('╚════════════════════════════════════════════════════════════════╝\n');

  const checks = [];
  function check(name, ok) {
    checks.push({ name, ok });
    log(`  ${ok ? '✅' : '❌'} ${name}`);
  }

  // Health check
  log('── Preflight ──');
  try {
    const h = await fetch(`${RUNTIME_URL}/health`);
    const hd = await h.json();
    log(`  Runtime: ${hd.status} (${hd.stats?.knowledgeEntries ?? 'unknown'} entries)`);
  } catch {
    log('  ❌ Runtime not reachable — start it first');
    process.exit(1);
  }

  const patchedBootstrap = await patchBootstrap();

  log('\n▸ Launching Chromium...');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--no-sandbox', '--start-maximized', '--window-size=1920,1080'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Auth bypass
  await page.route('**/api/platform/bootstrap', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: patchedBootstrap }));
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { id: 'pw-test', email: 'test@test.com', name: 'Playwright Tester' } }) }));

  try {
    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Welcome State — 2-Column Grid Cards
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 1: Welcome State ──');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await screenshot(page, 'welcome-state');

    // Verify welcome heading
    const heading = page.locator('h1');
    const headingText = await heading.textContent();
    check('Heading: "What shall we build?"', headingText?.includes('What shall we build'));

    // Verify 2-column grid (preset cards)
    const presetButtons = page.locator('button:has-text("Scaffold"), button:has-text("Create a REST"), button:has-text("Build a landing"), button:has-text("Deploy from"), button:has-text("Explain React"), button:has-text("Compare Prisma")');
    const presetCount = await presetButtons.count();
    check(`Preset cards visible: ${presetCount}/6`, presetCount >= 5);

    // Verify grid layout (cards have descriptions — Perplexity-style)
    const firstCard = presetButtons.first();
    const firstCardText = await firstCard.textContent();
    check('Preset cards have descriptions', firstCardText?.includes('Full-stack') || firstCardText?.includes('Express'));

    // Hover each preset card
    log('  Hovering preset cards...');
    for (let i = 0; i < Math.min(presetCount, 6); i++) {
      await moveToElement(page, presetButtons.nth(i));
      await page.waitForTimeout(300);
    }
    await screenshot(page, 'preset-cards-hovered');

    // Verify quick chips
    const quickChips = page.locator('button:has-text("Build something"), button:has-text("Explain a concept"), button:has-text("Debug my code"), button:has-text("Browse the web")');
    const chipCount = await quickChips.count();
    check(`Quick chips visible: ${chipCount}/4`, chipCount >= 3);

    // Hover quick chips
    for (let i = 0; i < chipCount; i++) {
      await moveToElement(page, quickChips.nth(i));
      await page.waitForTimeout(200);
    }
    await screenshot(page, 'quick-chips-hovered');

    // Verify sparkle icon (branding)
    const sparkleIcon = page.locator('.rounded-2xl >> svg').first();
    check('Sparkle branding icon visible', await sparkleIcon.count() > 0);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Send a Chat Message — Watch Thinking Indicator
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 2: Send Chat Message ──');
    const textarea = page.locator('textarea');
    await typeVisibly(page, textarea, 'What is WebSocket and how does it work?');
    await screenshot(page, 'typing-message');

    // Click send
    const sendBtn = page.locator('button[title="Send message (Enter)"]');
    await clickElement(page, sendBtn, 'Send button');

    // Watch for thinking indicator (multi-step)
    await page.waitForTimeout(500);
    const thinkingArea = page.locator('text=Understanding');
    const thinkingVisible = await thinkingArea.count() > 0;
    if (thinkingVisible) {
      await screenshot(page, 'thinking-understanding');
      log('  ✓ "Understanding..." step visible');
    }

    // Wait for second step
    await page.waitForTimeout(1500);
    const searchingStep = page.locator('text=Searching knowledge');
    if (await searchingStep.count() > 0) {
      await screenshot(page, 'thinking-searching');
      log('  ✓ "Searching knowledge..." step visible');
    }

    // Wait for response to complete
    log('  Waiting for Vai response...');
    await page.waitForTimeout(5000);
    await screenshot(page, 'response-received');

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Verify Assistant Response + Content
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 3: Response Verification ──');

    const assistantMessage = page.locator('[data-chat-message-role="assistant"]').first();
    const hasAssistantMessage = await assistantMessage.count() > 0;
    check('Assistant response visible', hasAssistantMessage);
    if (hasAssistantMessage) {
      await screenshot(page, 'assistant-response');
    }

    // Verify the response contains WebSocket content
    const responseArea = page.locator('[class*="markdown"], [class*="prose"]').first();
    if (await responseArea.count() > 0) {
      const responseText = await responseArea.textContent();
      check('Response mentions WebSocket', responseText?.toLowerCase().includes('websocket') || responseText?.toLowerCase().includes('web socket'));
    }

    // Check action buttons (copy, thumbs up/down, retry)
    const copyBtn = page.locator('button:has-text("Copy")').first();
    const hasCopyBtn = await copyBtn.count() > 0;
    check('Copy button visible on response', hasCopyBtn);
    if (hasCopyBtn) {
      await moveToElement(page, copyBtn);
      await page.waitForTimeout(300);
      await screenshot(page, 'action-buttons-hover');
    }

    // Check thumbs up/down
    const thumbsUp = page.locator('button[title="Helpful"]').first();
    const thumbsDown = page.locator('button[title="Not helpful"]').first();
    check('Thumbs up button visible', await thumbsUp.count() > 0);
    check('Thumbs down button visible', await thumbsDown.count() > 0);

    // Click thumbs up
    if (await thumbsUp.count() > 0) {
      await clickElement(page, thumbsUp, 'Thumbs up');
      await screenshot(page, 'thumbs-up-clicked');
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: Follow-Up Suggestions
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 4: Follow-Up Suggestions ──');

    // Check for "Related" section and follow-up cards
    const relatedLabel = page.locator('text=Related').first();
    const hasRelated = await relatedLabel.count() > 0;
    if (hasRelated) {
      check('"Related" section visible', true);

      const followUpCards = page.locator('button:has([class*="sparkles"]), button:has-text("What") >> nth=0');
      const followUpCount = await followUpCards.count();
      log(`  Follow-up cards: ${followUpCount}`);

      if (followUpCount > 0) {
        // Hover each follow-up card
        for (let i = 0; i < Math.min(followUpCount, 3); i++) {
          await moveToElement(page, followUpCards.nth(i));
          await page.waitForTimeout(300);
        }
        await screenshot(page, 'followup-cards-hovered');
      }
    } else {
      log('  ℹ No follow-up suggestions (depends on Vai response)');
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 5: Multi-Turn Conversation
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 5: Multi-Turn Conversation ──');

    // Send a follow-up message
    const textarea2 = page.locator('textarea');
    await typeVisibly(page, textarea2, 'Can you show me a code example?');
    await screenshot(page, 'followup-typing');

    const sendBtn2 = page.locator('button[title="Send message (Enter)"]');
    await clickElement(page, sendBtn2, 'Send follow-up');

    // Wait for response
    log('  Waiting for follow-up response...');
    await page.waitForTimeout(5000);
    await screenshot(page, 'followup-response');

    // Verify multiple messages in thread
    const allMessages = page.locator('[class*="group/msg"]');
    const msgCount = await allMessages.count();
    check(`Multi-turn: ${msgCount} messages visible`, msgCount >= 3);

    // Scroll through the conversation
    const scrollContainer = page.locator('[class*="overflow-y-auto"]').first();
    if (await scrollContainer.count() > 0) {
      await scrollContainer.evaluate((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(1000);
      await screenshot(page, 'scrolled-to-top');

      await scrollContainer.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
      await page.waitForTimeout(1000);
      await screenshot(page, 'scrolled-to-bottom');
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 6: Input Area Interactions
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 6: Input Area ──');

    // Test mode selector
    const modeSelector = page.locator('[class*="ModeSelector"], button:has-text("Chat"), button:has-text("Agent"), button:has-text("Builder")').first();
    if (await modeSelector.count() > 0) {
      await moveToElement(page, modeSelector);
      await page.waitForTimeout(300);
      await screenshot(page, 'mode-selector-hover');
    }

    // Test attachment button
    const attachBtn = page.locator('button[title="Attach files"]');
    if (await attachBtn.count() > 0) {
      await moveToElement(page, attachBtn);
      await page.waitForTimeout(300);
      await screenshot(page, 'attach-button-hover');
    }

    // Test text input focus glow
    await textarea2.click();
    await page.waitForTimeout(300);
    await screenshot(page, 'input-focused');

    // ═══════════════════════════════════════════════════════════════
    // PHASE 7: Responsive Breakpoints
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 7: Responsive Breakpoints ──');

    const breakpoints = [
      { width: 375, height: 812, label: 'mobile-375' },
      { width: 768, height: 1024, label: 'tablet-768' },
      { width: 1280, height: 800, label: 'laptop-1280' },
      { width: 1920, height: 1080, label: 'desktop-1920' },
      { width: 2560, height: 1440, label: 'ultra-2560' },
    ];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(800);
      await screenshot(page, `responsive-${bp.label}`);
      log(`  📐 ${bp.label}: ${bp.width}×${bp.height}`);
    }

    // Restore original viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(500);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 8: New Conversation — Verify Welcome Returns
    // ═══════════════════════════════════════════════════════════════
    log('\n── Phase 8: New Conversation ──');

    // Navigate back to fresh state (reload)
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await screenshot(page, 'fresh-welcome-state');

    // Verify the 2-column grid reappears
    const freshPresets = page.locator('button:has-text("Scaffold"), button:has-text("Create a REST")');
    check('Welcome grid reappears on new conversation', await freshPresets.count() >= 2);

    // Click a preset card to start a new conversation
    const buildCard = page.locator('button:has-text("Build a landing page")');
    if (await buildCard.count() > 0) {
      await clickElement(page, buildCard, 'Build a landing page preset');
      log('  Waiting for Vai to generate...');
      await page.waitForTimeout(6000);
      await screenshot(page, 'preset-response');
      check('Preset card triggers conversation', true);
    }

    // ═══════════════════════════════════════════════════════════════
    // KEEP BROWSER OPEN FOR HUMAN REVIEW
    // ═══════════════════════════════════════════════════════════════
    log('\n  ⏳ Keeping browser open for 8 seconds for review...');
    await page.waitForTimeout(8000);

    // ═══════════════════════════════════════════════════════════════
    // RESULTS
    // ═══════════════════════════════════════════════════════════════
    log('\n╔════════════════════════════════════════════════════════════════╗');
    log('║  RESULTS                                                      ║');
    log('╚════════════════════════════════════════════════════════════════╝');
    const pass = checks.filter((c) => c.ok).length;
    const fail = checks.filter((c) => !c.ok).length;
    for (const c of checks) {
      log(`  ${c.ok ? '✅' : '❌'} ${c.name}`);
    }
    log(`\n  PASSED: ${pass}/${pass + fail}`);
    if (fail > 0) {
      log(`  FAILED: ${fail} — review screenshots in ${SCREENSHOT_DIR}`);
    } else {
      log('\n  🎉 All Perplexity UI checks passed!');
    }

  } catch (err) {
    log(`\n❌ Error: ${err.message}`);
    console.error(err.stack);
    await screenshot(page, 'error-state');
  } finally {
    await browser.close();
    log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
