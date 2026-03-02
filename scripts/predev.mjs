/**
 * Pre-dev check — bulletproof port cleanup before starting.
 *
 * 1. Scans required ports (3006 runtime, 5173 vite, 4100-4110 sandbox)
 * 2. Tree-kills any process holding them (taskkill /T /F on Windows)
 * 3. Waits until ports are confirmed free
 * 4. Cleans up stale .vai-server.pid if present
 *
 * Works on Windows and Unix.
 */

import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PID_FILE = join(ROOT, '.vai-server.pid');
const isWindows = process.platform === 'win32';

/** Core ports that MUST be free */
const REQUIRED_PORTS = [
  Number(process.env.VAI_PORT ?? 3006),  // Runtime server
  5173,                                    // Vite dev server
];

/** Sandbox ports — kill if occupied but don't fail if still busy */
const SANDBOX_PORTS = Array.from({ length: 11 }, (_, i) => 4100 + i); // 4100-4110

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(true);
      else resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port);
  });
}

/** Sleep helper */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Find PIDs listening on a port and tree-kill them.
 * Returns the number of processes killed.
 */
function killProcessOnPort(port) {
  let killed = 0;
  try {
    if (isWindows) {
      const output = execSync(
        `cmd /c "netstat -ano | findstr :${port} | findstr LISTENING"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const pids = new Set();
      for (const line of output.trim().split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && /^\d+$/.test(pid)) pids.add(pid);
      }

      for (const pid of pids) {
        console.log(`[VAI] Killing process tree on port ${port} (PID ${pid})`);
        try {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'pipe' });
          killed++;
        } catch {
          // Process may have already exited
        }
      }
    } else {
      const output = execSync(`lsof -ti :${port}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      for (const pid of output.trim().split('\n').filter(Boolean)) {
        console.log(`[VAI] Killing process on port ${port} (PID ${pid})`);
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
          killed++;
        } catch {
          // Process may have already exited
        }
      }
    }
  } catch {
    // findstr/lsof found nothing — that's fine
  }
  return killed;
}

async function main() {
  let totalKilled = 0;

  // ── 1. Clean stale PID file ──
  if (existsSync(PID_FILE)) {
    console.log('[VAI] Removing stale .vai-server.pid');
    try { unlinkSync(PID_FILE); } catch {}
  }

  // ── 2. Kill required ports ──
  for (const port of REQUIRED_PORTS) {
    const inUse = await isPortInUse(port);
    if (inUse) {
      console.log(`[VAI] Port ${port} is in use — killing process tree...`);
      totalKilled += killProcessOnPort(port);
    }
  }

  // ── 3. Kill sandbox ports (best-effort) ──
  for (const port of SANDBOX_PORTS) {
    const inUse = await isPortInUse(port);
    if (inUse) {
      console.log(`[VAI] Sandbox port ${port} in use — cleaning up...`);
      totalKilled += killProcessOnPort(port);
    }
  }

  // ── 4. Wait for OS to release ports ──
  if (totalKilled > 0) {
    console.log(`[VAI] Killed ${totalKilled} stale process(es) — waiting for port release...`);
    await sleep(2000);
  }

  // ── 5. Final verification on required ports ──
  const failures = [];
  for (const port of REQUIRED_PORTS) {
    const stillInUse = await isPortInUse(port);
    if (stillInUse) {
      failures.push(port);
    }
  }

  if (failures.length > 0) {
    console.error(`[VAI] ERROR: Ports still occupied: ${failures.join(', ')}`);
    console.error('[VAI] Try: netstat -ano | findstr :<port>  then  taskkill /F /T /PID <pid>');
    process.exit(1);
  }

  console.log(`[VAI] Ports ${REQUIRED_PORTS.join(', ')} are free — starting dev servers`);
}

main();
