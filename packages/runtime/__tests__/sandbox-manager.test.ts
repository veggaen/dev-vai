/**
 * Integration tests for the SandboxManager.
 *
 * These tests exercise the real file system (using temp dirs) to verify
 * that project creation, file writing, and listing work end-to-end.
 * We skip install/startDev since those require npm to be installed
 * and would make CI slow — that's better suited for E2E tests.
 */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import { SandboxManager } from '../src/sandbox/manager.js';

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };

  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 12345;

  return proc;
}

describe('SandboxManager', () => {
  let manager: SandboxManager;
  let testDir: string;

  beforeEach(async () => {
    // Each test gets its own temp directory — full isolation
    testDir = await mkdtemp(join(tmpdir(), 'vai-sandbox-test-'));
    manager = new SandboxManager(testDir);
    spawnMock.mockReset();
  });

  afterEach(async () => {
    // Clean up after ourselves
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('create()', () => {
    it('creates a project with a unique ID and directory', async () => {
      const project = await manager.create('test-app');

      expect(project.id).toBeTruthy();
      expect(project.name).toBe('test-app');
      expect(project.status).toBe('idle');
      expect(existsSync(project.rootDir)).toBe(true);
    });

    it('sanitizes unsafe characters in project names', async () => {
      const project = await manager.create('my app/foo@bar');

      // Should replace non-alphanumeric chars with dashes
      expect(project.rootDir).not.toContain(' ');
      expect(project.rootDir).not.toContain('/foo');
      expect(existsSync(project.rootDir)).toBe(true);
    });

    it('creates multiple projects with distinct IDs', async () => {
      const p1 = await manager.create('app1');
      const p2 = await manager.create('app2');

      expect(p1.id).not.toBe(p2.id);
      expect(p1.rootDir).not.toBe(p2.rootDir);
    });
  });

  describe('get()', () => {
    it('retrieves a project by ID', async () => {
      const created = await manager.create('lookup-test');
      const found = manager.get(created.id);

      expect(found).toBeDefined();
      expect(found!.name).toBe('lookup-test');
    });

    it('returns undefined for unknown IDs', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });
  });

  describe('writeFiles() + listFiles()', () => {
    it('writes files to the project directory', async () => {
      const project = await manager.create('write-test');

      await manager.writeFiles(project.id, [
        { path: 'index.html', content: '<h1>Hello</h1>' },
        { path: 'src/main.ts', content: 'console.log("hi")' },
      ]);

      const files = await manager.listFiles(project.id);
      expect(files).toContain('index.html');
      expect(files).toContain('src/main.ts');
    });

    it('creates nested directories automatically', async () => {
      const project = await manager.create('nested-test');

      await manager.writeFiles(project.id, [
        { path: 'src/components/Button/Button.tsx', content: 'export const Button = () => <button />; ' },
      ]);

      const files = await manager.listFiles(project.id);
      expect(files).toContain('src/components/Button/Button.tsx');
    });

    it('reads back written file content', async () => {
      const project = await manager.create('read-test');
      const content = '{"name":"test","version":"1.0.0"}';

      await manager.writeFiles(project.id, [
        { path: 'package.json', content },
      ]);

      const readBack = await manager.readFile(project.id, 'package.json');
      expect(readBack).toBe(content);
    });

    it('throws when writing to a nonexistent project', async () => {
      await expect(
        manager.writeFiles('bad-id', [{ path: 'x.ts', content: '' }]),
      ).rejects.toThrow('Sandbox project not found');
    });
  });

  describe('list()', () => {
    it('returns all created projects', async () => {
      await manager.create('app-a');
      await manager.create('app-b');

      const all = manager.list();
      expect(all).toHaveLength(2);
      expect(all.map((p) => p.name)).toContain('app-a');
      expect(all.map((p) => p.name)).toContain('app-b');
    });
  });

  describe('install()', () => {
    it('installs with pnpm without frozen lockfile so AI-edited package manifests can refresh lockfiles', async () => {
      const project = await manager.create('install-retry');
      await manager.writeFiles(project.id, [
        {
          path: 'package.json',
          content: JSON.stringify({
            name: 'install-retry',
            private: true,
            dependencies: {
              react: '^19.0.0',
            },
          }, null, 2),
        },
        {
          path: 'pnpm-lock.yaml',
          content: 'lockfileVersion: 9.0\n',
        },
      ]);

      spawnMock.mockImplementationOnce(() => {
        const proc = createMockProcess();
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from('Packages: +1\n'));
          proc.emit('close', 0);
        }, 0);
        return proc;
      });

      const result = await manager.install(project.id);

      expect(result.success).toBe(true);
      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(spawnMock.mock.calls[0][0]).toBe('pnpm');
      expect(spawnMock.mock.calls[0][1]).toContain('--no-frozen-lockfile');
      expect(spawnMock.mock.calls[0][1]).not.toContain('--frozen-lockfile');
    });
  });

  describe('destroy()', () => {
    it('removes the project and its directory', async () => {
      const project = await manager.create('destroy-test');
      await manager.writeFiles(project.id, [
        { path: 'file.txt', content: 'hello' },
      ]);

      await manager.destroy(project.id);

      expect(manager.get(project.id)).toBeUndefined();
      // Directory should be cleaned up
      expect(existsSync(project.rootDir)).toBe(false);
    });
  });

  describe('createFromTemplate()', () => {
    it('creates a project from the react-vite template', async () => {
      const project = await manager.createFromTemplate('react-vite');

      expect(project.name).toContain('react');
      expect(project.status).toBe('idle');

      const files = await manager.listFiles(project.id);
      expect(files).toContain('package.json');
      expect(files).toContain('src/App.tsx');
      expect(files).toContain('vite.config.ts');
    });

    it('creates a project from the express-api template', async () => {
      const project = await manager.createFromTemplate('express-api');

      const files = await manager.listFiles(project.id);
      expect(files).toContain('package.json');
      expect(files).toContain('src/index.ts');
    });

    it('creates a project from the express-hexa (hexagonal) template', async () => {
      const project = await manager.createFromTemplate('express-hexa');

      const files = await manager.listFiles(project.id);
      expect(files).toContain('package.json');
      expect(files).toContain('src/domain/ports.ts');
      expect(files).toContain('src/application/room-service.ts');
      expect(files).toContain('src/adapters/in-memory-room-repository.ts');
      expect(files).toContain('src/adapters/http/routes.ts');
      expect(files).toContain('src/index.ts');
    });

    it('throws for unknown template IDs', async () => {
      await expect(
        manager.createFromTemplate('nonexistent-template'),
      ).rejects.toThrow('Unknown template');
    });

    it('accepts a custom name override', async () => {
      const project = await manager.createFromTemplate('react-vite', 'my-custom-name');
      expect(project.name).toBe('my-custom-name');
    });

    it('uses the real CLI scaffold for nextjs starters', async () => {
      spawnMock.mockImplementation((_cmd, options) => {
        const proc = createMockProcess();
        const appName = 'fresh-next-starter';
        const rootDir = join(options.cwd as string, appName);

        void (async () => {
          await mkdir(join(rootDir, 'src', 'app'), { recursive: true });
          await writeFile(join(rootDir, 'package.json'), JSON.stringify({
            name: appName,
            private: true,
            scripts: { dev: 'next dev' },
          }, null, 2));
          await writeFile(join(rootDir, 'src', 'app', 'page.tsx'), 'export default function Page() { return <main>Fresh Next starter</main>; }');
          proc.emit('close', 0);
        })();

        return proc;
      });

      const project = await manager.createFromTemplate('nextjs', 'fresh-next-starter');

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(project.name).toBe('fresh-next-starter');
      expect(project.logs[0]).toContain('Scaffolded a fresh Next.js App Router baseline');
      expect(project.files['src/app/page.tsx']).toContain('Fresh Next starter');
    });
  });

  describe('listTemplates()', () => {
    it('returns all available templates', () => {
      const templates = manager.listTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(10); // grows with SANDBOX_TEMPLATES
      expect(templates.some((t) => t.id === 'react-vite')).toBe(true);
      expect(templates.some((t) => t.id === 'nextjs')).toBe(true);
      expect(templates.some((t) => t.id === 'express-api')).toBe(true);
    });

    it('each template has required fields', () => {
      const templates = manager.listTemplates();
      for (const t of templates) {
        expect(t.id).toBeTruthy();
        expect(t.name).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.category).toBeTruthy();
        expect(t.files.length).toBeGreaterThan(0);
      }
    });
  });

  describe('startDev()', () => {
    it('waits for the actual bound port after a generic ready line', async () => {
      const project = await manager.create('vite-port-race');
      await manager.writeFiles(project.id, [
        {
          path: 'package.json',
          content: JSON.stringify({
            name: 'vite-port-race',
            private: true,
            scripts: {
              dev: 'vite',
            },
          }, null, 2),
        },
      ]);

      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const startPromise = manager.startDev(project.id);

      await new Promise((resolve) => setTimeout(resolve, 20));
      proc.stdout.emit('data', Buffer.from('VITE v6.0.0 ready in 123 ms\n'));
      setTimeout(() => {
        proc.stdout.emit('data', Buffer.from('  ➜  Local:   http://localhost:5173/\n'));
      }, 40);

      const result = await startPromise;

      expect(result.port).toBe(5173);
      expect(manager.get(project.id)?.devPort).toBe(5173);
      expect(spawnMock).toHaveBeenCalledTimes(1);

      manager.stopDev(project.id);
    });
  });
});
