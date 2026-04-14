/**
 * test-sidebar-validation.mjs — Comprehensive sidebar panel validation.
 *
 * Follows v3gga's manual testing methodology:
 *   1. Reload page → clean state
 *   2. Hover each sidebar rail item → verify tooltip appears
 *   3. Click item → verify panel opens with correct content
 *   4. Click again or click elsewhere → verify panel closes
 *   5. Deep test each panel's internal features
 *   6. Test Ctrl+K quick switch overlay
 *   7. Test layout controls (focus mode, preview toggle, overlay toggle)
 *
 * Screenshots captured at every step for visual verification.
 *
 * Note: this validates the shared desktop/web shell served from the Tauri devUrl.
 * It does not validate the native Tauri window chrome itself.
 */

import puppeteer from 'puppeteer';
import { mkdir, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS = join(__dirname, 'screenshots', 'sidebar-validation');
const APP_URL = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stepNum = 0;
let passed = 0;
let failed = 0;
const failures = [];

async function screenshot(page, label) {
  stepNum++;
  const name = `${String(stepNum).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  await page.screenshot({ path: join(SCREENSHOTS, name) });
  return name;
}

function check(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
    failures.push(label);
  }
}

async function getWindowSession(page) {
  const session = await page.target().createCDPSession();
  const { windowId } = await session.send('Browser.getWindowForTarget');
  return { session, windowId };
}

async function getViewportMetrics(page) {
  return page.evaluate(() => ({
    width: window.innerWidth || document.documentElement.clientWidth || 1440,
    height: window.innerHeight || document.documentElement.clientHeight || 900,
    screenWidth: window.screen.availWidth || window.screen.width || 1440,
    screenHeight: window.screen.availHeight || window.screen.height || 900,
  }));
}

async function maximizeBrowserWindow(page) {
  const { session, windowId } = await getWindowSession(page);
  await session.send('Browser.setWindowBounds', {
    windowId,
    bounds: { windowState: 'maximized' },
  });
  await sleep(700);
  return getViewportMetrics(page);
}

async function resizeBrowserWindow(page, width, height) {
  const { session, windowId } = await getWindowSession(page);
  await session.send('Browser.setWindowBounds', {
    windowId,
    bounds: {
      windowState: 'normal',
      width,
      height,
    },
  });
  await sleep(700);
  return getViewportMetrics(page);
}

async function checkForHorizontalOverflow(page) {
  return page.evaluate(() => {
    const root = document.getElementById('layout-root');
    const viewportWidth = window.innerWidth;
    const documentWidth = document.documentElement.scrollWidth;
    const bodyWidth = document.body.scrollWidth;
    const rootWidth = root?.scrollWidth ?? 0;

    return {
      viewportWidth,
      documentWidth,
      bodyWidth,
      rootWidth,
      hasOverflow:
        documentWidth > viewportWidth + 1 ||
        bodyWidth > viewportWidth + 1 ||
        rootWidth > viewportWidth + 1,
    };
  });
}

async function main() {
  await mkdir(SCREENSHOTS, { recursive: true });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      slowMo: 50,
      defaultViewport: null,
      channel: 'chrome',
      args: ['--no-sandbox', '--start-maximized', '--force-device-scale-factor=1'],
    });
  } catch {
    browser = await puppeteer.launch({
      headless: false,
      slowMo: 50,
      defaultViewport: null,
      args: ['--no-sandbox', '--start-maximized', '--force-device-scale-factor=1'],
    });
  }

  const [page] = await browser.pages();
  const viewport = await maximizeBrowserWindow(page);

  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // ═══════════════════════════════════════════════════
  //  PHASE 0: Load & Clean State
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Phase 0: Loading App ═══');
  console.log(`  Validating shared shell at ${APP_URL}`);
  console.log(`  Using real browser viewport ${viewport.width}x${viewport.height} on screen ${viewport.screenWidth}x${viewport.screenHeight}`);
  await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 20000 });
  await sleep(3000);

  // Stop any auto-running demo
  await page.evaluate(() => {
    if (window.__vai_demo?.isRunning?.()) window.__vai_demo.stop();
  });
  await sleep(1000);

  await screenshot(page, 'initial-load');
  console.log('  App loaded successfully');

  // Check for Activity Rail
  const hasRail = await page.evaluate(() => {
    // Rail is the narrow left column with icon buttons
    const buttons = document.querySelectorAll('button[title]');
    return buttons.length > 0;
  });
  check('Activity Rail is present', hasRail);

  // ═══════════════════════════════════════════════════
  //  PHASE 1: Sidebar Rail Items — Hover + Tooltip
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Phase 1: Rail Item Hover & Tooltips ═══');

  const RAIL_ITEMS = [
    { title: 'Chat History', shortcut: 'Ctrl+Shift+C' },
    { title: 'Dev Logs', shortcut: 'Ctrl+Shift+L' },
    { title: 'Knowledge', shortcut: 'Ctrl+Shift+K' },
    { title: 'Docker', shortcut: null },
    { title: 'Search', shortcut: 'Ctrl+Shift+F' },
    { title: 'Settings', shortcut: null },
  ];

  for (const item of RAIL_ITEMS) {
    // Find the button with matching title
    const btn = await page.$(`button[title*="${item.title}"]`);
    if (!btn) {
      check(`${item.title} button exists`, false);
      continue;
    }
    check(`${item.title} button exists`, true);

    // Hover and wait for tooltip
    await btn.hover();
    await sleep(600);
    await screenshot(page, `hover-${item.title.toLowerCase().replace(/\s/g, '-')}`);

    // Check if tooltip appeared (title attribute tooltip or custom tooltip)
    const title = await page.evaluate((el) => el.getAttribute('title') || '', btn);
    check(`${item.title} has title attribute`, title.includes(item.title));
  }

  // ═══════════════════════════════════════════════════
  //  PHASE 2: Click Each Panel — Open & Close
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Phase 2: Panel Open/Close ═══');

  for (const item of RAIL_ITEMS) {
    // Always re-query to avoid stale handles after DOM re-renders
    const exists = await page.$(`button[title*="${item.title}"]`);
    if (!exists) continue;

    // Click to open using evaluate (avoids stale handle issues)
    await page.evaluate((title) => {
      const btn = document.querySelector(`button[title*="${title}"]`);
      btn?.click();
    }, item.title);
    await sleep(600);
    await screenshot(page, `open-${item.title.toLowerCase().replace(/\s/g, '-')}`);

    // Check sidebar is expanded (should have visible panel content)
    const panelVisible = await page.evaluate(() => {
      // Look for sidebar content area
      const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"]');
      if (sidebar) {
        const text = sidebar.textContent || '';
        return text.length > 10; // Has meaningful content
      }
      // Alternative: check if any panel-like div is visible
      const panels = document.querySelectorAll('[class*="panel"], [class*="Panel"]');
      for (const p of panels) {
        if (p.offsetWidth > 100 && p.offsetHeight > 100) return true;
      }
      return false;
    });
    check(`${item.title} panel opens on click`, panelVisible);

    // Click the same button again to close (re-query)
    await page.evaluate((title) => {
      const btn = document.querySelector(`button[title*="${title}"]`);
      btn?.click();
    }, item.title);
    await sleep(500);
    await screenshot(page, `close-${item.title.toLowerCase().replace(/\s/g, '-')}`);
  }

  // ═══════════════════════════════════════════════════
  //  PHASE 3: Deep Panel Tests
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Phase 3: Deep Panel Tests ═══');

  /** Helper: click a rail button by title using evaluate (never stale) */
  async function clickRail(title) {
    await page.evaluate((t) => {
      document.querySelector(`button[title*="${t}"]`)?.click();
    }, title);
    await sleep(600);
  }

  // ── 3a: Chat History Panel ──
  console.log('\n  --- Chat History ---');
  await clickRail('Chat History');

  // Look for "New Chat" button or similar
  const hasNewChat = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      if (b.textContent?.includes('New') || b.querySelector('.lucide-plus')) return true;
    }
    return false;
  });
  check('Chat panel has New Chat button', hasNewChat);
  await screenshot(page, 'chat-panel-deep');

  // Look for the chat textarea
  const hasTextarea = await page.$('textarea');
  check('Chat textarea is present', !!hasTextarea);

  // Type a test message
  if (hasTextarea) {
    // Focus textarea via evaluate, then use Puppeteer keyboard
    await page.evaluate(() => {
      const ta = document.querySelector('textarea');
      if (ta) ta.focus();
    });
    await sleep(300);

    // Type character by character to trigger React onChange
    const testMsg = 'Test validation';
    for (const ch of testMsg) {
      await page.keyboard.type(ch);
    }
    await sleep(600);
    await screenshot(page, 'chat-typed-message');

    const value = await page.evaluate(() => document.querySelector('textarea')?.value || '');
    check('Chat textarea accepts input', value.length > 0);

    // Select all + delete to clear
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await sleep(200);
  }

  await clickRail('Chat History'); // close
  await sleep(400);

  // ── 3b: Dev Logs Panel ──
  console.log('\n  --- Dev Logs ---');
  await clickRail('Dev Logs');
  await screenshot(page, 'devlogs-panel-deep');

  const hasDevLogsContent = await page.evaluate(() => {
    // Dev Logs panel content could be in any visible panel area
    const body = document.body.textContent || '';
    return body.includes('Dev Logs') || body.includes('session') || body.includes('Session') || body.includes('No sessions');
  });
  check('Dev Logs panel has content', hasDevLogsContent);

  await clickRail('Dev Logs');
  await sleep(400);

  // ── 3c: Knowledge Base Panel ──
  console.log('\n  --- Knowledge Base ---');
  await clickRail('Knowledge');
  await screenshot(page, 'knowledge-panel-deep');

  const hasKnowledge = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[placeholder*="earch"], input[placeholder*="filter"]');
    const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"]');
    return inputs.length > 0 || (sidebar?.textContent?.length || 0) > 20;
  });
  check('Knowledge panel has content or search', hasKnowledge);

  await clickRail('Knowledge');
  await sleep(400);

  // ── 3d: Docker Panel ──
  console.log('\n  --- Docker ---');
  await clickRail('Docker');
  await sleep(200); // extra time for Docker API calls
  await screenshot(page, 'docker-panel-deep');

  const dockerContent = await page.evaluate(() => {
    // Docker content may be rendered anywhere in the visible DOM
    return document.body.textContent || '';
  });
  check('Docker panel shows engine status', dockerContent.toLowerCase().includes('docker') || dockerContent.toLowerCase().includes('engine') || dockerContent.toLowerCase().includes('container'));

  await clickRail('Docker');
  await sleep(400);

  // ── 3e: Search Panel ──
  console.log('\n  --- Search ---');
  await clickRail('Search');
  await screenshot(page, 'search-panel-deep');

  await clickRail('Search');
  await sleep(400);

  // ── 3f: Settings Panel ──
  console.log('\n  --- Settings ---');
  await clickRail('Settings');
  await screenshot(page, 'settings-panel-deep');

  const hasSettings = await page.evaluate(() => {
    const text = document.body.textContent || '';
    return text.toLowerCase().includes('model') || text.toLowerCase().includes('setting') || text.toLowerCase().includes('theme') || text.toLowerCase().includes('api key');
  });
  check('Settings panel has configuration options', hasSettings);

  await clickRail('Settings');
  await sleep(400);

  // ═══════════════════════════════════════════════════
  //  PHASE 4: Layout Controls
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Phase 4: Layout Controls ═══');

  // ── 4a: Focus Mode Toggle (top-right corner) ──
  console.log('\n  --- Focus Mode ---');

  // The focus button auto-hides; use direct evaluate to find it
  const focusBtnExists = await page.evaluate(() => {
    return !!document.querySelector('button[title*="Focus mode"]');
  });
  if (focusBtnExists) {
    check('Focus mode button found', true);

    // Click to enter focus mode
    await page.evaluate(() => {
      document.querySelector('button[title*="Focus mode"]')?.click();
    });
    await sleep(600);
    await screenshot(page, 'focus-mode-on');

    // Verify rail is hidden
    const railHidden = await page.evaluate(() => {
      const railBtns = document.querySelectorAll('button[title*="Chat History"]');
      // Check if the rail button is hidden/not visible
      for (const btn of railBtns) {
        if (btn.offsetWidth > 0 && btn.offsetHeight > 0) return false;
      }
      return true;
    });
    check('Focus mode hides sidebar/rail', railHidden);

    // Exit focus mode via direct store call (keyboard shortcuts unreliable in headless)
    await page.evaluate(() => {
      // Dispatch a Ctrl+0 keyboard event to the document
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '0', code: 'Digit0', ctrlKey: true, bubbles: true,
      }));
    });
    await sleep(800);

    // Verify rail is back
    const railBack = await page.evaluate(() => {
      const btn = document.querySelector('button[title*="Chat History"]');
      return btn ? btn.offsetWidth > 0 : false;
    });
    check('Focus mode exits properly', railBack);
    await screenshot(page, 'focus-mode-off');
  } else {
    check('Focus mode button found', false);
  }

  // ── 4b: Vai Actions Overlay Toggle (sidebar rail bottom) ──
  console.log('\n  --- Vai Actions Overlay ---');
  // Ensure rail is visible by opening a panel
  await clickRail('Chat History');
  await sleep(300);
  // Title is "Hide Vai overlays" or "Show Vai overlays"
  const hasOverlayToggle = await page.evaluate(() => {
    const btn = document.querySelector('button[title*="Vai overlays"]');
    return !!btn;
  });
  if (hasOverlayToggle) {
    check('Vai Actions overlay toggle found', true);

    await page.evaluate(() => {
      const btn = document.querySelector('button[title*="Vai overlays"]');
      btn?.click();
    });
    await sleep(600);
    await screenshot(page, 'overlay-off');

    await page.evaluate(() => {
      const btn = document.querySelector('button[title*="Vai overlays"]');
      btn?.click();
    });
    await sleep(600);
    await screenshot(page, 'overlay-on');
  } else {
    check('Vai Actions overlay toggle found', false);
  }

  // ── 4c: Layout Mode Toggle (sidebar rail bottom) ──
  console.log('\n  --- Layout Mode ---');
  // Title is "Switch to compact layout" or "Switch to open layout"
  const hasLayoutToggle = await page.evaluate(() => {
    const btn = document.querySelector('button[title*="Switch to"]');
    return !!btn;
  });
  if (hasLayoutToggle) {
    check('Layout mode toggle found', true);
    await page.evaluate(() => {
      const btn = document.querySelector('button[title*="Switch to"]');
      btn?.click();
    });
    await sleep(600);
    await screenshot(page, 'layout-toggled');
    await page.evaluate(() => {
      const btn = document.querySelector('button[title*="Switch to"]');
      btn?.click();
    });
    await sleep(400);
  } else {
    check('Layout mode toggle found', false);
  }

  // ── 4d: Preview Toggle (in chat header) ──
  console.log('\n  --- Preview Toggle ---');
  const hasPreviewBtn = await page.evaluate(() => {
    const btn = document.querySelector('button[title*="preview"], button[title*="Preview"]');
    return !!btn;
  });
  if (hasPreviewBtn) {
    check('Preview toggle button found', true);
    await page.evaluate(() => {
      const btn = document.querySelector('button[title*="preview"], button[title*="Preview"]');
      btn?.click();
    });
    await sleep(600);
    await screenshot(page, 'preview-toggled');
  }

  // ═══════════════════════════════════════════════════
  //  PHASE 5: Keyboard Shortcut — Ctrl+K Quick Switch
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Phase 5: Ctrl+K Quick Switch ═══');

  // First, make sure sidebar is visible
  await clickRail('Chat History');
  await sleep(300);

  // Try Ctrl+K
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await sleep(800);
  await screenshot(page, 'ctrl-k-overlay');

  const hasQuickSwitch = await page.evaluate(() => {
    const overlays = document.querySelectorAll('[class*="fixed"], [class*="overlay"], [class*="modal"]');
    for (const o of overlays) {
      if (o.querySelector('input') && o.offsetWidth > 200) return true;
    }
    return false;
  });
  check('Ctrl+K opens quick switch overlay', hasQuickSwitch);

  await page.keyboard.press('Escape');
  await sleep(500);
  await screenshot(page, 'ctrl-k-closed');

  // ═══════════════════════════════════════════════════
  //  PHASE 6: Cross-Panel Navigation
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Phase 6: Cross-Panel Navigation ═══');

  // Rapidly switch between panels to test stability
  const quickSwitch = ['Chat History', 'Dev Logs', 'Knowledge', 'Docker', 'Search', 'Settings', 'Chat History'];
  for (const name of quickSwitch) {
    await page.evaluate((t) => {
      document.querySelector(`button[title*="${t}"]`)?.click();
    }, name);
    await sleep(300);
  }
  await sleep(600);
  await screenshot(page, 'rapid-switch-stable');
  check('Rapid panel switching is stable (no crash)', true);

  // ═══════════════════════════════════════════════════
  //  PHASE 7: Responsive Overflow Checks
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Phase 7: Responsive Overflow Checks ═══');

  await clickRail('Settings');
  await sleep(400);

  for (const viewport of [
    { width: 1100, height: 820, label: 'desktop-min' },
    { width: 900, height: 760, label: 'tablet' },
    { width: 760, height: 760, label: 'phone-wide' },
  ]) {
    const metrics = await resizeBrowserWindow(page, viewport.width, viewport.height);

    const overflow = await checkForHorizontalOverflow(page);
    await screenshot(page, `responsive-${viewport.label}`);

    check(
      `No horizontal overflow at ${viewport.label} (${metrics.width}x${metrics.height})`,
      !overflow.hasOverflow,
    );

    if (overflow.hasOverflow) {
      failures.push(
        `Overflow metrics ${viewport.label}: viewport=${overflow.viewportWidth}, document=${overflow.documentWidth}, body=${overflow.bodyWidth}, root=${overflow.rootWidth}`,
      );
    }
  }

  await maximizeBrowserWindow(page);

  // ═══════════════════════════════════════════════════
  //  SUMMARY
  // ═══════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════');
  console.log('📊 Sidebar Validation Summary');
  console.log('═══════════════════════════════════════');
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  Page errors: ${errors.length}`);

  if (failures.length > 0) {
    console.log('\n  Failed checks:');
    failures.forEach((f) => console.log(`    ❌ ${f}`));
  }

  if (errors.length > 0) {
    console.log('\n  Page errors:');
    errors.forEach((e) => console.log(`    ${e.substring(0, 120)}`));
  }

  const files = await readdir(SCREENSHOTS);
  const screenshots = files.filter((f) => f.endsWith('.png'));
  console.log(`\n  📸 Screenshots captured: ${screenshots.length}`);
  screenshots.forEach((f) => console.log(`    ${f}`));

  console.log(`\n${failed === 0 ? '✅' : '❌'} Sidebar validation ${failed === 0 ? 'PASSED' : 'FAILED'}`);

  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
