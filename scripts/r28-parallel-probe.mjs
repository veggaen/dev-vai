// scripts/r28-parallel-probe.mjs
// TEMPORARY R&D extension: tests whether the R28 fixes generalize to
// parallel-phrasing variants of the four screenshot-bug prompts.
// This is NOT a permanent bench — it lives alongside the canonical
// e2e-chat-probe.mjs and bench corpora and may be deleted after V3gga
// confirms the findings.

import WSDefault from 'ws';
const WebSocket = WSDefault.WebSocket || WSDefault;
const REST = 'http://localhost:3006';
const WS = 'ws://localhost:3006/api/chat';

// Parallel-phrasing matrix. For each canonical R28 prompt we list
// rephrasings that should produce the SAME class of answer.
//   - apple: curated founder entry should fire on multiple phrasings
//   - lol  : research routing must produce no LoL-transcript rant
//   - and-second : conversational follow-up gate must fire
//   - no-second  : conversational follow-up gate must fire
const SUITES = [
  {
    id: 'apple',
    canonical: 'who was founder of apple? tell me his name only',
    needsHistory: false,
    expect: { mustInclude: /(jobs|wozniak|wayne)/i, mustNotInclude: /symbol|weight|talon|react|mutation/i },
    variants: [
      'name the founder of apple inc',
      'who started apple? just the name',
      'tell me who founded apple',
      'apple was founded by who?',
    ],
  },
  {
    id: 'apple-name-only',
    canonical: 'who was founder of apple? tell me his name only',
    needsHistory: false,
    // Honor terseness: response must be short and must NOT contain the date
    // / location prose from the curated entry.
    expect: {
      mustInclude: /jobs/i,
      mustNotInclude: /1976|los altos|california|founded on|the company was/i,
      maxChars: 120,
    },
    variants: [
      'who started apple? just the name',
      'who founded apple - names only',
      'tell me only the names of apple founders',
    ],
  },
  {
    id: 'lol',
    canonical: 'what are the top 10 most important skills needed to know of when playing league of legends?',
    needsHistory: false,
    // we don't insist on a perfect answer — only that the LoL-transcript
    // rant ("talon is a champion that...") never appears
    expect: { mustInclude: null, mustNotInclude: /talon\s+is\s+a\s+champion|gangplank|teemo|mid lane carry build/i },
    variants: [
      'list the ten most important skills for league of legends',
      'top 10 skills i need to play lol well',
      'what should i master first in league of legends?',
    ],
  },
  {
    id: 'and-second',
    // these prompts rely on prior assistant context — we seed a fake list turn first
    canonical: 'and the second?',
    needsHistory: true,
    expect: { mustInclude: /not sure which one|could you say it back|expand on/i, mustNotInclude: /weight of the second symbol|t\s*[\*x]\s*o\s*=\s*35|numeral system/i },
    variants: [
      'and the third?',
      'but the second one?',
      'what about the second?',
      'tell me the next one',
      'so the second?',
      'or the second?',
    ],
  },
  {
    id: 'no-second',
    canonical: 'no the second message',
    needsHistory: true,
    expect: { mustInclude: /not sure which one|could you say it back|expand on/i, mustNotInclude: /react.*mutation|setstate.*outside/i },
    variants: [
      'no the third message',
      'no give me the previous one',
      'no the second reply',
      'no the second answer',
      'no the second item',
    ],
  },
];

async function newConv(title) {
  const r = await fetch(`${REST}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, modelId: 'vai:v0' }),
  });
  return (await r.json()).id;
}

function send(convId, content) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    let text = '';
    let sources = [];
    let done = false;
    const t = setTimeout(() => {
      if (!done) { try { ws.close(); } catch {} reject(new Error('TIMEOUT')); }
    }, 240_000);
    ws.on('open', () => ws.send(JSON.stringify({ conversationId: convId, content })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'text_delta' && m.textDelta) text += m.textDelta;
      else if (m.type === 'text_delta' && m.text) text += m.text;
      else if (m.type === 'sources' && Array.isArray(m.sources)) sources = m.sources;
      if (m.type === 'done' || m.type === 'error') {
        done = true;
        clearTimeout(t);
        try { ws.close(); } catch {}
        resolve({ text, sources, durationMs: m.durationMs ?? null });
      }
    });
    ws.on('error', (e) => { if (!done) { clearTimeout(t); reject(e); } });
  });
}

const SEED_LIST_TURN = 'give me three short examples of design patterns, numbered 1 2 3';

const results = [];
for (const suite of SUITES) {
  const allPrompts = [suite.canonical, ...suite.variants];
  for (const prompt of allPrompts) {
    const convId = await newConv(`r28-parallel ${suite.id}`);
    if (suite.needsHistory) {
      // seed prior context so the follow-up has something to refer to
      await send(convId, SEED_LIST_TURN);
    }
    let verdict = 'PASS';
    let reason = '';
    let snippet = '';
    let durationMs = null;
    try {
      const r = await send(convId, prompt);
      durationMs = r.durationMs;
      snippet = r.text.slice(0, 200).replace(/\s+/g, ' ').trim();
      const text = r.text;
      if (suite.expect.mustNotInclude && suite.expect.mustNotInclude.test(text)) {
        verdict = 'FAIL';
        reason = `matched mustNotInclude ${suite.expect.mustNotInclude}`;
      } else if (suite.expect.mustInclude && !suite.expect.mustInclude.test(text)) {
        verdict = 'FAIL';
        reason = `did not match mustInclude ${suite.expect.mustInclude}`;
      } else if (suite.expect.maxChars && text.trim().length > suite.expect.maxChars) {
        verdict = 'FAIL';
        reason = `response ${text.trim().length} chars exceeds maxChars=${suite.expect.maxChars}`;
      }
    } catch (e) {
      verdict = 'ERROR';
      reason = e.message;
    }
    results.push({ suite: suite.id, prompt, verdict, reason, durationMs, snippet });
    const tag = verdict === 'PASS' ? 'PASS ' : verdict === 'FAIL' ? 'FAIL ' : 'ERR  ';
    console.log(`${tag} [${suite.id.padEnd(11)}] ${(durationMs ?? '?').toString().padStart(5)}ms :: ${prompt}`);
    if (verdict !== 'PASS') console.log(`        reason: ${reason}`);
    if (verdict !== 'PASS') console.log(`        snippet: ${snippet}`);
  }
}

const total = results.length;
const pass = results.filter((r) => r.verdict === 'PASS').length;
const fail = results.filter((r) => r.verdict === 'FAIL').length;
const err = results.filter((r) => r.verdict === 'ERROR').length;
console.log(`\n=== R28 parallel-probe summary ===`);
console.log(`total=${total} pass=${pass} fail=${fail} err=${err}`);

import { writeFileSync } from 'node:fs';
writeFileSync('_r28_parallel_results.json', JSON.stringify(results, null, 2));
console.log('wrote _r28_parallel_results.json');
process.exit(fail + err > 0 ? 1 : 0);
