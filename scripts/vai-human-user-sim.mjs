/**
 * Human-User Simulation — drive Vai like a real person using Grok/Claude/Perplexity.
 *
 * No rubrics, no canaries, no THREAD markers. Just natural conversations:
 * compound questions, follow-ups, corrections, changes of plan, casual register.
 * Captures every message + response (trace, thinking, confidence, sources) and
 * screenshots, then writes a transcript JSON for analysis.
 *
 * Usage: node scripts/vai-human-user-sim.mjs [--app URL] [--headless]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const argValue = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const HEADLESS = process.argv.includes('--headless');
const APP_URL = argValue('--app', process.env.VAI_APP_URL || 'http://localhost:5173/?devAuthBypass=1');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(ROOT, 'Temporary_files', 'human-sim', STAMP);
fs.mkdirSync(OUT, { recursive: true });

// Real conversations — the way an engineer actually talks. Each array element is
// one turn the human says. Includes compound asks, casual openers, corrections,
// changes of plan, and "this seems off" pushbacks.
const CONVERSATIONS = [
  {
    id: 'architecture-brainstorm',
    turns: [
      "ok so i'm building a little side project — a job queue that processes image uploads. should i reach for redis + bullmq or just use postgres with a jobs table? it's low volume right now",
      'hmm yeah that makes sense. what happens if a worker crashes mid-job though, how do i not lose the job?',
      "actually wait — let's say it grows to like 50k jobs a day. does your answer change?",
    ],
  },
  {
    id: 'debugging-frustration',
    turns: [
      "lol i've been staring at this for an hour. my node app's memory keeps climbing until it OOMs. no idea why. where do i even start?",
      'i think it might be event listeners i never remove. how do i confirm that hunch?',
    ],
  },
  {
    id: 'casual-code-review',
    turns: [
      'quick gut check — is it bad practice to catch an error and just console.log it then keep going?',
      "ok so when WOULD swallowing be ok then? like genuinely fine",
    ],
  },
  {
    id: 'random-thought',
    turns: [
      'random thought but why is everyone moving off REST to trpc and graphql? feels like churn to me',
      "yeah that's kinda my worry. for a small team building a typescript monolith, what would you actually pick?",
    ],
  },
  {
    id: 'change-of-plan',
    turns: [
      'can you write me a debounce function in typescript',
      "thanks. actually scratch that, i need throttle instead — fire at most once every 200ms",
    ],
  },
  // --- Extended wave: more decision/opinion paraphrases (the article-dump
  // hijack cluster) + messier real-developer phrasings, per the "always push
  // for maximum signal" rule. These should NOT get one-sided article dumps. ---
  {
    id: 'stack-decision-2',
    turns: [
      "ngl i keep going back and forth — for a new saas should i just use nextjs api routes or stand up a separate express backend?",
      "ok but my team is like 3 people. does that change what you'd pick?",
    ],
  },
  {
    id: 'db-decision',
    turns: [
      "real talk, postgres or mongodb for an app that's mostly relational data but i want fast iteration early on?",
      "and is it worth it to add prisma on top or is that overkill at this stage?",
    ],
  },
  {
    id: 'practice-judgment',
    turns: [
      "gut check — is it a bad idea to put business logic directly in my react components?",
      "so where should it actually live then?",
    ],
  },
  {
    id: 'trend-skepticism',
    turns: [
      "why is everyone suddenly obsessed with server components? feels like hype to me honestly",
      "ok so when are they genuinely worth it vs just churn?",
    ],
  },
  // --- New wave: code change-of-plan + idiom follow-ups (root cause C focus). ---
  {
    id: 'code-change-of-plan-2',
    turns: [
      'can you write me a debounce in javascript',
      "hmm actually i changed my mind, give me a throttle instead — at most once every 200ms",
    ],
  },
  {
    id: 'idiom-quickfire',
    turns: [
      "yo how do i dedupe an array in javascript",
      "nice. and what about flattening a nested array?",
    ],
  },
  {
    id: 'casual-mixed',
    turns: [
      "lol ok random — how do i reverse a string in python",
      "cool. now i actually need it in rust instead",
    ],
  },
  // --- New wave (iteration 4): ack-prefixed + restart continuations, max signal. ---
  {
    id: 'ack-lang-switch',
    turns: [
      "how do i dedupe an array in typescript",
      "nice. now give me the same thing in python",
    ],
  },
  {
    id: 'ack-restart-throttle',
    turns: [
      "can you write me a debounce function in typescript",
      "thanks. actually scratch that, i need throttle instead — fire at most once every 200ms",
    ],
  },
  {
    id: 'ack-followup-flatten',
    turns: [
      "yo how do i merge two objects in javascript",
      "awesome. ok and how do i flatten a nested array then?",
    ],
  },
  {
    id: 'double-ack-readfile',
    turns: [
      "how do i read a whole file in python",
      "ok cool thanks. now how about in rust?",
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getState(page) {
  return page.evaluate(() => {
    const store = window.__vai_chat_store?.getState?.();
    return {
      streaming: Boolean(store?.isStreaming),
      activeConversationId: store?.activeConversationId || null,
      messages: Array.isArray(store?.messages)
        ? store.messages.map((m) => ({
          id: String(m.id || ''),
          role: String(m.role || ''),
          content: String(m.content || ''),
          turnKind: m.turnKind || null,
          confidence: typeof m.confidence === 'number' ? m.confidence : null,
          sources: Array.isArray(m.sources) ? m.sources.length : 0,
          thinking: m.thinking || null,
          fallback: m.fallback || null,
        }))
        : [],
    };
  });
}

async function waitUntil(label, fn, timeout = 45000, poll = 500) {
  const start = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`timeout: ${label}`);
    await sleep(poll);
  }
}

async function openFresh(page) {
  const btn = page.getByRole('button', { name: /new chat/i });
  if (await btn.count() > 0) await btn.first().click();
  else await page.evaluate(() => window.__vai_chat_store?.getState?.().startNewChat?.());
  await waitUntil('fresh chat', async () => {
    const s = await getState(page);
    return !s.streaming && s.messages.length === 0;
  }, 20000, 250);
}

async function sendTurn(page, text) {
  const before = await getState(page);
  const beforeIds = new Set(before.messages.filter((m) => m.role === 'assistant').map((m) => m.id));
  const ta = page.locator('textarea').first();
  await ta.waitFor({ timeout: 20000 });
  await ta.fill(text);
  await ta.press('Enter');
  const { assistant } = await waitUntil(`reply: ${text.slice(0, 30)}`, async () => {
    const s = await getState(page);
    const fresh = s.messages.filter((m) => m.role === 'assistant' && m.content.trim() && !beforeIds.has(m.id));
    if (!s.streaming && fresh.length) return { assistant: fresh.at(-1) };
    return null;
  });
  return assistant;
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 60, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitUntil('chat store', () => page.evaluate('Boolean(window.__vai_chat_store?.getState)'), 30000, 300);

  const transcript = [];
  let convIndex = 0;
  for (const conv of CONVERSATIONS) {
    convIndex += 1;
    console.log(`\n===== ${convIndex}/${CONVERSATIONS.length}: ${conv.id} =====`);
    await openFresh(page);
    const convLog = { id: conv.id, turns: [] };
    let turnIndex = 0;
    for (const text of conv.turns) {
      turnIndex += 1;
      console.log(`\n[me] ${text}`);
      let assistant;
      try {
        assistant = await sendTurn(page, text);
      } catch (e) {
        console.log(`[!] ${e.message}`);
        convLog.turns.push({ user: text, error: e.message });
        continue;
      }
      const strategy = assistant.thinking?.strategy || assistant.thinking?.modelId || 'n/a';
      const conf = assistant.confidence != null ? assistant.confidence.toFixed(2) : 'n/a';
      console.log(`[vai ${strategy} · conf ${conf} · ${assistant.content.length}ch] ${assistant.content.slice(0, 220).replace(/\n/g, ' ')}`);
      const shot = path.join(OUT, `${String(convIndex).padStart(2, '0')}-${conv.id}-t${turnIndex}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      convLog.turns.push({
        user: text,
        assistant: assistant.content,
        strategy,
        confidence: assistant.confidence,
        turnKind: assistant.turnKind,
        sources: assistant.sources,
        fallback: assistant.fallback,
        chars: assistant.content.length,
        screenshot: path.relative(ROOT, shot),
      });
      await sleep(700);
    }
    transcript.push(convLog);
  }

  fs.writeFileSync(path.join(OUT, 'transcript.json'), JSON.stringify(transcript, null, 2));
  console.log(`\nTranscript: ${path.relative(ROOT, path.join(OUT, 'transcript.json'))}`);
  if (!HEADLESS) await sleep(2500);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
