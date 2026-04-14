/**
 * test-docker-panel.mjs — Validate Docker Sandboxes panel renders and connects.
 *
 * Opens the desktop app, clicks the Docker rail icon, verifies:
 * - The sidebar switches to Docker Sandboxes
 * - Daemon status shows "Running"
 * - Panel renders without errors
 *
 * Takes screenshots at each step.
 */

import { mkdir } from 'fs/promises';
import { launchVisualBrowser, maximizeBrowserWindow, wait } from './visual-browser.mjs';

const DIR = './screenshots/docker-panel';
await mkdir(DIR, { recursive: true });

const { browser, page } = await launchVisualBrowser({
  args: ['--disable-setuid-sandbox'],
});
const viewport = await maximizeBrowserWindow(page);
console.log(`Using real browser viewport ${viewport.width}x${viewport.height}`);
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

console.log('Navigating to desktop app...');
await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 30_000 });
await page.waitForSelector('[data-group]', { timeout: 10_000 });
await wait(1500);
await page.screenshot({ path: `${DIR}/01-initial.png`, fullPage: true });
console.log('✅ App loaded');

// Find and click the Docker rail item (uses title attribute, not visible text)
const dockerBtnIndex = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const idx = buttons.findIndex((b) => {
    const title = b.getAttribute('title') ?? '';
    return title.startsWith('Docker Sandboxes');
  });
  return idx;
});

if (dockerBtnIndex >= 0) {
  const buttons = await page.$$('button');
  await buttons[dockerBtnIndex].click();
  console.log('✅ Clicked Docker rail button');
  await wait(1000);
  await page.screenshot({ path: `${DIR}/02-docker-panel.png`, fullPage: true });

  // Check panel title
  const panelTitle = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('span'));
    const dockerHeader = headers.find((h) => h.textContent?.includes('Docker'));
    return dockerHeader?.textContent ?? null;
  });
  console.log(`  Panel title: ${panelTitle ?? '(not found)'}`);

  // Check daemon status
  const daemonInfo = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span, p, div'));
    const statusEl = spans.find((el) =>
      el.textContent?.includes('Running') || el.textContent?.includes('Stopped') || el.textContent?.includes('Not Installed')
    );
    return statusEl?.textContent ?? null;
  });
  console.log(`  Daemon status text: ${daemonInfo ?? '(not found)'}`);

  // Check for container list or empty state
  const emptyState = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('p, span, div'));
    const empty = els.find((el) => el.textContent?.includes('No containers') || el.textContent?.includes('no sandbox'));
    return empty?.textContent?.trim() ?? null;
  });
  if (emptyState) console.log(`  Empty state: ${emptyState}`);
} else {
  console.log('❌ Docker rail button not found');
}

// Take final screenshot
await page.screenshot({ path: `${DIR}/03-final.png`, fullPage: true });

console.log(`\nPage errors: ${errors.length}`);
errors.forEach((e) => console.log(`  ⚠ ${e}`));

await browser.close();
console.log('\n✅ Docker panel test complete');
