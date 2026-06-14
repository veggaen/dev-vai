#!/usr/bin/env node
/**
 * Offline scenario-matrix scorecard for the council cross-check — OLD vs NEW.
 *
 * Runs the deterministic grounding logic against a labeled scenario matrix (no network, no
 * Ollama) and reports, per engine, how often each scenario produced the CORRECT verdict.
 * Fuzz: every scenario is run N times with snippet order shuffled and decoy numbers injected,
 * so the result is dynamic, not a single fixed fixture.
 *
 * The NEW engine is imported from the compiled/TS source. The OLD engine is reproduced inline
 * (the pre-rearchitecture "first number within 5% anywhere" logic) so we can score both on the
 * exact same inputs without juggling git worktrees.
 *
 * Usage: node scripts/crosscheck-scorecard.mjs [--runs 50]
 * Gate:  NEW must have a strictly lower false-confirm rate and no regression on correct-confirm.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Allow importing the .ts source directly via tsx's loader if available; else expect built dist.
let assessNew, extractNew, resolveIntentNew;
try {
  register('tsx/esm', pathToFileURL('./'));
} catch { /* tsx not registered; will try dist */ }
try {
  ({ assessClaimAgreement: assessNew, extractCheckableClaim: extractNew } =
    await import('../packages/core/src/consensus/cross-check.ts'));
  ({ resolveIntent: resolveIntentNew } = await import('../packages/core/src/consensus/intent-resolver.ts'));
} catch (e) {
  console.error('Could not import NEW cross-check from TS source. Run with: npx tsx scripts/crosscheck-scorecard.mjs');
  console.error(e.message);
  process.exit(1);
}

// ── OLD engine (pre-rearchitecture): confirm if ANY number anywhere is within 5% ──
const NUMBER_RE = /(?:[$€£]\s?)?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?:[$€£]\s?)?\d+(?:\.\d+)?/g;
function parseNum(t) { const n = Number(t.replace(/[$€£,\s]/g, '')); return Number.isFinite(n) ? n : null; }
function oldAssess(claimNumeric, search) {
  const haystack = [search.answer, ...search.sources.slice(0, 5).map((s) => `${s.title} ${s.text}`)].join(' \n ');
  const nums = (haystack.match(NUMBER_RE) ?? []).map(parseNum).filter((n) => n !== null && n > 0);
  if (nums.length === 0) return { verified: false, contradicted: false };
  const match = nums.find((n) => Math.abs(n - claimNumeric) <= Math.abs(claimNumeric) * 0.05);
  if (match !== undefined) return { verified: true, contradicted: false };
  const comparable = nums.some((n) => n >= claimNumeric * 0.5 && n <= claimNumeric * 2);
  return { verified: false, contradicted: comparable };
}

// ── Scenario matrix. expected: 'confirm' | 'contradict' | 'inconclusive' ──
const SCENARIOS = [
  {
    name: 'fabricated ETH price, lone forum decoy (THE LIVE FAILURE)',
    prompt: 'what is the price of eth', draft: 'The price of ETH is $3,200.00 USD.',
    answer: 'Ethereum is trading around $1,680 today.',
    snippets: ['CoinMarketCap: Ethereum price $1,674 USD', 'Binance ETH/USD $1,682 USD', 'r/Flipping: sold my couch for $3,200'],
    expected: 'contradict',
  },
  {
    name: 'correct ETH price, corroborated cluster',
    prompt: 'what is the price of eth', draft: 'ETH is about $1,680.',
    answer: 'Ethereum is trading around $1,680 today.',
    snippets: ['CoinMarketCap: Ethereum price $1,674 USD', 'Binance ETH/USD $1,682 USD', 'Coinbase ether $1,679'],
    expected: 'confirm',
  },
  {
    name: 'correct price but only ONE anchored source',
    prompt: 'what is the price of eth', draft: 'ETH is about $1,680.',
    answer: 'A general page about crypto.',
    snippets: ['CoinMarketCap: Ethereum price $1,674 USD', 'A blog about pasta recipes'],
    expected: 'inconclusive',
  },
  {
    name: 'off-subject numbers that coincidentally match',
    prompt: 'what is the price of eth', draft: 'ETH is about $1,680.',
    answer: 'No price here.',
    snippets: ['Used car priced at $1,680', 'Laptop on sale $1,679'],
    expected: 'inconclusive',
  },
  {
    name: 'forum-noise page, no real price',
    prompt: 'what is the price of btc', draft: 'BTC is $63,000.',
    answer: 'Reddit discussion thread.',
    snippets: ['I have 5 BTC and 12 comments', 'posted 2 years ago, 6 upvotes'],
    expected: 'inconclusive',
  },
  {
    name: 'real contradiction (draft wrong, cluster says otherwise)',
    prompt: 'what is the price of btc', draft: 'BTC is $48,000.',
    answer: 'Bitcoin is around $63,000.',
    snippets: ['CoinMarketCap: Bitcoin $63,100 USD', 'Binance BTC/USD $62,900 USD', 'Coinbase bitcoin $63,050'],
    expected: 'contradict',
  },
];

const RUNS = (() => { const i = process.argv.indexOf('--runs'); return i >= 0 ? Number(process.argv[i + 1]) : 50; })();

function shuffle(arr, seed) { // deterministic-ish shuffle per run
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor((Math.sin(seed * 9301 + i * 49297) * 0.5 + 0.5) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const DECOYS = ['(2024)', 'rated 4.5/5', 'over 100 comments', '$0.00 fees', 'page 3 of 12'];

function makeSearch(answer, snippets) {
  return {
    answer,
    sources: snippets.map((text, i) => ({ text, url: `https://ex${i}.com`, domain: `ex${i}.com`, title: `Source ${i}`, favicon: '', trust: { tier: 'reputable', score: 0.8, signals: [] }, rank: i })),
    plan: { originalQuery: 'q', intent: '', entities: [], constraints: {}, fanOutQueries: [] },
    rawResultCount: snippets.length, confidence: 0.9, durationMs: 100, sync: 'linear', audit: [],
  };
}

function verdictOf(a) { return a.verified ? 'confirm' : a.contradicted ? 'contradict' : 'inconclusive'; }
function isFalseConfirm(verdict, expected) { return verdict === 'confirm' && expected !== 'confirm'; }

const tally = {
  old: { correct: 0, falseConfirm: 0, total: 0 },
  new: { correct: 0, falseConfirm: 0, total: 0 },
};
const perScenario = [];

for (const sc of SCENARIOS) {
  const row = { name: sc.name, expected: sc.expected, old: { correct: 0, fc: 0 }, new: { correct: 0, fc: 0 } };
  const claimNum = parseNum((sc.draft.match(NUMBER_RE) ?? []).find((t) => /[$€£,]/.test(t)) ?? '0');
  for (let r = 0; r < RUNS; r++) {
    const snips = shuffle(sc.snippets, r).map((s, i) => (r % 3 === 1 ? `${s} ${DECOYS[(i + r) % DECOYS.length]}` : s));
    const search = makeSearch(sc.answer, snips);

    // NEW
    const intent = resolveIntentNew(sc.prompt, sc.draft, false);
    const claim = extractNew(sc.prompt, sc.draft, intent);
    const newA = claim ? assessNew(claim, search, sc.prompt, intent) : { verified: false, contradicted: false };
    const newV = verdictOf(newA);
    if (newV === sc.expected) { row.new.correct++; tally.new.correct++; }
    if (isFalseConfirm(newV, sc.expected)) { row.new.fc++; tally.new.falseConfirm++; }
    tally.new.total++;

    // OLD
    const oldA = oldAssess(claimNum, search);
    const oldV = verdictOf(oldA);
    if (oldV === sc.expected) { row.old.correct++; tally.old.correct++; }
    if (isFalseConfirm(oldV, sc.expected)) { row.old.fc++; tally.old.falseConfirm++; }
    tally.old.total++;
  }
  perScenario.push(row);
}

const pct = (n, d) => `${((n / d) * 100).toFixed(0)}%`;
console.log(`\n=== CROSS-CHECK SCORECARD (${RUNS} fuzzed runs/scenario) ===\n`);
console.log('scenario'.padEnd(54), 'expected'.padEnd(13), 'OLD ok  fc  ', 'NEW ok  fc');
for (const r of perScenario) {
  console.log(
    r.name.slice(0, 53).padEnd(54),
    r.expected.padEnd(13),
    `${pct(r.old.correct, RUNS).padStart(4)} ${pct(r.old.fc, RUNS).padStart(4)}  `,
    `${pct(r.new.correct, RUNS).padStart(4)} ${pct(r.new.fc, RUNS).padStart(4)}`,
  );
}
console.log('\n--- TOTALS ---');
console.log(`OLD  correct=${pct(tally.old.correct, tally.old.total)}  false-confirm=${pct(tally.old.falseConfirm, tally.old.total)}`);
console.log(`NEW  correct=${pct(tally.new.correct, tally.new.total)}  false-confirm=${pct(tally.new.falseConfirm, tally.new.total)}`);

const fcDown = tally.new.falseConfirm < tally.old.falseConfirm;
const correctUp = tally.new.correct >= tally.old.correct;
const netPositive = fcDown && correctUp;
console.log(`\nGATE: false-confirm ${fcDown ? 'DOWN ✓' : 'NOT down ✗'} | correct ${correctUp ? 'maintained/up ✓' : 'regressed ✗'} → ${netPositive ? 'NET POSITIVE ✓ (merge OK)' : 'NOT net-positive ✗ (do not merge)'}`);
process.exit(netPositive ? 0 : 1);
