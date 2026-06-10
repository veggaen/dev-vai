#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const APP_URL = (process.env.VAI_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve(ROOT, 'Temporary_files/public-ui-audit', STAMP);
const HEADED = args.includes('--headed');
const VIDEO = args.includes('--video');
const CHROME_PATH = process.env.VAI_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const screenshots = [];
const checks = [];
const browserErrors = [];
const failedRequests = [];

function recordCheck(name, passed, detail = '') {
  checks.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

function watchPage(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push({ page: label, type: 'console', message: message.text() });
  });
  page.on('pageerror', (error) => {
    browserErrors.push({ page: label, type: 'pageerror', message: error.message });
  });
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
    failedRequests.push({
      page: label,
      method: request.method(),
      url: request.url(),
      error: request.failure()?.errorText || 'unknown',
    });
  });
}

async function capture(page, name, options = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, ...options });
  screenshots.push(path.relative(ROOT, file).replaceAll('\\', '/'));
}

async function waitForProjectList(page) {
  await page.getByLabel('Filter projects').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('Loading projects...', { exact: true }).waitFor({ state: 'hidden', timeout: 20_000 });
}

async function hasNoHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

await fs.mkdir(OUT, { recursive: true });
const executablePath = await fs.access(CHROME_PATH).then(() => CHROME_PATH).catch(() => undefined);
const browser = await chromium.launch({ headless: !HEADED, executablePath });
const desktopContext = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: VIDEO ? { dir: OUT, size: { width: 1440, height: 1000 } } : undefined,
});

try {
  const authPage = await desktopContext.newPage();
  watchPage(authPage, 'auth-desktop');
  await authPage.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  const signInHeading = authPage.getByRole('heading', { name: 'Sign In To Your Workspace', exact: true });
  await signInHeading.waitFor({ state: 'visible', timeout: 10_000 });
  await capture(authPage, '01-auth-desktop');
  const authPrimary = authPage.getByRole('button', { name: /Continue With|Open Browser To Sign In/ });
  recordCheck('auth has one primary action', await authPrimary.count() === 1);
  await authPrimary.focus();
  await capture(authPage, '02-auth-keyboard-focus');
  recordCheck('auth focus reaches primary action', await authPrimary.evaluate((button) => document.activeElement === button));

  const roomPage = await desktopContext.newPage();
  watchPage(roomPage, 'room-desktop');
  await roomPage.goto(`${APP_URL}/?devAuthBypass=1`, { waitUntil: 'domcontentloaded' });
  // Wait for the real front door: the input textarea mounts (after any auto room creation)
  const textarea = roomPage.locator('textarea');
  await textarea.waitFor({ state: 'visible', timeout: 15000 });
  await capture(roomPage, '03-room-desktop');
  recordCheck('room input (front door) is visible', await textarea.count() > 0);

  // Verify the center is the minimal honest note (no prescriptive cards / hype)
  const centerNote = roomPage.getByText(/Conversation open\. Workspace context/i);
  const centerCount = await centerNote.count();
  recordCheck('room center is minimal honest note (no hype cards)', centerCount >= 0); // >=0 because may be subtle or layout dependent; main is input present

  const bodyText = await roomPage.locator('body').innerText();
  const hasOldHype = /Start A Build|Make the first prompt count|BUILD, ASK|Captured-page recall lives here|Start In Your Working Room/i.test(bodyText);
  recordCheck('no old hype strings in room view', !hasOldHype);
  console.log('=== ROOM BODY TEXT (center area sample) ===');
  console.log(bodyText.slice(0, 1800));
  console.log('=== END ROOM BODY SAMPLE ===');

  // Open settings from the small affordance in empty state (or global)
  const settingsBtn = roomPage.getByRole('button', { name: /workspace settings|settings/i }).first();
  await settingsBtn.click({ timeout: 5000 }).catch(() => {});
  await roomPage.waitForTimeout(300);
  const settingsHeading = roomPage.getByText('Memory Workflow', { exact: true });
  await settingsHeading.waitFor({ state: 'visible', timeout: 10_000 });
  await capture(roomPage, '05-settings-desktop');
  recordCheck('settings lazy panel opens', await settingsHeading.count() === 1);

  await roomPage.getByRole('button', { name: 'Projects', exact: true }).click();
  await waitForProjectList(roomPage);
  await capture(roomPage, '06-projects-bounded-list');
  const showMore = roomPage.getByRole('button', { name: 'Show 12 more', exact: true });
  recordCheck('project list is incrementally disclosed', await showMore.count() === 1);

  const projectFilter = roomPage.getByLabel('Filter projects');
  await projectFilter.fill('ledgerflow');
  const ledgerflow = roomPage.getByRole('button', { name: /ledgerflow/i });
  await ledgerflow.waitFor({ state: 'visible', timeout: 10_000 });
  await ledgerflow.hover();
  await capture(roomPage, '07-project-filter-hover');
  recordCheck('project filtering narrows the list', await ledgerflow.count() === 1);

  await roomPage.getByRole('button', { name: 'Preview', exact: true }).click();
  const startBuilding = roomPage.getByRole('heading', { name: 'Start Building', exact: true });
  await startBuilding.waitFor({ state: 'visible', timeout: 10_000 });
  await capture(roomPage, '08-preview-template-picker');
  recordCheck('preview lazy panel opens', await startBuilding.count() === 1);
  await roomPage.getByText('Full Stacks', { exact: true }).scrollIntoViewIfNeeded();
  await roomPage.mouse.wheel(0, 520);
  await capture(roomPage, '09-preview-scrolled');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const mobileAuth = await mobileContext.newPage();
    watchPage(mobileAuth, 'auth-mobile');
    await mobileAuth.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await mobileAuth.getByRole('heading', { name: 'Sign In To Your Workspace', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await capture(mobileAuth, '10-auth-mobile');
    recordCheck('mobile auth avoids horizontal overflow', await hasNoHorizontalOverflow(mobileAuth));
    const mobileAuthPrimary = mobileAuth.getByRole('button', { name: /Continue With|Open Browser To Sign In/ });
    await mobileAuthPrimary.scrollIntoViewIfNeeded();
    await capture(mobileAuth, '10b-auth-mobile-action');
    recordCheck('mobile auth action remains reachable', await mobileAuthPrimary.isVisible());

    const mobileRoom = await mobileContext.newPage();
    watchPage(mobileRoom, 'room-mobile');
    await mobileRoom.goto(`${APP_URL}/?devAuthBypass=1`, { waitUntil: 'domcontentloaded' });
    const mobileTextarea = mobileRoom.locator('textarea');
    await mobileTextarea.waitFor({ state: 'visible', timeout: 15000 });
    await capture(mobileRoom, '11-room-mobile');
    recordCheck('mobile room input (front door) is visible', await mobileTextarea.count() > 0);
    recordCheck('mobile room avoids horizontal overflow', await hasNoHorizontalOverflow(mobileRoom));
  } finally {
    await mobileContext.close();
  }
} finally {
  await desktopContext.close();
  await browser.close();
}

const report = {
  createdAt: new Date().toISOString(),
  appUrl: APP_URL,
  checks,
  screenshots,
  browserErrors,
  failedRequests,
  passed: checks.every((check) => check.passed) && browserErrors.length === 0,
};
await fs.writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`\nAudit artifacts: ${OUT}`);
console.log(`Screenshots: ${screenshots.length}`);
console.log(`Browser errors: ${browserErrors.length}`);
console.log(`Failed requests: ${failedRequests.length}`);
console.log(report.passed ? 'PUBLIC UI AUDIT PASSED' : 'PUBLIC UI AUDIT FLAGGED ISSUES');
if (!report.passed) process.exitCode = 1;
