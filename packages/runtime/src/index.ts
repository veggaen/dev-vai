import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createServer } from './server.js';

const isWindows = process.platform === 'win32';
const __filename = typeof globalThis.__filename === 'string' ? globalThis.__filename : fileURLToPath(import.meta.url);
const runtimeDir = path.dirname(__filename);

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
 * Needed for tsx watch restarts on Windows where the old
 * process tree doesn't always get cleaned up.
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
        try { execFileSync('taskkill', ['/F', '/T', '/PID', pid], { stdio: 'pipe' }); } catch {}
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
          try { execSync(`kill -9 ${pid}`, { stdio: 'pipe' }); } catch {}
        }
      }
      return true;
    }
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { app, port, vaiEngine } = await createServer();

  // Flush knowledge persistence on shutdown.
  process.on('SIGINT', () => { vaiEngine.flushPersist(); process.exit(0); });
  process.on('SIGTERM', () => { vaiEngine.flushPersist(); process.exit(0); });

  async function startWithRetry(maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await app.listen({ port, host: '0.0.0.0' });
        console.log(`VAI runtime listening on http://localhost:${port}`);
        return;
      } catch (err: unknown) {
        const isAddrInUse = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE';

        if (isAddrInUse && attempt < maxRetries) {
          console.log(`[VAI] Port ${port} busy — killing stale process and retrying (attempt ${attempt + 1})...`);
          killPortHolder(port);
          await sleep(1500);
          continue;
        }

        console.error('Failed to start server:', err);
        process.exit(1);
      }
    }
  }

  await startWithRetry();
}

void main();
