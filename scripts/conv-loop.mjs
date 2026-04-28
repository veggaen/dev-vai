#!/usr/bin/env node
/**
 * Thorsen Conversation Loop
 *
 * Runs the generated MD corpus (eval/generated/corpus.ts) in-process against
 * VaiEngine. In-process beats gRPC/HTTP for this — no serialization, no socket —
 * typically <50ms/turn.
 *
 * Usage:
 *   node scripts/conv-loop.mjs                  # run active cases, print failures
 *   node scripts/conv-loop.mjs --filter mira    # only matching id or title substring
 *   node scripts/conv-loop.mjs --watch          # rerun on engine src changes
 *   node scripts/conv-loop.mjs --quiet          # only summary line
 *   node scripts/conv-loop.mjs --json           # JSON output for tooling
 *   node scripts/conv-loop.mjs --pending        # also include pending-feature cases
 *   node scripts/conv-loop.mjs --seed 42        # deterministic engine (seeded RNG + frozen clock + no web)
 *
 * Exits 0 if all turns pass, 1 otherwise.
 */

import { performance } from 'node:perf_hooks';
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const filter = (() => {
  const i = args.indexOf('--filter');
  return i !== -1 ? args[i + 1] : null;
})();
const seedArg = (() => {
  const i = args.indexOf('--seed');
  return i !== -1 ? Number(args[i + 1]) : null;
})();
const watchMode = args.includes('--watch');
const quiet = args.includes('--quiet');
const json = args.includes('--json');
const includePending = args.includes('--pending');

const ROOT = process.cwd();
const TSX_BIN = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

// Re-exec under tsx if we were invoked directly with node (so we can import .ts).
if (!process.env.__CONV_LOOP_TSX__ && existsSync(TSX_BIN)) {
  const { spawnSync } = await import('node:child_process');
  const scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const result = spawnSync(TSX_BIN, [scriptPath, ...args], {
    stdio: 'inherit',
    env: { ...process.env, __CONV_LOOP_TSX__: '1' },
    shell: true,
  });
  process.exit(result.status ?? 1);
}

const { CORPUS } = await import(pathToFileURL(join(ROOT, 'eval', 'generated', 'corpus.ts')).href);
const { VaiEngine } = await import(pathToFileURL(join(ROOT, 'packages', 'core', 'src', 'models', 'vai-engine.ts')).href);

/** mulberry32 — deterministic RNG seeded from an integer. */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compileRegex(r) {
  return new RegExp(r.pattern, r.flags || '');
}

function checkAssertion(content, turn) {
  const trimmed = content.trim();
  const errors = [];
  if (turn.min_len != null && trimmed.length < turn.min_len) {
    errors.push(`length ${trimmed.length} < min_len ${turn.min_len}`);
  }
  if (turn.max_len != null && trimmed.length > turn.max_len) {
    errors.push(`length ${trimmed.length} > max_len ${turn.max_len}`);
  }
  for (const r of turn.must ?? []) {
    const re = compileRegex(r);
    if (!re.test(content)) errors.push(`missing match for /${r.pattern}/${r.flags || ''}`);
  }
  for (const r of turn.must_not ?? []) {
    const re = compileRegex(r);
    if (re.test(content)) errors.push(`forbidden match hit for /${r.pattern}/${r.flags || ''}`);
  }
  return errors;
}

function makeEngine() {
  if (seedArg == null) return new VaiEngine();
  const rng = mulberry32(seedArg);
  return new VaiEngine({ testMode: true, rng, now: () => 1700000000000 });
}

async function runConversation(spec) {
  const engine = makeEngine();
  const messages = [];
  const turnResults = [];
  for (const turn of spec.turns) {
    if (turn.role !== 'user') {
      // Inject scripted assistant/system turns into history, but don't score them.
      messages.push({ role: turn.role, content: turn.say });
      continue;
    }
    messages.push({ role: 'user', content: turn.say });
    const t0 = performance.now();
    let content = '';
    let strategy = '?';
    let err = null;
    try {
      const r = await engine.chat({ messages: messages.slice() });
      content = r.message.content;
      strategy = engine.lastResponseMeta?.strategy ?? '?';
      messages.push({ role: 'assistant', content });
    } catch (e) {
      err = e?.message ?? String(e);
    }
    const ms = performance.now() - t0;
    const errors = err ? [`engine threw: ${err}`] : checkAssertion(content, turn);
    turnResults.push({
      user: turn.say,
      strategy,
      ms: Math.round(ms),
      content,
      errors,
    });
  }
  return { spec, turnResults };
}

function selectTargets() {
  let cases = CORPUS;
  if (!includePending) cases = cases.filter((c) => c.expectedStatus === 'active');
  if (filter) {
    const f = filter.toLowerCase();
    cases = cases.filter((c) => c.id.toLowerCase().includes(f) || (c.title || '').toLowerCase().includes(f));
  }
  return cases;
}

async function runOnce() {
  const targets = selectTargets();
  if (!targets.length) {
    console.error(`no cases match filter "${filter}"`);
    return 1;
  }
  const t0 = performance.now();
  // Parallel for speed — independent engines.
  const results = await Promise.all(targets.map(runConversation));
  const totalMs = Math.round(performance.now() - t0);

  let passedTurns = 0;
  let failedTurns = 0;
  let failedConvs = 0;

  if (json) {
    process.stdout.write(JSON.stringify({ totalMs, results }, null, 2));
    return results.some((r) => r.turnResults.some((t) => t.errors.length)) ? 1 : 0;
  }

  for (const { spec, turnResults } of results) {
    const convFailed = turnResults.some((t) => t.errors.length);
    if (convFailed) failedConvs++;
    if (!quiet) {
      const head = convFailed ? `\x1b[31mFAIL\x1b[0m` : `\x1b[32mPASS\x1b[0m`;
      const turnSummary = turnResults
        .map((t) => (t.errors.length ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m'))
        .join('');
      console.log(`${head} ${spec.id.padEnd(40)} ${turnSummary}  (${turnResults.reduce((n, t) => n + t.ms, 0)}ms)`);
    }
    for (const t of turnResults) {
      if (t.errors.length) {
        failedTurns++;
        console.log(`  \x1b[31m✗\x1b[0m turn [${t.strategy}] "${t.user.slice(0, 80)}${t.user.length > 80 ? '…' : ''}"`);
        for (const e of t.errors) console.log(`    - ${e}`);
        const preview = t.content.replace(/\n+/g, ' ').slice(0, 220);
        console.log(`    got: "${preview}${t.content.length > 220 ? '…' : ''}"`);
      } else {
        passedTurns++;
      }
    }
  }

  const total = results.reduce((n, r) => n + r.turnResults.length, 0);
  const summary = `\n${passedTurns}/${total} turns passed, ${failedConvs}/${results.length} conversations failed (${totalMs}ms total)`;
  console.log(failedTurns ? `\x1b[31m${summary}\x1b[0m` : `\x1b[32m${summary}\x1b[0m`);
  return failedTurns ? 1 : 0;
}

if (!watchMode) {
  process.exit(await runOnce());
}

// Watch mode: re-run on engine source changes, debounced.
const watchDir = join(ROOT, 'packages', 'core', 'src');
let pending = null;
let running = false;
async function trigger() {
  if (running) {
    pending = setTimeout(trigger, 250);
    return;
  }
  running = true;
  console.clear();
  console.log(`[conv-loop] running (${new Date().toLocaleTimeString()})`);
  await runOnce();
  running = false;
}
console.log(`[conv-loop] watching ${watchDir}`);
watch(watchDir, { recursive: true }, (_, file) => {
  if (!file || !/\.(ts|js|mjs)$/.test(file)) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(trigger, 200);
});
await trigger();
