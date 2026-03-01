import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getTemplate, SANDBOX_TEMPLATES, type SandboxTemplate } from './templates.js';

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

  /** Write files to the sandbox project */
  async writeFiles(projectId: string, files: FileWrite[]): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);

    project.status = 'writing';
    project.logs.push(`Writing ${files.length} file(s)...`);

    for (const file of files) {
      const fullPath = join(project.rootDir, file.path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, 'utf-8');
      project.files[file.path] = file.content;
      project.logs.push(`  ✓ ${file.path}`);
    }
  }

  /** Read a file from the sandbox project */
  async readFile(projectId: string, filePath: string): Promise<string> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);
    return readFile(join(project.rootDir, filePath), 'utf-8');
  }

  /** List files in the sandbox project directory tree */
  async listFiles(projectId: string, subDir = ''): Promise<string[]> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Sandbox project not found: ${projectId}`);

    const dir = join(project.rootDir, subDir);
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
      const args = ['install'];

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

    const port = this.nextPort++;
    project.devPort = port;
    project.status = 'building';
    project.logs.push(`Starting dev server on port ${port}...`);

    // Detect what to run
    let cmd: string;
    let args: string[];

    const pkgPath = join(project.rootDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      const scripts = pkg.scripts ?? {};
      if (scripts.dev) {
        cmd = existsSync(join(project.rootDir, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
        args = ['run', 'dev', '--', '--port', String(port), '--host'];
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
      project.devProcess.kill();
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
