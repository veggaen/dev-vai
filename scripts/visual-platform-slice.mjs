/**
 * Visual driver — platform slice: Cloud Projects panel + Council seat picker.
 * Visible Playwright browser (headless:false, slowMo:50) per repo visual-testing rules.
 * Evidence → screenshots/platform-slice/
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'screenshots/platform-slice';
mkdirSync(OUT, { recursive: true });

const results = [];
const log = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

const browser = await chromium.launch({
  headless: false,
  slowMo: 50,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  // 1. Fresh load
  await page.goto('http://localhost:5173/?devAuthBypass=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-initial.png` });
  log('fresh load', true);

  // 2. Open the Projects sidebar panel (activity rail button)
  const projectsNav = page.locator('button[aria-label*="roject" i], [data-panel="projects"], button:has-text("Projects")').first();
  if (await projectsNav.count()) {
    await projectsNav.click();
    await page.waitForTimeout(800);
  }
  const cloudHeader = page.getByText('Cloud projects', { exact: false }).first();
  const cloudVisible = await cloudHeader.isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/02-projects-panel.png` });
  log('cloud projects section renders', cloudVisible);

  // 3. Council seat picker — closed state in composer
  const picker = page.locator('button[aria-label^="Council seats"]').first();
  const pickerVisible = await picker.isVisible().catch(() => false);
  log('council picker visible in composer', pickerVisible);

  if (pickerVisible) {
    // hover evidence
    await picker.hover();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/03-picker-hover.png` });

    // 4. Open popover
    await picker.click();
    await page.waitForTimeout(900);
    const listbox = page.locator('[role="listbox"][aria-label="Council members"]');
    const popoverOpen = await listbox.isVisible().catch(() => false);
    await page.screenshot({ path: `${OUT}/04-picker-open.png` });
    log('picker popover opens', popoverOpen);

    // 5. Select a member (first non-roundtable option) if any exist
    const memberOptions = listbox.locator('[role="option"]').filter({ hasNotText: 'Full roundtable' });
    const memberCount = await memberOptions.count();
    if (popoverOpen && memberCount > 0) {
      await memberOptions.first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/05-member-selected.png` });
      const label = await picker.getAttribute('aria-label');
      log('member selection updates trigger', /selected/i.test(label ?? ''), label ?? '');

      // 6. Reset to full roundtable (keyboard: Escape close → reopen → pick roundtable)
      const roundtable = listbox.locator('[role="option"]', { hasText: 'Full roundtable' }).first();
      await roundtable.click();
      await page.waitForTimeout(400);
      const labelAfter = await picker.getAttribute('aria-label');
      log('reset to full roundtable', /full roundtable/i.test(labelAfter ?? ''), labelAfter ?? '');
      await page.screenshot({ path: `${OUT}/06-roundtable-reset.png` });
    } else {
      log('member selection', memberCount > 0, `members listed: ${memberCount} (runtime council may be empty — popover copy should say so)`);
      await page.keyboard.press('Escape');
    }
  }

  // 7. Keyboard focus pass over composer controls
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 7b. Run-permission flow — drive the store directly (browser has no Tauri disk
  // access) to prove the council-ask card renders and responds.
  const storeReady = await page.evaluate(() => Boolean(window.__vai_workspace));
  if (storeReady) {
    await page.evaluate(() => {
      window.__vai_workspace.setState({
        kind: 'local',
        localRoot: 'C:/Users/v3gga/Documents/dev-lawn',
        localName: 'dev-lawn',
        devServerStatus: 'detected',
        devServerLabel: 'Web / API dev',
        detectedRunCommand: 'bun run dev:web',
      });
    });
    // The preview lives in the App window — open it from the top bar.
    const appNav = page.getByRole('button', { name: /^App$/ }).first();
    if (await appNav.count()) await appNav.click();
    await page.waitForTimeout(900);
    const askCard = page.getByText('Council found a runnable app', { exact: false }).first();
    const askVisible = await askCard.isVisible().catch(() => false);
    await page.screenshot({ path: `${OUT}/09-run-permission-ask.png` });
    log('run-permission ask card renders', askVisible);

    if (askVisible) {
      const notNow = page.getByRole('button', { name: 'Not now' }).first();
      await notNow.hover();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/10-run-permission-hover.png` });
      await notNow.click();
      await page.waitForTimeout(500);
      const status = await page.evaluate(() => window.__vai_workspace.getState().devServerStatus);
      log('decline returns to idle', status === 'idle', `status=${status}`);
      await page.screenshot({ path: `${OUT}/11-run-permission-declined.png` });
    }

    // 7c. Colleague awareness chip — two sibling chats bound to the same folder.
    const colleaguesVisible = await page.evaluate(() => {
      const convs = JSON.stringify({ 'conv-sibling-1': 'C:/Users/v3gga/Documents/dev-lawn', 'conv-sibling-2': 'c:/users/v3gga/documents/dev-lawn/' });
      localStorage.setItem('vai-workspace-by-conversation', convs);
      return true;
    });
    log('colleague bindings seeded', colleaguesVisible);
  } else {
    log('run-permission ask card renders', false, 'window.__vai_workspace missing — is vite running in dev mode?');
  }

  // reset store state so later checks see the normal empty composer
  await page.evaluate(() => {
    window.__vai_workspace?.setState({ kind: 'none', localRoot: null, localName: null, devServerStatus: 'idle', detectedRunCommand: null });
    localStorage.removeItem('vai-workspace-by-conversation');
  });

  // 8. Responsive: 768 width
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/07-responsive-768.png` });
  const overflow768 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  log('no horizontal overflow @768', !overflow768);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/08-final-1920.png` });

  const realErrors = errors.filter((e) => !/favicon|net::ERR_|WebSocket|ResizeObserver/i.test(e));
  log('zero console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} finally {
  console.log('\n--- SUMMARY ---');
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} checks passed`);
  await page.waitForTimeout(2500); // keep window visible for observation
  await browser.close();
}
