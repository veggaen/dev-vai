/**
 * Pre-dev check: ensure port 3006 is free before starting.
 * Uses Node's net module to test the port, then kills any process holding it.
 * Works on Windows and Unix.
 */

import { execSync } from 'node:child_process';
import net from 'node:net';

const PORTS = [
  Number(process.env.VAI_PORT ?? 3006),  // Runtime server
  5173,                                    // Vite dev server
];

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

function killProcessOnPort(port) {
  const isWindows = process.platform === 'win32';

  try {
    if (isWindows) {
      // Use netstat + findstr via cmd.exe explicitly
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
        console.log(`[VAI] Killing stale process on port ${port} (PID ${pid})`);
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
        } catch {
          // Process may have already exited
        }
      }

      if (pids.size > 0) {
        // Wait for OS to release the port
        execSync('cmd /c "timeout /t 2 /nobreak >nul 2>&1"', { stdio: 'pipe' });
      }
    } else {
      const output = execSync(`lsof -ti :${port}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      for (const pid of output.trim().split('\n').filter(Boolean)) {
        console.log(`[VAI] Killing stale process on port ${port} (PID ${pid})`);
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
        } catch {
          // Process may have already exited
        }
      }
    }
  } catch {
    // findstr/lsof found nothing — that's fine
  }
}

async function main() {
  for (const port of PORTS) {
    const inUse = await isPortInUse(port);

    if (inUse) {
      console.log(`[VAI] Port ${port} is in use — killing stale process...`);
      killProcessOnPort(port);

      const stillInUse = await isPortInUse(port);
      if (stillInUse) {
        console.error(`[VAI] ERROR: Port ${port} is still in use! Kill it manually.`);
        process.exit(1);
      }
    }
  }

  console.log(`[VAI] Ports ${PORTS.join(', ')} are free — starting dev servers`);
}

main();
