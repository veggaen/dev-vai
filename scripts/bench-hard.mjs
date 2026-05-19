#!/usr/bin/env node
/**
 * bench-hard.mjs — multi-constraint dual/triple-meaning prompts.
 *
 * Each case combines TWO or THREE intents:
 *   - content (factual / reasoning / code)
 *   - format  (structure, length cap, style)
 *   - style   (tone, perspective, audience)
 *   - meta    (self-awareness, negation, exclusion, conditional)
 *
 * Categories targeted (selected because earlier benches were too easy):
 *   - exclusion       — "list X but NOT Y"
 *   - perspective     — "explain X like to a 10yo, in 2 sentences"
 *   - reasoning+brief — "compute X step by step, then ONLY the answer on last line"
 *   - code-cap        — "JS function for X, ≤5 lines, with a one-line comment"
 *   - negation        — "what is NOT true about X — 3 bullets"
 *   - conditional     — "if A then bullets, else one sentence"
 *   - self-meta       — "what can't Vai do here? ≤30 words, no preamble"
 *   - multi-format    — "first the year, then a one-line consequence"
 *   - ambiguity       — "term X has 2 meanings — give both in one line each"
 *   - reframe         — "rewrite Y so it makes sense to a non-engineer"
 *
 * Usage:
 *   node scripts/bench-hard.mjs --out _bench_hard_R1.json
 *   node scripts/bench-hard.mjs --limit 6 --out _bench_hard_smoke.json
 */
import WS from 'ws';
const WebSocket = WS.WebSocket || WS;
import { writeFile } from 'node:fs/promises';
import { argv } from 'node:process';

const REST = process.env.VAI_API ?? 'http://localhost:3006';
const WS_URL = REST.replace(/^http/i, 'ws').replace(/\/$/, '') + '/api/chat';

const CASES = [
  // ── exclusion ────────────────────────────────────────────────
  { id: 'ex-langs',    cat: 'exclusion',
    prompt: 'list 3 popular programming languages — but NOT JavaScript, Python, or TypeScript. one per line, no preamble.',
    checks: [
      { kind: 'exclude', any: [/\bjavascript\b/i, /\bpython\b/i, /\btypescript\b/i] },
      { kind: 'lines', min: 3, max: 4 },
      { kind: 'noPreamble' },
    ] },
  { id: 'ex-frontend', cat: 'exclusion',
    prompt: 'three popular frontend frameworks, comma separated, NOT React.',
    checks: [
      { kind: 'exclude', any: [/\breact\b/i] },
      { kind: 'commaList', min: 3 },
    ] },
  { id: 'ex-presidents', cat: 'exclusion',
    prompt: 'name 3 US presidents from the 20th century — but not Roosevelt, not Kennedy, not Reagan. just names, comma separated.',
    checks: [
      { kind: 'exclude', any: [/\broosevelt\b/i, /\bkennedy\b/i, /\breagan\b/i] },
      { kind: 'commaList', min: 3 },
    ] },

  // ── perspective + length ─────────────────────────────────────
  { id: 'persp-recursion', cat: 'perspective',
    prompt: 'explain recursion like to a 10-year-old in exactly 2 sentences. no code.',
    checks: [
      { kind: 'sentences', min: 2, max: 2 },
      { kind: 'maxChars', n: 400 },
      { kind: 'noCode' },
    ] },
  { id: 'persp-tcp',      cat: 'perspective',
    prompt: 'explain TCP handshake to a non-technical manager in 3 short sentences. no acronyms beyond TCP.',
    checks: [
      { kind: 'sentences', min: 3, max: 3 },
      { kind: 'mustHit', any: [/handshake|connection|three|3/i] },
    ] },

  // ── reasoning + brief answer ─────────────────────────────────
  { id: 'reason-math1', cat: 'reasoning-brief',
    prompt: 'a train leaves at 8am at 60mph, another leaves the same station at 9am at 90mph going the same direction. when does the 2nd catch up? show steps, then put ONLY the answer on the last line.',
    checks: [
      { kind: 'lastLineMatches', pat: /\b11\s*(?:am|:00|\.00)?\b/i },
      { kind: 'hasSteps' },
    ] },
  { id: 'reason-bayes', cat: 'reasoning-brief',
    prompt: 'prior P(deploy caused bug)=0.7. evidence: errors started 2 hours BEFORE deploy. give the updated probability as a single percent on the last line, after brief reasoning.',
    checks: [
      { kind: 'lastLineMatches', pat: /\b(?:1[0-5]|[5-9])\s*%/ },
      { kind: 'mustHit', any: [/bayes|prior|posterior|likelihood/i] },
    ] },

  // ── code with hard cap ───────────────────────────────────────
  { id: 'code-fizzbuzz', cat: 'code-cap',
    prompt: 'write a JS fizzbuzz for 1..15. max 8 lines including the function signature. add ONE comment line explaining the trick.',
    checks: [
      { kind: 'hasCodeBlock' },
      { kind: 'codeMaxLines', n: 8 },
      { kind: 'mustHit', any: [/fizz/i] },
    ] },
  { id: 'code-debounce', cat: 'code-cap',
    prompt: 'write a JS debounce(fn, ms) — max 6 lines of code, no comments, no preamble.',
    checks: [
      { kind: 'hasCodeBlock' },
      { kind: 'codeMaxLines', n: 6 },
      { kind: 'mustHit', any: [/setTimeout|clearTimeout/] },
    ] },
  { id: 'code-flatten', cat: 'code-cap',
    prompt: 'one-line JS arrow function to deeply flatten an array. no comments.',
    checks: [
      { kind: 'hasCodeBlock' },
      { kind: 'codeMaxLines', n: 2 },
      { kind: 'mustHit', any: [/flat|reduce|concat/i] },
    ] },

  // ── negation (what is NOT) ───────────────────────────────────
  { id: 'neg-react', cat: 'negation',
    prompt: '3 things that are NOT true about React, as bullets. no preamble.',
    checks: [
      { kind: 'bullets', min: 3, max: 5 },
      { kind: 'noPreamble' },
    ] },

  // ── conditional structure ────────────────────────────────────
  { id: 'cond-weather', cat: 'conditional',
    prompt: 'if you know today\'s weather in Oslo, give it as a single sentence. if you don\'t, reply with the single word: unknown.',
    checks: [
      { kind: 'either', options: [
        { kind: 'exact', text: 'unknown' },
        { kind: 'sentences', min: 1, max: 1 },
      ] },
    ] },

  // ── self / meta ──────────────────────────────────────────────
  { id: 'meta-cant-do', cat: 'self-meta',
    prompt: 'in ≤30 words, with no preamble, list 3 things you (Vai) cannot do in this chat. bullets ok.',
    checks: [
      { kind: 'maxWords', n: 40 },
      { kind: 'noPreamble' },
    ] },
  { id: 'meta-confidence', cat: 'self-meta',
    prompt: 'on a 0-100 scale, how confident are you about the current population of Tokyo? answer with just the number and a one-line justification.',
    checks: [
      { kind: 'mustHit', any: [/\b\d{1,3}\b/] },
      { kind: 'lines', min: 1, max: 3 },
    ] },

  // ── multi-format combinator ──────────────────────────────────
  { id: 'multi-moon', cat: 'multi-format',
    prompt: 'first line: the year of the first moon landing. second line: a single-sentence consequence for the cold war. nothing else.',
    checks: [
      { kind: 'lineMatches', i: 0, pat: /^\s*1969\.?\s*$/ },
      { kind: 'lines', min: 2, max: 3 },
    ] },
  { id: 'multi-www',  cat: 'multi-format',
    prompt: 'line 1: year the web was invented. line 2: inventor\'s name. line 3: one-sentence impact.',
    checks: [
      { kind: 'lineMatches', i: 0, pat: /^\s*1989\.?\s*$/ },
      { kind: 'lineMatches', i: 1, pat: /berners[- ]?lee/i },
      { kind: 'lines', min: 3, max: 4 },
    ] },

  // ── ambiguity / dual meaning ─────────────────────────────────
  { id: 'amb-python', cat: 'ambiguity',
    prompt: '"python" has two well-known meanings. give both in one line each, prefixed with "1)" and "2)".',
    checks: [
      { kind: 'mustHit', any: [/snake|reptile|serpent/i] },
      { kind: 'mustHit', any: [/programming|language|guido|interpret/i] },
      { kind: 'lines', min: 2, max: 4 },
    ] },
  { id: 'amb-mercury', cat: 'ambiguity',
    prompt: '"mercury" has at least two famous meanings — give the planet meaning AND the element meaning, one short sentence each. 2 lines total.',
    checks: [
      { kind: 'mustHit', any: [/planet|closest|orbit/i] },
      { kind: 'mustHit', any: [/element|metal|liquid|Hg|mercury\s+(?:vapou?r|atom)/i] },
      { kind: 'lines', min: 2, max: 3 },
    ] },
  { id: 'amb-jaguar', cat: 'ambiguity',
    prompt: '"jaguar" — the animal vs. the carmaker. one short sentence each. 2 lines.',
    checks: [
      { kind: 'mustHit', any: [/cat|feline|panther|americas/i] },
      { kind: 'mustHit', any: [/car|british|automaker|coventry|luxury/i] },
      { kind: 'lines', min: 2, max: 3 },
    ] },

  // ── reframe (rewrite for new audience) ───────────────────────
  { id: 'reframe-k8s', cat: 'reframe',
    prompt: 'rewrite this so a non-engineer understands, in 2 sentences max: "Kubernetes orchestrates containerized workloads across a cluster of nodes with declarative manifests."',
    checks: [
      { kind: 'sentences', min: 1, max: 3 },
      { kind: 'maxChars', n: 400 },
      { kind: 'excludeAll', any: [/\bkubernetes\b/i, /\bcontainerized\b/i, /\bmanifests?\b/i, /\bnodes?\b/i] },
    ] },

  // ── time-bound facts (knowledge-cutoff awareness) ─────────────
  { id: 'time-pope',  cat: 'time-aware',
    prompt: 'who is the current pope? if you\'re not sure due to knowledge cutoff, say so on a single line.',
    checks: [
      { kind: 'either', options: [
        { kind: 'mustHit', any: [/francis|leo|benedict/i] },
        { kind: 'mustHit', any: [/cutoff|not\s+sure|knowledge|unknown|cannot\s+confirm|don'?t\s+know/i] },
      ] },
      { kind: 'maxChars', n: 300 },
    ] },

  // ── format-stress (nested) ───────────────────────────────────
  { id: 'nest-langs', cat: 'nested',
    prompt: 'list 3 statically typed languages as bullets. under each bullet add ONE indented sub-bullet with one notable use case. no other prose.',
    checks: [
      { kind: 'bullets', min: 3 },
      { kind: 'hasIndentedBullets' },
    ] },

  // ── compute + verify ─────────────────────────────────────────
  { id: 'verify-prime', cat: 'reasoning-brief',
    prompt: 'is 1009 prime? say "yes" or "no" on line 1, then on line 2 list one quick reason why.',
    checks: [
      { kind: 'lineMatches', i: 0, pat: /^\s*yes\b/i },
      { kind: 'lines', min: 2, max: 4 },
    ] },

  // ── strict json with content ─────────────────────────────────
  { id: 'json-book', cat: 'code-cap',
    prompt: 'JSON only, no prose, no fences: {"title": "...", "author": "...", "year": ...} for the book "Brave New World".',
    checks: [
      { kind: 'jsonParses' },
      { kind: 'jsonHasKeys', keys: ['title', 'author', 'year'] },
      { kind: 'mustHit', any: [/huxley/i] },
      { kind: 'noFences' },
    ] },

  // ── progressive disclosure ───────────────────────────────────
  { id: 'prog-git', cat: 'multi-format',
    prompt: 'three increasing layers of "what is git": (a) 8-word elevator pitch, (b) 2-sentence overview, (c) one bullet of pitfall. label each (a) (b) (c).',
    checks: [
      { kind: 'mustHit', any: [/\(a\)/i] },
      { kind: 'mustHit', any: [/\(b\)/i] },
      { kind: 'mustHit', any: [/\(c\)/i] },
    ] },
];

// ────────────────── checks ──────────────────
function lines(t) { return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); }
function words(t) { return t.trim().split(/\s+/).filter(Boolean); }
function sentences(t) { return t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0); }
function bullets(t) { return lines(t).filter((l) => /^\s*[-•*]\s+\S/.test(l)); }
function codeBlocks(t) { const out = []; const re = /```(?:\w+)?\n([\s\S]*?)```/g; let m; while ((m = re.exec(t))) out.push(m[1]); return out; }
function hasIndentedBullets(t) { return /\n\s{2,}[-•*]\s+\S/.test(t); }

function runCheck(check, text) {
  switch (check.kind) {
    case 'exclude':
      return { ok: !check.any.some((p) => p.test(text)), why: 'contained excluded term' };
    case 'excludeAll':
      return { ok: !check.any.some((p) => p.test(text)), why: 'contained an excluded term' };
    case 'mustHit':
      return { ok: check.any.some((p) => p.test(text)), why: 'no required pattern' };
    case 'lines': {
      const n = lines(text).length;
      const lo = check.min ?? 0, hi = check.max ?? Infinity;
      return { ok: n >= lo && n <= hi, why: `lines=${n}, want [${lo},${hi}]` };
    }
    case 'lineMatches': {
      const ls = lines(text);
      const ok = check.pat.test(ls[check.i] || '');
      return { ok, why: `line ${check.i}="${(ls[check.i] || '').slice(0, 60)}" vs ${check.pat}` };
    }
    case 'lastLineMatches': {
      const ls = lines(text);
      const last = ls[ls.length - 1] || '';
      return { ok: check.pat.test(last), why: `last="${last.slice(0, 60)}" vs ${check.pat}` };
    }
    case 'maxChars':
      return { ok: text.length <= check.n, why: `len=${text.length}>${check.n}` };
    case 'maxWords':
      return { ok: words(text).length <= check.n, why: `words=${words(text).length}>${check.n}` };
    case 'sentences': {
      const n = sentences(text).length;
      const lo = check.min ?? 0, hi = check.max ?? Infinity;
      return { ok: n >= lo && n <= hi, why: `sentences=${n}, want [${lo},${hi}]` };
    }
    case 'bullets': {
      const n = bullets(text).length;
      const lo = check.min ?? 1, hi = check.max ?? Infinity;
      return { ok: n >= lo && n <= hi, why: `bullets=${n}, want [${lo},${hi}]` };
    }
    case 'noCode':
      return { ok: !/```/.test(text), why: 'contains code block' };
    case 'noPreamble':
      return { ok: !/^\s*(?:sure|here|here'?s|happy to|let me|i'll|i can|of course|absolutely|certainly|great|good question|to answer|in order to)\b/i.test(text), why: 'has preamble' };
    case 'noFences':
      return { ok: !/```/.test(text), why: 'contains code fences' };
    case 'hasCodeBlock':
      return { ok: codeBlocks(text).length > 0 || /\b(function|const|=>|return)\b/.test(text), why: 'no code-ish content' };
    case 'codeMaxLines': {
      const blocks = codeBlocks(text);
      const code = blocks.length ? blocks[0] : text;
      const n = code.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
      return { ok: n <= check.n, why: `code lines=${n}>${check.n}` };
    }
    case 'commaList': {
      const items = text.split(/\n/)[0].split(',').map((s) => s.trim()).filter(Boolean);
      return { ok: items.length >= (check.min ?? 2), why: `csv items=${items.length}` };
    }
    case 'hasSteps':
      return { ok: /\n/.test(text) && lines(text).length >= 2, why: 'no multi-line steps' };
    case 'jsonParses': {
      const slice = text.trim();
      const i = slice.indexOf('{');
      if (i < 0) return { ok: false, why: 'no {' };
      const m = slice.slice(i).match(/\{[\s\S]*\}/);
      if (!m) return { ok: false, why: 'no closing }' };
      try { JSON.parse(m[0]); return { ok: true, why: '' }; } catch (e) { return { ok: false, why: 'parse error: ' + e.message }; }
    }
    case 'jsonHasKeys': {
      try {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return { ok: false, why: 'no object' };
        const o = JSON.parse(m[0]);
        const missing = check.keys.filter((k) => !(k in o));
        return { ok: missing.length === 0, why: `missing ${missing.join(',')}` };
      } catch (e) { return { ok: false, why: 'json: ' + e.message }; }
    }
    case 'exact':
      return { ok: text.trim().toLowerCase() === check.text.toLowerCase(), why: `text="${text.trim().slice(0,60)}" vs "${check.text}"` };
    case 'hasIndentedBullets':
      return { ok: hasIndentedBullets(text), why: 'no indented sub-bullets' };
    case 'either': {
      for (const opt of check.options) {
        const r = runCheck(opt, text);
        if (r.ok) return { ok: true, why: '' };
      }
      return { ok: false, why: 'no branch matched' };
    }
    default:
      return { ok: false, why: 'unknown check: ' + check.kind };
  }
}

// ────────────────── runner ──────────────────
function args() {
  const a = { out: '_bench_hard_R1.json', limit: 0, delayMs: 1500, concurrency: 2 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--out') { a.out = v; i++; }
    else if (k === '--limit') { a.limit = parseInt(v, 10) || 0; i++; }
    else if (k === '--delay') { a.delayMs = parseInt(v, 10) || 0; i++; }
    else if (k === '--concurrency') { a.concurrency = Math.max(1, parseInt(v, 10) || 1); i++; }
  }
  return a;
}

async function newConversation() {
  const r = await fetch(`${REST}/api/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'bench-hard', modelId: 'vai:v0' }),
  });
  if (!r.ok) throw new Error(`conv ${r.status}`);
  return (await r.json()).id;
}

function askChat(conversationId, prompt, timeoutMs = 45_000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let text = '', done = false;
    const t0 = Date.now();
    const timer = setTimeout(() => { try { ws.close(); } catch {}; finish('timeout'); }, timeoutMs);
    function finish(reason) {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ text, wallMs: Date.now() - t0, reason });
    }
    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content: prompt })));
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type === 'text_delta' && m.textDelta) text += m.textDelta;
      else if (m.type === 'token' && m.token) text += m.token;
      else if (m.type === 'done') { try { ws.close(); } catch {}; finish('done'); }
      else if (m.type === 'error') { try { ws.close(); } catch {}; finish('error:' + (m.error || '?')); }
    });
    ws.on('close', () => finish('close'));
    ws.on('error', (e) => finish('wserror:' + e.message));
  });
}

async function runPool(items, n, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function pump() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, pump));
  return results;
}

async function main() {
  const a = args();
  let cases = CASES;
  if (a.limit > 0) cases = cases.slice(0, a.limit);
  console.log(`bench-hard: ${cases.length} cases, concurrency=${a.concurrency} → ${a.out}`);
  const t0 = Date.now();

  const results = await runPool(cases, a.concurrency, async (c, i) => {
    let res;
    try {
      const cid = await newConversation();
      res = await askChat(cid, c.prompt);
    } catch (e) { res = { text: '', wallMs: 0, reason: 'exc:' + e.message }; }
    const checkResults = c.checks.map((chk) => ({ ...chk, ...runCheck(chk, res.text) }));
    const passed = checkResults.every((r) => r.ok);
    const failed = checkResults.filter((r) => !r.ok);
    console.log(`[${(i+1).toString().padStart(2)}/${cases.length}] ${c.cat.padEnd(16)} ${c.id.padEnd(16)} ${passed ? 'PASS' : 'FAIL'} ${res.wallMs}ms  ${failed.length ? '(' + failed.map(f=>f.kind).join(',') + ')' : ''}  ${res.text.slice(0, 70).replace(/\s+/g,' ')}`);
    if (a.delayMs > 0) await new Promise((r) => setTimeout(r, a.delayMs));
    return {
      id: c.id, cat: c.cat, prompt: c.prompt, passed,
      wallMs: res.wallMs, reason: res.reason,
      checks: checkResults, text: res.text,
    };
  });

  const byCat = {};
  for (const r of results) { byCat[r.cat] ??= { n: 0, pass: 0 }; byCat[r.cat].n++; if (r.passed) byCat[r.cat].pass++; }
  const summary = {
    at: new Date().toISOString(),
    total: results.length,
    pass: results.filter((r) => r.passed).length,
    wallMs: Date.now() - t0,
    byCat: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, `${v.pass}/${v.n}`])),
    failures: results.filter((r) => !r.passed).map((r) => ({
      id: r.id, cat: r.cat, prompt: r.prompt,
      failedChecks: r.checks.filter((c) => !c.ok).map((c) => ({ kind: c.kind, why: c.why })),
      preview: r.text.slice(0, 300),
    })),
    cases: results,
  };
  await writeFile(a.out, JSON.stringify(summary, null, 2));
  console.log('');
  console.log(`Total=${summary.total}  Pass=${summary.pass}/${summary.total}  (${summary.wallMs}ms)`);
  for (const [k, v] of Object.entries(summary.byCat)) console.log(`  ${k.padEnd(18)} ${v}`);
  console.log(`Saved: ${a.out}`);
}

main().catch((e) => { console.error(e); process.exit(2); });
