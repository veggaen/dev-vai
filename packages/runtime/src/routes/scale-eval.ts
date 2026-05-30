import { existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import { isLocalDevMutationAllowed } from '../security/request-trust.js';

export interface RegisterScaleEvalRoutesOptions {
  ownerEmail: string;
}

function resolveArtifactsRoot(): string {
  const configured = process.env.VAI_SCALE_EVAL_ARTIFACTS_DIR?.trim();
  if (configured) return path.resolve(configured);

  const cwdRoot = path.resolve(process.cwd(), 'artifacts', 'scale-eval');
  if (existsSync(cwdRoot)) return cwdRoot;

  return path.resolve(process.cwd(), '..', '..', 'artifacts', 'scale-eval');
}

async function authorizeOwner(
  auth: PlatformAuthService,
  request: FastifyRequest,
  reply: FastifyReply,
  ownerEmail: string,
): Promise<boolean> {
  if (!auth.isEnabled()) return true;
  if (
    isLocalDevMutationAllowed(request)
    && request.headers['x-vai-dev-auth-bypass'] === '1'
  ) {
    return true;
  }
  const viewer = await auth.getViewer(request);
  const viewerEmail = viewer.user?.email.trim().toLowerCase();
  if (viewer.authenticated && viewerEmail === ownerEmail.trim().toLowerCase()) {
    return true;
  }
  reply.code(viewer.authenticated ? 403 : 401);
  return false;
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function registerScaleEvalRoutes(
  app: FastifyInstance,
  auth: PlatformAuthService,
  options: RegisterScaleEvalRoutesOptions,
) {
  app.get('/api/scale-eval/runs', async (request, reply) => {
    if (!await authorizeOwner(auth, request, reply, options.ownerEmail)) {
      return { error: reply.statusCode === 401 ? 'Sign in to view scale eval runs' : 'Only the owner can view scale eval runs' };
    }

    const root = resolveArtifactsRoot();
    if (!existsSync(root)) {
      return { root, runs: [] };
    }

    const entries = await fsp.readdir(root, { withFileTypes: true });
    const runs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runDir = path.join(root, entry.name);
      const manifest = await readJsonFile(path.join(runDir, 'manifest.json'));
      const summary = await readJsonFile(path.join(runDir, 'summary.json'));
      const auditPath = path.join(runDir, 'audit.jsonl');
      const responsePath = path.join(runDir, 'responses.jsonl');
      const auditBytes = existsSync(auditPath) ? (await fsp.stat(auditPath)).size : 0;
      const responseBytes = existsSync(responsePath) ? (await fsp.stat(responsePath)).size : 0;
      runs.push({
        id: entry.name,
        manifest,
        summary,
        auditBytes,
        responseBytes,
      });
    }

    return {
      root,
      runs: runs.sort((left, right) => String(right.id).localeCompare(String(left.id))),
    };
  });
}
