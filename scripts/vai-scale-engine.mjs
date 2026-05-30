#!/usr/bin/env node
/**
 * Vai in-process scale runner.
 *
 * Runs the bulk-wave evaluation directly against `new VaiEngine()` in memory —
 * no WebSocket, no HTTP, no database. This is the fast A/B harness: thousands of
 * conversations, multi-turn, in seconds, so engine changes can be measured
 * before spending the live-stack budget on scripts/vai-corpus-benchmark.mjs.
 *
 * It shares one source of truth with the live bench via scripts/lib/vai-wave-core.mjs
 * (corpus generation, response analysis, turn pivoting, aggregation, orchestrator).
 *
 * Usage:
 *   node scripts/vai-scale-engine.mjs --n 1000 --turns 3 --conc 16
 *   node scripts/vai-scale-engine.mjs --script eval/waves/example.json --conc 16
 *   node scripts/vai-scale-engine.mjs --from-failures artifacts/.../run.jsonl --n 200
 *   node scripts/vai-scale-engine.mjs --n 500 --seed 7 --score   # also write scoreboard
 *
 * Exits 0 always (it is a measurement tool, not a gate); use --fail-under <pct>
 * to make CI fail when the overall pass rate drops below a threshold.
 */

import { existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = process.cwd();
const TSX_BIN = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

// Re-exec under tsx so we can import the TypeScript engine source directly.
if (!process.env.__VAI_SCALE_TSX__ && existsSync(TSX_BIN)) {
  const { spawnSync } = await import('node:child_process');
  const scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const result = spawnSync(TSX_BIN, [scriptPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, __VAI_SCALE_TSX__: '1' },
    shell: true,
  });
  process.exit(result.status ?? 1);
}

const core = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'vai-wave-core.mjs')).href);
const { VaiEngine } = await import(
  pathToFileURL(join(ROOT, 'packages', 'core', 'src', 'models', 'vai-engine.ts')).href
);

function parseArgs(argv) {
  const out = {
    n: 200,
    turns: 3,
    conc: 8,
    builderConc: 4,
    seed: 42,
    builderRate: 0.08,
    maxBuilders: 20,
    out: '',
    summary: '',
    fromFailures: '',
    script: '',
    harder: false,
    quiet: false,
    deterministic: false,
    score: false,
    failUnder: 0,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    const [key, inline] = raw.startsWith('--') ? raw.slice(2).split('=') : [raw, undefined];
    const next = inline ?? argv[i + 1];
    const consume = inline === undefined;
    const setString = (field) => {
      out[field] = String(next ?? '');
      if (consume) i += 1;
    };
    const setNumber = (field) => {
      out[field] = Number(next);
      if (consume) i += 1;
    };
    if (key === 'n') setNumber('n');
    else if (key === 'turns') setNumber('turns');
    else if (key === 'conc') setNumber('conc');
    else if (key === 'builder-conc') setNumber('builderConc');
    else if (key === 'seed') setNumber('seed');
    else if (key === 'builder-rate') setNumber('builderRate');
    else if (key === 'max-builders') setNumber('maxBuilders');
    else if (key === 'out') setString('out');
    else if (key === 'summary') setString('summary');
    else if (key === 'from-failures') setString('fromFailures');
    else if (key === 'script') setString('script');
    else if (key === 'fail-under') setNumber('failUnder');
    else if (key === 'harder') out.harder = true;
    else if (key === 'quiet') out.quiet = true;
    else if (key === 'deterministic') out.deterministic = true;
    else if (key === 'score') out.score = true;
    else if (key === 'help' || key === 'h') out.help = true;
  }
  out.n = core.positiveInt(out.n, 200);
  out.turns = core.positiveInt(out.turns, 3);
  out.conc = core.positiveInt(out.conc, 8);
  out.builderConc = core.positiveInt(out.builderConc, 4);
  out.seed = Number.isFinite(out.seed) ? out.seed : 42;
  out.builderRate = core.clamp(Number.isFinite(out.builderRate) ? out.builderRate : 0.08, 0, 1);
  out.maxBuilders = core.positiveInt(out.maxBuilders, 20);
  out.failUnder = Number.isFinite(out.failUnder) ? out.failUnder : 0;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(ROOT, 'artifacts', 'scale-engine', `run-${stamp}`);
  if (!out.out) out.out = `${base}.jsonl`;
  if (!out.summary) out.summary = `${base}.summary.json`;
  if (out.fromFailures) out.fromFailures = join(ROOT, out.fromFailures);
  if (out.script) out.script = join(ROOT, out.script);
  out.cleanup = false;
  return out;
}

const HELP = `vai-scale-engine — in-process VaiEngine bulk-wave runner

  --n <int>            conversations to generate (default 200)
  --turns <int>        turns per conversation (default 3)
  --conc <int>         chat concurrency / engine pool size (default 8)
  --builder-conc <int> builder concurrency (default 4)
  --seed <int>         RNG seed for corpus generation (default 42)
  --builder-rate <f>   fraction of conversations that are builder specs (default 0.08)
  --max-builders <int> cap on builder conversations (default 20)
  --script <file>      scripted waves JSON (overrides generated corpus)
  --from-failures <f>  regenerate corpus from a prior run's JSONL failures
  --harder             apply harder prompt styling / extra turns
  --deterministic      construct engines with seeded RNG + frozen clock
  --out <file>         JSONL output path
  --summary <file>     summary JSON output path
  --score              run the quality scoreboard after the run
  --fail-under <pct>   exit 1 if overall pass rate < pct
  --quiet              only print the final summary line
`;

/** Construct a VaiEngine, optionally with seeded RNG + frozen clock. */
function makeEngine(options) {
  if (!options.deterministic) return new VaiEngine();
  const rng = core.mulberry32(options.seed);
  return new VaiEngine({ testMode: true, rng, now: () => 1700000000000 });
}

/**
 * Bounded engine pool. We reuse a fixed set of engines (one per concurrency
 * slot) instead of constructing one per conversation — engine construction
 * builds a TF-IDF index and is far too heavy to repeat thousands of times.
 * Each turn acquires an engine, runs to completion, then releases it, so the
 * `lastResponseMeta` read is never raced by a concurrent call on the same engine.
 */
function createEnginePool(size, options) {
  const free = Array.from({ length: Math.max(1, size) }, () => makeEngine(options));
  const waiters = [];
  return {
    acquire() {
      const engine = free.pop();
      if (engine) return Promise.resolve(engine);
      return new Promise((resolve) => waiters.push(resolve));
    },
    release(engine) {
      const next = waiters.shift();
      if (next) next(engine);
      else free.push(engine);
    },
  };
}

function makeTransport(pool) {
  return {
    async createConversation(spec) {
      return { conversationId: `conv-${spec.id}` };
    },
    async sendTurn({ state, user }) {
      const engine = await pool.acquire();
      const messages = (state.messages ||= []);
      messages.push({ role: 'user', content: user });
      const startedAt = performance.now();
      try {
        const result = await engine.chat({ messages: messages.slice() });
        const text = result?.message?.content ?? '';
        const meta = engine.lastResponseMeta || null;
        const evidence = engine.lastCitedAnswer?.evidence;
        messages.push({ role: 'assistant', content: text });
        return {
          text,
          ms: performance.now() - startedAt,
          strategy: meta?.strategy ?? null,
          confidence: meta?.confidence ?? null,
          sources: Array.isArray(evidence) ? evidence : [],
          followUps: [],
        };
      } catch (error) {
        return {
          text: '',
          ms: performance.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        pool.release(engine);
      }
    },
  };
}

function pct(n, d) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : '--';
}

function printReport(options, agg, elapsedMs) {
  const lines = [];
  const overall = agg.totalTurns ? agg.passedTurns / agg.totalTurns : 0;
  lines.push('');
  lines.push(`In-process scale run — ${agg.totalConversations} conversations, ${agg.totalTurns} turns`);
  lines.push(`Overall pass: ${agg.passedTurns}/${agg.totalTurns} (${(overall * 100).toFixed(1)}%) in ${(elapsedMs / 1000).toFixed(1)}s`);
  lines.push(`Throughput: ${(agg.totalTurns / (elapsedMs / 1000)).toFixed(1)} turns/s`);
  lines.push('');
  lines.push('By kind:');
  for (const [kind, t] of Object.entries(agg.byKind).sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`  ${kind.padEnd(24)} ${String(t.pass).padStart(5)}/${String(t.total).padEnd(5)} ${pct(t.pass, t.total)}`);
  }
  const tags = Object.entries(agg.tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (tags.length) {
    lines.push('');
    lines.push('Top failure tags:');
    for (const [tag, count] of tags) lines.push(`  ${String(count).padStart(5)}  ${tag}`);
  }
  console.log(lines.join('\n'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  let specs;
  let nextPromptFn = core.chooseNextPrompt;
  if (options.script) {
    const waves = await core.loadScriptWaves(options.script);
    specs = core.specsFromScript(waves, options);
    options.turns = waves.length;
    nextPromptFn = core.makeScriptedNextPrompt(waves);
  } else {
    specs = await core.generateCorpus(options);
  }
  if (!specs.length) {
    console.error('No specs generated — check --n / --script / --from-failures.');
    return 1;
  }

  mkdirSync(join(options.out, '..'), { recursive: true });
  const stream = createWriteStream(options.out, { flags: 'a' });
  const writeRow = (row) => stream.write(core.jsonLine(row));

  const agg = core.makeAggregator();
  agg.totalConversations = specs.length;
  const onEvent = (kind, payload) => {
    if (kind === 'turn_done') core.aggregate(agg, payload);
  };

  const pool = createEnginePool(Math.max(options.conc, options.builderConc), options);
  const transport = makeTransport(pool);

  if (!options.quiet) {
    console.log(`Scale run: ${specs.length} conversations × up to ${options.turns} turns, conc ${options.conc} (in-process)`);
  }
  const startedAt = performance.now();
  await core.runWaves({
    options,
    specs,
    transport,
    writeRow,
    onEvent,
    log: options.quiet ? () => {} : console.log,
    nextPromptFn,
  });
  const elapsedMs = performance.now() - startedAt;
  await new Promise((resolve) => stream.end(resolve));

  const overall = agg.totalTurns ? agg.passedTurns / agg.totalTurns : 0;
  const summary = {
    runVersion: core.WAVE_CORE_VERSION,
    transport: 'in-process',
    options: { n: options.n, turns: options.turns, conc: options.conc, seed: options.seed, harder: options.harder, script: options.script || null },
    elapsedMs: Math.round(elapsedMs),
    turnsPerSecond: Number((agg.totalTurns / (elapsedMs / 1000)).toFixed(2)),
    totals: {
      conversations: agg.totalConversations,
      turns: agg.totalTurns,
      passed: agg.passedTurns,
      failed: agg.failedTurns,
      passRate: Number((overall * 100).toFixed(2)),
    },
    byKind: agg.byKind,
    byMode: agg.byMode,
    byTurn: agg.byTurn,
    latencyByKind: agg.latencyByKind,
    tagCounts: agg.tagCounts,
  };
  mkdirSync(join(options.summary, '..'), { recursive: true });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(options.summary, JSON.stringify(summary, null, 2));

  if (!options.quiet) printReport(options, agg, elapsedMs);
  console.log(`\nJSONL:    ${options.out}`);
  console.log(`Summary:  ${options.summary}`);

  if (options.score) {
    const { scoreRun } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'vai-scoreboard.mjs')).href);
    await scoreRun({ jsonlPath: options.out, summary });
  }

  if (options.failUnder > 0 && summary.totals.passRate < options.failUnder) {
    console.error(`\nFAIL: pass rate ${summary.totals.passRate}% < --fail-under ${options.failUnder}%`);
    return 1;
  }
  return 0;
}

process.exit(await main());
