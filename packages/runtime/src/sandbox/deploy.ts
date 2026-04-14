/**
 * Deploy pipeline — orchestrated stack deployment with streaming progress events.
 * Creates a project from a stack template, installs deps, builds, optionally
 * verifies with Docker, runs tests, starts the dev server, and health-checks.
 */

import { execSync, type ExecSyncOptions } from 'node:child_process';

/** Cross-platform exec options — use cmd.exe on Windows to support && in npm scripts */
const EXEC_SHELL: Pick<ExecSyncOptions, 'shell'> =
  process.platform === 'win32' ? { shell: 'cmd.exe' } : {};
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SandboxManager } from './manager.js';
import { getStackTemplate } from './stacks/index.js';

/** A progress event emitted during deployment */
export interface DeployEvent {
  step: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  message: string;
  detail?: string;
  projectId?: string;
  port?: number;
  elapsed?: number;
}

export type DeployEmitter = (event: DeployEvent) => void;

/** Check if Docker CLI is installed AND daemon is running */
function isDockerAvailable(): boolean {
  try {
    execSync('docker --version', { stdio: 'pipe', timeout: 5000 });
    // Also verify daemon is responsive — `docker version` requires a running daemon
    execSync('docker version', { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/** Wait for a health endpoint to respond */
async function waitForHealth(port: number, timeout = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://localhost:${port}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Wait for any URL to return a successful response */
async function waitForUrl(url: string, timeout = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Deploy a stack template with full pipeline and progress events.
 * Steps: scaffold → install → build → docker → test → start → verify
 */
export async function deployStack(
  sandbox: SandboxManager,
  stackId: string,
  tier: string,
  name: string | undefined,
  emit: DeployEmitter,
  ownerUserId?: string | null,
): Promise<{ projectId: string; port: number } | null> {
  const startTime = Date.now();
  const elapsed = () => Date.now() - startTime;

  /* ── Step 1: Scaffold ── */
  emit({ step: 'scaffold', status: 'running', message: 'Finding template...' });

  // Next.js basic → use real create-next-app CLI for an honest clean starter
  if (stackId === 'nextjs' && tier === 'basic') {
    emit({ step: 'scaffold', status: 'running', message: 'Creating a fresh Next.js App Router baseline...' });
    let cliProject;
    try {
      cliProject = await sandbox.createFromCLI('nextjs', name || 'my-nextjs-app', ownerUserId ?? null);
    } catch (err) {
      emit({ step: 'scaffold', status: 'failed', message: `Starter scaffold failed: ${(err as Error).message}` });
      return null;
    }
    emit({
      step: 'scaffold',
      status: 'done',
      message: `Next.js app created (${Object.keys(cliProject.files).length} files)`,
      projectId: cliProject.id,
      elapsed: elapsed(),
    });

    // Skip install — create-next-app already installed deps
    emit({ step: 'install', status: 'done', message: 'Dependencies already prepared by create-next-app', elapsed: elapsed() });

    // Start dev server
    emit({ step: 'start', status: 'running', message: 'Launching Next.js dev server...' });
    const devResult = await sandbox.startDev(cliProject.id);
    if (!devResult.port) {
      emit({ step: 'start', status: 'failed', message: 'Dev server did not start' });
      return null;
    }
    emit({ step: 'start', status: 'done', message: `Running on port ${devResult.port}`, port: devResult.port, elapsed: elapsed() });

    // Verify
    emit({ step: 'verify', status: 'running', message: 'Opening live preview...' });
    const verifyOk = await waitForUrl(`http://localhost:${devResult.port}`, 30_000);
    emit({
      step: 'verify',
      status: verifyOk ? 'done' : 'failed',
      message: verifyOk ? 'Preview is ready' : 'Preview did not respond in time',
      projectId: cliProject.id,
      port: devResult.port,
      elapsed: elapsed(),
    });

    return { projectId: cliProject.id, port: devResult.port };
  }

  const template = getStackTemplate(stackId, tier);
  if (!template) {
    emit({ step: 'scaffold', status: 'failed', message: `Template not found: ${stackId}-${tier}` });
    return null;
  }
  if (template.comingSoon) {
    emit({ step: 'scaffold', status: 'failed', message: `${template.name} is coming soon` });
    return null;
  }

  emit({ step: 'scaffold', status: 'running', message: `Writing ${template.files.length} files...` });
  const project = await sandbox.create(
    name || template.name.toLowerCase().replace(/\s+/g, '-'),
    ownerUserId ?? null,
  );
  await sandbox.writeFiles(
    project.id,
    template.files.map((f) => ({ path: f.path, content: f.content })),
  );
  emit({
    step: 'scaffold',
    status: 'done',
    message: `${template.files.length} files written`,
    projectId: project.id,
    elapsed: elapsed(),
  });

  /* ── Step 2: Install ── */
  emit({ step: 'install', status: 'running', message: 'Installing packages...' });
  const installResult = await sandbox.install(project.id);
  if (!installResult.success) {
    emit({
      step: 'install',
      status: 'failed',
      message: 'Package installation failed',
      detail: installResult.output.slice(-500),
      elapsed: elapsed(),
    });
    return null;
  }
  emit({ step: 'install', status: 'done', message: 'Dependencies installed', elapsed: elapsed() });

  /* ── Step 3: Build ── */
  const pkgPath = join(project.rootDir, 'package.json');
  let hasBuild = false;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    hasBuild = !!pkg.scripts?.build;
  } catch {
    /* no package.json */
  }

  if (hasBuild) {
    emit({ step: 'build', status: 'running', message: 'Building application...' });
    try {
      execSync('npm run build', { cwd: project.rootDir, stdio: 'pipe', timeout: 120_000, ...EXEC_SHELL });
      emit({ step: 'build', status: 'done', message: 'Build successful', elapsed: elapsed() });
    } catch (err) {
      emit({
        step: 'build',
        status: 'failed',
        message: 'Build failed',
        detail: (err as Error).message?.slice(-500),
        elapsed: elapsed(),
      });
      // Build failure is non-fatal for dev mode — continue
    }
  } else {
    emit({ step: 'build', status: 'skipped', message: 'No build script' });
  }

  /* ── Step 4: Docker verification ── */
  if (template.hasDocker) {
    const hasDockerfile = existsSync(join(project.rootDir, 'Dockerfile'));
    if (hasDockerfile && isDockerAvailable()) {
      emit({ step: 'docker', status: 'running', message: 'Building Docker image...' });
      try {
        const tag = `vai-verify-${project.id}`;
        execSync(`docker build -t ${tag} .`, {
          cwd: project.rootDir,
          stdio: 'pipe',
          timeout: 300_000,
          ...EXEC_SHELL,
        });
        // Clean up verification image
        try {
          execSync(`docker rmi ${tag}`, { stdio: 'pipe', ...EXEC_SHELL });
        } catch {
          /* ok */
        }
        emit({ step: 'docker', status: 'done', message: 'Docker build verified', elapsed: elapsed() });
      } catch (err) {
        emit({
          step: 'docker',
          status: 'failed',
          message: 'Docker build failed',
          detail: (err as Error).message?.slice(-500),
          elapsed: elapsed(),
        });
        // Docker failure is non-fatal — dev mode doesn't need Docker
      }
    } else {
      emit({
        step: 'docker',
        status: 'skipped',
        message: hasDockerfile ? 'Docker not available on this system' : 'No Dockerfile in template',
      });
    }
  } else {
    emit({ step: 'docker', status: 'skipped', message: 'Not included in this tier' });
  }

  /* ── Step 5: Run tests ── */
  if (template.hasTests) {
    let hasTestScript = false;
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      hasTestScript = !!pkg.scripts?.test;
    } catch {
      /* ok */
    }

    if (hasTestScript) {
      emit({ step: 'test', status: 'running', message: 'Running test suite...' });
      try {
        const output = execSync('npm test', {
          cwd: project.rootDir,
          stdio: 'pipe',
          timeout: 60_000,
          env: { ...process.env, CI: 'true' },
          ...EXEC_SHELL,
        }).toString();
        const passMatch = output.match(/(\d+)\s+pass/i);
        const passCount = passMatch ? passMatch[1] : '?';
        emit({
          step: 'test',
          status: 'done',
          message: `All tests passed (${passCount})`,
          elapsed: elapsed(),
        });
      } catch (err) {
        emit({
          step: 'test',
          status: 'failed',
          message: 'Some tests failed',
          detail: (err as Error).message?.slice(-500),
          elapsed: elapsed(),
        });
        // Test failure: still start dev server but warn
      }
    } else {
      emit({ step: 'test', status: 'skipped', message: 'No test script' });
    }
  } else {
    emit({ step: 'test', status: 'skipped', message: 'Not included in this tier' });
  }

  /* ── Step 6: Start dev server ── */
  emit({ step: 'start', status: 'running', message: 'Starting dev server...' });
  try {
    const { port: initialPort } = await sandbox.startDev(project.id);
    let port = sandbox.get(project.id)?.devPort ?? initialPort;
    emit({
      step: 'start',
      status: 'done',
      message: `Server starting on port ${port}`,
      port,
      elapsed: elapsed(),
    });

    /* ── Step 7: Health check ── */
    emit({ step: 'verify', status: 'running', message: 'Waiting for server to be ready...' });

    // Wait for the sandbox status to become 'running' or health endpoint
    let healthy = await waitForHealth(port, 15_000);
    const latestPort = sandbox.get(project.id)?.devPort ?? port;
    if (!healthy && latestPort !== port) {
      port = latestPort;
      emit({
        step: 'verify',
        status: 'running',
        message: `Detected active server on port ${port}...`,
        port,
        elapsed: elapsed(),
      });
      healthy = await waitForHealth(port, 15_000);
    }

    if (healthy) {
      emit({
        step: 'verify',
        status: 'done',
        message: 'Server is healthy and ready!',
        projectId: project.id,
        port,
        elapsed: elapsed(),
      });
    } else {
      // Server might still be starting — check sandbox status
      const proj = sandbox.get(project.id);
      if (proj?.status === 'running') {
        emit({
          step: 'verify',
          status: 'done',
          message: 'Server is running (health endpoint may not be available)',
          projectId: project.id,
          port,
          elapsed: elapsed(),
        });
      } else {
        emit({
          step: 'verify',
          status: 'done',
          message: 'Server started (health check timed out — may still be booting)',
          projectId: project.id,
          port,
          elapsed: elapsed(),
        });
      }
    }

    return { projectId: project.id, port };
  } catch (err) {
    emit({
      step: 'start',
      status: 'failed',
      message: 'Failed to start dev server',
      detail: (err as Error).message,
      elapsed: elapsed(),
    });
    emit({ step: 'verify', status: 'skipped', message: 'Server did not start' });
    return null;
  }
}
