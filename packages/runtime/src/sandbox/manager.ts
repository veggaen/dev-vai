import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
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
  createdAt: Date;
}

export interface FileWrite {
  path: string;   // relative to project root, e.g. "src/App.tsx"
  content: string;
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

/**
 * SandboxManager — creates temporary project directories, writes files,
 * installs deps, and runs dev servers for builder mode preview.
 */
const MAX_LOG_ENTRIES = 500;
const START_DEV_TIMEOUT_MS = 6000;
const READY_PORT_SETTLE_MS = 1500;

export class SandboxManager {
  private projects = new Map<string, SandboxProject>();
  private baseDir: string;
  private nextPort = 4100; // sandbox dev servers start at 4100

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(tmpdir(), 'vai-sandbox');
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
      createdAt: new Date(),
    };

    this.projects.set(id, project);
    return project;
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
      createdAt: new Date(),
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
      createdAt: new Date(),
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

  /** Resolve a file path within the sandbox root, guarding against path traversal. */
  private safePath(rootDir: string, filePath: string): string {
    const full = resolve(rootDir, filePath);
    if (!full.startsWith(rootDir)) {
      throw new Error(`Path traversal blocked: ${filePath}`);
    }
    return full;
  }

  /** Write files to the sandbox project */
  async writeFiles(projectId: string, files: FileWrite[], callerUserId?: string | null): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);
    if (callerUserId !== undefined && !this.canWrite(projectId, callerUserId)) {
      throw new Error(`Access denied: user ${callerUserId ?? 'anonymous'} cannot write to project ${projectId}`);
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
  }

  /** Read a file from the sandbox project */
  async readFile(projectId: string, filePath: string): Promise<string> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);
    return readFile(this.safePath(project.rootDir, filePath), 'utf-8');
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
      // Always prefer pnpm: uses a global content-addressable store with hard-links,
      // so repeated installs with the same packages are nearly instant.
      // Fall back to npm only if pnpm isn't on PATH.
      const hasLockfile = existsSync(join(project.rootDir, 'pnpm-lock.yaml'));
      const cmd = 'pnpm';
      // --frozen-lockfile: skip resolution entirely if lockfile matches (fastest path)
      // --no-frozen-lockfile: resolve normally when lockfile absent (custom AI-generated package.json)
      const args = hasLockfile
        ? ['install', '--frozen-lockfile', '--prefer-offline']
        : ['install', '--no-frozen-lockfile', '--prefer-offline'];
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

    // Kill existing dev process
    if (project.devProcess) {
      project.devProcess.kill();
      project.devProcess = null;
    }

    const port = await findFreePort(this.nextPort);
    this.nextPort = port + 1;
    project.devPort = port;
    project.status = 'building';
    project.devStderr = []; // reset stderr capture for this dev server run
    this.pushLog(project, `Starting dev server on port ${port}...`);

    // Inject console bridge for Next.js projects (no index.html to inject into)
    const layoutPath = join(project.rootDir, 'src', 'app', 'layout.tsx');
    if (existsSync(layoutPath)) {
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

    const pkgPath = join(project.rootDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      const scripts = pkg.scripts ?? {};
      if (scripts.dev) {
        const usePnpm = existsSync(join(project.rootDir, 'pnpm-lock.yaml'));
        // Next.js uses --hostname, and running it through `pnpm run dev -- --port ...`
        // injects a literal `--` that Next treats as a project directory.
        const isNextjs = typeof scripts.dev === 'string' && scripts.dev.includes('next');
        if (isNextjs) {
          if (usePnpm) {
            cmd = 'pnpm';
            args = ['exec', 'next', 'dev', '--port', String(port), '--hostname', '0.0.0.0'];
          } else {
            cmd = 'npx';
            args = ['next', 'dev', '--port', String(port), '--hostname', '0.0.0.0'];
          }
        } else {
          cmd = usePnpm ? 'pnpm' : 'npm';
          args = ['run', 'dev', '--', '--port', String(port), '--host'];
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
      shell: true,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    });

    project.devProcess = proc;

    let resolveObservedPort: ((value: number) => void) | null = null;
    let readySignalSeen = false;
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
      resolveObservedPort?.(value);
      resolveObservedPort = null;
    };

    const updateObservedPort = (text: string): number | null => {
      const detectedPort = extractBoundPort(stripAnsi(text));
      if (!detectedPort) return null;
      if (detectedPort === project.devPort) return detectedPort;
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
    proc.on('close', () => {
      project.devProcess = null;
      if (project.status === 'building') project.status = 'failed';
      settleObservedPort(project.devPort ?? port);
    });

    const settledPort = await Promise.race([
      observedPort,
      new Promise<number>((resolve) => setTimeout(() => resolve(project.devPort ?? port), START_DEV_TIMEOUT_MS)),
    ]);

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
    }
    project.status = 'idle';
    project.devPort = null;
  }

  /** Delete a sandbox project entirely */
  async destroy(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    this.stopDev(projectId);

    try {
      await rm(project.rootDir, { recursive: true, force: true });
    } catch { /* cleanup failure is ok */ }

    this.projects.delete(projectId);
  }

  /** Get recent logs for a project */
  getLogs(projectId: string, count = 50): string[] {
    const project = this.projects.get(projectId);
    if (!project) return [];
    return project.logs.slice(-count);
  }

  /** Cleanup all projects */
  async destroyAll(): Promise<void> {
    for (const id of this.projects.keys()) {
      await this.destroy(id);
    }
  }
}
