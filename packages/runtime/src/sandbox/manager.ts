import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, dirname, relative, resolve, basename } from 'node:path';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { getTemplate, SANDBOX_TEMPLATES, type SandboxTemplate } from './templates.js';

/**
 * Console bridge script — injected into sandbox HTML files.
 * Captures console.log/warn/error/info and uncaught errors,
 * then postMessages them to the parent window so DebugConsole can show them.
 */
const CONSOLE_BRIDGE_SCRIPT = `
<script data-vai-console-bridge>
(function() {
  if (window.__vaiConsoleBridge) return;
  window.__vaiConsoleBridge = true;
  var methods = ['log', 'warn', 'error', 'info'];
  methods.forEach(function(method) {
    var orig = console[method];
    console[method] = function() {
      try {
        var args = Array.prototype.slice.call(arguments).map(function(a) {
          if (typeof a === 'object') try { return JSON.stringify(a); } catch(e) { return String(a); }
          return String(a);
        });
        window.parent.postMessage({
          type: 'vai-sandbox-console',
          method: method,
          args: args
        }, '*');
      } catch(e) {}
      return orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function(e) {
    window.parent.postMessage({
      type: 'vai-sandbox-console',
      method: 'error',
      args: ['[Uncaught] ' + (e.message || e) + (e.filename ? ' at ' + e.filename + ':' + e.lineno : '')]
    }, '*');
  });
  window.addEventListener('unhandledrejection', function(e) {
    window.parent.postMessage({
      type: 'vai-sandbox-console',
      method: 'error',
      args: ['[UnhandledRejection] ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))]
    }, '*');
  });
})();
</script>`;

export interface SandboxProject {
  id: string;
  name: string;
  rootDir: string;
  ownerUserId: string | null;
  files: Record<string, string>; // path -> content
  devProcess: ChildProcess | null;
  devPort: number | null;
  logs: string[];
  /** Last ~50 stderr lines from the current dev server process — reset on each startDev(). */
  devStderr: string[];
  status: 'idle' | 'writing' | 'installing' | 'building' | 'running' | 'failed';
  version: number;
  createdAt: Date;
  /** True when rootDir is a user-opened folder OUTSIDE the sandbox baseDir. External
   *  folders are served in place and are NEVER deleted by destroy(). */
  external: boolean;
  /** Detected framework id (nextjs | vite | vinext | …) for opened folders. */
  framework: FrameworkId | null;
  /** Latest one-shot script run (build / lint / test) — one at a time per project. */
  commandRun: CommandRun | null;
  /** Environment lane of the served app — dev (HMR) · preview (built) · production (gated build). */
  envLane: EnvLane;
  /** Progress/result of the most recent lane switch. */
  laneState: LaneState | null;
}

export interface CommandRun {
  script: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  /** Ring buffer of output lines (~400 max). */
  output: string[];
}

/** Which environment the app window is serving. */
export type EnvLane = 'dev' | 'preview' | 'production';

export interface LaneState {
  lane: EnvLane;
  status: 'switching' | 'ready' | 'failed';
  /** Human stage while switching: gate · build · serve */
  stage: string | null;
  startedAt: number;
  error: string | null;
}

export type FrameworkId = 'vinext' | 'nextjs' | 'vite' | 'remix' | 'astro' | 'node' | 'static' | 'unknown';

export interface ProjectProfile {
  name: string | null;
  framework: FrameworkId;
  frameworkLabel: string;
  packageManager: 'pnpm' | 'yarn' | 'npm' | 'bun';
  scripts: Record<string, string>;
  hasPackageJson: boolean;
  hasNodeModules: boolean;
  hasTypeScript: boolean;
  /** True for pnpm-workspace.yaml or package.json workspaces — dev may fan out to multiple apps. */
  monorepo: boolean;
  /** Uncommented VAR= names in .env.example that are missing from .env/.env.local. */
  missingEnvVars: string[];
  /** The project's own README Installation/Prerequisites section — surfaced as setup notes. */
  readmeSetup: string | null;
  /** True when the dev script cannot run as-is on this OS (e.g. bash on Windows). */
  devScriptPortable: boolean;
  /** engines.node from package.json, when declared. */
  requiredNode: string | null;
  /** True when engines.node is declared and the runtime's Node version does not satisfy it. */
  nodeMismatch: boolean;
}

export interface ProjectEnvStatus {
  exampleVars: string[];
  configuredVars: string[];
  missingEnvVars: string[];
  envLocalExists: boolean;
}

export interface ProjectCandidate {
  rootDir: string;
  /** Human-readable path relative to the folder the user selected. */
  relativePath: string;
  profile: ProjectProfile;
}

export interface ProjectDiscovery {
  requestedRootDir: string;
  candidates: ProjectCandidate[];
}

const FRAMEWORK_LABELS: Record<FrameworkId, string> = {
  vinext: 'Vinext',
  nextjs: 'Next.js',
  vite: 'Vite',
  remix: 'Remix',
  astro: 'Astro',
  node: 'Node.js',
  static: 'Static site',
  unknown: 'Unknown',
};

const PROJECT_DISCOVERY_MAX_DEPTH = 2;
const PROJECT_DISCOVERY_MAX_RESULTS = 20;
const PROJECT_DISCOVERY_IGNORED_DIRS = new Set([
  '.git', '.next', '.turbo', '.vite', '.cache', '.output',
  'node_modules', 'dist', 'build', 'coverage', 'out', 'target',
]);

function isRunnableProfile(profile: ProjectProfile): boolean {
  return profile.hasPackageJson || profile.framework === 'static';
}

/**
 * Look for runnable apps just beneath a selected container folder. This is
 * deliberately bounded: project intake should find common `repo/app` layouts
 * without turning a folder choice into an unbounded disk crawl.
 */
function discoverNestedProjects(rootDir: string): ProjectCandidate[] {
  const found: ProjectCandidate[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];

  while (queue.length > 0 && found.length < PROJECT_DISCOVERY_MAX_RESULTS) {
    const current = queue.shift();
    if (!current || current.depth >= PROJECT_DISCOVERY_MAX_DEPTH) continue;

    let children: Array<{ name: string; isDirectory(): boolean }>;
    try {
      children = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const directories = children
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !PROJECT_DISCOVERY_IGNORED_DIRS.has(entry.name))
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of directories) {
      const candidateDir = join(current.dir, entry.name);
      const profile = detectProjectProfile(candidateDir);
      if (isRunnableProfile(profile)) {
        found.push({
          rootDir: candidateDir,
          relativePath: relative(rootDir, candidateDir) || '.',
          profile,
        });
        if (found.length >= PROJECT_DISCOVERY_MAX_RESULTS) break;
        // A runnable project owns its subtree. Avoid showing generated or
        // example packages as competing roots when the project itself runs.
        continue;
      }
      queue.push({ dir: candidateDir, depth: current.depth + 1 });
    }
  }

  return found;
}

/* ── Project text search ── */

export interface SearchFilesOptions {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  maxResults?: number;
}

export interface SearchLineMatch {
  line: number;
  column: number;
  matchText: string;
  preview: string;
}

export interface SearchFileMatch {
  path: string;
  matches: SearchLineMatch[];
}

export interface SearchFilesResult {
  files: SearchFileMatch[];
  totalMatches: number;
  filesScanned: number;
  truncated: boolean;
}

const MAX_SEARCH_FILE_BYTES = 1_500_000;
const BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp[34]|wav|ogg|webm|zip|gz|br|tar|7z|pdf|exe|dll|so|dylib|wasm|node|db|sqlite|lockb)$/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the search regex from VS Code-style options. Throws on invalid user regex. */
export function buildSearchRegex(options: SearchFilesOptions): RegExp {
  const raw = options.query;
  if (!raw) throw new Error('Search query is empty');
  let source = options.regex ? raw : escapeRegExp(raw);
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return new RegExp(source, options.caseSensitive ? 'g' : 'gi');
  } catch (err) {
    throw new Error(`Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

/** Extract the Installation / Prerequisites / Getting Started section from a README, if any. */
function extractReadmeSetup(rootDir: string): string | null {
  try {
    const readmePath = ['README.md', 'readme.md', 'Readme.md'].map((f) => join(rootDir, f)).find((f) => existsSync(f));
    if (!readmePath) return null;
    const text = readFileSync(readmePath, 'utf-8');
    const match = /^(#{1,3})\s*(installation|prerequisites|requirements|getting started|setup)\b[^\n]*$/im.exec(text);
    if (!match || match.index === undefined) return null;
    const level = match[1].length;
    const rest = text.slice(match.index + match[0].length);
    // Section ends at the next heading of the same or higher level.
    const end = new RegExp(`^#{1,${level}}\\s`, 'm').exec(rest);
    const body = (end ? rest.slice(0, end.index) : rest).trim();
    if (!body) return null;
    return body.length > 1200 ? `${body.slice(0, 1200)}\n…` : body;
  } catch {
    return null;
  }
}

/** Uncommented VAR= names in .env.example that are not present in .env or .env.local. */
function detectMissingEnvVars(rootDir: string): string[] {
  try {
    const examplePath = join(rootDir, '.env.example');
    if (!existsSync(examplePath)) return [];
    const wanted = readFileSync(examplePath, 'utf-8')
      .split('\n')
      .map((l) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(l.trim())?.[1])
      .filter((v): v is string => Boolean(v));
    if (wanted.length === 0) return [];
    const present = new Set<string>();
    for (const envFile of ['.env', '.env.local', '.env.development', '.env.development.local']) {
      const p = join(rootDir, envFile);
      if (!existsSync(p)) continue;
      for (const l of readFileSync(p, 'utf-8').split('\n')) {
        const name = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(l.trim())?.[1];
        if (name) present.add(name);
      }
    }
    return wanted.filter((v) => !present.has(v)).slice(0, 12);
  } catch {
    return [];
  }
}

/** True when a dev script can run as-is on the current OS. */
export function isDevScriptPortable(devScript: string): boolean {
  if (!devScript) return true;
  return process.platform !== 'win32' || !/(^|\s)(bash|sh)\s|\.sh\b/.test(devScript);
}

/**
 * Scan a project folder and figure out what it is: framework, package manager,
 * available scripts, install state. Pure fs reads — no processes spawned.
 */
export function detectProjectProfile(rootDir: string): ProjectProfile {
  const pkgPath = join(rootDir, 'package.json');
  const hasPackageJson = existsSync(pkgPath);
  let name: string | null = null;
  let scripts: Record<string, string> = {};
  let deps: Record<string, string> = {};
  let requiredNode: string | null = null;
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        name?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        engines?: { node?: string };
        packageManager?: string;
      };
      name = typeof pkg.name === 'string' ? pkg.name : null;
      scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
      deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      requiredNode = typeof pkg.engines?.node === 'string' ? pkg.engines.node : null;
    } catch { /* unreadable package.json — treat as unknown */ }
  }

  const devScript = typeof scripts.dev === 'string' ? scripts.dev : '';
  const hasAny = (...files: string[]) => files.some((f) => existsSync(join(rootDir, f)));

  let framework: FrameworkId = 'unknown';
  if (deps.vinext || devScript.startsWith('vinext')) framework = 'vinext';
  else if (deps.next || hasAny('next.config.js', 'next.config.mjs', 'next.config.ts')) framework = 'nextjs';
  else if (deps.astro) framework = 'astro';
  else if (deps['@remix-run/react'] || deps['@remix-run/node']) framework = 'remix';
  else if (deps.vite || /\bvite\b/.test(devScript) || hasAny('vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs')) framework = 'vite';
  else if (hasPackageJson && (scripts.dev || scripts.start)) framework = 'node';
  else if (existsSync(join(rootDir, 'index.html'))) framework = 'static';

  const declaredPackageManager = (() => {
    if (!hasPackageJson) return null;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { packageManager?: string };
      return typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
    } catch {
      return null;
    }
  })();
  const packageManager = existsSync(join(rootDir, 'bun.lock')) || existsSync(join(rootDir, 'bun.lockb')) || declaredPackageManager === 'bun' ? 'bun'
    : existsSync(join(rootDir, 'pnpm-lock.yaml')) || declaredPackageManager === 'pnpm' ? 'pnpm'
    : existsSync(join(rootDir, 'yarn.lock')) || declaredPackageManager === 'yarn' ? 'yarn'
    : 'npm';

  let monorepo = existsSync(join(rootDir, 'pnpm-workspace.yaml'));
  if (!monorepo && hasPackageJson) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { workspaces?: unknown };
      monorepo = Boolean(pkg.workspaces);
    } catch { /* already handled above */ }
  }

  return {
    name,
    framework,
    frameworkLabel: FRAMEWORK_LABELS[framework],
    packageManager,
    scripts,
    hasPackageJson,
    hasNodeModules: existsSync(join(rootDir, 'node_modules')),
    hasTypeScript: existsSync(join(rootDir, 'tsconfig.json')),
    monorepo,
    missingEnvVars: detectMissingEnvVars(rootDir),
    readmeSetup: extractReadmeSetup(rootDir),
    devScriptPortable: isDevScriptPortable(devScript),
    requiredNode,
    nodeMismatch: requiredNode ? !nodeVersionSatisfies(requiredNode) : false,
  };
}

/** Loose semver-range check for engines.node against the runtime's own Node version.
 *  Handles the common forms: `>=18`, `^24.1.0`, `20.x`, `>=18 <23`, exact `22.1.0`.
 *  Unparseable ranges return true (no false alarms). */
export function nodeVersionSatisfies(range: string, current: string = process.versions.node): boolean {
  const major = Number(current.split('.')[0]);
  if (!Number.isFinite(major)) return true;
  const clauses = range.split(/\s*\|\|\s*/);
  const clauseOk = (clause: string): boolean => {
    const parts = clause.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return true;
    return parts.every((part) => {
      const m = /^(>=|<=|>|<|\^|~)?v?(\d+)(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?/.exec(part);
      if (!m) return true;
      const op = m[1] ?? '';
      const target = Number(m[2]);
      switch (op) {
        case '>=': return major >= target;
        case '>': return major > target;
        case '<=': return major <= target;
        case '<': return major < target;
        case '^': return major === target;
        case '~': return major === target;
        default: return major === target; // exact or x-range — major must match
      }
    });
  };
  return clauses.some(clauseOk);
}

export interface FileWrite {
  path: string;   // relative to project root, e.g. "src/App.tsx"
  content: string;
}

export interface WriteFilesOptions {
  callerUserId?: string | null;
  baseVersion?: number;
}

export interface FileRestore {
  path: string;
  content: string | null;
}

/** Check if a port is available by attempting to listen on it */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

/** Find the next available port starting from the given port */
async function findFreePort(start: number): Promise<number> {
  let port = start;
  while (!(await isPortFree(port))) {
    port++;
    if (port > 65535) throw new Error('No free ports available');
  }
  return port;
}

function extractBoundPort(text: string): number | null {
  // Each pattern must have exactly one capture group: the port number.
  // Ordered from most-specific to least-specific to avoid false positives.
  const patterns: RegExp[] = [
    // Vite: "Local:   http://localhost:5173/"
    /(?:Local|Network):\s+https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[^\]]+\]|[\w.-]+):(\d+)/i,
    // Next.js ≥13: "started server on 0.0.0.0:3000, url: http://localhost:3000"
    /started server on [\w.:[\]]+:(\d+)/i,
    // Next.js ≤12: "ready - started server on http://localhost:3000"
    /ready\s*[-–]\s*started server on https?:\/\/[\w.[\]-]+:(\d+)/i,
    // Express / Fastify / generic: "listening on port 3000" or "listening on :3000"
    /listening on\s+(?:port\s+)?:?(\d{4,5})\b/i,
    // CRA / webpack-dev-server: "webpack compiled" line often precedes "http://localhost:3000"
    /running\s+at\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i,
    // Remix: "Remix App Server started at http://localhost:3000"
    /started at\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i,
    // Generic URL with localhost/127.0.0.1 in any "running on / serving / available at" context
    /(?:running on|serving|available at|server at)\s+https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
    // Fallback: any http://localhost:PORT or http://0.0.0.0:PORT in the output line
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const port = Number(match?.[1]);
    if (Number.isInteger(port) && port > 1023 && port < 65536) {
      return port;
    }
  }

  return null;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function isOutdatedPnpmLockfile(output: string): boolean {
  return /ERR_PNPM_OUTDATED_LOCKFILE|Cannot install with "frozen-lockfile" because pnpm-lock\.yaml is not up to date/i.test(output);
}

/** Kill whatever process is LISTENING on a port (full tree on Windows). Best effort. */
function killPortOwner(port: number): boolean {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const line = out.split('\n').find((l) => new RegExp(`[:.]${port}\\s`).test(l) && /LISTENING/i.test(l));
      const pid = Number(line?.trim().split(/\s+/).pop());
      if (Number.isInteger(pid) && pid > 4 && pid !== process.pid) {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        return true;
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -s tcp:listen 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      let killed = false;
      for (const pidStr of out.split('\n').filter(Boolean)) {
        const pid = Number(pidStr);
        if (Number.isInteger(pid) && pid > 1 && pid !== process.pid) {
          try { process.kill(pid, 'SIGKILL'); killed = true; } catch { /* gone already */ }
        }
      }
      return killed;
    }
  } catch { /* best effort */ }
  return false;
}

/**
 * SandboxManager — creates temporary project directories, writes files,
 * installs deps, and runs dev servers for builder mode preview.
 */
const MAX_LOG_ENTRIES = 500;
const START_DEV_TIMEOUT_MS = 6000;
const READY_PORT_SETTLE_MS = 1500;
const PREVIEW_HEALTH_TIMEOUT_MS = 8000;

export type PreviewHealthResult =
  | { ok: true }
  | { ok: false; message: string; reason: 'timeout' | 'application-error' };

export function previewHealthDisposition(result: PreviewHealthResult): 'ready' | 'pending' | 'failed' {
  if (result.ok) return 'ready';
  return result.reason === 'timeout' ? 'pending' : 'failed';
}

function summarizePreviewBody(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function parseEnvNames(content: string): string[] {
  return content
    .split('\n')
    .map((line) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line.trim())?.[1])
    .filter((value): value is string => Boolean(value));
}

function readEnvFileMap(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    values.set(match[1], match[2] ?? '');
  }
  return values;
}

function serializeEnvLine(key: string, value: string): string {
  if (/^[^\r\n#]*$/.test(value) && !/^\s|\s$/.test(value)) {
    return `${key}=${value}`;
  }
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
  return `${key}="${escaped}"`;
}

function classifyPreviewFailure(status: number, contentType: string, body: string): string | null {
  const summary = summarizePreviewBody(body);
  if (status >= 500) {
    return `HTTP ${status}${summary ? ` — ${summary}` : ''}`;
  }

  const trimmed = body.trim();
  if (/json/i.test(contentType) || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { status?: unknown; message?: unknown; error?: unknown };
      const parsedStatus = typeof parsed.status === 'number' ? parsed.status : null;
      if (parsedStatus !== null && parsedStatus >= 500) {
        const parsedMessage = typeof parsed.message === 'string'
          ? parsed.message
          : typeof parsed.error === 'string'
            ? parsed.error
            : summary;
        return `HTTP ${parsedStatus}${parsedMessage ? ` — ${parsedMessage}` : ''}`;
      }
    } catch {
      // Not actually JSON; continue with text heuristics.
    }
  }

  if (/\b(HTTPError|Internal Server Error|Missing VITE_[A-Z0-9_]+|Vite Error)\b/i.test(summary)) {
    return summary || 'Preview rendered an application error';
  }

  return null;
}

async function checkPreviewHealth(port: number): Promise<PreviewHealthResult> {
  const deadline = Date.now() + PREVIEW_HEALTH_TIMEOUT_MS;
  let lastFailure = 'preview did not respond before the health-check timeout';
  let sawApplicationFailure = false;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' },
      });
      const body = await response.text();
      const failure = classifyPreviewFailure(response.status, response.headers.get('content-type') ?? '', body);
      if (!failure) return { ok: true };
      lastFailure = failure;
      sawApplicationFailure = true;
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    ok: false,
    message: lastFailure,
    reason: sawApplicationFailure ? 'application-error' : 'timeout',
  };
}

export class SandboxManager {
  private projects = new Map<string, SandboxProject>();
  private baseDir: string;
  private pidDir: string;
  private nextPort = 4100; // sandbox dev servers start at 4100

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(tmpdir(), 'vai-sandbox');
    this.pidDir = join(this.baseDir, '.pids');
    // Reap dev servers orphaned by a previous runtime life. tsx-watch restarts
    // lose ChildProcess handles, and orphaned `next dev` instances sharing one
    // .next folder corrupt each other's chunks (live failure: 7 servers on one
    // project → Runtime SyntaxError / ChunkLoadError in the preview).
    this.reapOrphanDevServers();
  }

  /** Persist "this project has a dev server on this port" so a future runtime life can reap it. */
  private writePidfile(projectId: string, pid: number | undefined, port: number): void {
    try {
      mkdirSync(this.pidDir, { recursive: true });
      writeFileSync(join(this.pidDir, `${projectId}.json`), JSON.stringify({ pid: pid ?? null, port, startedAt: Date.now() }), 'utf-8');
    } catch { /* best effort */ }
  }

  private removePidfile(projectId: string): void {
    try { rmSync(join(this.pidDir, `${projectId}.json`), { force: true }); } catch { /* best effort */ }
  }

  /** Kill every dev server recorded by previous runtime lives, then clear the records. */
  private reapOrphanDevServers(): void {
    try {
      if (!existsSync(this.pidDir)) return;
      for (const file of readdirSync(this.pidDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const record = JSON.parse(readFileSync(join(this.pidDir, file), 'utf-8')) as { port?: number };
          if (record.port) killPortOwner(record.port);
        } catch { /* unreadable record — drop it */ }
        try { rmSync(join(this.pidDir, file), { force: true }); } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }

  /** Append a log line, evicting oldest entry when the ring is full. */
  private pushLog(project: SandboxProject, line: string): void {
    if (project.logs.length >= MAX_LOG_ENTRIES) {
      project.logs.shift();
    }
    project.logs.push(line);
  }

  /** Create a new sandbox project */
  async create(name: string, ownerUserId: string | null = null): Promise<SandboxProject> {
    const id = randomUUID().slice(0, 8);
    const rootDir = join(this.baseDir, `${id}-${name.replace(/[^a-zA-Z0-9-_]/g, '-')}`);

    await mkdir(rootDir, { recursive: true });

    const project: SandboxProject = {
      id,
      name,
      rootDir,
      ownerUserId,
      files: {},
      devProcess: null,
      devPort: null,
      logs: [],
      devStderr: [],
      status: 'idle',
      version: 0,
      createdAt: new Date(),
      external: false,
      framework: null,
      commandRun: null,
      envLane: 'dev',
      laneState: null,
    };

    this.projects.set(id, project);
    return project;
  }

  /** Validate a user-selected folder before project discovery/opening. */
  private validateExternalFolderRoot(folderPath: string): string {
    const rootDir = resolve(folderPath.trim());
    if (!isAbsolute(rootDir)) throw new Error('Folder path must be absolute');
    if (!existsSync(rootDir)) throw new Error(`Folder not found: ${rootDir}`);
    if (!statSync(rootDir).isDirectory()) throw new Error(`Not a folder: ${rootDir}`);
    if (dirname(rootDir) === rootDir || rootDir === resolve(this.baseDir)) {
      throw new Error('Refusing to open this folder');
    }
    // Recursion guard: opening Vai's own runtime (or the repo that contains it)
    // as a project would start Vai inside Vai — port collisions and chaos.
    // Owner-enabled escape hatch (VAI_ALLOW_SELF_WORKSPACE=1): dogfooding Vai on
    // its own codebase is a legitimate self-improvement workflow, so the guard
    // is a conscious gate, not a hard wall.
    const selfDir = resolve(process.cwd());
    if (rootDir === selfDir || selfDir.startsWith(rootDir + '\\') || selfDir.startsWith(rootDir + '/')) {
      if (process.env.VAI_ALLOW_SELF_WORKSPACE !== '1') {
        throw new Error("That folder contains Vai's own running runtime — opening it inside itself is blocked by default. Owner override: set VAI_ALLOW_SELF_WORKSPACE=1 and restart if you really want Vai working on its own code.");
      }
      console.warn(`[sandbox] SELF-WORKSPACE OPEN (owner-enabled): ${rootDir} contains the running runtime — dev-server starts here can collide with Vai's own ports.`);
    }
    return rootDir;
  }

  /**
   * Return every plausible app root beneath a selected folder. A runnable
   * selected root always wins; otherwise discovery is bounded to two levels.
   */
  discoverProjects(folderPath: string): ProjectDiscovery {
    const requestedRootDir = this.validateExternalFolderRoot(folderPath);
    const directProfile = detectProjectProfile(requestedRootDir);
    if (isRunnableProfile(directProfile)) {
      return {
        requestedRootDir,
        candidates: [{ rootDir: requestedRootDir, relativePath: '.', profile: directProfile }],
      };
    }

    const candidates = discoverNestedProjects(requestedRootDir);
    if (candidates.length === 0) {
      throw new Error('No package.json or index.html found here or within two folder levels');
    }
    return { requestedRootDir, candidates };
  }

  /** Validate a folder path and return one unambiguous profile WITHOUT registering a project. */
  scanFolder(folderPath: string): { rootDir: string; profile: ProjectProfile } {
    const discovery = this.discoverProjects(folderPath);
    if (discovery.candidates.length > 1) {
      const choices = discovery.candidates.map((candidate) => candidate.relativePath).join(', ');
      throw new Error(`Multiple runnable projects found: ${choices}. Choose one project folder.`);
    }
    const [{ rootDir, profile }] = discovery.candidates;
    return { rootDir, profile };
  }

  /**
   * Open an EXISTING local folder (e.g. C:\Users\you\Documents\my-app) as an external
   * project. The folder is served in place — dev server runs inside the user's own
   * directory with their own hot reload. External folders are never mutated beyond what
   * the user explicitly asks for and never deleted by destroy().
   */
  async openExternal(folderPath: string, ownerUserId: string | null = null): Promise<{ project: SandboxProject; profile: ProjectProfile }> {
    const { rootDir, profile } = this.scanFolder(folderPath);

    // Reuse an already-open entry for the same folder instead of duplicating it.
    // Local-first ownership: the filesystem is the real access boundary for an
    // external folder — whoever opens the path from this machine claims the entry.
    // Without this, a stale owner (earlier session, API test, anonymous run) leaves
    // the project permanently 403-locked for the current user.
    for (const existing of this.projects.values()) {
      if (existing.external && resolve(existing.rootDir) === rootDir) {
        if (existing.ownerUserId !== ownerUserId) {
          existing.ownerUserId = ownerUserId;
          this.pushLog(existing, `Ownership claimed by current local caller (${ownerUserId ?? 'anonymous'})`);
        }
        return { project: existing, profile };
      }
    }

    const id = randomUUID().slice(0, 8);
    const project: SandboxProject = {
      id,
      name: profile.name ?? basename(rootDir),
      rootDir,
      ownerUserId,
      files: {},
      devProcess: null,
      devPort: null,
      logs: [],
      devStderr: [],
      status: 'idle',
      version: 0,
      createdAt: new Date(),
      external: true,
      framework: profile.framework,
      commandRun: null,
      envLane: 'dev',
      laneState: null,
    };
    this.pushLog(project, `Opened local folder: ${rootDir}`);
    this.pushLog(project, `Detected: ${profile.frameworkLabel} · ${profile.packageManager}`
      + (profile.hasTypeScript ? ' · TypeScript' : '')
      + (profile.hasNodeModules ? '' : ' · node_modules missing (install needed)'));
    this.projects.set(id, project);
    return { project, profile };
  }

  /** Get a sandbox project by ID */
  get(id: string): SandboxProject | undefined {
    return this.projects.get(id);
  }

  /** List all available templates */
  listTemplates(): SandboxTemplate[] {
    return SANDBOX_TEMPLATES;
  }

  /** Create a project pre-populated from a template */
  async createFromTemplate(
    templateId: string,
    name?: string,
    ownerUserId: string | null = null,
  ): Promise<SandboxProject> {
    const template = getTemplate(templateId);
    if (!template) throw new Error(`Unknown template: ${templateId}`);

    const projectName = name || template.name.toLowerCase().replace(/\s+/g, '-');

    // A "fresh Next.js starter" needs the real CLI scaffold, not the canned placeholder template.
    if (templateId === 'nextjs') {
      return this.createFromCLI('nextjs', projectName, ownerUserId);
    }

    const project = await this.create(projectName, ownerUserId);

    // Write template files
    await this.writeFiles(project.id, template.files);
    this.pushLog(project, `Scaffolded from template: ${template.name}`);

    return project;
  }

  /**
   * Create a project using the real framework CLI (e.g. create-next-app).
   * This produces the exact same output as running the CLI manually.
   */
  async createFromCLI(
    framework: 'nextjs',
    name: string,
    ownerUserId: string | null = null,
  ): Promise<SandboxProject> {
    const id = randomUUID().slice(0, 8);
    const safeName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || framework;
    const parentDir = join(this.baseDir, `${id}-${safeName}`);
    await mkdir(parentDir, { recursive: true });

    // Run create-next-app inside parentDir — it creates a subfolder named `safeName`
    const cmd = framework === 'nextjs'
      ? `npx create-next-app@latest ${safeName} --yes --ts --tailwind --eslint --app --src-dir --use-pnpm --import-alias "@/*"`
      : '';

    await new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, {
        cwd: parentDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, npm_config_yes: 'true' },
      });

      const logs: string[] = [];
      child.stdout?.on('data', (d: Buffer) => logs.push(d.toString()));
      child.stderr?.on('data', (d: Buffer) => logs.push(d.toString()));

      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`create-next-app exited with code ${code}:\n${logs.join('')}`));
      });

      // Timeout after 120 seconds
      setTimeout(() => {
        child.kill();
        reject(new Error('create-next-app timed out after 120s'));
      }, 120_000);
    });

    // The CLI creates a subfolder; use that as rootDir
    const rootDir = join(parentDir, safeName);

    // Read the created files for the files map
    const files: Record<string, string> = {};
    const walk = async (dir: string, prefix = '') => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === 'dist' || entry.name === '.turbo') continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), rel);
        } else {
          try {
            files[rel] = await readFile(join(dir, entry.name), 'utf8');
          } catch { /* skip binary files */ }
        }
      }
    };
    await walk(rootDir);

    const project: SandboxProject = {
      id,
      name: safeName,
      rootDir,
      ownerUserId,
      files,
      devProcess: null,
      devPort: null,
      logs: ['Scaffolded a fresh Next.js App Router baseline'],
      devStderr: [],
      status: 'idle',
      version: 0,
      createdAt: new Date(),
      external: false,
      framework: 'nextjs',
      commandRun: null,
      envLane: 'dev',
      laneState: null,
    };

    this.projects.set(id, project);
    return project;
  }

  /** List all active projects */
  list(): SandboxProject[] {
    return Array.from(this.projects.values()).map((p) => ({
      ...p,
      devProcess: null, // Don't serialize ChildProcess
    }));
  }

  rehydrate(project: Pick<SandboxProject, 'id' | 'name' | 'rootDir' | 'ownerUserId'> & { status?: SandboxProject['status'] }): SandboxProject {
    const existing = this.projects.get(project.id);
    if (existing) return existing;

    const restored: SandboxProject = {
      id: project.id,
      name: project.name,
      rootDir: project.rootDir,
      ownerUserId: project.ownerUserId,
      files: {},
      devProcess: null,
      devPort: null,
      logs: ['[system] Restored from persisted project metadata'],
      devStderr: [],
      status: project.status ?? 'idle',
      version: 0,
      createdAt: new Date(),
      external: this.isOutsideBaseDir(project.rootDir),
      framework: null,
      commandRun: null,
      envLane: 'dev',
      laneState: null,
    };

    this.projects.set(project.id, restored);
    return restored;
  }

  listForUser(userId: string | null): SandboxProject[] {
    return this.list().filter((project) => this.isAccessibleToUser(project, userId));
  }

  canAccess(projectId: string, userId: string | null): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    return this.isAccessibleToUser(project, userId);
  }

  private isAccessibleToUser(project: SandboxProject, userId: string | null): boolean {
    // null-owner projects are dev/anonymous — only readable, not writable via this check.
    // Use canWrite() for mutation gates.
    return project.ownerUserId === null || project.ownerUserId === userId;
  }

  /** True if userId may mutate (write files, stop/start server, destroy) the project. */
  canWrite(projectId: string, userId: string | null): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    // Require a matching owner — null-owner projects are read-only for unauthenticated callers.
    if (project.ownerUserId === null) return userId === null; // anonymous dev mode: caller must also be anonymous
    return project.ownerUserId === userId;
  }

  /** True when a rootDir lives outside the managed sandbox baseDir (i.e. a user folder). */
  private isOutsideBaseDir(rootDir: string): boolean {
    const rel = relative(resolve(this.baseDir), resolve(rootDir));
    return rel.startsWith('..') || isAbsolute(rel);
  }

  /** Resolve a file path within the sandbox root, guarding against path traversal. */
  private safePath(rootDir: string, filePath: string): string {
    const full = resolve(rootDir, filePath);
    const relativePath = relative(rootDir, full);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`Path traversal blocked: ${filePath}`);
    }
    return full;
  }

  /** Write files to the sandbox project */
  async writeFiles(projectId: string, files: FileWrite[], options: WriteFilesOptions = {}): Promise<number> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);
    if (options.callerUserId !== undefined && !this.canWrite(projectId, options.callerUserId)) {
      throw new Error(`Access denied: user ${options.callerUserId ?? 'anonymous'} cannot write to project ${projectId}`);
    }
    if (options.baseVersion !== undefined && options.baseVersion !== project.version) {
      throw new Error(`Sandbox version conflict: expected ${options.baseVersion}, current ${project.version}`);
    }

    project.status = 'writing';
    this.pushLog(project, `Writing ${files.length} file(s)...`);

    for (const file of files) {
      const fullPath = this.safePath(project.rootDir, file.path);
      await mkdir(dirname(fullPath), { recursive: true });
      // Inject console bridge into HTML files so iframe errors are visible
      let content = file.content;
      if (file.path.endsWith('.html') && content.includes('<head>') && !content.includes('vai-console-bridge')) {
        content = content.replace('<head>', '<head>' + CONSOLE_BRIDGE_SCRIPT);
      }
      await writeFile(fullPath, content, 'utf-8');
      project.files[file.path] = content;
      this.pushLog(project, `  ✓ ${file.path}`);
    }

    project.status = project.devProcess && project.devPort ? 'running' : 'idle';
    project.version += 1;
    return project.version;
  }

  /** Restore files to prior contents; null content deletes a file created by the reverted revision. */
  async restoreFiles(projectId: string, files: FileRestore[], options: WriteFilesOptions = {}): Promise<number> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);
    if (options.callerUserId !== undefined && !this.canWrite(projectId, options.callerUserId)) {
      throw new Error(`Access denied: user ${options.callerUserId ?? 'anonymous'} cannot write to project ${projectId}`);
    }
    if (options.baseVersion !== undefined && options.baseVersion !== project.version) {
      throw new Error(`Sandbox version conflict: expected ${options.baseVersion}, current ${project.version}`);
    }

    project.status = 'writing';
    this.pushLog(project, `Restoring ${files.length} file(s)...`);
    for (const file of files) {
      const fullPath = this.safePath(project.rootDir, file.path);
      if (file.content === null) {
        await rm(fullPath, { force: true });
        delete project.files[file.path];
        this.pushLog(project, `  - ${file.path}`);
        continue;
      }

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, 'utf-8');
      project.files[file.path] = file.content;
      this.pushLog(project, `  ↩ ${file.path}`);
    }

    project.status = project.devProcess && project.devPort ? 'running' : 'idle';
    project.version += 1;
    return project.version;
  }

  /** Read a file from the sandbox project */
  async readFile(projectId: string, filePath: string): Promise<string> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);
    return readFile(this.safePath(project.rootDir, filePath), 'utf-8');
  }

  getEnvStatus(projectId: string): ProjectEnvStatus {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);

    const examplePath = join(project.rootDir, '.env.example');
    const exampleVars = existsSync(examplePath)
      ? Array.from(new Set(parseEnvNames(readFileSync(examplePath, 'utf-8')))).slice(0, 80)
      : [];
    const configured = new Set<string>();
    for (const envFile of ['.env', '.env.local', '.env.development', '.env.development.local']) {
      const fullPath = join(project.rootDir, envFile);
      if (!existsSync(fullPath)) continue;
      for (const name of parseEnvNames(readFileSync(fullPath, 'utf-8'))) configured.add(name);
    }

    return {
      exampleVars,
      configuredVars: [...configured].sort(),
      missingEnvVars: exampleVars.filter((name) => !configured.has(name)).slice(0, 80),
      envLocalExists: existsSync(join(project.rootDir, '.env.local')),
    };
  }

  async writeEnvLocal(projectId: string, values: Record<string, string>): Promise<ProjectEnvStatus> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);

    const entries = Object.entries(values)
      .map(([key, value]) => [key.trim(), value] as const)
      .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key));
    if (entries.length === 0) throw new Error('No valid env values were provided');

    const envPath = this.safePath(project.rootDir, '.env.local');
    const existingLines = existsSync(envPath) ? readFileSync(envPath, 'utf-8').split(/\r?\n/) : [];
    const existingMap = readEnvFileMap(envPath);
    const updateKeys = new Set(entries.map(([key]) => key));
    const nextLines: string[] = [];

    for (const line of existingLines) {
      const key = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
      if (!key || !updateKeys.has(key)) {
        if (line.length > 0) nextLines.push(line);
        continue;
      }
      const value = entries.find(([entryKey]) => entryKey === key)?.[1] ?? existingMap.get(key) ?? '';
      nextLines.push(serializeEnvLine(key, value));
      updateKeys.delete(key);
    }

    if (nextLines.length > 0 && updateKeys.size > 0) nextLines.push('');
    for (const [key, value] of entries) {
      if (!updateKeys.has(key)) continue;
      nextLines.push(serializeEnvLine(key, value));
    }

    await writeFile(envPath, `${nextLines.join('\n').replace(/\n+$/, '')}\n`, 'utf-8');
    this.pushLog(project, `Updated .env.local with ${entries.length} value(s): ${entries.map(([key]) => key).join(', ')}`);
    return this.getEnvStatus(projectId);
  }

  /** List files in the sandbox project directory tree */
  async listFiles(projectId: string, subDir = ''): Promise<string[]> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);

    const dir = this.safePath(project.rootDir, subDir);
    if (!existsSync(dir)) return [];

    const result: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = subDir ? `${subDir}/${entry.name}` : entry.name;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === 'dist' || entry.name === '.turbo') continue;
      if (entry.isDirectory()) {
        result.push(...await this.listFiles(projectId, rel));
      } else {
        result.push(rel);
      }
    }
    return result;
  }

  /** Install dependencies — prefers pnpm for speed (hard-links from global store) */
  async install(projectId: string): Promise<{ success: boolean; output: string }> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);

    project.status = 'installing';
    this.pushLog(project, 'Installing dependencies...');

    return new Promise((resolve) => {
      // Respect the project's OWN package manager. Generated sandbox projects
      // are pnpm (fast hard-links from the global store), but an external
      // npm/yarn project must NEVER be pnpm-installed — mixed layouts corrupt
      // node_modules in ways that surface as bizarre runtime chunk errors.
      const pm = project.external
        ? (existsSync(join(project.rootDir, 'pnpm-lock.yaml')) ? 'pnpm'
          : existsSync(join(project.rootDir, 'yarn.lock')) ? 'yarn'
          : 'npm')
        : 'pnpm';
      const cmd = pm;
      const args = pm === 'pnpm'
        // Allow lockfile refresh for AI-edited package.json files; --prefer-offline
        // keeps repeated installs fast via pnpm's global store.
        ? ['install', '--no-frozen-lockfile', '--prefer-offline']
        : pm === 'yarn'
          ? ['install']
          : ['install', '--no-audit', '--no-fund'];
      const pkgPath = join(project.rootDir, 'package.json');
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
          };
          const deps = [
            ...Object.keys(pkg.dependencies ?? {}),
            ...Object.keys(pkg.devDependencies ?? {}),
          ];
          if (deps.length > 0) {
            this.pushLog(project, `package.json packages: ${deps.join(', ')}`);
          }
        } catch {
          // ignore package summary logging errors
        }
      }
      this.pushLog(project, `Install command: ${cmd} ${args.join(' ')}`);

      const runInstall = (installCmd: string, installArgs: string[]) => {
        this.pushLog(project, `Install: ${installCmd} ${installArgs.join(' ')}`);
        const proc = spawn(installCmd, installArgs, {
          cwd: project.rootDir,
          shell: true,
          env: { ...process.env, NODE_ENV: 'development' },
        });

        const outputChunks: string[] = [];
        proc.stdout?.on('data', (d: Buffer) => {
          const text = d.toString();
          outputChunks.push(text);
          this.pushLog(project, text.trim());
        });
        proc.stderr?.on('data', (d: Buffer) => {
          const text = d.toString();
          outputChunks.push(text);
          this.pushLog(project, text.trim());
        });
        proc.on('close', (code) => {
          const success = code === 0;
          if (!success) {
            const out = outputChunks.join('');
            if (installCmd === 'pnpm' && installArgs.includes('--frozen-lockfile') && isOutdatedPnpmLockfile(out)) {
              this.pushLog(project, 'pnpm lockfile is outdated — retrying without frozen lockfile');
              runInstall('pnpm', ['install', '--no-frozen-lockfile', '--prefer-offline']);
              return;
            }
            // If pnpm not found, retry with npm
            if (installCmd === 'pnpm' && /not found|not recognized|ENOENT/i.test(out + (code === 127 ? 'not found' : ''))) {
              this.pushLog(project, 'pnpm not found — falling back to npm install');
              runInstall('npm', ['install', '--legacy-peer-deps']);
              return;
            }
            project.status = 'failed';
          }
          this.pushLog(project, success ? '✓ Dependencies installed' : '✗ Install failed');
          resolve({ success, output: outputChunks.join('') });
        });
        proc.on('error', (err) => {
          // ENOENT means pnpm binary not found — fall back to npm
          if (installCmd === 'pnpm' && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            this.pushLog(project, 'pnpm not found — falling back to npm install');
            runInstall('npm', ['install', '--legacy-peer-deps']);
            return;
          }
          project.status = 'failed';
          this.pushLog(project, `Install error: ${err.message}`);
          resolve({ success: false, output: err.message });
        });
      };

      runInstall(cmd, args);
    });
  }

  /** Start a dev server in the sandbox */
  async startDev(projectId: string): Promise<{ port: number }> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);
    const recoveringFromFailedRun = project.status === 'failed';
    const hadTrackedDevProcess = Boolean(project.devProcess);

    // Kill existing dev process — including one whose handle was lost to a
    // runtime reload (pidfile survives lives; a second concurrent server on the
    // same project corrupts its build cache).
    if (project.devProcess) {
      project.devProcess.kill();
      project.devProcess = null;
    }
    try {
      const pidfilePath = join(this.pidDir, `${projectId}.json`);
      if (existsSync(pidfilePath)) {
        const record = JSON.parse(readFileSync(pidfilePath, 'utf-8')) as { port?: number };
        if (record.port) killPortOwner(record.port);
      }
    } catch { /* best effort */ }
    this.removePidfile(projectId);

    const port = await findFreePort(this.nextPort);
    this.nextPort = port + 1;
    project.devPort = port;
    project.status = 'building';
    project.devStderr = []; // reset stderr capture for this dev server run
    this.pushLog(project, `Starting dev server on port ${port}...`);

    // Inject console bridge for Next.js projects (no index.html to inject into).
    // NEVER for external/user folders — we don't mutate code the user didn't ask us to touch.
    const layoutPath = join(project.rootDir, 'src', 'app', 'layout.tsx');
    if (!project.external && existsSync(layoutPath)) {
      try {
        const bridgeComponentPath = join(project.rootDir, 'src', 'app', 'ConsoleBridge.tsx');
        if (!existsSync(bridgeComponentPath)) {
          const bridgeComponent = [
            "'use client';",
            "import { useEffect } from 'react';",
            'export function ConsoleBridge() {',
            '  useEffect(() => {',
            '    if ((window as any).__vaiConsoleBridge) return;',
            '    (window as any).__vaiConsoleBridge = true;',
            "    const methods = ['log', 'warn', 'error', 'info'] as const;",
            '    methods.forEach((method) => {',
            '      const orig = console[method];',
            '      console[method] = (...a: unknown[]) => {',
            '        try {',
            "          const s = a.map((x) => typeof x === 'object' ? JSON.stringify(x) : String(x));",
            "          window.parent.postMessage({ type: 'vai-sandbox-console', method, args: s }, '*');",
            '        } catch {}',
            '        return orig.apply(console, a);',
            '      };',
            '    });',
            "    window.addEventListener('error', (e) => {",
            "      window.parent.postMessage({ type: 'vai-sandbox-console', method: 'error', args: ['[Uncaught] ' + (e.message || e)] }, '*');",
            '    });',
            "    window.addEventListener('unhandledrejection', (e) => {",
            "      window.parent.postMessage({ type: 'vai-sandbox-console', method: 'error', args: ['[UnhandledRejection] ' + (e.reason?.message || String(e.reason))] }, '*');",
            '    });',
            '  }, []);',
            '  return null;',
            '}',
          ].join('\n');
          await writeFile(bridgeComponentPath, bridgeComponent, 'utf-8');
          // Inject into layout.tsx
          let layout = await readFile(layoutPath, 'utf-8');
          if (!layout.includes('ConsoleBridge')) {
            layout = "import { ConsoleBridge } from './ConsoleBridge';\n" + layout;
            layout = layout.replace(/<body([^>]*)>/, '<body$1><ConsoleBridge />');
            await writeFile(layoutPath, layout, 'utf-8');
          }
          this.pushLog(project, '  \u2713 Console bridge injected (Next.js)');
        }
      } catch { /* Non-critical \u2014 console capture may not work */ }
    }

    // Detect what to run
    let cmd: string;
    let args: string[];
    let spawnWithShell = true;

    const pkgPath = join(project.rootDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      const scripts = pkg.scripts ?? {};
          if (scripts.dev) {
        const usePnpm = existsSync(join(project.rootDir, 'pnpm-lock.yaml'));
        const devScript = typeof scripts.dev === 'string' ? scripts.dev : '';
        const hasVinextDep = !!(pkg.dependencies?.vinext ?? pkg.devDependencies?.vinext);
        const isVinext = hasVinextDep || devScript.startsWith('vinext');
        // Real-world dev scripts can be non-portable (e.g. `bash scripts/dev.sh` on Windows).
        // When the script can't run on this OS, classify by dependencies instead so we can
        // still bring the app up with the framework binary directly.
        const devScriptPortable = isDevScriptPortable(devScript);
        const hasNextDep = !!(pkg.dependencies?.next ?? pkg.devDependencies?.next);
        const hasViteDep = !!(pkg.dependencies?.vite ?? pkg.devDependencies?.vite);
        // Must check vinext before next — "vinext dev" contains the substring "next"
        const isNextjs = !isVinext && (/\bnext\b/.test(devScript) || (!devScriptPortable && hasNextDep));
            const isVite = !isVinext && !isNextjs && (/\bvite\b/.test(devScript) || (!devScriptPortable && hasViteDep));
        if (!devScriptPortable) {
          this.pushLog(project, `dev script "${devScript}" is not runnable on this OS — using the ${isNextjs ? 'next' : isVite ? 'vite' : 'npm'} binary directly`);
        }
        if (isVinext) {
          if (usePnpm) {
            cmd = 'pnpm';
            args = ['exec', 'vinext', 'dev', '--port', String(port), '--host', '0.0.0.0'];
          } else {
            cmd = 'npx';
            args = ['vinext', 'dev', '--port', String(port), '--host', '0.0.0.0'];
          }
        } else if (isNextjs) {
          // Next shares its compiled cache across dev-server lives. If the
          // previous server failed—or an external project is being reattached
          // without a trustworthy live-process handle—that cache may contain half-written chunks
          // (observed as `app/layout.js: Invalid or unexpected token` in the
          // embedded preview). Source files are untouched; only generated
          // framework output is discarded before recovery.
          if (recoveringFromFailedRun || (project.external && !hadTrackedDevProcess)) {
            this.pushLog(project, 'Clearing stale .next cache before untracked external-project start...');
            try {
              await rm(join(project.rootDir, '.next'), { recursive: true, force: true });
            } catch { /* best effort — Next can still rebuild/diagnose */ }
          }
          // Prefer the project's installed Next CLI directly. On Windows,
          // `shell: true` + `npx next dev` can detach the actual server from the
          // shell process: the wrapper exits, Vai marks the preview failed, and
          // the child becomes an orphan. Direct Node execution gives us the
          // real long-lived process and a PID that restart/stop can trust.
          const localNextCli = join(project.rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');
          if (existsSync(localNextCli)) {
            cmd = process.execPath;
            args = [localNextCli, 'dev', '--port', String(port), '--hostname', '0.0.0.0'];
            spawnWithShell = false;
          } else if (usePnpm) {
            cmd = 'pnpm';
            args = ['exec', 'next', 'dev', '--port', String(port), '--hostname', '0.0.0.0'];
          } else {
            cmd = 'npx';
            args = ['next', 'dev', '--port', String(port), '--hostname', '0.0.0.0'];
          }
            } else if (isVite) {
              if (usePnpm) {
                cmd = 'pnpm';
                args = ['exec', 'vite', '--port', String(port), '--host', '0.0.0.0'];
              } else {
                cmd = 'npx';
                args = ['vite', '--port', String(port), '--host', '0.0.0.0'];
              }
        } else {
          // Unknown/custom dev runner (e.g. `node scripts/dev-runner.ts dev`): run it UNTOUCHED.
          // Injected `--port/--host` flags break custom CLIs — rely on the PORT env hint and
          // port auto-detection from the server banner instead.
          cmd = usePnpm ? 'pnpm' : 'npm';
          args = ['run', 'dev'];
        }
      } else if (scripts.start) {
        cmd = existsSync(join(project.rootDir, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
        args = ['run', 'start'];
      } else {
        // Fallback: try npx vite
        cmd = 'npx';
        args = ['vite', '--port', String(port), '--host'];
      }
    } else {
      // No package.json — just try vite
      cmd = 'npx';
      args = ['vite', '--port', String(port), '--host'];
    }

    this.pushLog(project, `Dev command: ${cmd} ${args.join(' ')}`);

    const proc = spawn(cmd, args, {
      cwd: project.rootDir,
      shell: spawnWithShell,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    });

    project.devProcess = proc;
    // Record the server for cross-life reaping — if this runtime dies/reloads,
    // the next life kills this server instead of leaving an orphan to corrupt
    // the project's build cache with a second concurrent instance.
    this.writePidfile(projectId, proc.pid, port);

    let resolveObservedPort: ((value: number) => void) | null = null;
    let readySignalSeen = false;
    let portSettled = false;
    let readyPortSettleTimer: NodeJS.Timeout | null = null;
    const observedPort = new Promise<number>((resolve) => {
      resolveObservedPort = resolve;
    });

    const clearReadyPortSettleTimer = () => {
      if (readyPortSettleTimer) {
        clearTimeout(readyPortSettleTimer);
        readyPortSettleTimer = null;
      }
    };

    const settleObservedPort = (value: number) => {
      clearReadyPortSettleTimer();
      portSettled = true;
      resolveObservedPort?.(value);
      resolveObservedPort = null;
    };

    const updateObservedPort = (text: string): number | null => {
      const detectedPort = extractBoundPort(stripAnsi(text));
      if (!detectedPort) return null;
      if (detectedPort === project.devPort) return detectedPort;
      // Multi-process dev runners (web + api server) print several port banners.
      // Once the user-facing port has settled, later banners (e.g. an API server
      // on another port) must not steal the preview URL.
      if (portSettled) return null;
      project.devPort = detectedPort;
      this.nextPort = Math.max(this.nextPort, detectedPort + 1);
      this.pushLog(project, `Detected actual dev server port: ${detectedPort}`);
      if (readySignalSeen) {
        settleObservedPort(detectedPort);
      }
      return detectedPort;
    };

    const markRunningIfReady = (text: string) => {
      if (project.status === 'failed') return;
      const normalizedText = stripAnsi(text);
      const detectedPort = updateObservedPort(normalizedText);
      if (/(^|\b)(ready|localhost|local:|listening on|running on http|http:\/\/0\.0\.0\.0:)/i.test(normalizedText)) {
        project.status = 'running';
        readySignalSeen = true;
        if (detectedPort) {
          settleObservedPort(detectedPort);
          return;
        }
        if (!readyPortSettleTimer) {
          readyPortSettleTimer = setTimeout(() => {
            settleObservedPort(project.devPort ?? port);
          }, READY_PORT_SETTLE_MS);
        }
      }
    };

    proc.stdout?.on('data', (d: Buffer) => {
      const text = d.toString();
      this.pushLog(project, text.trim());
      markRunningIfReady(text);
    });
    proc.stderr?.on('data', (d: Buffer) => {
      const text = d.toString();
      this.pushLog(project, text.trim());
      // Keep a separate stderr ring for repair context (last 50 lines)
      const lines = text.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        if (project.devStderr.length >= 50) project.devStderr.shift();
        project.devStderr.push(line);
      }
      markRunningIfReady(text);
    });
    proc.on('close', (code, signal) => {
      // A restarted server may already own project.devProcess. A late close
      // from the previous process must never null or fail the replacement.
      if (project.devProcess === proc) {
        project.devProcess = null;
        if (project.status === 'building' || project.status === 'running') {
          project.status = 'failed';
          this.pushLog(project, `Dev server exited${code !== null ? ` (code ${code})` : signal ? ` (${signal})` : ''}`);
        }
      }
      settleObservedPort(project.devPort ?? port);
    });
    proc.on('error', (error) => {
      if (project.devProcess === proc) {
        project.devProcess = null;
        project.status = 'failed';
        this.pushLog(project, `Dev server error: ${error.message}`);
      }
      settleObservedPort(project.devPort ?? port);
    });

    const settledPort = await Promise.race([
      observedPort,
      new Promise<number>((resolve) => setTimeout(() => resolve(project.devPort ?? port), START_DEV_TIMEOUT_MS)),
    ]);

    // The server may have bound a different port than requested (framework picked
    // its own). Keep the pidfile accurate so reaping targets the real port.
    if (settledPort !== port) this.writePidfile(projectId, proc.pid, settledPort);

    // A dev server can be "ready" while the app root is still a real user-facing
    // failure (Vite/SSR 500, missing env JSON, framework overlay). For opened
    // local folders, verify the rendered root before the desktop app paints the
    // preview green; otherwise Vai looks confident while the iframe is broken.
    if (project.external && (project.status as SandboxProject['status']) === 'running') {
      const health = await checkPreviewHealth(settledPort);
      if (!health.ok) {
        if (previewHealthDisposition(health) === 'pending') {
          this.pushLog(project, 'Preview is still compiling; keeping the dev server live while the App view waits.');
          return { port: settledPort };
        }
        const concreteStderr = project.devStderr
          .slice()
          .reverse()
          .find((line) => /Missing VITE_[A-Z0-9_]+|Error:/i.test(line.trim()));
        const detail = (concreteStderr ?? health.message).trim().replace(/^cause:\s*/i, '');
        const message = `Preview health check failed: ${detail}`;
        project.status = 'failed';
        this.pushLog(project, message);
        if (project.devStderr.length >= 50) project.devStderr.shift();
        project.devStderr.push(message);
      }
    }

    return { port: settledPort };
  }

  /** Stop the dev server for a project */
  stopDev(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;
    if (project.devProcess) {
      // On Windows, kill the entire process tree (shell: true means child spawns a sub-process)
      if (process.platform === 'win32' && project.devProcess.pid) {
        try {
          execSync(`taskkill /PID ${project.devProcess.pid} /T /F`, { stdio: 'ignore' });
        } catch { /* Best effort */ }
      } else {
        project.devProcess.kill('SIGTERM');
      }
      project.devProcess = null;
    } else if (project.devPort) {
      // Handle lost to a runtime reload — kill by port so stop ALWAYS works.
      killPortOwner(project.devPort);
    }
    this.removePidfile(projectId);
    project.status = 'idle';
    project.devPort = null;
  }

  /** Delete a sandbox project. External/user folders are ONLY closed — never deleted. */
  async destroy(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    this.stopDev(projectId);

    // Belt and braces: only ever rm folders we created under our own baseDir.
    if (!project.external && !this.isOutsideBaseDir(project.rootDir)) {
      try {
        await rm(project.rootDir, { recursive: true, force: true });
      } catch { /* cleanup failure is ok */ }
    }

    this.projects.delete(projectId);
  }

  /**
   * Run a package.json script (build / lint / test / typecheck …) inside the project.
   * One command at a time per project — protects the machine from stacked heavy tasks.
   * Output streams into project logs and the CommandRun ring buffer; poll GET /:id.
   */
  runCommand(projectId: string, script: string): CommandRun {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);
    if (project.commandRun?.status === 'running') {
      throw new Error(`A command is already running (${project.commandRun.script}) — wait for it to finish`);
    }
    if (!/^[\w:.-]+$/.test(script)) throw new Error(`Invalid script name: ${script}`);
    if (script === 'dev' || script === 'start') {
      throw new Error('Use the dev-server controls for dev/start');
    }
    const pkgPath = join(project.rootDir, 'package.json');
    if (!existsSync(pkgPath)) throw new Error('No package.json in this project');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
    if (!pkg.scripts?.[script]) throw new Error(`Script "${script}" is not defined in package.json`);

    const usePnpm = existsSync(join(project.rootDir, 'pnpm-lock.yaml'));
    const cmd = usePnpm ? 'pnpm' : existsSync(join(project.rootDir, 'yarn.lock')) ? 'yarn' : 'npm';

    const run: CommandRun = {
      script,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      exitCode: null,
      output: [],
    };
    project.commandRun = run;
    this.pushLog(project, `▶ ${cmd} run ${script}`);

    const proc = spawn(cmd, ['run', script], {
      cwd: project.rootDir,
      shell: true,
      env: { ...process.env },
    });

    const capture = (d: Buffer) => {
      for (const raw of d.toString().split('\n')) {
        const line = stripAnsi(raw).trimEnd();
        if (!line.trim()) continue;
        if (run.output.length >= 400) run.output.shift();
        run.output.push(line);
        this.pushLog(project, line);
      }
    };
    proc.stdout?.on('data', capture);
    proc.stderr?.on('data', capture);

    // Safety net: kill runaway commands after 10 minutes.
    const killTimer = setTimeout(() => {
      if (run.status !== 'running') return;
      if (process.platform === 'win32' && proc.pid) {
        try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch { /* best effort */ }
      } else {
        proc.kill('SIGTERM');
      }
      this.pushLog(project, `✗ ${script} timed out after 10 minutes — killed`);
    }, 10 * 60_000);

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      run.exitCode = code;
      run.finishedAt = Date.now();
      run.status = code === 0 ? 'done' : 'failed';
      this.pushLog(project, code === 0 ? `✓ ${script} finished` : `✗ ${script} failed (exit ${code})`);
    });
    proc.on('error', (err) => {
      clearTimeout(killTimer);
      run.finishedAt = Date.now();
      run.status = 'failed';
      this.pushLog(project, `✗ ${script} error: ${err.message}`);
    });

    return run;
  }

  /** Await the project's current command run (poll-based; resolves when it settles). */
  private awaitCommand(project: SandboxProject): Promise<CommandRun | null> {
    return new Promise((resolveRun) => {
      const check = () => {
        const run = project.commandRun;
        if (!run || run.status !== 'running') { resolveRun(run); return; }
        setTimeout(check, 500);
      };
      check();
    });
  }

  /**
   * Switch the app window between environment lanes:
   *   dev        → the framework dev server (HMR) — the default.
   *   preview    → `build`, then serve the built output locally.
   *   production → lint + typecheck gates, then `build`, then serve.
   *
   * Blue-green promise: the CURRENT server keeps serving while gates/build run;
   * the swap happens only when the new lane is ready. A failed switch restores dev.
   */
  async switchLane(projectId: string, lane: EnvLane): Promise<LaneState> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);
    if (project.laneState?.status === 'switching') {
      throw new Error(`Already switching to ${project.laneState.lane} — wait for it to finish`);
    }
    if (project.commandRun?.status === 'running') {
      throw new Error(`A command is running (${project.commandRun.script}) — wait for it to finish`);
    }

    const state: LaneState = { lane, status: 'switching', stage: 'preparing', startedAt: Date.now(), error: null };
    project.laneState = state;
    this.pushLog(project, `⇆ Switching app to ${lane}…`);

    const profile = detectProjectProfile(project.rootDir);
    // Frameworks whose build writes into the SAME directory the dev server is
    // serving from (Next/Vinext: .next). Building under a live dev server
    // corrupts both (live failure: routes-manifest ENOENT + missing chunks).
    // Vite-family builds into dist/, which dev ignores → true blue-green there.
    const buildCollidesWithDev = profile.framework === 'nextjs' || profile.framework === 'vinext';

    try {
      if (lane === 'dev') {
        state.stage = 'starting dev server';
        this.stopDev(projectId);
        project.status = 'building';
        await this.startDev(projectId);
        project.envLane = 'dev';
        state.status = 'ready';
        state.stage = null;
        this.pushLog(project, '✓ dev lane ready');
        return state;
      }

      if (!profile.scripts.build) throw new Error('No "build" script in package.json — cannot build this app');

      // Production gate: lint + typecheck must pass BEFORE we spend time building.
      if (lane === 'production') {
        for (const gate of ['lint', 'typecheck'] as const) {
          if (!profile.scripts[gate]) continue;
          state.stage = `gate: ${gate}`;
          this.runCommand(projectId, gate);
          const run = await this.awaitCommand(project);
          if (run?.exitCode !== 0) {
            throw new Error(`${gate} failed (exit ${run?.exitCode ?? '?'}) — fix it before going to production`);
          }
        }
      }

      // Build. True blue-green (old server keeps serving) only when the build
      // output cannot collide with the dev server's working directory.
      if (buildCollidesWithDev) {
        state.stage = 'stopping dev server (Next.js build shares .next)';
        this.stopDev(projectId);
        // A previous collided build may have left .next corrupted — clear it.
        try { await rm(join(project.rootDir, '.next'), { recursive: true, force: true }); } catch { /* best effort */ }
      }
      state.stage = 'building';
      this.runCommand(projectId, 'build');
      const buildRun = await this.awaitCommand(project);
      if (buildRun?.exitCode !== 0) {
        throw new Error(`build failed (exit ${buildRun?.exitCode ?? '?'}) — check the console`);
      }

      // Swap: stop the old server only now, then serve the built output.
      state.stage = 'starting server';
      this.stopDev(projectId);
      project.status = 'building';
      await this.startServeProcess(project, lane, profile);
      project.status = 'running';
      project.envLane = lane;
      state.status = 'ready';
      state.stage = null;
      this.pushLog(project, `✓ ${lane} lane ready on port ${project.devPort}`);
      return state;
    } catch (err) {
      state.status = 'failed';
      state.error = err instanceof Error ? err.message : String(err);
      state.stage = null;
      this.pushLog(project, `✗ ${lane} switch failed: ${state.error}`);
      // Restore the dev lane if the swap left the app without a server.
      if (!project.devProcess) {
        try {
          project.status = 'building';
          await this.startDev(projectId);
          project.envLane = 'dev';
          this.pushLog(project, '↩ dev server restored');
        } catch { /* stays down — surfaced by status */ }
      }
      return state;
    }
  }

  /** Serve the built output for preview/production and wait for readiness. */
  private async startServeProcess(project: SandboxProject, lane: EnvLane, profile: ProjectProfile): Promise<void> {
    const port = await findFreePort(this.nextPort);
    this.nextPort = port + 1;
    const usePnpm = profile.packageManager === 'pnpm';

    let cmd: string;
    let args: string[];
    if (profile.framework === 'vinext') {
      cmd = usePnpm ? 'pnpm' : 'npx';
      args = usePnpm ? ['exec', 'vinext', 'start', '--port', String(port)] : ['vinext', 'start', '--port', String(port)];
    } else if (profile.framework === 'nextjs') {
      cmd = usePnpm ? 'pnpm' : 'npx';
      args = usePnpm
        ? ['exec', 'next', 'start', '--port', String(port), '--hostname', '0.0.0.0']
        : ['next', 'start', '--port', String(port), '--hostname', '0.0.0.0'];
    } else if (profile.framework === 'vite' || profile.framework === 'astro' || profile.framework === 'remix') {
      cmd = usePnpm ? 'pnpm' : 'npx';
      args = usePnpm
        ? ['exec', 'vite', 'preview', '--port', String(port), '--host', '0.0.0.0']
        : ['vite', 'preview', '--port', String(port), '--host', '0.0.0.0'];
    } else if (profile.scripts.start) {
      cmd = usePnpm ? 'pnpm' : 'npm';
      args = ['run', 'start'];
    } else {
      throw new Error(`No serve strategy for a built ${profile.frameworkLabel} app`);
    }

    this.pushLog(project, `Serve command (${lane}): ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, {
      cwd: project.rootDir,
      shell: true,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'production' },
    });
    project.devProcess = proc;
    project.devPort = port;
    this.writePidfile(project.id, proc.pid, port);

    proc.stdout?.on('data', (d: Buffer) => this.pushLog(project, stripAnsi(d.toString()).trim()));
    proc.stderr?.on('data', (d: Buffer) => this.pushLog(project, stripAnsi(d.toString()).trim()));
    proc.on('close', () => {
      project.devProcess = null;
      if (project.status === 'building') project.status = 'failed';
    });

    // Readiness: the server answers HTTP (any status) within 60s.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (!project.devProcess) throw new Error('server exited before becoming ready — check the console');
      try {
        await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(3_000) });
        return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error('server did not answer within 60s');
  }

  /** Get recent logs for a project */
  getLogs(projectId: string, count = 50): string[] {
    const project = this.projects.get(projectId);
    if (!project) return [];
    return project.logs.slice(-count);
  }

  /**
   * VS Code-style project text search. Walks project files (skipping node_modules,
   * build output, and binary formats), matching per line with case / whole-word /
   * regex options. Read-only.
   */
  async searchFiles(projectId: string, options: SearchFilesOptions): Promise<SearchFilesResult> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);

    const pattern = buildSearchRegex(options);
    const maxResults = Math.min(Math.max(options.maxResults ?? 500, 1), 2000);
    const paths = await this.listFiles(projectId);

    const matches: SearchFileMatch[] = [];
    let totalMatches = 0;
    let filesScanned = 0;
    let truncated = false;

    for (const path of paths) {
      if (truncated) break;
      if (BINARY_EXT_RE.test(path)) continue;
      let content: string;
      try {
        const full = this.safePath(project.rootDir, path);
        const stat = statSync(full);
        if (stat.size > MAX_SEARCH_FILE_BYTES) continue;
        content = await readFile(full, 'utf-8');
      } catch { continue; }
      if (content.includes('\u0000')) continue; // binary content sneaked past the extension filter
      filesScanned += 1;

      const lines = content.split('\n');
      let fileMatches: SearchLineMatch[] | null = null;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(line)) !== null) {
          if (totalMatches >= maxResults) { truncated = true; break; }
          fileMatches ??= [];
          fileMatches.push({
            line: i + 1,
            column: m.index + 1,
            matchText: m[0].slice(0, 200),
            preview: line.length > 300 ? line.slice(Math.max(0, m.index - 80), m.index + 220) : line,
          });
          totalMatches += 1;
          if (m[0].length === 0) pattern.lastIndex += 1; // avoid zero-width infinite loops
        }
        if (truncated) break;
      }
      if (fileMatches) matches.push({ path, matches: fileMatches });
    }

    return { files: matches, totalMatches, filesScanned, truncated };
  }

  /**
   * Replace matches across project files (same options as searchFiles).
   * Returns the before/after snapshots of every changed file so the caller
   * can record a revertable revision. Restricted to `paths` when provided.
   */
  async replaceInFiles(
    projectId: string,
    options: SearchFilesOptions & { replacement: string; paths?: string[] },
  ): Promise<{ changes: { path: string; beforeContent: string; afterContent: string }[]; replacements: number }> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);

    const pattern = buildSearchRegex(options);
    const allowed = options.paths?.length ? new Set(options.paths) : null;
    const paths = await this.listFiles(projectId);
    const changes: { path: string; beforeContent: string; afterContent: string }[] = [];
    let replacements = 0;

    for (const path of paths) {
      if (allowed && !allowed.has(path)) continue;
      if (BINARY_EXT_RE.test(path)) continue;
      let content: string;
      try {
        const full = this.safePath(project.rootDir, path);
        if (statSync(full).size > MAX_SEARCH_FILE_BYTES) continue;
        content = await readFile(full, 'utf-8');
      } catch { continue; }
      if (content.includes('\u0000')) continue;

      pattern.lastIndex = 0;
      if (!pattern.test(content)) continue;
      pattern.lastIndex = 0;
      let count = 0;
      const next = content.replace(pattern, () => { count += 1; return options.replacement; });
      if (next === content) continue;
      replacements += count;
      changes.push({ path, beforeContent: content, afterContent: next });
    }

    return { changes, replacements };
  }

  /**
   * Stop every running dev server WITHOUT deleting project files.
   * Called on runtime shutdown — sandbox children are spawned with
   * shell:true and outlive the runtime on Windows otherwise.
   */
  stopAllDev(): void {
    for (const id of this.projects.keys()) {
      this.stopDev(id);
    }
  }

  /** Cleanup all projects */
  async destroyAll(): Promise<void> {
    for (const id of this.projects.keys()) {
      await this.destroy(id);
    }
  }
}
