// Visible E2E with dual expectations: every prompt asserts BOTH
//   (a) the answer contains the right facts (mustInclude / anyOf)
//   (b) the answer obeys the requested format (length, list shape,
//       table shape, numeric, bullet style, prose-only, etc.)
// Inspired by the bench corpora in packages/core/bench/corpus but with
// strict format gates added so a "right-ish" paragraph never passes a
// "give me a single number" prompt.
//
// Per Master.md sec 6.6 (truth before polish) and the user's rule that
// weak passes are not allowed.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.VAI_APP_URL || 'http://localhost:5173/?devAuthBypass=1';
const OUT = join(process.cwd(), 'scripts', 'screenshots', 'r29-dual');
mkdirSync(OUT, { recursive: true });

// --------------------- format checkers ---------------------
// Each check returns { ok: boolean, why: string }. Prompts compose the
// content and format checks they need.

const fmt = {
  // Hard upper bound on response length (in characters).
  maxChars: (n) => (text) => text.length <= n
    ? { ok: true, why: `≤ ${n} chars (got ${text.length})` }
    : { ok: false, why: `length ${text.length} exceeds ${n}` },

  // Hard lower bound — for "give me a paragraph" / "explain in detail" prompts.
  minChars: (n) => (text) => text.length >= n
    ? { ok: true, why: `≥ ${n} chars (got ${text.length})` }
    : { ok: false, why: `length ${text.length} below ${n}` },

  // The reply must be a numbered list of exactly N items.
  // The DOM may render `1. foo` markdown as `<ol><li>foo</li></ol>`, in which
  // case `innerText` strips the `1.` prefix. Accept either the raw markdown
  // line shape OR the rendered <ol> count from `dom.orderedItems`.
  numberedListExactly: (n) => (text, dom) => {
    const lines = text.split(/\r?\n/);
    const numbered = lines.filter((l) => /^\s*\d+[.)]\s+\S/.test(l));
    const ol = dom?.orderedItems ?? 0;
    const got = Math.max(numbered.length, ol);
    return got === n
      ? { ok: true, why: `numbered list with ${n} items` }
      : { ok: false, why: `expected ${n} numbered items, got ${got}` };
  },

  // The reply must be a numbered list of AT LEAST N items.
  numberedListAtLeast: (n) => (text, dom) => {
    const lines = text.split(/\r?\n/);
    const numbered = lines.filter((l) => /^\s*\d+[.)]\s+\S/.test(l));
    const ol = dom?.orderedItems ?? 0;
    const got = Math.max(numbered.length, ol);
    return got >= n
      ? { ok: true, why: `numbered list with ${got} items (≥ ${n})` }
      : { ok: false, why: `expected ≥ ${n} numbered items, got ${got}` };
  },

  // The reply must be a bulleted list of at least N items.
  bulletListAtLeast: (n) => (text, dom) => {
    const lines = text.split(/\r?\n/);
    const bullets = lines.filter((l) => /^\s*[-*•]\s+\S/.test(l));
    const ul = dom?.unorderedItems ?? 0;
    const got = Math.max(bullets.length, ul);
    return got >= n
      ? { ok: true, why: `bullet list with ${got} items (≥ ${n})` }
      : { ok: false, why: `expected ≥ ${n} bullets, got ${got}` };
  },

  // The reply must NOT contain any list shape (numbered or bulleted).
  // Use for "answer in one sentence", "answer in prose".
  noListShape: () => (text) => {
    const lines = text.split(/\r?\n/);
    const listLines = lines.filter((l) => /^\s*(\d+[.)]\s+\S|[-*•]\s+\S)/.test(l));
    return listLines.length === 0
      ? { ok: true, why: 'no list shape' }
      : { ok: false, why: `expected no list, found ${listLines.length} list lines` };
  },

  // Reply must be one sentence (no internal newlines beyond markdown noise).
  // We treat as one sentence if there is at most one '. ', '?', or '!' in
  // sentence-terminator position and no list lines.
  singleSentence: () => (text) => {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    // Split on punctuation that ends a real sentence; ignore decimals like 1.5.
    const parts = collapsed.split(/(?<=[.!?])\s+(?=[A-Z(])/).filter((s) => s.trim().length > 0);
    return parts.length <= 1
      ? { ok: true, why: 'single sentence' }
      : { ok: false, why: `expected 1 sentence, got ${parts.length}` };
  },

  // Reply must be a single number-shaped token (with optional units / commas).
  singleNumber: () => (text) => {
    const t = text.replace(/\*\*/g, '').trim();
    // Allow leading prose like "Answer: 42" only if total is short.
    if (t.length > 60) return { ok: false, why: `too long for a single number (${t.length} chars)` };
    return /\d/.test(t)
      ? { ok: true, why: 'short numeric reply' }
      : { ok: false, why: 'no digit found' };
  },

  // Reply must contain a markdown table (a header row + a separator row).
  // Either the raw `|---|---|` separator OR a rendered <table> with rows.
  markdownTable: () => (text, dom) => {
    const lines = text.split(/\r?\n/);
    const sepIdx = lines.findIndex((l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(l));
    if (sepIdx > 0) return { ok: true, why: 'markdown table detected' };
    if ((dom?.tableRows ?? 0) >= 2) return { ok: true, why: `rendered <table> with ${dom.tableRows} rows` };
    return { ok: false, why: 'no markdown table found' };
  },

  // Reply must NOT contain a clarifying counter-question (catches "could
  // you clarify" stalling on prompts that should just be answered).
  noClarifyingQuestion: () => (text) => {
    const t = text.toLowerCase();
    return /\b(could you (clarify|say|tell)|i'?m not sure which|do you mean|can you specify|which (one|version) do you mean)\b/.test(t)
      ? { ok: false, why: 'asked clarifying question instead of answering' }
      : { ok: true, why: 'no clarifying counter-question' };
  },
};

// content: regex (mustInclude). Optional anyOf list of regexes.
function content({ mustInclude = null, mustNotInclude = null, anyOf = null }) {
  return (text) => {
    if (mustInclude && !mustInclude.test(text)) return { ok: false, why: `missing required pattern ${mustInclude}` };
    if (mustNotInclude && mustNotInclude.test(text)) return { ok: false, why: `matched forbidden pattern ${mustNotInclude}` };
    if (anyOf && !anyOf.some((rx) => rx.test(text))) return { ok: false, why: `none of anyOf matched` };
    return { ok: true, why: 'content ok' };
  };
}

// --------------------- prompts ---------------------
// Each prompt asserts both content AND format. No weak passes allowed.

const PROMPTS = [
  // --- single-number / terseness shapes ---
  {
    id: 'pi-3-decimals',
    text: 'what is pi to 3 decimal places? just the number, nothing else',
    checks: [
      content({ mustInclude: /3\.14[12]\d?/ }),
      fmt.singleNumber(),
      fmt.noListShape(),
    ],
  },
  {
    id: 'speed-of-light-number',
    text: 'speed of light in km/s — just the number',
    checks: [
      content({ mustInclude: /299[\s,.]?792|3\s*[x×]\s*10/i }),
      fmt.maxChars(80),
      fmt.noListShape(),
    ],
  },
  // --- "name only" shapes — the regression class the user just caught ---
  {
    id: 'apple-name-only',
    text: 'who founded apple? names only, no extra words',
    checks: [
      content({
        mustInclude: /jobs/i,
        mustNotInclude: /1976|los altos|california|founded on|the company was|wayne sold/i,
      }),
      fmt.maxChars(120),
      fmt.noListShape(),
    ],
  },
  {
    id: 'tesla-name-only',
    text: 'who founded tesla motors? just the names',
    checks: [
      content({
        mustInclude: /eberhard|tarpenning|musk/i,
        mustNotInclude: /2003|series a|chairman|roadster|model s/i,
      }),
      fmt.maxChars(160),
      fmt.noListShape(),
    ],
  },
  // --- one-sentence / prose-only shapes ---
  {
    id: 'mitochondria-one-sentence',
    text: 'in one sentence, what is the mitochondria?',
    checks: [
      content({
        mustInclude: /mitochondri/i,
        anyOf: [/energy|atp|cellular respiration|powerhouse/i],
      }),
      fmt.singleSentence(),
      fmt.noListShape(),
      fmt.maxChars(240),
    ],
  },
  {
    id: 'http-prose',
    text: 'explain HTTP in prose, no bullet points, no list — just plain text',
    checks: [
      content({
        mustInclude: /http/i,
        anyOf: [/hypertext|request|response|stateless|protocol/i],
      }),
      fmt.noListShape(),
      fmt.minChars(120),
    ],
  },
  // --- numbered list shapes ---
  {
    id: 'planets-numbered-8',
    text: 'list the 8 planets of our solar system as a numbered list, in order from the sun',
    checks: [
      content({
        mustInclude: /mercury/i,
        anyOf: [/neptune/i],
        mustNotInclude: /pluto.*planet|nine planets/i,
      }),
      fmt.numberedListExactly(8),
    ],
  },
  {
    id: 'oceans-numbered-5',
    text: 'list the 5 oceans of the world as a numbered list',
    checks: [
      content({
        mustInclude: /pacific/i,
        anyOf: [/atlantic/i],
        anyOf2: [/southern|antarctic/i],
      }),
      fmt.numberedListExactly(5),
    ],
  },
  // --- bullet list shape ---
  {
    id: 'tcp-vs-udp-bullets',
    text: 'give me 5 differences between TCP and UDP as bullet points',
    checks: [
      content({
        mustInclude: /tcp/i,
        anyOf: [/udp/i],
      }),
      fmt.bulletListAtLeast(4),
    ],
  },
  // --- direct factual answer that should NOT stall with a clarifier ---
  {
    id: 'capital-of-norway',
    text: 'what is the capital of norway?',
    checks: [
      content({ mustInclude: /\boslo\b/i }),
      fmt.noClarifyingQuestion(),
      fmt.maxChars(400),
    ],
  },
  {
    id: 'capital-of-japan',
    text: 'capital of japan? one word answer please',
    checks: [
      content({ mustInclude: /\btokyo\b/i }),
      fmt.maxChars(60),
      fmt.noListShape(),
      fmt.noClarifyingQuestion(),
    ],
  },
  // --- markdown table shape ---
  {
    id: 'continents-table',
    text: 'give me a markdown table of the 7 continents with columns: continent, approximate population (billions). use markdown table syntax with | separators.',
    checks: [
      content({ mustInclude: /asia/i, anyOf: [/africa/i] }),
      fmt.markdownTable(),
    ],
  },
];

// --------------------- harness ---------------------

const log = [];
function logEvent(kind, detail) {
  const ts = new Date().toISOString();
  log.push({ ts, kind, detail });
  console.log(`[${ts}] ${kind} ${detail ?? ''}`);
}

async function shoot(page, name) {
  const path = join(OUT, `${String(log.length).padStart(3,'0')}-${name}.png`);
  try { await page.screenshot({ path, fullPage: false }); } catch {}
  logEvent('screenshot', name);
  return path;
}

async function waitForAssistantSettled(page, prevCount, timeoutMs = 240_000) {
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

async function readLastAssistantText(page) {
  // Pull the assistant bubble's plain text plus structural counts from the
  // rendered DOM (so list / table format checks survive markdown rendering
  // that strips literal `-` and `1.` prefixes).
  const data = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-chat-message-role="assistant"]'));
    const last = nodes[nodes.length - 1];
    if (!last) return { text: '', orderedItems: 0, unorderedItems: 0, tableRows: 0 };
    return {
      text: (last.innerText || last.textContent || '').trim(),
      orderedItems: last.querySelectorAll('ol > li').length,
      unorderedItems: last.querySelectorAll('ul > li').length,
      tableRows: last.querySelectorAll('table tr').length,
    };
  });
  let t = data.text.replace(/^Vai\s*/i, '');
  t = t.replace(/\n?Related\b[\s\S]*$/i, '');
  t = t.replace(/\n?Copy\s*$/i, '');
  return { text: t.trim(), orderedItems: data.orderedItems, unorderedItems: data.unorderedItems, tableRows: data.tableRows };
}

async function newConversation(page) {
  // Reload with the bypass param and a cache-bust to start a fresh conversation
  // so each prompt is a clean turn-1, not contaminated by previous turns.
  const url = `${APP}${APP.includes('?') ? '&' : '?'}_t=${Date.now()}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
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

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await shoot(page, 'initial-load');

  const ta = page.locator('textarea').first();
  await ta.waitFor({ state: 'visible', timeout: 15_000 });

  const evidence = [];

  for (const p of PROMPTS) {
    // Fresh conversation per prompt so context contamination is impossible.
    await newConversation(page);
    const taFresh = page.locator('textarea').first();
    await taFresh.waitFor({ state: 'visible', timeout: 15_000 });

    logEvent('prompt.start', `${p.id} :: ${p.text}`);
    await waitForComposerIdle(page);
    await taFresh.click();
    await taFresh.fill(p.text);
    await shoot(page, `${p.id}-typed`);

    const before = await countAssistant(page);
    await page.keyboard.press('Enter');
    logEvent('prompt.sent', p.id);

    const settled = await waitForAssistantSettled(page, before);
    if (!settled) {
      logEvent('prompt.timeout', p.id);
      await shoot(page, `${p.id}-timeout`);
      evidence.push({ id: p.id, prompt: p.text, ok: false, text: '', failures: ['timeout'] });
      continue;
    }
    const dom = await readLastAssistantText(page);
    const text = dom.text;
    logEvent('prompt.settled', `${p.id} chars=${text.length} ol=${dom.orderedItems} ul=${dom.unorderedItems} tr=${dom.tableRows}`);
    await shoot(page, `${p.id}-response`);

    // Apply every check; ALL must pass. Pass the DOM struct as 2nd arg so
    // list / table checkers can fall back to rendered <ol>/<ul>/<table>.
    const results = p.checks.map((fn) => fn(text, dom));
    const failures = results.filter((r) => !r.ok).map((r) => r.why);
    const ok = failures.length === 0;
    evidence.push({ id: p.id, prompt: p.text, ok, text: text.slice(0, 800), checks: results, failures });
    if (!ok) await shoot(page, `${p.id}-FAIL`);
  }

  writeFileSync(join(OUT, 'evidence.json'), JSON.stringify({ log, evidence }, null, 2));

  console.log('\n=== R29 dual-expectation visual verdicts ===');
  let pass = 0, fail = 0;
  for (const e of evidence) {
    const tag = e.ok ? 'PASS' : 'FAIL';
    if (e.ok) pass++; else fail++;
    console.log(`${tag}  ${e.id.padEnd(28)} :: ${e.prompt}`);
    console.log(`        text: ${e.text.replace(/\s+/g, ' ').slice(0, 200)}`);
    if (!e.ok) {
      for (const f of e.failures) console.log(`        - ${f}`);
    }
  }
  console.log(`\ntotal=${evidence.length} pass=${pass} fail=${fail}`);

  await page.waitForTimeout(2500);
  await browser.close();
  logEvent('done', `out=${OUT}`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
