import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const APP_URL = process.env.VAI_APP_URL || 'http://127.0.0.1:5173/?devAuthBypass=1';
const RUNTIME_URL = process.env.VAI_RUNTIME_URL || 'http://127.0.0.1:3006';
const PROMPT = 'when does the bakery on hommersåk open up? brygge bakeren';
const OUTPUT_DIR = path.resolve('screenshots/local-business-hours');
const EXECUTABLE_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const executablePath = EXECUTABLE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('No installed Chrome or Edge executable was found.');

const bootstrapResponse = await fetch(`${RUNTIME_URL}/api/platform/bootstrap`);
if (!bootstrapResponse.ok) throw new Error(`Bootstrap failed: ${bootstrapResponse.status}`);
const bootstrap = await bootstrapResponse.json();
bootstrap.auth = {
  ...bootstrap.auth,
  enabled: false,
  authenticated: true,
  user: { id: 'local-hours-visual', email: 'visual@test.local', name: 'Visual QA' },
};

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 960 } });
const consoleErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => consoleErrors.push(error.message));

try {
  await page.route('**/api/platform/bootstrap', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(bootstrap),
  }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: bootstrap.auth.user }),
  }));

  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 45_000 });
  const textarea = page.locator('textarea').first();
  const assistant = page.locator('[data-chat-message-role="assistant"]');
  await textarea.waitFor({ timeout: 30_000 });

  const before = await assistant.count();
  await textarea.fill(PROMPT);
  await textarea.press('Enter');
  await page.waitForFunction(
    ({ selector, previous }) => {
      const messages = [...document.querySelectorAll(selector)];
      if (messages.length <= previous) return false;
      const latest = messages.at(-1)?.textContent || '';
      return /Opening hours/i.test(latest) && /05[.:]00\s*[-–]\s*18[.:]00/.test(latest);
    },
    { selector: '[data-chat-message-role="assistant"]', previous: before },
    { timeout: 120_000 },
  );
  await page.locator('button[title="Send message (Enter)"]').waitFor({ state: 'visible', timeout: 45_000 });

  const latest = assistant.last();
  const answerText = ((await latest.textContent()) || '').replace(/\s+/g, ' ').trim();
  const answerHtml = await latest.innerHTML();
  await latest.getByText('Opening hours:', { exact: false }).last().scrollIntoViewIfNeeded();
  const answerScreenshot = path.join(OUTPUT_DIR, 'answer.png');
  await page.screenshot({ path: answerScreenshot, fullPage: true });

  if (await page.locator('[data-research-sidebar="panel"][data-state="open"]').count() === 0) {
    const sourceToggle = page.locator('[data-research-sidebar-toggle="button"]').first();
    if (await sourceToggle.count()) await sourceToggle.click();
    else await page.locator('[data-research-source-summary="button"]').last().click();
  }
  await page.waitForFunction(() => [...document.querySelectorAll('[data-research-sidebar="panel"][data-state="open"]')]
    .some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }), { timeout: 10_000 });
  const sourcePanel = page.locator('[data-research-sidebar="panel"][data-state="open"]');
  const sourceText = (await sourcePanel.allTextContents()).join(' ').replace(/\s+/g, ' ').trim();
  const sourceScreenshot = path.join(OUTPUT_DIR, 'source-open.png');
  await page.screenshot({ path: sourceScreenshot, fullPage: true });

  const failures = [];
  if (!/05[.:]00\s*[-–]\s*18[.:]00/.test(answerText)) failures.push('weekday hours missing');
  if (!/05[.:]00\s*[-–]\s*17[.:]00/.test(answerText)) failures.push('Saturday hours missing');
  if (/19[.:]00/.test(answerText)) failures.push('outdated directory hours leaked into the answer');
  if (/SHOW CODE|```\s*json|\{\s*"(?:answer|message|response|opening_hours)"/i.test(`${answerText}\n${answerHtml}`)) failures.push('answer rendered as JSON/code UI');
  if (!/bryggensenter\.no|Butikkoversikt - Bryggen Senter/i.test(sourceText)) failures.push('first-party tenant source is not visible');
  if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} console error(s)`);

  console.log(JSON.stringify({
    passed: failures.length === 0,
    failures,
    answerText,
    sourceText,
    consoleErrors,
    screenshots: [answerScreenshot, sourceScreenshot],
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
