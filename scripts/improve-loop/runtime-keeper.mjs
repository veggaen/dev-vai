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
 * The fix: run the runtime with `tsx src/index.ts` (NO `watch`). tsx is required because @vai/core's
 * `main` points at src/index.ts (it resolves to TypeScript source, so `node dist/index.js` can't run
 * standalone — it ERR_MODULE_NOT_FOUNDs on core's .ts). tsx (no watch) gives correct .ts resolution
 * AND stability: it runs once and does NOT restart on source edits — so the loop's fixes land in git
 * while the running process stays up. And keep it ALIVE: if it ever exits (crash/OOM), relaunch with
 * backoff. Health-gated. The robust, loop-safe way to host Vai.
 *
 * Usage:
 *   node scripts/improve-loop/runtime-keeper.mjs                 # start, keep alive
 *   node scripts/improve-loop/runtime-keeper.mjs --port 3006
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('--port', process.env.PORT || '3006'));
const HEALTH = `http://localhost:${PORT}/health`;
const RUNTIME_DIR = resolve(ROOT, 'packages/runtime');
const TSX = resolve(ROOT, 'node_modules/.bin/tsx');
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

let stop = false;
process.on('SIGINT', () => { stop = true; log('SIGINT — stopping keeper (runtime will exit too).'); });

async function main() {
  // If something is ALREADY serving on the port (a runtime you started yourself), don't fight it.
  if (await healthy()) { log(`already healthy at ${HEALTH} — keeper will just monitor it.`); }

  let backoff = 1000;
  while (!stop) {
    if (await healthy()) { await sleep(5000); backoff = 1000; continue; } // alive → monitor

    log(`runtime not serving → launching tsx src/index.ts (no watch, port ${PORT})…`);
    const child = spawn(TSX, ['src/index.ts'], {
      cwd: RUNTIME_DIR,
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'inherit',
      shell: true, // tsx is a .CMD on Windows
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
