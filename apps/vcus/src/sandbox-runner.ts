/**
 * VCUS Sandbox Runner
 *
 * Executes code that VAI generates in a safe sandbox environment.
 * Supports:
 * - TypeScript/JavaScript (via tsx)
 * - Next.js project scaffolding + dev server
 * - Compilation checks (tsc --noEmit)
 * - Output capture and verification
 *
 * Each sandbox run gets an isolated directory under apps/vcus/sandbox/.
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SANDBOX_ROOT = resolve(import.meta.dirname, '..', 'sandbox');

interface SandboxOptions {
  /** Name for this sandbox instance */
  name: string;
  /** Language/runtime: 'ts' | 'js' | 'nextjs' | 'node' */
  runtime: 'ts' | 'js' | 'nextjs' | 'node';
  /** Files to write into the sandbox */
  files: Record<string, string>;
  /** Command to execute after setup */
  command?: string;
  /** Timeout in ms (default: 30s) */
  timeout?: number;
  /** Whether to keep the sandbox after execution */
  keepAlive?: boolean;
}

interface SandboxResult {
  success: boolean;
  output: string;
  errors: string;
  exitCode: number | null;
  sandboxPath: string;
  compilationErrors?: string[];
  files: string[];
}

/**
 * Create a sandbox directory with the given files.
 */
function setupSandbox(name: string, files: Record<string, string>): string {
  const dir = join(SANDBOX_ROOT, name);

  // Clean previous run
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });

  // Write files
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    const parentDir = fullPath.replace(/[/\\][^/\\]+$/, '');
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }

  return dir;
}

/**
 * Run TypeScript type checking on sandbox files.
 */
function typeCheck(sandboxPath: string): string[] {
  const errors: string[] = [];

  // Create a minimal tsconfig if none exists
  if (!existsSync(join(sandboxPath, 'tsconfig.json'))) {
    writeFileSync(join(sandboxPath, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ES2022',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ['**/*.ts', '**/*.tsx'],
    }, null, 2));
  }

  try {
    execSync('npx tsc --noEmit', {
      cwd: sandboxPath,
      encoding: 'utf-8',
      timeout: 15000,
    });
  } catch (err) {
    const output = (err as { stdout?: string; stderr?: string }).stdout ??
                   (err as { stderr?: string }).stderr ?? '';
    // Parse TypeScript errors
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes(': error TS')) {
        errors.push(line.trim());
      }
    }
    if (errors.length === 0 && output.trim()) {
      errors.push(output.trim());
    }
  }

  return errors;
}

/**
 * Execute code in the sandbox.
 */
export async function runSandbox(options: SandboxOptions): Promise<SandboxResult> {
  const sandboxPath = setupSandbox(options.name, options.files);
  const timeout = options.timeout ?? 30000;

  // Type-check TypeScript files
  let compilationErrors: string[] | undefined;
  const hasTsFiles = Object.keys(options.files).some(f => f.endsWith('.ts') || f.endsWith('.tsx'));
  if (hasTsFiles && options.runtime !== 'nextjs') {
    compilationErrors = typeCheck(sandboxPath);
  }

  // Execute command
  const command = options.command ?? (options.runtime === 'ts' ? 'npx tsx index.ts' : 'node index.js');

  let output = '';
  let errors = '';
  let exitCode: number | null = null;

  try {
    const result = execSync(command, {
      cwd: sandboxPath,
      encoding: 'utf-8',
      timeout,
      env: { ...process.env, NODE_ENV: 'development' },
    });
    output = result;
    exitCode = 0;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    output = e.stdout ?? '';
    errors = e.stderr ?? '';
    exitCode = e.status ?? 1;
  }

  // List sandbox files
  const files = listFiles(sandboxPath);

  // Cleanup unless keepAlive
  if (!options.keepAlive) {
    setTimeout(() => {
      rmSync(sandboxPath, { recursive: true, force: true });
    }, 5000);
  }

  return {
    success: exitCode === 0 && (!compilationErrors || compilationErrors.length === 0),
    output: output.trim(),
    errors: errors.trim(),
    exitCode,
    sandboxPath,
    compilationErrors,
    files,
  };
}

/**
 * Scaffold a Next.js project in the sandbox for preview.
 */
export async function scaffoldNextProject(
  name: string,
  files: Record<string, string>,
): Promise<{ sandboxPath: string; devProcess: ChildProcess }> {
  const sandboxPath = setupSandbox(name, {
    'package.json': JSON.stringify({
      name: `vai-sandbox-${name}`,
      private: true,
      scripts: { dev: 'next dev --port 3100' },
      dependencies: {
        next: 'latest',
        react: 'latest',
        'react-dom': 'latest',
      },
    }, null, 2),
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2017',
        lib: ['dom', 'dom.iterable', 'esnext'],
        jsx: 'preserve',
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ['**/*.ts', '**/*.tsx'],
    }, null, 2),
    'next.config.js': 'module.exports = {}',
    ...files,
  });

  // Install deps
  console.log(`[Sandbox] Installing dependencies in ${sandboxPath}...`);
  execSync('npm install', { cwd: sandboxPath, stdio: 'pipe', timeout: 60000 });

  // Start dev server
  const devProcess = spawn('npx', ['next', 'dev', '--port', '3100'], {
    cwd: sandboxPath,
    stdio: 'pipe',
    shell: true,
  });

  return { sandboxPath, devProcess };
}

function listFiles(dir: string, prefix = ''): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      files.push(...listFiles(join(dir, e.name), path));
    } else {
      files.push(path);
    }
  }
  return files;
}

// ─── CLI ────────────────────────────────────────────────────────

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('sandbox-runner.ts')) {

  // Quick self-test
  console.log('🧪 Sandbox self-test...\n');

  const result = await runSandbox({
    name: 'self-test',
    runtime: 'ts',
    files: {
      'index.ts': `
        const greeting: string = "Hello from VAI sandbox!";
        console.log(greeting);
        console.log("TypeScript execution works ✅");
      `,
    },
  });

  console.log(`Success: ${result.success}`);
  console.log(`Output: ${result.output}`);
  if (result.compilationErrors?.length) {
    console.log(`Compilation errors: ${result.compilationErrors.join('\n')}`);
  }
  if (result.errors) {
    console.log(`Runtime errors: ${result.errors}`);
  }
}
