/**
 * Vai quality scoreboard.
 *
 * Reads a wave-run JSONL (from either the live WS bench or the in-process scale
 * runner) and produces comparable per-capability scores plus one overall score.
 * The mapping from corpus `kind` → capability is fixed here so scores are
 * directly comparable run-to-run and transport-to-transport.
 */

import fs from 'node:fs';
import path from 'node:path';

// Fixed capability weights. Only capabilities actually present in a run
// contribute; weights are renormalized over the present set so partial runs
// (e.g. a code-only scripted wave) still produce a meaningful overall score.
export const CAPABILITY_WEIGHTS = {
  search: 0.25,
  code: 0.2,
  build: 0.2,
  reasoning: 0.15,
  safety: 0.15,
  multiconstraint: 0.1,
  format: 0.1,
  memory: 0.05,
  conversation: 0.05,
};

export function capabilityOf(row) {
  const kind = String(row.kind || '');
  if (row.mode === 'builder' || kind.includes('builder')) return 'build';
  if (kind.startsWith('regression-')) return 'regression';
  switch (kind) {
    case 'coding':
      return 'code';
    case 'safety':
      return 'safety';
    case 'format':
      return 'format';
    case 'memory':
      return 'memory';
    case 'reasoning':
      return 'reasoning';
    case 'multiconstraint':
      return 'multiconstraint';
    case 'casual':
      return 'conversation';
    case 'scripted':
      return 'scripted';
    case 'knowledge':
    case 'current':
    case 'multi':
    case 'constraint':
    case 'debug':
      return 'search';
    default:
      return 'other';
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Map a mean latency (ms) to a 0–100 score: ≤2s = 100, ≥30s = 0, linear between. */
export function latencyScore(meanMs) {
  if (!Number.isFinite(meanMs)) return 0;
  const lo = 2000;
  const hi = 30000;
  if (meanMs <= lo) return 100;
  if (meanMs >= hi) return 0;
  return Math.round((1 - (meanMs - lo) / (hi - lo)) * 100);
}

/** Pure: compute a scoreboard from an array of result rows. */
export function computeScoreboard(rows) {
  const caps = {};
  const latencies = [];
  for (const row of rows) {
    if (!Array.isArray(row.tags)) continue;
    const cap = capabilityOf(row);
    const pass = row.tags.length === 1 && row.tags[0] === 'ok';
    const entry = (caps[cap] ||= { total: 0, pass: 0, ms: [] });
    entry.total += 1;
    if (pass) entry.pass += 1;
    if (Number.isFinite(row.ms)) {
      entry.ms.push(row.ms);
      latencies.push(row.ms);
    }
  }

  const capabilities = {};
  for (const [cap, entry] of Object.entries(caps)) {
    const sorted = entry.ms.slice().sort((a, b) => a - b);
    const meanMs = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
    capabilities[cap] = {
      score: entry.total ? Number(((entry.pass / entry.total) * 100).toFixed(2)) : 0,
      pass: entry.pass,
      total: entry.total,
      meanMs: Math.round(meanMs),
      p95Ms: Math.round(percentile(sorted, 95)),
    };
  }

  let weightSum = 0;
  let weighted = 0;
  for (const [cap, weight] of Object.entries(CAPABILITY_WEIGHTS)) {
    if (capabilities[cap]) {
      weightSum += weight;
      weighted += weight * capabilities[cap].score;
    }
  }
  // Fall back to an unweighted mean when a run contains only capabilities
  // outside the fixed weight table (e.g. scripted/regression/other runs), so
  // the overall score stays meaningful instead of collapsing to zero.
  const present = Object.values(capabilities);
  const qualityScore = weightSum
    ? Number((weighted / weightSum).toFixed(2))
    : present.length
      ? Number((present.reduce((s, c) => s + c.score, 0) / present.length).toFixed(2))
      : 0;
  const sortedAll = latencies.slice().sort((a, b) => a - b);
  const meanAll = sortedAll.length ? sortedAll.reduce((s, v) => s + v, 0) / sortedAll.length : 0;
  const latScore = latencyScore(meanAll);

  return {
    qualityScore,
    latencyScore: latScore,
    overallScore: Number((qualityScore * 0.85 + latScore * 0.15).toFixed(2)),
    latency: { meanMs: Math.round(meanAll), p95Ms: Math.round(percentile(sortedAll, 95)), maxMs: sortedAll.length ? sortedAll[sortedAll.length - 1] : 0 },
    capabilities,
  };
}

function renderMarkdown(scoreboard) {
  const lines = [];
  lines.push('# Vai capability scoreboard');
  lines.push('');
  lines.push(`**Overall: ${scoreboard.overallScore}** (quality ${scoreboard.qualityScore}, latency ${scoreboard.latencyScore})`);
  lines.push('');
  lines.push('| Capability | Score | Pass/Total | Mean ms | p95 ms |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const [cap, c] of Object.entries(scoreboard.capabilities).sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`| ${cap} | ${c.score} | ${c.pass}/${c.total} | ${c.meanMs} | ${c.p95Ms} |`);
  }
  return lines.join('\n') + '\n';
}

export function readJsonl(jsonlPath) {
  const raw = fs.readFileSync(jsonlPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Read a JSONL run, score it, write scoreboard.json + .md next to it, print a table. */
export async function scoreRun({ jsonlPath, out }) {
  const rows = readJsonl(jsonlPath);
  const scoreboard = computeScoreboard(rows);
  const base = out || jsonlPath.replace(/\.jsonl$/, '');
  fs.writeFileSync(`${base}.scoreboard.json`, JSON.stringify(scoreboard, null, 2));
  fs.writeFileSync(`${base}.scoreboard.md`, renderMarkdown(scoreboard));
  console.log('\n' + renderMarkdown(scoreboard).trimEnd());
  console.log(`\nScoreboard: ${path.resolve(`${base}.scoreboard.json`)}`);
  return scoreboard;
}
