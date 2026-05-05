#!/usr/bin/env node
/**
 * VAI Server Manager
 *
 * Usage:
 *   node scripts/vai-server.mjs          → Start server (stops previous if running)
 *   node scripts/vai-server.mjs start    → Start server (stops previous if running)
 *   node scripts/vai-server.mjs stop     → Stop running server
 *   node scripts/vai-server.mjs restart  → Stop + start
 *   node scripts/vai-server.mjs status   → Check if server is running
 *
 * Features:
 *   - Detects existing VAI server on port 3006 and stops it before starting
 *   - PID file for reliable process tracking
 *   - Health check after startup to confirm server is ready
 *   - Graceful shutdown with SIGTERM, then SIGKILL after timeout
 */

import { spawn, execSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RUNTIME_DIR = join(ROOT, 'packages', 'runtime');
const ARTIFACT_DIR = join(ROOT, '.codex-run');
const SERVER_OUT_LOG = join(ARTIFACT_DIR, 'vai-server.out.log');
const SERVER_ERR_LOG = join(ARTIFACT_DIR, 'vai-server.err.log');
const PID_FILE = join(ROOT, '.vai-server.pid');
const PORT = 3006;
const HEALTH_URL = `http://localhost:${PORT}/health`;
const STARTUP_TIMEOUT_MS = Number.parseInt(process.env.VAI_STARTUP_TIMEOUT_MS || '60000', 10);
const KILL_GRACE_MS = 5_000;
const TSX_CLI = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// ── Helpers ──────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[VAI ${ts}] ${msg}`);
}

function err(msg) {
  const ts = new Date().toLocaleTimeString();
  console.error(`[VAI ${ts}] ❌ ${msg}`);
}

function readPid() {
  try {
    if (existsSync(PID_FILE)) {
      return parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    }
  } catch {}
  return null;
}

function writePid(pid) {
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

function removePid() {
  try { unlinkSync(PID_FILE); } catch {}
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = just check
    return true;
  } catch {
    return false;
  }
}

/** Find PID holding the port (Windows-specific) */
function findPortHolder() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1"`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    const pid = parseInt(out, 10);
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function killPid(pid) {
  try {
    // Try graceful first
    process.kill(pid, 'SIGTERM');
    log(`Sent SIGTERM to PID ${pid}`);

    // Wait a bit, then force kill if still alive
    const start = Date.now();
    while (Date.now() - start < KILL_GRACE_MS) {
      if (!isProcessAlive(pid)) return true;
      execSync('timeout /t 1 /nobreak >nul 2>&1', { shell: true });
    }

    // Force kill
    try {
      process.kill(pid, 'SIGKILL');
      log(`Force-killed PID ${pid}`);
    } catch {
      // Try Windows taskkill as last resort
      try {
        execSync(`taskkill /F /PID ${pid} /T`, { encoding: 'utf-8', timeout: 5000 });
        log(`taskkill PID ${pid}`);
      } catch {}
    }
    return true;
  } catch {
    return false;
  }
}

async function healthCheck(timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

// ── Commands ─────────────────────────────────────────────────

async function stopServer() {
  let stopped = false;

  // 1. Try PID file
  const savedPid = readPid();
  if (savedPid && isProcessAlive(savedPid)) {
    log(`Stopping VAI server (PID ${savedPid} from pid file)...`);
    killPid(savedPid);
    stopped = true;
  }

  // 2. Also check port holder (in case PID file is stale)
  const portPid = findPortHolder();
  if (portPid && portPid !== savedPid) {
    log(`Stopping process holding port ${PORT} (PID ${portPid})...`);
    killPid(portPid);
    stopped = true;
  }

  // 3. Wait for port to be free
  const start = Date.now();
  while (Date.now() - start < KILL_GRACE_MS) {
    if (!findPortHolder()) break;
    await new Promise(r => setTimeout(r, 500));
  }

  removePid();

  if (stopped) {
    log('Server stopped.');
  } else {
    log('No running VAI server found.');
  }

  return stopped;
}

async function startServer() {
  // Stop any existing server first
  await stopServer();

  // Short delay to let the port fully release
  await new Promise(r => setTimeout(r, 1500));

  // Double-check port is free
  const holder = findPortHolder();
  if (holder) {
    err(`Port ${PORT} still held by PID ${holder} — cannot start.`);
    process.exit(1);
  }

  log('Starting VAI server...');

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const stdoutFd = openSync(SERVER_OUT_LOG, 'a');
  const stderrFd = openSync(SERVER_ERR_LOG, 'a');
  const child = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
    cwd: RUNTIME_DIR,
    stdio: ['ignore', stdoutFd, stderrFd],
    detached: true,
    env: { ...process.env, VAI_PORT: String(PORT) },
  });

  child.unref();
  closeSync(stdoutFd);
  closeSync(stderrFd);

  // Save PID
  writePid(child.pid);
  log(`Server process started (PID ${child.pid})`);
  log(`Runtime logs: ${SERVER_OUT_LOG}`);

  // Wait for health check
  log(`Waiting for server to be ready on port ${PORT}...`);
  const health = await healthCheck();

  if (health) {
    const stats = health.stats;
    log('✅ Server is ready!');
    log(`   Engine: ${health.engine}`);
    if (stats) {
      log(`   Vocab: ${stats.vocabSize} | Knowledge: ${stats.knowledgeEntries} | Docs: ${stats.documentsIndexed}`);
    }
    return true;
  } else {
    err('Server failed to start within timeout.');
    if (isProcessAlive(child.pid)) {
      killPid(child.pid);
    }
    removePid();
    process.exit(1);
  }
}

async function showStatus() {
  const savedPid = readPid();
  const portPid = findPortHolder();

  if (!savedPid && !portPid) {
    log('Server is NOT running.');
    return;
  }

  if (savedPid && isProcessAlive(savedPid)) {
    log(`Server PID: ${savedPid} (from pid file, alive)`);
  } else if (savedPid) {
    log(`Stale PID file: ${savedPid} (process is dead)`);
    removePid();
  }

  if (portPid) {
    log(`Port ${PORT} held by PID: ${portPid}`);
  }

  // Health check
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      log(`✅ Server is HEALTHY`);
      log(`   Engine: ${data.engine}`);
      if (data.stats) {
        log(`   Vocab: ${data.stats.vocabSize} | Knowledge: ${data.stats.knowledgeEntries} | Docs: ${data.stats.documentsIndexed}`);
      }
    } else {
      log(`⚠️ Server responded with status ${res.status}`);
    }
  } catch {
    log('⚠️ Server is not responding to health checks.');
  }
}

// ── Main ─────────────────────────────────────────────────────

const command = process.argv[2] || 'start';

switch (command) {
  case 'start':
    await startServer();
    break;

  case 'stop':
    await stopServer();
    break;

  case 'restart':
    await stopServer();
    await startServer();
    break;

  case 'status':
    await showStatus();
    break;

  default:
    console.log(`
VAI Server Manager

Usage:
  node scripts/vai-server.mjs [command]

Commands:
  start    Start the server (stops previous instance first)
  stop     Stop the running server
  restart  Stop + start
  status   Check server status
`);
}
