/**
 * test-broadcast-strip-visual.mjs — Full visual E2E test of the BroadcastStrip
 * component including all 4 dropdown pickers.
 *
 * This opens a real Chrome window, navigates to the dev server, activates
 * broadcast mode, and interacts with every picker, taking screenshots at each step.
 *
 * Prerequisites:
 *   - Vite dev server running on port 5173
 *   - Runtime server running on port 3006
 *   - Runtime seeded with session/model data (run seed-sessions.mjs first)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchVisualBrowser, maximizeBrowserWindow, wait } from './visual-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots', 'broadcast-strip');
const BASE_URL = 'http://localhost:5173';

// Ensure screenshot directory exists
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

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  BroadcastStrip Visual E2E Test                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Launch browser
  console.log('▸ Launching Chrome...');
  const { browser, page } = await launchVisualBrowser({
    headless: false,
    slowMo: 80,
    args: ['--window-size=1920,1080'],
  });

  try {
    // Maximize and set viewport
    await maximizeBrowserWindow(page);
    await page.setViewport({ width: 1920, height: 1080 });
    await wait(500);

    // ─── Phase 1: Initial Load ───────────────────────────────
    console.log('\n── Phase 1: Initial Load ──');

    // First, refresh the companion client's lastSeenAt by re-seeding
    console.log('  → Refreshing companion client data (avoid 30-min offline cutoff)...');
    await fetch('http://localhost:3006/api/companion-clients/chat-info', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-vai-installation-key': 'vscode-e2e-test-' + Date.now(),
        'x-vai-client-name': 'VS Code',
        'x-vai-client-type': 'vscode-extension',
        'x-vai-launch-target': 'vscode',
      },
      body: JSON.stringify({
        chatApps: [
          { id: 'vscode-copilot', label: 'GitHub Copilot' },
          { id: 'vscode-claude', label: 'Claude Code' },
        ],
        sessions: [
          { sessionId: 'ses_ext_001', title: 'Extending IDE with Additional Dropdown Options', chatApp: 'vscode-copilot', lastModified: Date.now() - 60_000 },
          { sessionId: 'ses_ext_002', title: "Improving Vai's Response Quality", chatApp: 'vscode-copilot', lastModified: Date.now() - 3_600_000 },
          { sessionId: 'ses_ext_003', title: 'AgentSession model and related structures discussion', chatApp: 'vscode-copilot', lastModified: Date.now() - 7_200_000 },
          { sessionId: 'ses_ext_004', title: 'Refactoring desktop chat app for IDE management', chatApp: 'vscode-copilot', lastModified: Date.now() - 86_400_000 },
          { sessionId: 'ses_ext_005', title: 'VS Code crash validation request', chatApp: 'vscode-copilot', lastModified: Date.now() - 100_000_000 },
          { sessionId: 'ses_ext_006', title: 'Extension connection + visual E2E testing', chatApp: 'vscode-claude', lastModified: Date.now() - 30_000 },
        ],
      }),
    });
    console.log('  ✓ Companion client data refreshed');

    // Pre-fetch the real bootstrap data from the runtime, then inject auth bypass
    console.log('  → Pre-fetching bootstrap data...');
    const bootstrapResp = await fetch('http://localhost:3006/api/platform/bootstrap');
    const bootstrapData = await bootstrapResp.json();
    bootstrapData.auth = {
      ...bootstrapData.auth,
      enabled: false,
      authenticated: true,
      user: { id: 'test-visual', email: 'test@test.com', name: 'Visual Test User' },
    };
    const patchedBootstrap = JSON.stringify(bootstrapData);
    console.log('  ✓ Bootstrap data pre-fetched and patched');

    // Use setRequestInterception to intercept bootstrap
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('/api/platform/bootstrap') || req.url().includes('/api/auth/me')) {
        console.log(`  → Intercepted: ${req.url()}`);
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: req.url().includes('bootstrap') ? patchedBootstrap : JSON.stringify({ authenticated: true, user: { id: 'test-visual', email: 'test@test.com', name: 'Visual Test User' } }),
        });
      } else {
        req.continue();
      }
    });

    console.log('  ✓ Request interception active');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(3000);

    // Debug: check what the store has
    const storeState = await page.evaluate(() => {
      // Access zustand store from window if available, or check DOM
      const allBtns = Array.from(document.querySelectorAll('button'));
      return {
        buttonCount: allBtns.length,
        buttonTexts: allBtns.map(b => b.textContent?.trim()).filter(Boolean).slice(0, 20),
        hasBroadcastBtn: allBtns.some(b => (b.getAttribute('title') || '').toLowerCase().includes('broadcast')),
        hasIdeBtn: allBtns.some(b => (b.textContent || '').includes('IDE')),
      };
    });
    console.log(`  Page has ${storeState.buttonCount} buttons`);
    console.log(`  Has broadcast button: ${storeState.hasBroadcastBtn}`);
    console.log(`  Has IDE button: ${storeState.hasIdeBtn}`);
    console.log(`  Button texts: ${storeState.buttonTexts.slice(0, 10).join(' | ')}`);

    await screenshot(page, 'initial-load');

    // ─── Phase 2: Find and click broadcast button ────────────
    console.log('\n── Phase 2: Activate Broadcast Mode ──');

    // The broadcast button shows when onlineIdeCount > 0
    // It contains a Radio/broadcast icon and the word "Broadcast" or a count
    // Let's look for buttons with broadcast-related content
    const broadcastBtn = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      // Look for the broadcast toggle button - it has title containing "broadcast"
      return buttons.find(b => {
        const title = b.getAttribute('title') || '';
        const text = b.textContent || '';
        return title.toLowerCase().includes('broadcast') || 
               (text.includes('IDE') && b.querySelector('svg'));
      });
    });

    if (!broadcastBtn || (await broadcastBtn.evaluate(el => !el))) {
      console.log('  ⚠ Broadcast button not found. Checking if already active...');
      await screenshot(page, 'no-broadcast-btn');

      // Try to activate broadcast mode via JavaScript
      console.log('  → Injecting broadcast mode activation...');
      await page.evaluate(() => {
        // Find the zustand store or dispatch a click on the delivery route toggle
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
          if (btn.textContent?.includes('Broadcast') || 
              btn.getAttribute('title')?.toLowerCase().includes('broadcast')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      await wait(1500);
    } else {
      console.log('  ✓ Found broadcast button');
      await broadcastBtn.asElement()?.click();
      await wait(1500);
    }

    await screenshot(page, 'broadcast-mode-activated');

    // Check if broadcast strip appeared
    const stripVisible = await page.evaluate(() => {
      // BroadcastStrip has a motion.div with a specific structure containing pickers
      const strips = document.querySelectorAll('[class*="bg-blue-500"]');
      return strips.length > 0;
    });

    if (!stripVisible) {
      console.log('  ⚠ Broadcast strip not visible. Trying alternate activation...');
      // Try clicking the delivery route selector
      await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll('button'));
        // The broadcast button typically has a satellite/radio icon or "IDE" text
        for (const btn of allBtns) {
          const classes = btn.className || '';
          const text = btn.textContent || '';
          // Could be a small button in the input area
          if (classes.includes('rounded-lg') && (text.match(/\d/) || text.includes('IDE'))) {
            console.log('Clicking:', text);
            btn.click();
            break;
          }
        }
      });
      await wait(1500);
      await screenshot(page, 'broadcast-strip-retry');
    } else {
      console.log('  ✓ Broadcast strip visible');
    }

    // ─── Phase 3: Test Each Picker ───────────────────────────
    console.log('\n── Phase 3: Test Dropdown Pickers ──');

    // Get all compact combobox trigger buttons within the broadcast strip
    const pickerButtons = await page.$$('[class*="bg-blue-500"] button, [class*="bg-blue-500/5"] button');
    console.log(`  Found ${pickerButtons.length} buttons in broadcast area`);

    // More robust: find buttons by their trigger characteristics
    // CompactCombobox triggers have ChevronDown icon and specific styling
    const triggers = await page.$$eval('button', (buttons) => {
      return buttons
        .filter(b => {
          const svg = b.querySelector('svg');
          const parent = b.closest('[class*="bg-blue-500"]');
          return parent && svg && b.textContent.trim().length > 0;
        })
        .map(b => ({
          text: b.textContent?.trim() || '?',
          rect: b.getBoundingClientRect(),
          classes: b.className.slice(0, 100),
        }));
    });

    console.log(`  Found ${triggers.length} picker triggers:`);
    triggers.forEach((t, i) => console.log(`    [${i}] "${t.text}" at (${Math.round(t.rect.x)}, ${Math.round(t.rect.y)})`));
    
    // Test Target Picker (IDE targets)
    console.log('\n  ▸ Testing Target Picker (IDE targets)...');
    await testPicker(page, 0, 'target-picker');
    
    // Test Chat App Picker
    console.log('\n  ▸ Testing Chat App Picker...');
    await testPicker(page, 1, 'chat-app-picker');
    
    // Test Session Picker  
    console.log('\n  ▸ Testing Session Picker...');
    await testPicker(page, 2, 'session-picker');
    
    // Test Model Picker
    console.log('\n  ▸ Testing Model Picker...');
    await testPicker(page, 3, 'model-picker');

    // ─── Phase 4: Verify Session Titles ──────────────────────
    console.log('\n── Phase 4: Verify Session Titles ──');
    
    // Open the session picker and verify our seeded sessions appear
    await openPickerByIndex(page, 2);
    await wait(800);
    
    const sessionItems = await page.evaluate(() => {
      // Find the dropdown portal content (cmdk items)
      const portal = document.querySelector('[cmdk-root]') || document.querySelector('[role="dialog"]');
      if (!portal) {
        // Try finding items in the page
        const items = document.querySelectorAll('[cmdk-item]');
        return Array.from(items).map(i => i.textContent?.trim() || '');
      }
      const items = portal.querySelectorAll('[cmdk-item]');
      return Array.from(items).map(i => i.textContent?.trim() || '');
    });
    
    console.log(`  Session items found: ${sessionItems.length}`);
    sessionItems.forEach(s => console.log(`    • "${s}"`));
    
    const expectedSessions = [
      'Extending IDE with Additional Dropdown Options',
      "Improving Vai's Response Quality",
      'AgentSession model and related structures discussion',
    ];
    
    for (const expected of expectedSessions) {
      const found = sessionItems.some(s => s.includes(expected.slice(0, 30)));
      console.log(`  ${found ? '✓' : '✗'} Session "${expected.slice(0, 50)}..." ${found ? 'FOUND' : 'NOT FOUND'}`);
    }

    await screenshot(page, 'session-picker-with-titles');
    
    // Close dropdown
    await page.keyboard.press('Escape');
    await wait(300);

    // ─── Phase 5: Test Search in Picker ──────────────────────
    console.log('\n── Phase 5: Test Search Functionality ──');
    
    // Open session picker and search
    await openPickerByIndex(page, 2);
    await wait(600);
    
    // Type in the search box
    const searchInput = await page.$('[cmdk-input]');
    if (searchInput) {
      console.log('  ✓ Search input found');
      await searchInput.type('Improving', { delay: 80 });
      await wait(500);
      await screenshot(page, 'session-search-improving');
      
      // Check filtered results
      const filteredItems = await page.$$('[cmdk-item]');
      console.log(`  Filtered results: ${filteredItems.length}`);
      
      // Clear search
      await searchInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await wait(300);
    } else {
      console.log('  ⚠ Search input not found');
    }
    
    await page.keyboard.press('Escape');
    await wait(300);

    // ─── Phase 6: Hover States ───────────────────────────────
    console.log('\n── Phase 6: Hover & Focus States ──');
    
    // Hover over each picker button
    const allBtns = await page.$$('[class*="bg-blue-500/5"] button');
    for (let i = 0; i < Math.min(allBtns.length, 6); i++) {
      const box = await allBtns[i].boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await wait(400);
        await screenshot(page, `hover-btn-${i}`);
      }
    }

    // ─── Phase 7: Disconnect Button ──────────────────────────
    console.log('\n── Phase 7: Disconnect Button ──');
    
    // Find the disconnect button (✕ at the end of the strip)
    const disconnectBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('[class*="bg-blue-500/5"] button'));
      return btns.find(b => b.textContent?.trim() === '✕');
    });
    
    if (disconnectBtn && await disconnectBtn.evaluate(el => !!el)) {
      const box = await disconnectBtn.asElement()?.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await wait(500);
        await screenshot(page, 'disconnect-hover');
        
        // Click disconnect
        await disconnectBtn.asElement()?.click();
        await wait(800);
        await screenshot(page, 'after-disconnect');
        console.log('  ✓ Disconnect clicked — broadcast mode deactivated');
      }
    } else {
      console.log('  ⚠ Disconnect button not found');
    }

    // ─── Phase 8: Responsive Testing ─────────────────────────
    console.log('\n── Phase 8: Responsive Testing ──');
    
    // Re-activate broadcast mode for responsive tests  
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const bcastBtn = btns.find(b => 
        b.getAttribute('title')?.toLowerCase().includes('broadcast')
      );
      bcastBtn?.click();
    });
    await wait(1000);
    
    const viewports = [
      { width: 2560, height: 1440, label: '2560x1440 QHD' },
      { width: 1920, height: 1080, label: '1920x1080 FHD' },
      { width: 1440, height: 900, label: '1440x900 Laptop' },
      { width: 1280, height: 720, label: '1280x720 HD' },
      { width: 768, height: 1024, label: '768x1024 Tablet' },
      { width: 375, height: 812, label: '375x812 Mobile' },
    ];
    
    for (const vp of viewports) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await wait(600);
      await screenshot(page, `responsive-${vp.width}x${vp.height}`);
      console.log(`  ✓ ${vp.label}`);
    }
    
    // Reset to full HD
    await page.setViewport({ width: 1920, height: 1080 });
    await wait(500);

    // ─── Summary ─────────────────────────────────────────────
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log(`║  Test Complete — ${stepN} screenshots saved                  ║`);
    console.log(`║  Location: scripts/screenshots/broadcast-strip/            ║`);
    console.log('╚════════════════════════════════════════════════════════════╝');

    // Keep browser open for manual inspection
    console.log('\n  Browser will stay open for 8 seconds for manual inspection...');
    await wait(8000);

  } catch (err) {
    console.error('\n✗ Test error:', err.message);
    await screenshot(page, 'error-state');
    throw err;
  } finally {
    await browser.close();
    console.log('  Browser closed.\n');
  }
}

/**
 * Open the nth picker trigger button in the broadcast strip
 */
async function openPickerByIndex(page, index) {
  await page.evaluate((idx) => {
    const strip = document.querySelector('[class*="bg-blue-500/5"]');
    if (!strip) return false;
    const buttons = Array.from(strip.querySelectorAll('button')).filter(b => {
      // Filter to combobox triggers (have chevron SVGs and text)
      const svgs = b.querySelectorAll('svg');
      return svgs.length > 0 && b.textContent.trim().length > 0 && b.textContent.trim() !== '✕';
    });
    if (buttons[idx]) {
      buttons[idx].click();
      return true;
    }
    return false;
  }, index);
  await wait(600);
}

/**
 * Test a picker: open it, screenshot, interact with items, close
 */
async function testPicker(page, index, name) {
  await openPickerByIndex(page, index);
  await wait(800);
  
  // Screenshot the open dropdown
  await screenshot(page, `${name}-open`);
  
  // Count items
  const itemCount = await page.$$eval('[cmdk-item]', items => items.length);
  console.log(`    Items: ${itemCount}`);
  
  // Get all item texts
  const itemTexts = await page.$$eval('[cmdk-item]', items => 
    items.map(i => i.textContent?.trim() || '').slice(0, 10)
  );
  itemTexts.forEach(t => console.log(`      • "${t}"`));
  
  // Hover over first few items
  const items = await page.$$('[cmdk-item]');
  for (let i = 0; i < Math.min(items.length, 3); i++) {
    const box = await items[i].boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await wait(300);
    }
  }
  await screenshot(page, `${name}-hover`);
  
  // Click first item to select
  if (items.length > 0) {
    await items[0].click();
    await wait(500);
    await screenshot(page, `${name}-selected`);
    console.log(`    Selected first item`);
  }
  
  // Close dropdown if still open
  await page.keyboard.press('Escape');
  await wait(300);
}

main().catch(console.error);
