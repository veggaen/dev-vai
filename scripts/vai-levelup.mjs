#!/usr/bin/env node
/**
 * vai-levelup.mjs — Run Vai's self-improvement cycle from the CLI.
 *
 * Usage:
 *   node scripts/vai-levelup.mjs              # Full self-improvement report
 *   node scripts/vai-levelup.mjs --quick      # Quick health check only
 *   node scripts/vai-levelup.mjs --json       # Output raw JSON
 *
 * Requires the runtime server running on port 3006.
 */

const BASE = process.env.VAI_URL ?? 'http://localhost:3006';
const args = process.argv.slice(2);
const quickMode = args.includes('--quick');
const jsonMode = args.includes('--json');

/* ── Pretty Formatting Helpers ────────────────────────────────── */

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;
const bar = (ratio, width = 30) => {
  const filled = Math.round(ratio * width);
  return c('green', '█'.repeat(filled)) + c('dim', '░'.repeat(width - filled));
};

const gradeColor = (grade) => {
  if (grade === 'A') return 'green';
  if (grade === 'B') return 'cyan';
  if (grade === 'C') return 'yellow';
  return 'red';
};

const syncColor = (state) => {
  if (state === 'wormhole') return 'magenta';
  if (state === 'parallel') return 'cyan';
  return 'yellow';
};

function severityIcon(sev) {
  if (sev === 'critical') return c('red', '●');
  if (sev === 'important') return c('yellow', '◐');
  return c('dim', '○');
}

/* ── Quick Mode ───────────────────────────────────────────────── */

async function runQuick() {
  console.log(c('cyan', '\n⚡ Vai Quick Health Check\n'));

  const res = await fetch(`${BASE}/api/thorsen/health`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();

  if (jsonMode) { console.log(JSON.stringify(data, null, 2)); return; }

  console.log(`  Grade:        ${c(gradeColor(data.grade), data.grade)}`);
  console.log(`  Templates:    ${c('white', data.templates)}`);
  console.log(`  Avg Score:    ${bar(data.avgScore)} ${(data.avgScore * 100).toFixed(0)}%`);
  console.log(`  Wormhole:     ${bar(data.wormholeRate / 100)} ${data.wormholeRate}%`);
  console.log(`  Success:      ${bar(data.successRate / 100)} ${data.successRate}%`);
  console.log(`  Gaps:         ${data.gaps > 0 ? c('yellow', data.gaps) : c('green', '0')}`);
  console.log(`  Suggestions:  ${data.suggestions > 0 ? c('yellow', data.suggestions) : c('green', '0')}\n`);
}

/* ── Full Mode ────────────────────────────────────────────────── */

async function runFull() {
  console.log(c('magenta', '\n╔══════════════════════════════════════════════════╗'));
  console.log(c('magenta', '║') + c('bold', '  🧬  VAI SELF-IMPROVEMENT CYCLE                  ') + c('magenta', '║'));
  console.log(c('magenta', '║') + c('dim', '  Benchmarking all templates through pipeline...   ') + c('magenta', '║'));
  console.log(c('magenta', '╚══════════════════════════════════════════════════╝\n'));

  const start = Date.now();

  const res = await fetch(`${BASE}/api/thorsen/self-improve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Server error ${res.status}: ${body}`);
  }

  const report = await res.json();
  const totalTime = Date.now() - start;

  if (jsonMode) { console.log(JSON.stringify(report, null, 2)); return; }

  // ── Header ──
  console.log(c('bold', `  Grade: `) + c(gradeColor(report.grade), `  ${report.grade}  `) + c('dim', `  (${report.totalTemplates} templates, ${report.benchmarkDurationMs.toFixed(0)}ms benchmark)\n`));

  // ── Stats ──
  console.log(c('bold', '  📊 Aggregate Stats'));
  console.log(`  ├─ Avg Score:      ${bar(report.stats.avgScore)} ${(report.stats.avgScore * 100).toFixed(1)}%`);
  console.log(`  ├─ Avg Latency:    ${c('white', report.stats.avgLatencyMs.toFixed(1) + 'ms')}`);
  console.log(`  ├─ Wormhole Rate:  ${bar(report.stats.wormholeRate)} ${(report.stats.wormholeRate * 100).toFixed(0)}%`);
  console.log(`  ├─ Verified Rate:  ${bar(report.stats.verifiedRate)} ${(report.stats.verifiedRate * 100).toFixed(0)}%`);
  console.log(`  ├─ Success Rate:   ${bar(report.stats.successRate)} ${(report.stats.successRate * 100).toFixed(0)}%`);
  console.log(`  └─ Total Code:     ${c('white', report.stats.totalCodeLines)} lines generated\n`);

  // ── Template Results ──
  console.log(c('bold', '  🔬 Template Benchmark Results'));
  console.log(c('dim', '  ──────────────────────────────────────────────────────────────'));

  for (const r of report.results) {
    const status = r.success ? c('green', '✓') : c('red', '✗');
    const score = r.success ? c(r.thorsenScore >= 0.95 ? 'green' : r.thorsenScore >= 0.9 ? 'cyan' : 'yellow', r.thorsenScore.toFixed(2)) : c('red', '0.00');
    const sync = c(syncColor(r.syncState), r.syncState.padEnd(8));
    const verified = r.verified ? c('green', '✓') : c('dim', '○');
    const latency = r.pipelineLatencyMs.toFixed(1).padStart(6) + 'ms';

    console.log(`  ${status} ${c('white', r.templateKey.padEnd(34))} score=${score}  ${sync}  ${latency}  v=${verified}  ${c('dim', r.codeLines + 'L')}`);
  }
  console.log();

  // ── Coverage Gaps ──
  if (report.gaps.length > 0) {
    console.log(c('bold', `  🕳️  Coverage Gaps (${report.gaps.length})`));
    const highGaps = report.gaps.filter(g => g.priority === 'high');
    const medGaps = report.gaps.filter(g => g.priority === 'medium');
    const lowGaps = report.gaps.filter(g => g.priority === 'low');

    if (highGaps.length > 0) {
      console.log(`  ${c('red', '  HIGH')} (${highGaps.length}):`);
      for (const g of highGaps) {
        console.log(`    ${c('red', '●')} ${c('white', g.key)}`);
      }
    }
    if (medGaps.length > 0) {
      console.log(`  ${c('yellow', '  MEDIUM')} (${medGaps.length}):`);
      for (const g of medGaps.slice(0, 5)) {
        console.log(`    ${c('yellow', '◐')} ${g.key}`);
      }
      if (medGaps.length > 5) console.log(c('dim', `    ... +${medGaps.length - 5} more`));
    }
    if (lowGaps.length > 0) {
      console.log(`  ${c('dim', '  LOW')} (${lowGaps.length}):`);
      for (const g of lowGaps.slice(0, 3)) {
        console.log(`    ${c('dim', '○')} ${g.key}`);
      }
      if (lowGaps.length > 3) console.log(c('dim', `    ... +${lowGaps.length - 3} more`));
    }
    console.log();
  }

  // ── Suggestions ──
  if (report.suggestions.length > 0) {
    console.log(c('bold', `  💡 Improvement Suggestions (${report.suggestions.length})`));
    for (const s of report.suggestions) {
      console.log(`  ${severityIcon(s.severity)} [${s.category}] ${c('white', s.title)}`);
      console.log(c('dim', `    ${s.description.slice(0, 120)}${s.description.length > 120 ? '...' : ''}`));
      console.log(c('dim', `    Effort: ${s.effort}`));
    }
    console.log();
  }

  // ── Next Steps ──
  console.log(c('bold', '  🎯 Next Steps (by impact)'));
  for (let i = 0; i < report.nextSteps.length; i++) {
    const step = report.nextSteps[i];
    const num = c('cyan', `  ${i + 1}.`);
    console.log(`  ${num} ${step}`);
  }

  console.log(c('dim', `\n  Completed in ${totalTime}ms\n`));
}

/* ── Entry Point ──────────────────────────────────────────────── */

(async () => {
  try {
    if (quickMode) await runQuick();
    else await runFull();
  } catch (err) {
    console.error(c('red', `\n  Error: ${err.message}`));
    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')) {
      console.error(c('yellow', '  → Make sure the Vai runtime is running: pnpm --filter @vai/runtime dev\n'));
    }
    process.exit(1);
  }
})();
