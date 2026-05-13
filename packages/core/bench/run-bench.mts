/**
 * Vai bench harness — validate → iterate → test loop.
 *
 * Loads a JSONL corpus of {id, category, q, mustMatch[]} rows, runs each
 * through the rule-based VaiEngine, and scores deterministically:
 *
 *   - PASS:    no fallback, no low-quality wikipedia disambig phrasing,
 *              length >= MIN_LEN, AND every mustMatch regex matches.
 *   - SOFT:    no fallback/lowq, length OK, but at least one mustMatch
 *              missed (curated answer exists but lacks expected keywords).
 *   - LOWQ:    answer matches a known low-quality wikipedia disambig
 *              pattern (raw scrape leaked through).
 *   - FALLBACK: honest-gap fallback fired (no curated coverage at all).
 *   - SHORT:   answer is shorter than MIN_LEN chars (likely a stub).
 *
 * Writes a structured JSON report and a markdown summary so we can grep
 * for the worst categories and patch curated entries in the next round.
 *
 * Usage:
 *   pnpm bench                       # frontier corpus, default
 *   pnpm bench -- --corpus=golden    # different corpus
 *   pnpm bench -- --max=20           # smoke test
 *
 * Exit code is 0 if no FALLBACK rows are present (regression gate).
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Row = { id: string; category: string; q: string; mustMatch: string[] };
type Verdict = 'PASS' | 'SOFT' | 'LOWQ' | 'FALLBACK' | 'SHORT';
type Result = {
  id: string;
  category: string;
  q: string;
  verdict: Verdict;
  ms: number;
  len: number;
  missedKeys: string[];
  preview: string;
};

const MIN_LEN = 200;

const FALLBACK_PATTERNS = [
  /isn['']t in my knowledge yet/i,
  /isn['']t somewhere i can speak with confidence/i,
  /real gap in what i hold/i,
  /don['']t have \*\*[^*]+\*\* locally yet/i,
  /empty pocket on/i,
  /i don['']t yet hold/i,
  /i can't reach.*from here/i,
  /could you (?:share|tell|give|paste|drop|point)/i,
  /one link or sentence/i,
  /happy to dig/i,
  /want me to (?:help|point)/i,
  /i don['']t know about/i,
  /what vai can do right now/i,
];

const LOWQ_PATTERNS = [
  /additional citations/i,
  /page needed/i,
  /\bsee[ \w()]*disambiguation\)/i,
  /this article needs/i,
  /\[citation needed\]/i,
  /please help improve/i,
  /article (?:contains|may|relies)/i,
  /\bredirect[s]?\s+(?:here|to)\b/i,
  /\bnot to be confused with\b/i,
  /\bfor (?:other|the|ships|disambiguation)/i,
  /from wikipedia, the free encyclopedia/i,
  /\[\d+\]\s+\*\*sources\*\*/i,
];

function parseArgs(): { corpus: string; max: number } {
  const args = process.argv.slice(2);
  let corpus = 'frontier';
  let max = Infinity;
  for (const a of args) {
    if (a.startsWith('--corpus=')) corpus = a.slice('--corpus='.length);
    else if (a.startsWith('--max=')) max = Number(a.slice('--max='.length));
  }
  return { corpus, max };
}

function loadCorpus(name: string, here: string): Row[] {
  const path = join(here, 'corpus', `${name}.jsonl`);
  const raw = readFileSync(path, 'utf8');
  const rows: Row[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function classify(answer: string, mustMatch: string[]): { verdict: Verdict; missedKeys: string[] } {
  for (const p of FALLBACK_PATTERNS) if (p.test(answer)) return { verdict: 'FALLBACK', missedKeys: [] };
  for (const p of LOWQ_PATTERNS) if (p.test(answer)) return { verdict: 'LOWQ', missedKeys: [] };
  if (answer.length < MIN_LEN) return { verdict: 'SHORT', missedKeys: [] };
  const missed: string[] = [];
  for (const k of mustMatch) {
    if (!new RegExp(k, 'i').test(answer)) missed.push(k);
  }
  return missed.length === 0
    ? { verdict: 'PASS', missedKeys: [] }
    : { verdict: 'SOFT', missedKeys: missed };
}

async function run(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const { corpus, max } = parseArgs();
  const rows = loadCorpus(corpus, here).slice(0, max);

  const engine = new VaiEngine();
  // freeze "now" so date-sensitive answers are reproducible
  (engine as unknown as { _nowMs: () => number })._nowMs = () =>
    new Date('2026-05-13T10:00:00Z').getTime();

  // disable network so wikipedia/scrape paths can't accidentally PASS a row
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError('fetch disabled in bench');
  }) as typeof fetch;

  const results: Result[] = [];
  const t0 = performance.now();
  for (const row of rows) {
    const start = performance.now();
    let answer = '';
    try {
      const r = await engine.chat({
        messages: [{ role: 'user', content: row.q }],
        temperature: 0,
        maxTokens: 220,
        noLearn: true,
      } as never);
      answer = r.message.content;
    } catch (err) {
      answer = `__ERROR__ ${(err as Error).message}`;
    }
    const ms = Math.round(performance.now() - start);
    const { verdict, missedKeys } = classify(answer, row.mustMatch);
    results.push({
      id: row.id,
      category: row.category,
      q: row.q,
      verdict,
      ms,
      len: answer.length,
      missedKeys,
      preview: answer.slice(0, 240).replace(/\s+/g, ' '),
    });
  }
  const totalMs = Math.round(performance.now() - t0);
  globalThis.fetch = originalFetch;

  // tally
  const tally = { PASS: 0, SOFT: 0, LOWQ: 0, FALLBACK: 0, SHORT: 0 } as Record<Verdict, number>;
  const byCat: Record<string, Record<Verdict, number>> = {};
  for (const r of results) {
    tally[r.verdict]++;
    byCat[r.category] ??= { PASS: 0, SOFT: 0, LOWQ: 0, FALLBACK: 0, SHORT: 0 };
    byCat[r.category][r.verdict]++;
  }

  // diff against previous latest (if present)
  const reportDir = join(here, 'reports');
  mkdirSync(reportDir, { recursive: true });
  let prevTally: typeof tally | null = null;
  try {
    const prev = readdirSync(reportDir)
      .filter((f) => f.startsWith(`${corpus}-`) && f.endsWith('.json'))
      .sort()
      .at(-1);
    if (prev) {
      const prevReport = JSON.parse(readFileSync(join(reportDir, prev), 'utf8'));
      prevTally = prevReport.tally;
    }
  } catch {
    /* no prior */
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(reportDir, `${corpus}-${stamp}.json`);
  const mdPath = join(reportDir, `${corpus}-latest.md`);
  writeFileSync(
    jsonPath,
    JSON.stringify({ corpus, stamp, totalMs, tally, byCat, results }, null, 2),
  );

  // markdown summary
  const lines: string[] = [];
  lines.push(`# Vai bench — ${corpus}`);
  lines.push('');
  lines.push(`- Run: ${stamp}`);
  lines.push(`- Total: ${results.length} rows in ${totalMs}ms (avg ${Math.round(totalMs / Math.max(1, results.length))}ms/row)`);
  lines.push('');
  lines.push('## Tally');
  lines.push('');
  lines.push('| Verdict | Count | Δ vs prev |');
  lines.push('|---|---:|---:|');
  for (const v of ['PASS', 'SOFT', 'LOWQ', 'FALLBACK', 'SHORT'] as Verdict[]) {
    const delta = prevTally ? tally[v] - prevTally[v] : 0;
    const sign = delta === 0 ? '0' : delta > 0 ? `+${delta}` : `${delta}`;
    lines.push(`| ${v} | ${tally[v]} | ${prevTally ? sign : '—'} |`);
  }
  lines.push('');
  lines.push('## By category');
  lines.push('');
  lines.push('| Category | PASS | SOFT | LOWQ | FALLBACK | SHORT |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const cat of Object.keys(byCat).sort()) {
    const t = byCat[cat];
    lines.push(`| ${cat} | ${t.PASS} | ${t.SOFT} | ${t.LOWQ} | ${t.FALLBACK} | ${t.SHORT} |`);
  }
  lines.push('');
  const failures = results.filter((r) => r.verdict !== 'PASS');
  if (failures.length) {
    lines.push(`## Failures (${failures.length})`);
    lines.push('');
    for (const r of failures) {
      lines.push(`### \`${r.id}\` [${r.verdict}] · ${r.category} · ${r.ms}ms · ${r.len}ch`);
      lines.push(`> Q: ${r.q}`);
      if (r.missedKeys.length) lines.push(`> Missed keys: \`${r.missedKeys.join('` · `')}\``);
      lines.push(`> A: ${r.preview}${r.preview.length >= 240 ? '…' : ''}`);
      lines.push('');
    }
  }
  writeFileSync(mdPath, lines.join('\n'));

  // console summary
  console.log(`Bench [${corpus}] · ${results.length} rows · ${totalMs}ms`);
  console.log(
    `  PASS=${tally.PASS} SOFT=${tally.SOFT} LOWQ=${tally.LOWQ} FALLBACK=${tally.FALLBACK} SHORT=${tally.SHORT}`,
  );
  console.log(`  Report: ${mdPath}`);
  console.log(`  JSON:   ${jsonPath}`);

  // gate: any FALLBACK is a regression
  if (tally.FALLBACK > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
