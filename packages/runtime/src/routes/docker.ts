/**
 * docker.ts — Docker management API routes.
 *
 * Shells out to the local `docker` CLI to inspect daemon status,
 * list containers/images, and perform lifecycle actions.
 *
 * All routes are prefixed with /docker.
 */

import type { FastifyInstance } from 'fastify';
import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/* ── Helpers ── */

const DOCKER_CMD = process.platform === 'win32' ? 'docker.exe' : 'docker';
const EXEC_OPTS: ExecFileOptions = { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 };

/**
 * Execute a docker CLI command and return stdout.
 * Throws on non-zero exit or timeout.
 */
async function docker(...args: string[]): Promise<string> {
  const { stdout } = await exec(DOCKER_CMD, args, EXEC_OPTS);
  return String(stdout).trim();
}

/**
 * Parse `docker ps --format json` output.
 * Each line is a separate JSON object (Docker ≥ 20.10).
 *
 * Falls back to `--format '{{json .}}'` parsing.
 */
function parseContainerList(raw: string) {
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const c = JSON.parse(line);
      return {
        id: (c.ID ?? c.Id ?? '').slice(0, 12),
        name: (c.Names ?? c.Name ?? '').replace(/^\//, ''),
        image: c.Image ?? '',
        status: mapState(c.State ?? c.Status ?? ''),
        state: c.Status ?? c.State ?? '',
        created: c.CreatedAt ?? c.Created ?? '',
        ports: parsePorts(c.Ports ?? ''),
        labels: parseLabels(c.Labels ?? ''),
      };
    });
}

function mapState(
  state: string,
): 'running' | 'stopped' | 'created' | 'restarting' | 'paused' | 'exited' | 'dead' {
  const s = state.toLowerCase();
  if (s.startsWith('up') || s === 'running') return 'running';
  if (s === 'created') return 'created';
  if (s === 'restarting') return 'restarting';
  if (s === 'paused') return 'paused';
  if (s === 'dead') return 'dead';
  if (s.startsWith('exited') || s === 'exited') return 'exited';
  return 'stopped';
}

function parsePorts(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((p) => p.trim()).filter(Boolean);
}

function parseLabels(raw: string): Record<string, string> {
  if (!raw || typeof raw !== 'string') return {};
  const labels: Record<string, string> = {};
  // Labels come as "key=value,key=value" from docker ps format
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      labels[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return labels;
}

function parseImageList(raw: string) {
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const img = JSON.parse(line);
      return {
        id: (img.ID ?? '').slice(0, 12),
        tags: (img.Repository && img.Tag)
          ? [`${img.Repository}:${img.Tag}`]
          : [],
        size: img.Size ?? img.VirtualSize ?? '',
        created: img.CreatedAt ?? img.CreatedSince ?? '',
      };
    });
}

/* ── Route registration ── */

export function registerDockerRoutes(app: FastifyInstance) {
  /** Check Docker daemon availability */
  app.get('/docker/status', async () => {
    try {
      const version = await docker('version', '--format', '{{.Server.Version}}');
      return { status: 'running', version };
    } catch (err: unknown) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not recognized')) {
        return { status: 'not-installed' };
      }
      // Docker installed but daemon not running
      if (msg.includes('Cannot connect') || msg.includes('daemon is not running') || msg.includes('connection refused')) {
        return { status: 'stopped' };
      }
      return { status: 'error', error: msg };
    }
  });

  /** List all containers (running + stopped) */
  app.get('/docker/containers', async () => {
    try {
      const raw = await docker('ps', '-a', '--no-trunc', '--format', '{{json .}}');
      const containers = parseContainerList(raw);
      return { containers };
    } catch (err) {
      return { containers: [], error: (err as Error).message };
    }
  });

  /** List local images */
  app.get('/docker/images', async () => {
    try {
      const raw = await docker('images', '--format', '{{json .}}');
      const images = parseImageList(raw);
      return { images };
    } catch (err) {
      return { images: [], error: (err as Error).message };
    }
  });

  /** Get container logs */
  app.get<{ Params: { id: string }; Querystring: { tail?: string } }>(
    '/docker/containers/:id/logs',
    async (request) => {
      const rawTail = parseInt(request.query.tail ?? '100', 10);
      const tail = String(Math.min(Math.max(Number.isFinite(rawTail) ? rawTail : 100, 1), 10000));
      try {
        const logs = await docker('logs', '--tail', tail, '--timestamps', request.params.id);
        return { logs };
      } catch (err) {
        return { logs: '', error: (err as Error).message };
      }
    },
  );

  /** Start a container */
  app.post<{ Params: { id: string } }>(
    '/docker/containers/:id/start',
    async (request) => {
      try {
        await docker('start', request.params.id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  /** Stop a container */
  app.post<{ Params: { id: string } }>(
    '/docker/containers/:id/stop',
    async (request) => {
      try {
        await docker('stop', request.params.id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  /** Restart a container */
  app.post<{ Params: { id: string } }>(
    '/docker/containers/:id/restart',
    async (request) => {
      try {
        await docker('restart', request.params.id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  /** Remove a container (force) */
  app.post<{ Params: { id: string } }>(
    '/docker/containers/:id/remove',
    async (request) => {
      try {
        await docker('rm', '-f', request.params.id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
