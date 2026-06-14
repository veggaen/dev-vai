/**
 * vai-live-audit.mjs — drives the running VeggaAI dev app with Playwright to do a
 * live demo + audit: loads the app, captures the empty state, asks questions,
 * builds a simple app, exercises the chat-switch state fixes, and records:
 *   • screenshots (one per "screen", dribbble-style) → /tmp/vai-audit/*.png
 *   • a video of the whole session → /tmp/vai-audit/video/
 *   • every console error / page error / failed request as audit data → report.json
 *
 * Target: the Vite dev server (proxies API to the runtime on :3006).
 *
 * Usage:
 *   node scripts/vai-live-audit.mjs
 *   VAI_AUDIT_HEADED=1 node scripts/vai-live-audit.mjs   # visible Chrome (close when done)
 *   VAI_AUDIT_PUSH_LOGS=1 node scripts/vai-live-audit.mjs  # also append summary to Dev Logs
 *
 * Phantom window note: Cursor IDE Browser MCP also spawns about:blank Chrome on the
 * taskbar — that is NOT this script when headless (default). See docs/vai-launch-master-plan.md
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.VAI_AUDIT_URL || 'http://localhost:5173/?devAuthBypass=1';
const OUT = process.env.VAI_AUDIT_OUT || 'C:/tmp/vai-audit';
const HEADLESS = process.env.VAI_AUDIT_HEADED !== '1';
const API_BASE = process.env.VAI_API_BASE || 'http://localhost:3006';
const PUSH_LOGS = process.env.VAI_AUDIT_PUSH_LOGS === '1';

mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/video`, { recursive: true });

const audit = { startedAt: new Date().toISOString(), base: BASE, headless: HEADLESS, shots: [], consoleErrors: [], pageErrors: [], failedRequests: [], notes: [] };
const log = (m) => { console.log(`[audit] ${m}`); audit.notes.push(m); };

/** @type {import('playwright').Browser | null} */
let browser = null;
/** @type {import('playwright').BrowserContext | null} */
let context = null;
/** @type {import('playwright').Page | null} */
let page = null;
let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  audit.finishedAt = new Date().toISOString();
  try {
    writeFileSync(`${OUT}/report.json`, JSON.stringify(audit, null, 2));
  } catch { /* best effort */ }
  try {
    if (context) await context.close();
  } catch { /* ignore */ }
  try {
    if (browser) await browser.close();
  } catch { /* ignore */ }
  context = null;
  browser = null;
  page = null;
  if (exitCode !== 0) process.exitCode = exitCode;
}

async function pushAuditToDevLogs() {
  if (!PUSH_LOGS) return;
  try {
    const title = `Playwright audit ${new Date().toLocaleString()}`;
    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        agentName: 'vai-live-audit',
        modelId: 'playwright',
        tags: ['playwright-audit', 'auto-capture'],
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const session = await res.json();
    const summary = [
      `Screenshots: ${audit.shots.length}`,
      `Console errors: ${audit.consoleErrors.length}`,
      `Page errors: ${audit.pageErrors.length}`,
      `Report: ${OUT}/report.json`,
      ...audit.notes.slice(-20),
    ].join('\n');
    await fetch(`${API_BASE}/api/sessions/${session.id}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [{
          type: 'summary',
          content: summary,
          meta: { eventType: 'summary', label: 'Live audit complete' },
        }],
      }),
    });
    log(`dev logs session: ${session.id}`);
  } catch (err) {
    log(`dev logs push failed: ${String(err).slice(0, 200)}`);
  }
}

process.on('SIGINT', () => {
  log('interrupted — closing browser');
  void shutdown(130).then(() => process.exit(130));
});
process.on('SIGTERM', () => {
  void shutdown(143).then(() => process.exit(143));
});

const shot = async (name) => {
  if (!page) return;
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  audit.shots.push({ name, file });
  log(`screenshot: ${name}`);
};

const typeAndSend = async (text) => {
  if (!page) return;
  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.fill(text);
  await page.keyboard.press('Enter');
};

const waitForSettle = async (timeoutMs = 90000) => {
  if (!page) return false;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stopCount = await page.locator('[title="Stop generating"]').count();
    const streaming = await page.locator('[data-streaming="true"]').count();
    if (stopCount === 0 && streaming === 0) {
      const settledAssistant = await page.locator(
        '[data-chat-message-role="assistant"][data-streaming="false"]',
      ).count();
      const copyActions = await page.locator('[title="Copy response"]').count();
      if (settledAssistant > 0 || copyActions > 0) return true;
    }
    await page.waitForTimeout(800);
  }
  return false;
};

try {
  log(`launching browser (headless=${HEADLESS})`);
  browser = await chromium.launch({
    headless: HEADLESS,
    args: HEADLESS ? [] : ['--start-maximized'],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: `${OUT}/video`, size: { width: 1440, height: 900 } },
    extraHTTPHeaders: { 'x-vai-dev-auth-bypass': '1' },
  });
  page = await context.newPage();

  page.on('console', (msg) => { if (msg.type() === 'error') audit.consoleErrors.push(msg.text().slice(0, 300)); });
  page.on('pageerror', (err) => audit.pageErrors.push(String(err).slice(0, 300)));
  page.on('requestfailed', (req) => audit.failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? ''}`.slice(0, 300)));

  log(`loading ${BASE}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 25000 })
    .then(() => log('composer visible — authenticated into workspace'))
    .catch(() => log('WARN: composer not visible (still on auth wall?)'));
  await page.waitForTimeout(1500);
  await shot('01-empty-state');

  log('asking Q1 (reasoning)…');
  await typeAndSend('In one short paragraph, what is the difference between a mutex and a semaphore?');
  await page.waitForTimeout(1800);
  await shot('02-streaming-process');
  const settled1 = await waitForSettle();
  audit.notes.push(`Q1 settled: ${settled1}`);
  await page.waitForTimeout(1000);
  await shot('03-answer-settled');

  const trigger = page.locator('[data-testid="process-tree"], [data-testid="thinking-panel"]').first();
  if (await trigger.count()) { await trigger.click().catch(() => {}); await page.waitForTimeout(600); await shot('04-process-expanded'); }

  log('starting a second chat…');
  const newChat = page.getByText('New Chat').first();
  await newChat.click().catch(() => {});
  await page.waitForTimeout(800);
  await typeAndSend('Tell me who made Stratos.');
  await page.waitForTimeout(2500);
  await shot('05-second-chat-working');
  await waitForSettle();
  await shot('06-second-chat-answer');

  log('attempting a build…');
  const modeBtn = page.getByRole('button', { name: /Chat/i }).last();
  await modeBtn.click().catch(() => {});
  await page.waitForTimeout(500);
  await shot('07-mode-menu');
  const builder = page.getByText(/Build|Builder|Agent/i).first();
  await builder.click().catch(() => {});
  await page.waitForTimeout(500);
  await typeAndSend('Build a simple clock app that shows the current time, updating every second, centered with a clean design.');
  await page.waitForTimeout(4000);
  await shot('08-build-in-progress');
  const settledBuild = await waitForSettle(90000);
  audit.notes.push(`build settled: ${settledBuild}`);
  await page.waitForTimeout(1500);
  await shot('09-build-result');

  log('audit run complete');
} catch (err) {
  audit.notes.push(`FATAL: ${String(err).slice(0, 400)}`);
  log(`error: ${err}`);
  await shot('99-error-state');
} finally {
  await pushAuditToDevLogs();
  await shutdown(0);
  console.log(`\n[audit] DONE. ${audit.shots.length} screenshots, ${audit.consoleErrors.length} console errors, ${audit.pageErrors.length} page errors.`);
  console.log(`[audit] report: ${OUT}/report.json`);
  if (!HEADLESS) console.log('[audit] Close the Playwright Chrome window if it is still open.');
}
