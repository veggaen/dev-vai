#!/usr/bin/env node
/**
 * Visible multi-turn conversation demo + per-turn validation.
 *
 * Drives ONE real conversation through the live app in a VISIBLE browser so a
 * human can watch, screenshots every turn, captures each response + its thinking
 * trace from the chat store, and scores each turn against a "Thorsen bar"
 * rubric. Prints a transcript + per-turn grades + an overall verdict.
 *
 * Usage: node scripts/vai-conversation-demo.mjs [--headless] [--app URL]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const headless = args.includes('--headless');
const appUrl = (() => { const i = args.indexOf('--app'); return i >= 0 ? args[i + 1] : 'http://localhost:5173/?devAuthBypass=1'; })();
const outRoot = (() => { const i = args.indexOf('--out'); return i >= 0 ? args[i + 1] : (process.env.VAI_CONVO_DEMO_OUT || path.join(process.cwd(), '.codex-run')); })();
const OUT = path.join(outRoot, `convo-demo-${new Date().toISOString().replace(/[:.]/g, '-')}`);

// Each turn: the message + what a GOOD (Thorsen-bar) answer must do.
// `must` = regexes at least one of which should appear; `forbid` = misroute/slop signals.
const TURNS = [
  { say: "hey, i'm vetle", tests: 'greeting + name', must: [/\b(hi|hey|hello|vetle|nice to meet)\b/i], forbid: [/scaffold|isn'?t in my knowledge|error:/i] },
  { say: 'whats the capital of norway?', tests: 'simple fact', must: [/\boslo\b/i], forbid: [/i don'?t|isn'?t in my knowledge/i] },
  { say: 'how many people live there?', tests: 'follow-up: "there" -> Oslo/Norway', must: [/\b(million|\d[\d.,]*\s*(k|m|million)?)\b/i, /oslo|norway|population/i], forbid: [/which (city|place|country)|what do you mean|there\?/i] },
  { say: 'actually i meant the whole country, not the city', tests: 'correction handling', must: [/norway|country|5[.,]?\d?\s*million|population/i], forbid: [/i don'?t|isn'?t in my knowledge|scaffold/i] },
  { say: 'is it bigger than sweden?', tests: 'comparison + "it" -> Norway', must: [/sweden|norway|smaller|larger|bigger|area|population|no\b|yes\b/i], forbid: [/which|what do you mean/i] },
  { say: 'what was my name again?', tests: 'memory recall', must: [/vetle/i], forbid: [/i don'?t|don'?t know|haven'?t|no name/i] },
  { say: 'okay switch topics — explain what a vpn is, briefly', tests: 'pivot + brevity', must: [/encrypt|tunnel|network|private/i], forbid: [/oslo|norway|vetle/i] },
  { say: 'would you recommend using one?', tests: 'opinion follow-up on VPN', must: [/depend|privacy|yes|recommend|useful|it can|trade-?off|trust/i], forbid: [/which|what do you mean|one\?|oslo|norway/i] },
];

const wait = async (label, fn, ms = 60000, iv = 500) => {
  const end = Date.now() + ms; let v;
  while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, iv)); }
  throw new Error('timeout: ' + label);
};

const state = (page) => page.evaluate(() => {
  const s = window.__vai_chat_store.getState();
  return {
    streaming: Boolean(s.isStreaming),
    activeId: s.activeConversationId || null,
    msgs: s.messages.map((m) => ({ id: String(m.id || ''), role: m.role, content: String(m.content || ''), thinking: m.thinking || null })),
  };
});

function grade(turn, content) {
  const reasons = [];
  if (!content || content.trim().length < 2) reasons.push('empty');
  if (content.startsWith('Error:')) reasons.push('error-response');
  const okMust = !turn.must || turn.must.every((rx) => rx.test(content));
  if (!okMust) reasons.push('missing-required-substance');
  for (const rx of (turn.forbid || [])) if (rx.test(content)) reasons.push(`forbidden:${rx.source.slice(0, 24)}`);
  return { pass: reasons.length === 0, reasons };
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 350, executablePath: chromium.executablePath() });
  const page = await browser.newPage({ viewport: { width: 980, height: 1180 } });
  const results = [];
  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait('store', () => page.evaluate('Boolean(window.__vai_chat_store?.getState)'), 30000, 300);
    const cid = await page.evaluate(async () => { const c = window.__vai_chat_store.getState(); c.startNewChat?.(); return c.createConversation('vai:v0', 'chat', { sandboxProjectId: null }); });
    await wait('active convo', async () => (await page.evaluate((id) => window.__vai_chat_store.getState().activeConversationId === id, cid)), 30000, 400);
    const ta = page.locator('textarea').first(); await ta.waitFor({ timeout: 20000 });

    for (let i = 0; i < TURNS.length; i++) {
      const turn = TURNS[i];
      const before = await state(page);
      const beforeAssistantIds = new Set(before.msgs.filter((m) => m.role === 'assistant' && m.content.trim()).map((m) => m.id));
      await ta.click(); await ta.fill(turn.say); await ta.press('Enter');
      const got = await wait(`turn ${i + 1} reply`, async () => {
        const s = await state(page);
        const fresh = s.msgs.filter((m) => m.role === 'assistant' && m.content.trim() && !beforeAssistantIds.has(m.id));
        if (!s.streaming && fresh.length > 0) return fresh[fresh.length - 1];
        return null;
      }, 90000, 700);
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const shot = path.join(OUT, `turn-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: shot });
      const g = grade(turn, got.content);
      results.push({ n: i + 1, tests: turn.tests, say: turn.say, reply: got.content, thinking: got.thinking, pass: g.pass, reasons: g.reasons, shot });
      console.log(`\n[T${i + 1}] (${turn.tests}) you: ${turn.say}`);
      console.log(`     vai${got.thinking ? ` [${got.thinking.intent}/${got.thinking.strategy}]` : ''}: ${got.content.replace(/\n/g, ' ').slice(0, 200)}`);
      console.log(`     ${g.pass ? 'PASS' : 'FLAG'}${g.reasons.length ? ' — ' + g.reasons.join(', ') : ''}`);
    }
  } finally {
    await fs.writeFile(path.join(OUT, 'transcript.json'), JSON.stringify(results, null, 2));
    if (!headless) await page.waitForTimeout(2500);
    await browser.close().catch(() => {});
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n===== ${passed}/${results.length} turns passed automated checks =====`);
  console.log('Screenshots + transcript:', OUT);
}
main().catch((e) => { console.error('demo failed:', e); process.exit(1); });
