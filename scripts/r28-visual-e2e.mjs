// Visible E2E for the four R28 screenshot prompts.
// Drives the actual desktop app at http://localhost:5173/ in a real Chromium
// window (headless: false, slowMo 50). Captures: initial load, each prompt
// sent + response read state, transcript scroll, hover state, final state.
//
// Per visual-testing-preferences:
//   - real visible browser, NOT VS Code embedded
//   - one canonical session, sequential prompts
//   - keyboard-led for typing/sending, mouse for hover/scroll
//   - compact evidence: sent state, response read state, transcript scroll,
//     key hover state, final UI state — no redundant screenshots

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.VAI_APP_URL || 'http://localhost:5173/?devAuthBypass=1';
const OUT = join(process.cwd(), 'scripts', 'screenshots', 'r28-visual');
mkdirSync(OUT, { recursive: true });

const PROMPTS = [
  { id: 'apple', text: 'who was founder of apple? tell me his name only' },
  { id: 'lol',   text: 'what are the top 10 most important skills needed to know of when playing league of legends?' },
  { id: 'and-second',  text: 'and the second?' },
  { id: 'no-second',   text: 'no the second message' },
];

const log = [];
function logEvent(kind, detail) {
  const ts = new Date().toISOString();
  log.push({ ts, kind, detail });
  console.log(`[${ts}] ${kind} ${detail ?? ''}`);
}

async function shoot(page, name) {
  const path = join(OUT, `${String(log.length).padStart(2,'0')}-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  logEvent('screenshot', name);
  return path;
}

async function waitForAssistantSettled(page, prevCount, timeoutMs = 240_000) {
  // Wait until a NEW assistant bubble appears, then until its data-streaming
  // flips to 'false'.
  const deadline = Date.now() + timeoutMs;
  let appeared = false;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[data-chat-message-role="assistant"]'));
      const last = nodes[nodes.length - 1];
      return {
        count: nodes.length,
        streaming: last ? last.getAttribute('data-streaming') : null,
        text: last ? (last.textContent || '').trim() : '',
      };
    });
    if (!appeared && state.count > prevCount) appeared = true;
    if (appeared && state.streaming === 'false' && state.text.length > 0) return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function waitForComposerIdle(page, timeoutMs = 240_000) {
  // Composer Stop button vanishes (replaced by Send) when the runtime stops streaming.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stopVisible = await page.evaluate(() => !!document.querySelector('button[title="Stop generating"]'));
    if (!stopVisible) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function countAssistant(page) {
  return page.evaluate(() => document.querySelectorAll('[data-chat-message-role="assistant"]').length);
}

async function run() {
  logEvent('launch', `app=${APP}`);
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  page.on('pageerror', (e) => logEvent('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') logEvent('console.error', m.text()); });

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  // Give the app a beat to wire up to the runtime.
  await page.waitForTimeout(2000);
  await shoot(page, 'initial-load');

  // Locate textarea.
  const ta = page.locator('textarea').first();
  await ta.waitFor({ state: 'visible', timeout: 15_000 });

  const evidence = [];

  for (const p of PROMPTS) {
    logEvent('prompt.start', `${p.id} :: ${p.text}`);
    // Make sure the previous turn has finished streaming before typing.
    await waitForComposerIdle(page);
    await ta.click();
    await ta.fill(p.text);
    await shoot(page, `${p.id}-typed`);

    const before = await countAssistant(page);
    await page.keyboard.press('Enter');
    logEvent('prompt.sent', p.id);
    await shoot(page, `${p.id}-sent`);

    const settled = await waitForAssistantSettled(page, before);
    if (!settled) {
      logEvent('prompt.timeout', p.id);
      await shoot(page, `${p.id}-timeout`);
      evidence.push({ id: p.id, ok: false, text: '', reason: 'timeout' });
      continue;
    }
    logEvent('prompt.settled', `${p.id} chars=${settled.text.length}`);
    await shoot(page, `${p.id}-response`);

    // Hover the response bubble to capture the live UI affordance.
    const lastBubble = page.locator('[data-chat-message-role="assistant"]').last();
    await lastBubble.hover();
    await page.waitForTimeout(300);
    await shoot(page, `${p.id}-hover`);

    evidence.push({ id: p.id, ok: true, text: settled.text.slice(0, 800) });
  }

  // Scroll transcript to top so we see the whole conversation in one shot.
  await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('*')).filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    if (containers[0]) containers[0].scrollTop = 0;
  });
  await page.waitForTimeout(400);
  await shoot(page, 'transcript-top');

  await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('*')).filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    if (containers[0]) containers[0].scrollTop = containers[0].scrollHeight;
  });
  await page.waitForTimeout(400);
  await shoot(page, 'transcript-bottom');

  // Pass/fail heuristics for the four known bugs.
  const verdicts = evidence.map((e) => {
    const t = (e.text || '').toLowerCase();
    let pass = e.ok;
    let why = '';
    if (e.id === 'apple') {
      pass = pass && /\b(jobs|wozniak)\b/.test(t) && !/talent talon|family needed a website/.test(t);
      why = pass ? 'mentions Jobs/Wozniak' : 'missing Jobs/Wozniak or contains rant';
    } else if (e.id === 'lol') {
      pass = pass && !/talent talon|family needed a website|10x developers? are/.test(t);
      why = pass ? 'no LoL transcript rant' : 'still contains LoL transcript rant';
    } else if (e.id === 'and-second' || e.id === 'no-second') {
      pass = pass && !/weight of the second symbol|react.*mutation|symbol is\s*36/.test(t);
      why = pass ? 'no symbol-weight / react-mutation rant' : 'still contains misroute rant';
    }
    return { ...e, pass, why };
  });

  writeFileSync(join(OUT, 'evidence.json'), JSON.stringify({ log, evidence: verdicts }, null, 2));

  console.log('\n=== R28 visual verdicts ===');
  for (const v of verdicts) {
    console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${v.id.padEnd(12)}  ${v.why}`);
    console.log(`         text: ${v.text.replace(/\s+/g,' ').slice(0,180)}`);
  }

  // Hold the window briefly so v3gga can see the final state.
  await page.waitForTimeout(2500);
  await browser.close();
  logEvent('done', `out=${OUT}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
