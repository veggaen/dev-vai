#!/usr/bin/env node
/**
 * bench-research.mjs — focused web-research quality bench for Vai.
 * Drives the chat WS, captures `sources` + final text, scores per case.
 *
 * Usage:
 *   node scripts/bench-research.mjs --suite easy   --out _bench_research_R0_easy.json
 *   node scripts/bench-research.mjs --suite medium --out _bench_research_R0_medium.json
 *   node scripts/bench-research.mjs --suite hard   --out _bench_research_R0_hard.json
 *   node scripts/bench-research.mjs --suite themed:gaming --out _bench_research_R0_gaming.json
 */
import WS from 'ws';
const WebSocket = WS.WebSocket || WS;
import { writeFile } from 'node:fs/promises';
import { argv } from 'node:process';

const REST = process.env.VAI_API ?? 'http://localhost:3006';
const WS_URL   = REST.replace(/^http/i, 'ws').replace(/\/$/, '') + '/api/chat';

// Suites — progressively harder + varied themes
const SUITES = {
  easy: [
    { id: 'wiki-fact',     prompt: 'who invented the transistor',
      mustHit: [/bardeen|brattain|shockley|bell\s*labs/i], wantsReddit: false },
    { id: 'wiki-place',    prompt: 'capital of mongolia',
      mustHit: [/ulaanbaatar|ulan\s*bator/i], wantsReddit: false },
    { id: 'def-concept',   prompt: 'what is photosynthesis',
      mustHit: [/light|chlorophyll|carbon|glucose/i], wantsReddit: false },
  ],
  medium: [
    { id: 'community-rec', prompt: 'best mechanical keyboard switch for typing',
      mustHit: [/cherry|gateron|kailh|brown|blue|tactile|linear/i], wantsReddit: true,
      antiHit: [/nintendo\s*switch|final\s*fantasy/i] },
    { id: 'gear-2024',     prompt: 'best budget noise cancelling headphones reddit',
      mustHit: [/sony|bose|soundcore|anker|qc|wh-1000|life\s*q/i], wantsReddit: true },
    { id: 'who-is-niche',  prompt: 'who is tarik karam streamer',
      mustHit: [/tarik|valorant|csgo|cs:go|counter[-\s]?strike|twitch/i], wantsReddit: true },
    { id: 'recent-game',   prompt: 'is hollow knight silksong out yet',
      mustHit: [/silksong|hollow\s*knight|team\s*cherry|release|2025|2026|delay|not\s*yet/i],
      wantsReddit: true },
  ],
  hard: [
    { id: 'multi-entity',  prompt: 'compare framework laptop 13 vs 16 for software development',
      mustHit: [/framework/i, /(13|14|16)/i, /(modular|repair|upgrade|battery|gpu|expansion)/i],
      wantsReddit: true },
    { id: 'opinion-deep',  prompt: 'why do programmers prefer arch linux',
      mustHit: [/aur|rolling\s*release|customiz|minimal|pacman/i], wantsReddit: true },
    { id: 'tech-current',  prompt: 'is rust good for game development in 2025',
      mustHit: [/rust/i, /(bevy|fyrox|game|borrow|ecs|amethyst|macroquad)/i], wantsReddit: false },
    { id: 'troubleshoot',  prompt: 'sourdough starter not rising after 5 days what to do',
      mustHit: [/feed|temperat|flour|hydration|whole\s*wheat|rye|float\s*test|patience|days/i],
      wantsReddit: false },
    { id: 'niche-creator', prompt: 'who is jerma985 and what are his most famous streams',
      mustHit: [/jerma|streamer|twitch|dollhouse|baby/i], wantsReddit: true },
  ],
  'themed:gaming': [
    { id: 'osrs-meta',     prompt: 'best money making method in osrs 2025',
      mustHit: [/(gp\/hr|gp\s*\/?\s*hour|gp|skilling|pvm|bossing|raids|slayer|rune)/i], wantsReddit: true },
    { id: 'factorio-help', prompt: 'how do i defend my factorio base from biters mid game',
      mustHit: [/turret|laser|wall|gun|flamethrower|pollution|biter/i], wantsReddit: true },
    { id: 'helldivers',    prompt: 'best loadout for helldivers 2 against bots',
      mustHit: [/autocannon|stratagem|railgun|laser\s*cannon|bot|automaton|orbital|eagle/i],
      wantsReddit: true },
  ],
  'themed:cooking': [
    { id: 'pizza-dough',   prompt: 'best hydration for neapolitan pizza dough',
      mustHit: [/(60%|65%|70%|hydration|flour|tipo\s*00|water)/i], wantsReddit: true },
    { id: 'sous-vide',     prompt: 'what temperature for sous vide ribeye medium rare',
      mustHit: [/(129|130|131|132|133|134|135)\s*°?f|54\s*°?c|55\s*°?c|56\s*°?c/i],
      wantsReddit: false },
    { id: 'fermentation',  prompt: 'why is my kimchi too sour after one week',
      mustHit: [/temperat|salt|fermen|fridge|cold|bacteria|lactic/i], wantsReddit: false },
  ],
  'themed:dev-tools': [
    { id: 'neovim-plugin', prompt: 'best neovim plugin manager 2025',
      mustHit: [/lazy\.nvim|packer|paq|mini\.deps|rocks/i], wantsReddit: true },
    { id: 'rust-async',    prompt: 'tokio vs async-std in 2025 which to pick',
      mustHit: [/tokio/i, /(ecosystem|maintained|deprecat|smol|runtime)/i], wantsReddit: false },
    { id: 'wsl-vs-vm',     prompt: 'wsl2 vs full linux vm for development which is better',
      mustHit: [/(wsl|wsl2)/i, /(performance|io|filesystem|integration|gpu|networking)/i],
      wantsReddit: true },
  ],
  'themed:science': [
    { id: 'crispr-ethics',   prompt: 'state of crispr gene editing ethics debate 2025',
      mustHit: [/crispr|cas9/i, /(ethic|germline|moratorium|regulation|debate)/i], wantsReddit: false },
    { id: 'jwst-discovery',  prompt: 'recent james webb space telescope discoveries about early galaxies',
      mustHit: [/(webb|jwst)/i, /(galax|redshift|early\s+universe|cosmology)/i], wantsReddit: false },
    { id: 'fusion-progress', prompt: 'where is nuclear fusion energy research at right now',
      mustHit: [/(fusion|tokamak|iter|inertial|nif)/i, /(plasma|ignition|breakeven|q\s*factor|progress)/i],
      wantsReddit: false },
  ],
  'themed:music': [
    { id: 'audio-interface',  prompt: 'best budget audio interface for home recording 2025',
      mustHit: [/(scarlett|focusrite|presonus|motu|audient|ssl\s*2|babyface)/i, /(input|preamp|usb|latency|bus\s*powered)/i],
      wantsReddit: true },
    { id: 'guitar-pedal',     prompt: 'most underrated overdrive pedal reddit recommends',
      mustHit: [/(overdrive|tube\s*screamer|klon|timmy|bluesbreaker|morning\s*glory|ocd)/i],
      wantsReddit: true },
    { id: 'daw-vs',           prompt: 'ableton vs fl studio for electronic production beginner',
      mustHit: [/ableton/i, /(fl\s*studio|fruity)/i, /(workflow|beginner|learning|piano\s*roll|warping)/i],
      wantsReddit: true },
  ],
  'themed:history': [
    { id: 'wwii-eastern',     prompt: 'why did operation barbarossa fail',
      mustHit: [/(barbarossa|wehrmacht|soviet)/i, /(winter|logistic|supply|stalingrad|moscow|distance|overextend)/i],
      wantsReddit: false },
    { id: 'roman-fall',       prompt: 'main modern theories on the fall of the western roman empire',
      mustHit: [/rom(?:an|e)/i, /(gibbon|migration|peter\s*heather|ward[-\s]*perkins|barbarian|economy|christianity|plague)/i],
      wantsReddit: false },
    { id: 'cold-war-event',   prompt: 'what really happened during the cuban missile crisis',
      mustHit: [/(cuban|missile|khrushchev|kennedy)/i, /(blockade|quarantine|13\s*days|backchannel|jupiter|turkey)/i],
      wantsReddit: false },
  ],
  'themed:finance': [
    { id: 'index-funds',      prompt: 'vanguard vs fidelity index funds which to choose 2025',
      mustHit: [/(vanguard|vti|vtsax)/i, /(fidelity|fxaix|fzrox|fskax)/i, /(expense|er|fee|tax)/i],
      wantsReddit: true },
    { id: 'roth-vs-trad',     prompt: 'roth ira vs traditional ira reddit explanation',
      mustHit: [/roth/i, /(traditional|trad)/i, /(tax|bracket|withdraw|contribution|deductible)/i],
      wantsReddit: true },
    { id: 'recession-2026',   prompt: 'current state of us recession risk 2026',
      mustHit: [/(recession|economy|gdp|fed|inflation)/i, /(yield|curve|labor|unemployment|cpi|outlook)/i],
      wantsReddit: false },
  ],
  // Adversarial — these specifically stress topic-carryover, disambiguation,
  // and synthesis across mixed-quality sources. Each prompt is meant to be
  // hard to answer well without genuine cross-source reasoning.
  'adversarial': [
    { id: 'pun-name',         prompt: 'who is mercury (the band, not the planet or element)',
      mustHit: [/(freddie|queen|brian\s*may|roger\s*taylor|john\s*deacon)/i],
      antiHit: [/planet|element|chemistry|mythology|messenger/i], wantsReddit: false },
    { id: 'time-bounded',     prompt: 'what is the most recent winner of f1 world championship as of 2025',
      mustHit: [/(verstappen|norris|piastri|hamilton|leclerc|russell)/i, /(2024|2025|champion|title)/i],
      wantsReddit: false },
    { id: 'compare-niche',    prompt: 'compare obsidian and logseq for daily journaling reddit opinion',
      mustHit: [/obsidian/i, /logseq/i, /(daily\s*note|journal|graph|backlink|plugin|workflow)/i],
      wantsReddit: true },
    { id: 'community-slang',  prompt: 'what does cope mean in gaming reddit context',
      mustHit: [/cope/i, /(deal|salt|deni|emotion|loss|community)/i], wantsReddit: true },
  ],
};

const SMELLS = [
  /I couldn't find a strong match/i,
  /cookie preferences/i,
  /^From Wikipedia, the free encyclopedia/m,
];

function args() {
  const a = { suite: 'medium', out: null, shuffle: false, limit: 0, delayMs: 3500 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--suite') { a.suite = v; i++; }
    else if (k === '--out') { a.out = v; i++; }
    else if (k === '--shuffle') { a.shuffle = true; }
    else if (k === '--limit') { a.limit = parseInt(v, 10) || 0; i++; }
    else if (k === '--delay') { a.delayMs = parseInt(v, 10) || 0; i++; }
  }
  if (!a.out) a.out = `_bench_research_${a.suite.replace(/[:\/]/g, '_')}.json`;
  return a;
}

async function newConversation() {
  const r = await fetch(`${REST}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'bench-research', modelId: 'vai:v0' }),
  });
  if (!r.ok) throw new Error(`conv create ${r.status}`);
  return (await r.json()).id;
}

function askChat(conversationId, prompt, timeoutMs = 25_000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let text = '';
    let sources = [];
    let confidence = null;
    let done = false;
    const t0 = Date.now();
    const timer = setTimeout(() => { try { ws.close(); } catch {} ; finish('timeout'); }, timeoutMs);
    function finish(reason) {
      if (done) return; done = true;
      clearTimeout(timer);
      resolve({ text, sources, confidence, wallMs: Date.now() - t0, reason });
    }
    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content: prompt })));
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type === 'text_delta' && m.textDelta) text += m.textDelta;
      else if (m.type === 'token' && m.token) text += m.token;
      else if (m.type === 'sources') {
        if (Array.isArray(m.sources)) sources = m.sources;
        if (typeof m.confidence === 'number') confidence = m.confidence;
      }
      else if (m.type === 'done') { try { ws.close(); } catch {} ; finish('done'); }
      else if (m.type === 'error') { try { ws.close(); } catch {} ; finish('error:' + (m.error || '?')); }
    });
    ws.on('close', () => finish('close'));
    ws.on('error', (e) => { console.error('  ws err:', e.message); finish('wserror:' + e.message); });
  });
}

function scoreCase(c, r) {
  const out = { id: c.id, prompt: c.prompt, wallMs: r.wallMs, reason: r.reason,
    sourceCount: r.sources.length, domains: [], hasRedditBody: false,
    smells: [], mustHit: [], antiHit: [], wantedReddit: !!c.wantsReddit, hasReddit: false,
    wordCount: 0, confidence: r.confidence ?? null, score: 0, notes: [], textPreview: '' };
  const domains = new Set();
  for (const s of r.sources) {
    if (s.domain) domains.add(s.domain);
    if (typeof s.snippet === 'string' && /Top reply:/i.test(s.snippet)) out.hasRedditBody = true;
    if (s.domain === 'reddit.com') out.hasReddit = true;
  }
  out.domains = Array.from(domains);
  out.wordCount = (r.text.trim().match(/\S+/g) ?? []).length;
  out.textPreview = r.text.slice(0, 280);

  // Smells
  for (const pat of SMELLS) if (pat.test(r.text)) out.smells.push(pat.toString());
  // Must hits — array of regexes
  for (const pat of (c.mustHit ?? [])) {
    const ok = pat.test(r.text) || r.sources.some(s => pat.test(s.snippet ?? '') || pat.test(s.title ?? ''));
    out.mustHit.push({ pat: pat.toString(), ok });
  }
  // Anti hits — penalize if matched
  for (const pat of (c.antiHit ?? [])) {
    const bad = pat.test(r.text);
    out.antiHit.push({ pat: pat.toString(), bad });
  }

  // Scoring (0–100)
  let s = 0;
  const must = out.mustHit;
  if (must.length) s += 50 * (must.filter(m => m.ok).length / must.length);
  if (out.sourceCount >= 4) s += 10; else if (out.sourceCount >= 2) s += 5;
  if (out.domains.length >= 2) s += 5;
  if (c.wantsReddit && out.hasReddit) s += 10;
  if (c.wantsReddit && out.hasRedditBody) s += 5;
  if (!c.wantsReddit && out.sourceCount > 0) s += 5;
  if (out.wordCount >= 80) s += 10; else if (out.wordCount >= 40) s += 5;
  if (out.smells.length) s -= 15 * out.smells.length;
  for (const a of out.antiHit) if (a.bad) s -= 20;
  if (r.reason === 'timeout') s -= 30;
  out.score = Math.max(0, Math.min(100, Math.round(s)));
  if (c.wantsReddit && !out.hasReddit) out.notes.push('expected reddit but none surfaced');
  if (out.antiHit.some(a => a.bad)) out.notes.push('matched antiHit (wrong topic)');
  return out;
}

async function main() {
  const a = args();
  // Special suite "all" = aggregate every suite as one mixed run
  // Special suite "mixed" = random sample across every suite
  let cases;
  if (a.suite === 'all') {
    cases = Object.entries(SUITES).flatMap(([s, list]) => list.map((c) => ({ ...c, _suite: s })));
  } else if (a.suite === 'mixed') {
    const flat = Object.entries(SUITES).flatMap(([s, list]) => list.map((c) => ({ ...c, _suite: s })));
    // random sample of 8
    cases = flat.sort(() => Math.random() - 0.5).slice(0, 8);
  } else {
    cases = SUITES[a.suite];
  }
  if (!cases) {
    console.error('Unknown suite:', a.suite, 'available:', Object.keys(SUITES).join(', '), '(plus "all", "mixed")');
    process.exit(1);
  }
  if (a.shuffle) cases = [...cases].sort(() => Math.random() - 0.5);
  if (a.limit > 0) cases = cases.slice(0, a.limit);
  console.log(`Running suite "${a.suite}" (${cases.length} cases) → ${a.out}`);
  const results = [];
  for (const c of cases) {
    const tag = c._suite ? `${c._suite}/${c.id}` : c.id;
    process.stdout.write(`  · ${tag} … `);
    let res;
    try {
      const convId = await newConversation();
      res = await askChat(convId, c.prompt);
    } catch (e) {
      res = { text: '', sources: [], confidence: null, wallMs: 0, reason: 'exc:' + e.message };
    }
    const scored = scoreCase(c, res);
    if (c._suite) scored.suite = c._suite;
    results.push(scored);
    console.log(`score=${scored.score}  src=${scored.sourceCount}  reddit=${scored.hasReddit}  body=${scored.hasRedditBody}  words=${scored.wordCount}  ${scored.wallMs}ms`);
    if (a.delayMs > 0) await new Promise((r) => setTimeout(r, a.delayMs));
  }
  const summary = {
    suite: a.suite, at: new Date().toISOString(),
    avgScore: Math.round(results.reduce((a, r) => a + r.score, 0) / results.length),
    redditCoverage: Math.round(100 * results.filter(r => r.wantedReddit && r.hasReddit).length /
                                 Math.max(1, results.filter(r => r.wantedReddit).length)),
    bodyCoverage: Math.round(100 * results.filter(r => r.hasRedditBody).length / results.length),
    avgSources: +(results.reduce((a, r) => a + r.sourceCount, 0) / results.length).toFixed(2),
    cases: results,
  };
  // Per-suite breakdown if this was a multi-suite run
  if (a.suite === 'all' || a.suite === 'mixed') {
    const bySuite = {};
    for (const r of results) {
      const s = r.suite ?? 'unknown';
      bySuite[s] ??= { n: 0, score: 0, src: 0, reddit: 0, body: 0, wantedReddit: 0 };
      bySuite[s].n++;
      bySuite[s].score += r.score;
      bySuite[s].src += r.sourceCount;
      if (r.wantedReddit) bySuite[s].wantedReddit++;
      if (r.wantedReddit && r.hasReddit) bySuite[s].reddit++;
      if (r.hasRedditBody) bySuite[s].body++;
    }
    summary.bySuite = Object.fromEntries(Object.entries(bySuite).map(([s, b]) => [s, {
      n: b.n,
      avgScore: Math.round(b.score / b.n),
      avgSources: +(b.src / b.n).toFixed(2),
      redditCov: b.wantedReddit ? Math.round(100 * b.reddit / b.wantedReddit) : 0,
      bodyCov: Math.round(100 * b.body / b.n),
    }]));
  }
  await writeFile(a.out, JSON.stringify(summary, null, 2));
  console.log(`\n→ avgScore=${summary.avgScore}  redditCov=${summary.redditCoverage}%  bodyCov=${summary.bodyCoverage}%  avgSources=${summary.avgSources}`);
  if (summary.bySuite) {
    console.log('Per-suite:');
    for (const [s, b] of Object.entries(summary.bySuite)) {
      console.log(`  ${s.padEnd(20)} n=${b.n}  score=${b.avgScore}  src=${b.avgSources}  reddit=${b.redditCov}%  body=${b.bodyCov}%`);
    }
  }
  console.log(`Saved: ${a.out}`);
}

main().catch(e => { console.error(e); process.exit(2); });
