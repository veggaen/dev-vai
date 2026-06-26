#!/usr/bin/env node
/**
 * runtime-keeper — keep the Vai runtime ALIVE for the improvement loop.
 *
 * Why this exists (found by debugging "the runtime keeps dying"): the loop was run against
 * `tsx watch src/index.ts`, which RESTARTS the runtime whenever a file it imports changes. The loop
 * EDITS exactly that code (packages/core/src/chat/*.ts) — so every applied fix restarted the runtime
 * mid-turn, the in-flight request failed, and it looked like "runtime down · meta-slop". A dev watcher
 * is the wrong process to run a code-editing loop against.
 *
 * The fix: run the BUILT runtime (node dist/index.js) — it does NOT restart on source edits, so the
 * loop's fixes land in git while the running binary stays stable until a deliberate rebuild. And keep
 * it ALIVE: if it ever exits (crash, OOM), relaunch with backoff. Health-gated start so callers know
 * when it's actually serving. This is the robust, loop-safe way to host Vai.
 *
 * Usage:
 *   node scripts/improve-loop/runtime-keeper.mjs                 # build-if-stale, start, keep alive
 *   node scripts/improve-loop/runtime-keeper.mjs --no-build      # skip the build, run existing dist
 *   node scripts/improve-loop/runtime-keeper.mjs --port 3006
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const has = (f) => args.includes(f);
const PORT = Number(opt('--port', process.env.PORT || '3006'));
const HEALTH = `http://localhost:${PORT}/health`;
const DIST = resolve(ROOT, 'packages/runtime/dist/index.js');
const SRC = resolve(ROOT, 'packages/runtime/src/index.ts');
const MAX_BACKOFF = 30_000;

const log = (m) => process.stdout.write(`[runtime-keeper ${new Date().toLocaleTimeString()}] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Is the runtime serving? (cheap fetch, short timeout) */
async function healthy() {
  try {
    const ctl = AbortSignal.timeout(3000);
    const r = await fetch(HEALTH, { signal: ctl });
    return r.ok;
  } catch { return false; }
}

/** Build the runtime when dist is missing or older than source (so we run current code, but ONLY
 *  on a deliberate (re)launch — never mid-loop). */
function buildIfStale() {
  if (has('--no-build')) return;
  const stale = !existsSync(DIST) || (existsSync(SRC) && statSync(DIST).mtimeMs < statSync(SRC).mtimeMs);
  if (!stale) { log('dist is current — skipping build'); return; }
  log('dist stale → building runtime (tsc)…');
  const r = spawnSync('pnpm', ['--filter', '@vai/runtime', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true, timeout: 300_000 });
  if (r.status !== 0) log('⚠ build returned non-zero — will try to run existing dist anyway');
}

let stop = false;
process.on('SIGINT', () => { stop = true; log('SIGINT — stopping keeper (runtime will exit too).'); });

async function main() {
  // If something is ALREADY serving on the port (a runtime you started yourself), don't fight it.
  if (await healthy()) { log(`already healthy at ${HEALTH} — keeper will just monitor it.`); }
  buildIfStale();

  let backoff = 1000;
  while (!stop) {
    if (await healthy()) { await sleep(5000); backoff = 1000; continue; } // alive → monitor

    log(`runtime not serving → launching node dist/index.js (port ${PORT})…`);
    const child = spawn(process.execPath, [DIST], {
      cwd: resolve(ROOT, 'packages/runtime'),
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'inherit',
    });
    const exited = new Promise((r) => { child.on('exit', (c) => r(c ?? 0)); child.on('error', () => r(1)); });

    // Wait until it's healthy (up to 60s) or it exits early.
    const start = Date.now();
    let up = false;
    while (!stop && Date.now() - start < 60_000) {
      if (await healthy()) { up = true; break; }
      // if it already exited, stop waiting
      const raced = await Promise.race([exited.then(() => 'exited'), sleep(2000).then(() => null)]);
      if (raced === 'exited') break;
    }
    if (up) { log(`✅ runtime healthy at ${HEALTH}`); backoff = 1000; }

    // Block until the child exits, then relaunch with backoff (crash resilience).
    const code = await exited;
    if (stop) { try { child.kill(); } catch {} break; }
    log(`runtime exited (code ${code}) → relaunching in ${Math.round(backoff / 1000)}s (crash-resilient).`);
    await sleep(backoff);
    backoff = Math.min(MAX_BACKOFF, backoff * 2);
  }
  log('keeper stopped.');
}

main().catch((e) => { log('fatal: ' + String(e)); process.exit(1); });
