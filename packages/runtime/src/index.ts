import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createServer } from './server.js';
import { startLocalDirectChatListener } from './local-pipe-chat.js';
import { resolveRuntimePrewarmPlan } from './prewarm.js';
import {
  assertSecureRuntimeExposure,
  resolveRuntimeHost,
} from './security/runtime-exposure.js';

const isWindows = process.platform === 'win32';
const runtimeFile = typeof globalThis.__filename === 'string'
  ? globalThis.__filename
  : typeof __filename === 'string'
    ? __filename
    : process.argv[1] ?? process.cwd();
const runtimeDir = path.dirname(runtimeFile);

for (const candidate of [
  process.env.VAI_ENV_FILE,
  path.resolve(process.cwd(), '.env'),
  path.resolve(runtimeDir, '../../../.env'),
  path.resolve(runtimeDir, '../.env'),
].filter((value): value is string => Boolean(value))) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate, override: false });
    break;
  }
}

/**
 * Kill any process currently listening on the given port.
 * ONLY used under explicit VAI_TAKEOVER=1 — by default a second runtime
 * REFUSES to boot instead of killing the incumbent (two runtimes with
 * kill-on-conflict logic murder each other in a loop; see backlog P0).
 */
function killPortHolder(port: number): boolean {
  try {
    if (isWindows) {
      const output = execSync(
        `cmd /c "netstat -ano | findstr :${port} | findstr LISTENING"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const pids = new Set<string>();
      for (const line of output.trim().split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid) && /^\d+$/.test(pid)) {
          pids.add(pid);
        }
      }
      for (const pid of pids) {
        console.log(`[VAI] Killing stale process on port ${port} (PID ${pid})`);
         
        try { execFileSync('taskkill', ['/F', '/T', '/PID', pid], { stdio: 'pipe' }); } catch { /* process may have already exited */ }
      }
      return pids.size > 0;
    } else {
      const output = execSync(`lsof -ti :${port}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      for (const pid of output.trim().split('\n').filter(Boolean)) {
        if (pid !== String(process.pid)) {
          console.log(`[VAI] Killing stale process on port ${port} (PID ${pid})`);
           
          try { execSync(`kill -9 ${pid}`, { stdio: 'pipe' }); } catch { /* process may have already exited */ }
        }
      }
      return true;
    }
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when a HEALTHY VAI runtime already answers on the port. */
async function isHealthyRuntime(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const LOCK_FILE = path.resolve(process.cwd(), '.vai-runtime.lock');

function writeLockFile(port: number): void {
  try {
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }),
      'utf-8',
    );
  } catch { /* lock file is best-effort metadata; the port bind is the real lock */ }
}

function removeLockFile(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf-8')) as { pid?: number };
      if (lock.pid === process.pid) unlinkSync(LOCK_FILE);
    }
  } catch { /* best-effort */ }
}

async function main() {
  const { app, port, vaiEngine, chatService, config, localSteeringWorker, sandboxManager } = await createServer();
  const host = resolveRuntimeHost();
  assertSecureRuntimeExposure(host, config.authEnabled && config.apiKeys.length > 0);

  // ── Single-instance gate ──
  // One VAI runtime per machine. If a healthy runtime already serves the port,
  // this process REFUSES to boot — it never kills the incumbent. The only
  // supported launch is `pnpm nuke && pnpm dev`.
  if (await isHealthyRuntime(port)) {
    console.error(`[VAI] Another healthy VAI runtime is already serving port ${port}.`);
    console.error('[VAI] Refusing to boot a duplicate. Use the existing runtime, or run:');
    console.error('[VAI]   pnpm nuke && pnpm dev');
    process.exit(1);
  }

  const shutdown = () => {
    try { sandboxManager.stopAllDev(); } catch { /* best effort */ }
    vaiEngine.flushPersist();
    removeLockFile();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', removeLockFile);

  // Bind with patience, not violence: a lingering socket from a tsx-watch
  // restart releases within seconds. A live duplicate never does — refuse.
  async function listenSingleInstance(maxWaitMs = 15_000) {
    const deadline = Date.now() + maxWaitMs;
    let tookOver = false;
    for (;;) {
      try {
        await app.listen({ port, host });
        writeLockFile(port);
        console.log(`VAI runtime listening on http://${host}:${port}`);
        return;
      } catch (err: unknown) {
        const isAddrInUse = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
        if (!isAddrInUse) {
          console.error('Failed to start server:', err);
          process.exit(1);
        }

        if (await isHealthyRuntime(port)) {
          console.error(`[VAI] Another healthy VAI runtime took port ${port} — refusing to fight it.`);
          console.error('[VAI] Use the existing runtime, or run: pnpm nuke && pnpm dev');
          process.exit(1);
        }

        if (Date.now() >= deadline) {
          if (process.env.VAI_TAKEOVER === '1' && !tookOver) {
            tookOver = true;
            console.log(`[VAI] VAI_TAKEOVER=1 — killing dead-but-lingering holder of port ${port}...`);
            killPortHolder(port);
            await sleep(1500);
            continue;
          }
          console.error(`[VAI] Port ${port} is held by an unresponsive process and never released.`);
          console.error('[VAI] Run: pnpm nuke && pnpm dev   (or set VAI_TAKEOVER=1 to force).');
          process.exit(1);
        }

        console.log(`[VAI] Port ${port} busy (no healthy runtime) — waiting for release...`);
        await sleep(1500);
      }
    }
  }

  await listenSingleInstance();

  // Direct local channel (private 127.0.0.1 high port) for fast Grok (this .grok window) <-> Vai friendship.
  // Lighter than main server, local-only, reuses full ChatService (all intelligence).
  // This is the direct link — no heavy script + main auth/TCP for every turn.
  const directListener = startLocalDirectChatListener({ chatService, localSteeringWorker });
  // keep reference so it stays alive
  (globalThis as any).__vaiDirectListener = directListener;

  // Keep startup warmup off the scarce local-model queue by default. A cheap
  // deterministic greeting exercises the real ChatService path without
  // launching council codegen while the first user turn is waiting.
  const prewarmPlan = resolveRuntimePrewarmPlan();
  if (prewarmPlan) {
    void (async () => {
      try {
        const t0 = Date.now();
        const convId = chatService.createConversation(config.defaultModelId, 'prewarm');
        let chunks = 0;
        for await (const _chunk of chatService.sendMessage(
          convId,
          prewarmPlan.prompt,
          undefined,
          undefined,
          true, // noLearn — don't pollute knowledge with the warm-up
        )) { chunks++; }
        console.log(`[VAI] ${prewarmPlan.kind} prewarm ok (${Date.now() - t0}ms · ${chunks} chunks)`);
      } catch (e: unknown) {
        console.log(`[VAI] prewarm skipped: ${(e as Error)?.message || e}`);
      }
    })();
  }
}

void main();
