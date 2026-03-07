/**
 * Visual validation script — captures screenshots of the VeggaAI desktop app
 * at key moments during the Full Feature Tour demo.
 *
 * Screenshots are saved to scripts/screenshots/ for analysis.
 */
import puppeteer from 'puppeteer';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = join(__dirname, 'screenshots');
const APP_URL = 'http://localhost:5173';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  await mkdir(SCREENSHOTS_DIR, { recursive: true });
  console.log('📸 Screenshot dir:', SCREENSHOTS_DIR);

  const browser = await puppeteer.launch({
    headless: false, slowMo: 50,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  // Capture console output from the app
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('[DemoSequence]') || text.includes('Vai') || text.includes('demo')) {
      console.log('  🖥️', text);
    }
  });

  console.log('🌐 Loading', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(2000); // Wait for React hydration + initial animations

  // ── Screenshot 1: Initial state ──
  console.log('\n📷 1/8: Initial app state');
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '01-initial-state.png'), fullPage: false });

  // Stop any auto-running demo first
  await page.evaluate(() => {
    const demo = window.__vai_demo;
    if (demo?.isRunning?.()) demo.stop();
  });
  await sleep(1000);

  // ── Screenshot 2: Clean state (no demo running) ──
  console.log('📷 2/8: Clean state (demo stopped)');
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '02-clean-state.png'), fullPage: false });

  // ── Screenshot 3: Check for demo buttons ──
  const demoButtons = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons
      .filter(b => b.textContent?.includes('Demo') || b.textContent?.includes('Tour') || b.textContent?.includes('Vai'))
      .map(b => ({
        text: b.textContent?.trim(),
        rect: b.getBoundingClientRect(),
        visible: b.offsetParent !== null,
      }));
  });
  console.log('  Found demo buttons:', JSON.stringify(demoButtons, null, 2));

  // ── Screenshot 4: Open radial menu programmatically ──
  console.log('📷 3/8: Radial menu open');
  await page.evaluate(() => {
    const cursor = window.__vai_cursor;
    if (cursor) {
      cursor.moveTo(720, 450);
    }
  });
  await sleep(500);
  await page.evaluate(() => {
    const cursor = window.__vai_cursor;
    if (cursor) {
      cursor.openRadialMenu(720, 450);
    }
  });
  await sleep(800);
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '03-radial-menu-open.png'), fullPage: false });

  // ── Screenshot 5: Select a radial category ──
  console.log('📷 4/8: Radial menu — Tools category selected');
  await page.evaluate(() => {
    const cursor = window.__vai_cursor;
    if (cursor) cursor.selectRadialItem('tools');
  });
  await sleep(600);
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '04-radial-tools-selected.png'), fullPage: false });

  // Close radial
  await page.evaluate(() => {
    const cursor = window.__vai_cursor;
    if (cursor) cursor.closeRadialMenu();
  });
  await sleep(400);

  // ── Screenshot 6: Activity rail hover with cursor ──
  console.log('📷 5/8: Cursor hovering Activity Rail');
  await page.evaluate(() => {
    const cursor = window.__vai_cursor;
    if (cursor) {
      cursor.hover(24, 180); // Activity rail area
    }
  });
  await sleep(500);
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '05-cursor-activity-rail.png'), fullPage: false });

  // ── Screenshot 7: Virtual keyboard (typing simulation) ──
  console.log('📷 6/8: Virtual keyboard during typing');
  await page.evaluate(() => {
    const cursor = window.__vai_cursor;
    if (cursor) {
      cursor.type(400, 500, 'Hello VeggaAI');
    }
  });
  await sleep(1500); // Let keyboard animate
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '06-virtual-keyboard.png'), fullPage: false });
  await sleep(2000); // Finish typing

  // ── Screenshot 8: Click animation ──
  console.log('📷 7/8: Click ripple effect');
  await page.evaluate(() => {
    const cursor = window.__vai_cursor;
    if (cursor) {
      cursor.click(720, 450);
    }
  });
  await sleep(200);
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '07-click-ripple.png'), fullPage: false });

  // ── Screenshot 8: Action log visible ──
  console.log('📷 8/8: Action log with recorded actions');
  await sleep(500);
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '08-action-log.png'), fullPage: false });

  // ── Gather DOM state for analysis ──
  const domInfo = await page.evaluate(() => {
    const info = {};

    // Check overlay system
    const overlayElements = document.querySelectorAll('[class*="z-[50]"], [class*="z-[55]"]');
    info.overlayCount = overlayElements.length;

    // Check radial menu elements
    const radialItems = document.querySelectorAll('[class*="rounded-full"][class*="border"]');
    info.radialItemCount = radialItems.length;

    // Check activity rail
    const railButtons = document.querySelectorAll('[title*="Chat"], [title*="Dev"], [title*="Knowledge"], [title*="Search"], [title*="Settings"]');
    info.railButtonCount = railButtons.length;

    // Check cursor element
    const cursorSvg = document.querySelector('svg path[d*="M5 3L19 12"]');
    info.cursorVisible = !!cursorSvg;

    // Check action log
    const actionLogEntries = document.querySelectorAll('[class*="ActionLog"] div, [class*="action-log"] div');
    info.actionLogEntryCount = actionLogEntries.length;

    // Template gallery
    const templateCards = document.querySelectorAll('[class*="stack"], [class*="template"]');
    info.templateCardCount = templateCards.length;

    // Demo buttons
    const buttons = Array.from(document.querySelectorAll('button'));
    info.demoButtonTexts = buttons
      .filter(b => b.textContent?.includes('Demo') || b.textContent?.includes('Tour') || b.textContent?.includes('Stop'))
      .map(b => b.textContent?.trim());

    return info;
  });

  console.log('\n═══ DOM Analysis ═══');
  console.log(JSON.stringify(domInfo, null, 2));

  // ── Run the full tour briefly to validate it starts ──
  console.log('\n🎬 Starting Full Feature Tour (running 8 seconds)...');
  await page.evaluate(() => {
    const demo = window.__vai_demo;
    if (demo) demo.tour();
  });

  // Capture 4 screenshots during the tour at 2-second intervals
  for (let i = 0; i < 4; i++) {
    await sleep(2000);
    const filename = `09-tour-progress-${i + 1}.png`;
    console.log(`📷 Tour capture ${i + 1}/4`);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, filename), fullPage: false });
  }

  // Stop the tour
  await page.evaluate(() => {
    const demo = window.__vai_demo;
    if (demo) demo.stop();
  });
  await sleep(500);

  // Final screenshot
  console.log('📷 Final: After tour stopped');
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '10-final-state.png'), fullPage: false });

  console.log('\n✅ All screenshots saved to:', SCREENSHOTS_DIR);
  console.log('Total screenshots: 13');

  await browser.close();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
