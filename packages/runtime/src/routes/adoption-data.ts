import type { FastifyInstance } from 'fastify';
import {
  backupManifestSchema,
  customDomainRequestSchema,
  exportBundleSchema,
  type ExportBundle,
  linkIndexUpdateSchema,
  restoreBundleReportSchema,
  restoreBundleRequestSchema,
  restoreFolderRequestSchema,
  shareManifestInputSchema,
} from '@vai/contracts/adoption';
import { LIMITS, PERSISTED_NAMES, PUBLIC_ENDPOINTS } from '@vai/constants';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import type { EnvironmentService } from '../environments/service.js';
import type { LinkIndexService } from '../links/service.js';
import type { MemoryService } from '../memory/service.js';
import type { PersonaService } from '../personas/service.js';
import type { ShareService } from '../sharing/service.js';
import { verifyCustomDomain } from '../sharing/service.js';
import type { SkillConfidenceService } from '../skills/confidence-service.js';
import type { SessionService } from '@vai/core';
import { invalidRequestBody } from '../validation/http-validation.js';
import { requireHostAuthority } from '../auth/route-authority.js';

interface AdoptionDataDeps {
  auth: PlatformAuthService; environments: EnvironmentService; links: LinkIndexService;
  memory: MemoryService; personas: PersonaService; shares: ShareService;
  skills: SkillConfidenceService; sessions: SessionService;
}

function escapeSharedHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerAdoptionDataRoutes(app: FastifyInstance, deps: AdoptionDataDeps): void {
  app.post('/api/shares/publish', async (request, reply) => {
    if (!await requireHostAuthority(deps.auth, request, reply)) return;
    const parsed = shareManifestInputSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    return deps.shares.publish(parsed.data, '/s/');
  });
  app.get('/api/shares', async (request, reply) => {
    if (!await requireHostAuthority(deps.auth, request, reply)) return;
    return { manifests: deps.shares.list() };
  });
  app.get<{ Params: { slug: string } }>('/s/:slug', async (request, reply) => {
    const item = deps.shares.list().flatMap((manifest) => manifest.items)
      .find((candidate) => candidate.slug === request.params.slug && candidate.included);
    if (!item || item.protection === 'private') return reply.status(404).type('text/plain').send('Share not found.');
    if (item.protection !== 'public') {
      const viewer = await deps.auth.getViewer(request);
      if (!viewer.authenticated) return reply.status(401).type('text/plain').send('Authentication is required for this share.');
    }
    if (item.content === undefined) return reply.status(409).type('text/plain').send('This permalink exists, but its file snapshot is not available on this device.');
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
    reply.header('cache-control', 'no-store');
    const css = (item.themeCss ?? '').replace(/@import/gi, '/* blocked import */').replace(/url\s*\(/gi, 'blocked-url(');
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeSharedHtml(item.path)}</title><style>:root{color-scheme:light dark}body{max-width:70rem;margin:0 auto;padding:clamp(1rem,4vw,4rem);font:15px/1.65 ui-monospace,monospace;background:#101216;color:#ece8e1}pre{white-space:pre-wrap;overflow-wrap:anywhere}${css}</style></head><body><pre>${escapeSharedHtml(item.content)}</pre></body></html>`);
  });
  app.post('/api/shares/domain/verify', async (request, reply) => {
    if (!await requireHostAuthority(deps.auth, request, reply)) return;
    const parsed = customDomainRequestSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    return verifyCustomDomain(parsed.data.domain, PUBLIC_ENDPOINTS.shareDnsTarget);
  });

  app.post('/api/links/index', async (request, reply) => {
    if (!await requireHostAuthority(deps.auth, request, reply)) return;
    const parsed = linkIndexUpdateSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    return { edges: deps.links.update(parsed.data.workspaceId, parsed.data.object, parsed.data.content) };
  });
  app.get<{ Querystring: { workspaceId: string; target: string } }>('/api/links/backlinks', async (request, reply) => {
    if (!await requireHostAuthority(deps.auth, request, reply)) return;
    return { backlinks: deps.links.backlinks(request.query.workspaceId, request.query.target) };
  });
  app.get<{ Querystring: { workspaceId: string } }>('/api/links/graph', async (request, reply) => {
    if (!await requireHostAuthority(deps.auth, request, reply)) return;
    return deps.links.graph(request.query.workspaceId);
  });

  const bundle = async (request: Parameters<PlatformAuthService['getViewer']>[0]) => {
    const viewer = await deps.auth.getViewer(request);
    const userId = viewer.user?.id ?? 'local';
    return exportBundleSchema.parse({
      schemaVersion: 1, exportedAt: Date.now(), personas: deps.personas.list(), skills: deps.skills.list(),
      environments: deps.environments.listEnvironments(), memories: deps.memory.list(userId, true),
      sessions: deps.sessions.listSessions({ limit: LIMITS.exportSessions })
        .flatMap((session) => deps.sessions.exportSession(session.id) ?? []),
      shares: deps.shares.list(), links: deps.links.listObjects(),
    });
  };
  const restore = (backup: ExportBundle, userId: string, dryRun: boolean, overwrite: boolean) => {
    const current = {
      personas: new Set(deps.personas.list().map((record) => record.id)),
      skills: new Set(deps.skills.list().map((record) => record.id)),
      environments: new Set(deps.environments.listEnvironments().map((record) => record.id)),
      memories: new Set(deps.memory.list(userId, true).map((record) => record.id)),
      sessions: new Set(deps.sessions.listSessions({ limit: LIMITS.exportSessions }).map((record) => record.id)),
      shares: new Set(deps.shares.list().map((record) => record.id)),
      links: new Set(deps.links.listObjects().map((record) => record.id)),
    };
    const records = {
      personas: backup.personas, skills: backup.skills, environments: backup.environments,
      memories: backup.memories, sessions: backup.sessions, shares: backup.shares, links: backup.links,
    };
    const identities = {
      personas: records.personas.map((record) => record.id),
      skills: records.skills.map((record) => record.id),
      environments: records.environments.map((record) => record.id),
      memories: records.memories.map((record) => record.id),
      sessions: records.sessions.map((record) => record.session.id),
      shares: records.shares.map((record) => record.id),
      links: records.links.map((record) => record.id),
    };
    const conflicts = Object.entries(identities).flatMap(([domain, ids]) =>
      ids.filter((id) => current[domain as keyof typeof current].has(id)).map((id) => `${domain}:${id}`));
    const wouldApply = Object.fromEntries(Object.entries(identities).map(([domain, ids]) => [
      domain, overwrite ? ids.length : ids.filter((id) => !current[domain as keyof typeof current].has(id)).length,
    ]));
    const applied = Object.fromEntries(Object.keys(records).map((domain) => [domain, 0]));
    if (!dryRun) {
      applied.personas = deps.personas.restore(records.personas, overwrite);
      applied.skills = deps.skills.restore(records.skills, overwrite);
      applied.environments = deps.environments.restoreEnvironments(records.environments, overwrite);
      applied.memories = deps.memory.restore(userId, records.memories, overwrite);
      for (const session of records.sessions) {
        if (overwrite || !current.sessions.has(session.session.id)) {
          deps.sessions.importSession(session as unknown as Parameters<SessionService['importSession']>[0]);
          applied.sessions += 1;
        }
      }
      applied.shares = deps.shares.restore(records.shares, overwrite);
      applied.links = deps.links.restoreObjects(records.links, overwrite);
    }
    return restoreBundleReportSchema.parse({ dryRun, overwrite, conflicts, wouldApply, applied });
  };
  app.get('/api/export', async (request, reply) => {
    if (!await requireHostAuthority(deps.auth, request, reply)) return;
    return bundle(request);
  });
  app.post('/api/export/restore', async (request, reply) => {
    const viewer = await requireHostAuthority(deps.auth, request, reply);
    if (!viewer) return;
    const parsed = restoreBundleRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    const { bundle: backup, dryRun, overwrite } = parsed.data;
    const userId = viewer.user?.id ?? 'local';
    return restore(backup, userId, dryRun, overwrite);
  });
  app.post<{ Body: { targetRoot?: string } }>('/api/export/folder', async (request, reply) => {
    if (!await requireHostAuthority(deps.auth, request, reply)) return;
    const targetRoot = request.body?.targetRoot?.trim();
    if (!targetRoot) return reply.status(400).send({ error: 'targetRoot is required' });
    const data = await bundle(request);
    const stamp = new Date(data.exportedAt).toISOString().replace(/[:.]/g, '-');
    const output = resolve(targetRoot, `${PERSISTED_NAMES.exportFolder}-${stamp}`);
    await mkdir(output, { recursive: false });
    const files = Object.fromEntries(Object.entries(data).map(([name, value]) => [
      `${name}.json`, `${JSON.stringify(value, null, 2)}\n`,
    ]));
    const manifest = {
      schemaVersion: 1,
      exportedAt: data.exportedAt,
      files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, {
        bytes: Buffer.byteLength(content, 'utf8'),
        sha256: createHash('sha256').update(content).digest('hex'),
      }])),
    };
    await Promise.all([
      ...Object.entries(files).map(([name, content]) => writeFile(resolve(output, name), content, 'utf8')),
      writeFile(resolve(output, PERSISTED_NAMES.exportManifest), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    ]);
    return { path: output, files: [...Object.keys(files), PERSISTED_NAMES.exportManifest] };
  });
  app.post('/api/export/restore-folder', async (request, reply) => {
    const viewer = await requireHostAuthority(deps.auth, request, reply);
    if (!viewer) return;
    const parsed = restoreFolderRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    try {
      const sourceFolder = resolve(parsed.data.sourceFolder);
      const manifestText = await readFile(resolve(sourceFolder, PERSISTED_NAMES.exportManifest), 'utf8');
      const manifest = backupManifestSchema.parse(JSON.parse(manifestText));
      const contents = new Map<string, string>();
      for (const [name, receipt] of Object.entries(manifest.files)) {
        const content = await readFile(resolve(sourceFolder, name), 'utf8');
        const actualBytes = Buffer.byteLength(content, 'utf8');
        const actualHash = createHash('sha256').update(content).digest('hex');
        if (actualBytes !== receipt.bytes || actualHash !== receipt.sha256) {
          return reply.status(409).send({
            error: `Backup checksum failed for ${name}`,
            code: 'backup_checksum_failed',
            expected: receipt, actual: { bytes: actualBytes, sha256: actualHash },
          });
        }
        contents.set(name, content);
      }
      const fields = ['schemaVersion', 'exportedAt', 'personas', 'skills', 'environments', 'memories', 'sessions', 'shares', 'links'] as const;
      const rawBundle = Object.fromEntries(fields.map((field) => {
        const name = `${field}.json`;
        const content = contents.get(name);
        if (content === undefined) throw new Error(`Backup is missing ${name}`);
        return [field, JSON.parse(content)];
      }));
      const backup = exportBundleSchema.parse(rawBundle);
      return restore(backup, viewer.user?.id ?? 'local', parsed.data.dryRun, parsed.data.overwrite);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : String(error),
        code: 'invalid_backup_folder',
      });
    }
  });
}
