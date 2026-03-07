import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
  files: Record<string, string>; // path -> content
  devProcess: ChildProcess | null;
  devPort: number | null;
  logs: string[];
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

/**
 * SandboxManager — creates temporary project directories, writes files,
 * installs deps, and runs dev servers for builder mode preview.
 */
export class SandboxManager {
  private projects = new Map<string, SandboxProject>();
  private baseDir: string;
  private nextPort = 4100; // sandbox dev servers start at 4100

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(tmpdir(), 'vai-sandbox');
  }

  /** Create a new sandbox project */
  async create(name: string): Promise<SandboxProject> {
    const id = randomUUID().slice(0, 8);
    const rootDir = join(this.baseDir, `${id}-${name.replace(/[^a-zA-Z0-9-_]/g, '-')}`);

    await mkdir(rootDir, { recursive: true });

    const project: SandboxProject = {
      id,
      name,
      rootDir,
      files: {},
      devProcess: null,
      devPort: null,
      logs: [],
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
  async createFromTemplate(templateId: string, name?: string): Promise<SandboxProject> {
    const template = getTemplate(templateId);
    if (!template) throw new Error(`Unknown template: ${templateId}`);

    const projectName = name || template.name.toLowerCase().replace(/\s+/g, '-');
    const project = await this.create(projectName);

    // Write template files
    await this.writeFiles(project.id, template.files);
    project.logs.push(`Scaffolded from template: ${template.name}`);

    return project;
  }

  /** List all active projects */
  list(): SandboxProject[] {
    return Array.from(this.projects.values()).map((p) => ({
      ...p,
      devProcess: null, // Don't serialize ChildProcess
    }));
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
  async writeFiles(projectId: string, files: FileWrite[]): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);

    project.status = 'writing';
    project.logs.push(`Writing ${files.length} file(s)...`);

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
      project.logs.push(`  ✓ ${file.path}`);
    }
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
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) {
        result.push(...await this.listFiles(projectId, rel));
      } else {
        result.push(rel);
      }
    }
    return result;
  }

  /** Install dependencies (npm install) */
  async install(projectId: string): Promise<{ success: boolean; output: string }> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);

    project.status = 'installing';
    project.logs.push('Installing dependencies...');

    return new Promise((resolve) => {
      // Detect package manager from lockfiles
      const usePnpm = existsSync(join(project.rootDir, 'pnpm-lock.yaml'));
      const cmd = usePnpm ? 'pnpm' : 'npm';
      const args = usePnpm ? ['install'] : ['install', '--legacy-peer-deps'];

      const proc = spawn(cmd, args, {
        cwd: project.rootDir,
        shell: true,
        env: { ...process.env, NODE_ENV: 'development' },
      });

      let output = '';
      proc.stdout?.on('data', (d: Buffer) => {
        const text = d.toString();
        output += text;
        project.logs.push(text.trim());
      });
      proc.stderr?.on('data', (d: Buffer) => {
        const text = d.toString();
        output += text;
        project.logs.push(text.trim());
      });
      proc.on('close', (code) => {
        const success = code === 0;
        if (!success) project.status = 'failed';
        project.logs.push(success ? '✓ Dependencies installed' : '✗ Install failed');
        resolve({ success, output });
      });
      proc.on('error', (err) => {
        project.status = 'failed';
        project.logs.push(`Install error: ${err.message}`);
        resolve({ success: false, output: err.message });
      });
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
    project.logs.push(`Starting dev server on port ${port}...`);

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
          project.logs.push('  \u2713 Console bridge injected (Next.js)');
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
        cmd = existsSync(join(project.rootDir, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
        // Next.js uses --hostname, not --host
        const isNextjs = typeof scripts.dev === 'string' && scripts.dev.includes('next');
        if (isNextjs) {
          args = ['run', 'dev', '--', '--port', String(port), '--hostname', '0.0.0.0'];
        } else {
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

    const proc = spawn(cmd, args, {
      cwd: project.rootDir,
      shell: true,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    });

    project.devProcess = proc;

    proc.stdout?.on('data', (d: Buffer) => {
      const text = d.toString();
      project.logs.push(text.trim());
      // Detect when server is ready
      if (text.includes('ready') || text.includes('localhost') || text.includes('Local:')) {
        project.status = 'running';
      }
    });
    proc.stderr?.on('data', (d: Buffer) => {
      project.logs.push(d.toString().trim());
    });
    proc.on('close', () => {
      project.devProcess = null;
      if (project.status === 'building') project.status = 'failed';
    });

    return { port };
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
