/**
 * Visible-browser E2E: preview failure -> Stage repair prompt -> composer.
 *
 * This validates the human path after an opened project fails to render:
 *   1. Open a local project with known missing env.
 *   2. Start anyway.
 *   3. Wait for the App stopped card.
 *   4. Click Stage repair prompt.
 *   5. Verify the chat composer receives a grounded, safe repair prompt.
 *
 * Usage: node scripts/test-preview-repair-prompt-visual.mjs [folderPath] [--send]
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const FOLDER = args.find((arg) => !arg.startsWith('--')) ?? 'C:\\Users\\v3gga\\Documents\\dev-lawn';
const SEND = args.includes('--send');
const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const API = 'http://localhost:3006';
const HEADERS = { 'Content-Type': 'application/json', 'x-vai-dev-auth-bypass': '1' };
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'preview-repair-prompt-e2e', STAMP);
mkdirSync(OUT, { recursive: true });

const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
};
const shot = async (page, name) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  📸 ${file}`);
};

async function api(path, init) {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(20_000),
      ...init,
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

async function findPersistedRepairResponse(prompt, sentAfterMs) {
  const conversations = await api('/api/conversations?limit=12');
  const list = Array.isArray(conversations.body) ? conversations.body : [];
  for (const conversation of list) {
    if (!conversation?.id) continue;
    const conversationTime = Date.parse(conversation.createdAt ?? conversation.updatedAt ?? '');
    if (Number.isFinite(conversationTime) && conversationTime < sentAfterMs - 10_000) continue;
    const messages = await api(`/api/conversations/${conversation.id}/messages`);
    const rows = Array.isArray(messages.body) ? messages.body : [];
    const userIndex = rows.findIndex((message) => {
      const messageTime = Date.parse(message?.createdAt ?? '');
      return message?.role === 'user'
        && typeof message.content === 'string'
        && message.content.includes(prompt.slice(0, 90))
        && (!Number.isFinite(messageTime) || messageTime >= sentAfterMs - 10_000);
    });
    if (userIndex < 0) continue;
    const assistant = rows.slice(userIndex + 1).find((message) => {
      const messageTime = Date.parse(message?.createdAt ?? '');
      return message?.role === 'assistant'
        && typeof message.content === 'string'
        && message.content.trim().length > 20
        && (!Number.isFinite(messageTime) || messageTime >= sentAfterMs - 10_000);
    });
    if (assistant) return { conversationId: conversation.id, content: assistant.content.trim() };
  }
  return null;
}

const buttonByText = async (page, pattern) => {
  const handle = await page.evaluateHandle((source) => {
    const re = new RegExp(source, 'i');
    return Array.from(document.querySelectorAll('button')).find((button) => {
      const text = (button.textContent ?? '').replace(/\s+/g, ' ').trim();
      return re.test(text) && !button.disabled;
    }) ?? null;
  }, pattern.source);
  const exists = await page.evaluate((element) => Boolean(element), handle);
  if (!exists) {
    await handle.dispose();
    return null;
  }
  return handle;
};

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 50,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: null,
});

try {
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await sleep(2500);
  log('App loaded', true);

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyO');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(700);

  const dialogInput = await page.$('input[aria-label="Folder path"]');
  log('Open-folder dialog visible', Boolean(dialogInput));
  if (!dialogInput) throw new Error('Open-folder dialog did not appear');
  await dialogInput.type(FOLDER, { delay: 10 });
  await page.keyboard.press('Enter');
  await shot(page, '01-folder-submitted');

  let started = false;
  for (let i = 0; i < 30; i += 1) {
    await sleep(500);
    const start = await buttonByText(page, /^Start\s*anyway$|^Start$/);
    if (!start) continue;
    await shot(page, '02-review-card');
    await start.asElement()?.click();
    await start.dispose();
    started = true;
    break;
  }
  log('Start clicked from review card', started);
  if (!started) throw new Error('Start button did not appear');

  let failureCause = null;
  for (let i = 0; i < 80; i += 1) {
    await sleep(1000);
    failureCause = await page.evaluate(() => {
      const text = document.body.innerText;
      if (!/App stopped|This build did not reach a runnable state/i.test(text)) return null;
      return (/Reported cause\s+([\s\S]*?)(?:Existing files stay in place|Restart preview|Stage repair prompt|View console|$)/i.exec(text)?.[1] ?? '').trim();
    }).catch(() => null);
    if (failureCause) break;
  }
  log('Preview failure card appeared', Boolean(failureCause), failureCause ?? 'timed out');
  await shot(page, '03-failure-card');
  if (!failureCause) throw new Error('Failure card did not appear');
  const failingEnvVar = /Missing\s+(VITE_[A-Z0-9_]+)/i.exec(failureCause)?.[1] ?? null;

  const repair = await buttonByText(page, /^Stage repair prompt$/);
  log('Stage repair prompt button visible', Boolean(repair));
  if (!repair) throw new Error('Stage repair prompt button not found');
  await repair.asElement()?.click();
  await repair.dispose();
  await sleep(700);

  const prompt = await page.$eval('textarea', (textarea) => textarea.value).catch(() => '');
  const checks = [
    ['contains repair heading', /Repair the current sandbox preview failure/i.test(prompt)],
    [
      'contains missing env var',
      failingEnvVar ? prompt.includes(failingEnvVar) : /VITE_[A-Z0-9_]+/i.test(prompt),
    ],
    ['warns not to invent secrets', /Do not invent real secrets/i.test(prompt)],
    ['offers setup-required fallback', /setup-required screen/i.test(prompt)],
    ['asks for exact env vars if no code fix', /exact env variables/i.test(prompt)],
  ];
  for (const [label, ok] of checks) log(label, ok);
  await shot(page, '04-composer-prefilled');

  if (SEND) {
    const sentAt = Date.now();
    await page.keyboard.press('Enter');
    log('Repair prompt sent through chat', true);
    await shot(page, '05-repair-prompt-sent');

    let response = null;
    for (let i = 0; i < 120; i += 1) {
      await sleep(5000);
      response = await findPersistedRepairResponse(prompt, sentAt);
      if (response) break;
      if (i > 0 && i % 6 === 0) {
        console.log(`  …waiting for persisted repair response (${Math.round((i * 5) / 60)}m)`);
        await shot(page, `waiting-${i}`);
      }
    }

    log('Assistant repair response persisted', Boolean(response), response ? `conversation=${response.conversationId}` : 'timed out');
    if (response) {
      const compact = response.content.replace(/\s+/g, ' ').slice(0, 500);
      log('response mentions missing env context', /VITE_CONVEX_URL|env/i.test(response.content), compact);
      log('response includes guarded replace action', /\{\{replace:/.test(response.content));
      log('response avoids fake credential claim', !/real\s+(secret|api key|deployment url).*(created|added|set)/i.test(response.content));
    }
    await shot(page, '06-after-repair-response');
  }

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} steps passed. Evidence: ${OUT}`);
  if (passed !== results.length) process.exitCode = 1;
  await sleep(12_000);
} finally {
  await browser.close();
}
