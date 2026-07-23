import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.VAI_DESKTOP_URL ?? 'http://127.0.0.1:5173/?devAuthBypass=1';
const outDir = path.resolve('artifacts/ptt-acceptance/ui');
const executablePath = process.env.VAI_CHROME_PATH
  ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const modes = ['compact', 'open', 'odyssey'];
const themes = ['dark', 'light'];
const viewports = [
  { id: 'ultrawide', width: 1920, height: 720 },
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'portrait', width: 900, height: 1200 },
  { id: 'narrow', width: 390, height: 844 },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
const results = [];
const consoleErrors = [];

try {
  for (const mode of modes) {
    for (const theme of themes) {
      for (const viewport of viewports) {
        const context = await browser.newContext({ viewport });
        await context.addInitScript(({ mode, theme }) => {
          localStorage.setItem('vai-layout-mode', mode);
          localStorage.setItem('vai-theme-preference', theme);
          localStorage.setItem('vai-active-theme-id', theme);
        }, { mode, theme });
        const page = await context.newPage();
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push(error.message));
        await page.goto(baseUrl);
        await page.waitForLoadState('networkidle');
        const settingsButton = page.getByRole('button', { name: 'Open settings' });
        if (await settingsButton.count()) await settingsButton.click();
        else await page.keyboard.press('Control+,');
        await page.getByText('Settings', { exact: true }).first().waitFor();
        await page.getByText('Shortcuts', { exact: true }).first().click();
        await page.getByText('Hold to dictate into the field focused at release', { exact: true }).waitFor();

        const dimensions = await page.evaluate(() => ({
          bodyWidth: document.body.scrollWidth,
          viewportWidth: window.innerWidth,
          bodyHeight: document.body.scrollHeight,
          viewportHeight: window.innerHeight,
          settingsPanelWidth: document.querySelector('.settings-panel')?.getBoundingClientRect().width ?? 0,
        }));
        const file = `${mode}-${theme}-${viewport.id}.png`;
        await page.screenshot({ path: path.join(outDir, file), fullPage: true });
        results.push({
          mode,
          theme,
          viewport: viewport.id,
          screenshot: file,
          horizontalOverflow: dimensions.bodyWidth > dimensions.viewportWidth + 1,
          contentTooNarrow: dimensions.settingsPanelWidth < Math.min(320, dimensions.viewportWidth - 32),
          dimensions,
        });
        await context.close();
      }
    }
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle');
  const settingsButton = page.getByRole('button', { name: 'Open settings' });
  if (await settingsButton.count()) await settingsButton.click();
  else await page.keyboard.press('Control+,');
  await page.getByText('Shortcuts', { exact: true }).first().click();
  const row = page.locator('li').filter({
    hasText: 'Hold to dictate into the field focused at release',
  });
  const key = row.locator('kbd');
  await key.focus();
  await key.press('Control+Shift+F12');
  const acceptedRebind = (await key.textContent())?.trim() === 'Ctrl+Shift+F12';
  await key.focus();
  await key.press('Control+Q');
  const rejectedUnsafeRebind = (await key.textContent())?.trim() === 'Ctrl+Shift+F12';
  await context.close();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    captures: results.length,
    overflowFailures: results.filter((result) => result.horizontalOverflow),
    narrowContentFailures: results.filter((result) => result.contentTooNarrow),
    acceptedRebind,
    rejectedUnsafeRebind,
    consoleErrors: [...new Set(consoleErrors)],
    passed: results.every((result) => !result.horizontalOverflow && !result.contentTooNarrow)
      && acceptedRebind
      && rejectedUnsafeRebind
      && consoleErrors.length === 0,
  };
  await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
