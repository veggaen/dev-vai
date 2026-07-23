import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SandboxManager, FileWrite } from '../sandbox/manager.js';
import { detectProjectProfile } from '../sandbox/manager.js';
import {
  getAllStacks,
  getStack,
  getStackTemplate,
  registerCustomStack,
  unregisterCustomStack,
  getCustomStacks,
  isCustomStack,
} from '../sandbox/stacks/index.js';
import type { CustomStackConfig } from '../sandbox/stacks/index.js';
import { deployStack, type DeployEvent } from '../sandbox/deploy.js';
import { PlatformAuthService } from '../auth/platform-auth.js';
import { ProjectService } from '../projects/service.js';
import {
  sandboxCreateBodySchema,
  sandboxDeployBodySchema,
  sandboxFromTemplateBodySchema,
  sandboxWriteFilesBodySchema,
  sandboxOpenFolderBodySchema,
  sandboxRunCommandBodySchema,
  sandboxEnvLocalBodySchema,
  sandboxSearchBodySchema,
  sandboxReplaceBodySchema,
  sandboxSwitchLaneBodySchema,
} from '@vai/contracts/sandbox';
import { invalidRequestBody } from '../validation/http-validation.js';
import { runLocalVisualLayoutAudit } from '../sandbox/visual-layout-audit.js';

async function getViewerUserId(auth: PlatformAuthService, request: FastifyRequest): Promise<string | null> {
  const viewer = await auth.getViewer(request);
  return viewer.user?.id ?? null;
}

/**
 * Line-level diff stats between two file snapshots. A line-multiset comparison
 * (not a true LCS) — cheap and good enough for the "+added / −removed" badge:
 * lines present only in `after` count as added, lines only in `before` as
 * removed. A pure create counts every after-line as added; a pure delete counts
 * every before-line as removed.
 */
export function lineDiffStats(before: string | null, after: string | null): { added: number; removed: number } {
  if (before === null && after !== null) return { added: after ? after.split('\n').length : 0, removed: 0 };
  if (after === null && before !== null) return { added: 0, removed: before ? before.split('\n').length : 0 };
  if (before === null || after === null) return { added: 0, removed: 0 };

  const count = (text: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const line of text.split('\n')) m.set(line, (m.get(line) ?? 0) + 1);
    return m;
  };
  const a = count(before);
  const b = count(after);
  let added = 0;
  let removed = 0;
  for (const [line, n] of b) added += Math.max(0, n - (a.get(line) ?? 0));
  for (const [line, n] of a) removed += Math.max(0, n - (b.get(line) ?? 0));
  return { added, removed };
}

function getOrRestoreProject(
  projects: ProjectService,
  sandbox: SandboxManager,
  projectId: string,
) {
  const liveProject = sandbox.get(projectId);
  if (liveProject) {
    return liveProject;
  }

  const persistedProject = projects.getProjectBySandboxId(projectId);
  if (
    !persistedProject
    || !persistedProject.rootDir
    || !existsSync(persistedProject.rootDir)
  ) {
    return null;
  }

  return sandbox.rehydrate({
    id: persistedProject.sandboxProjectId,
    name: persistedProject.name,
    rootDir: persistedProject.rootDir,
    ownerUserId: persistedProject.ownerUserId,
    status: 'idle',
  });
}

async function getAuthorizedProject(
  auth: PlatformAuthService,
  projects: ProjectService,
  sandbox: SandboxManager,
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string,
  access: 'read' | 'write',
) {
  const project = getOrRestoreProject(projects, sandbox, projectId);
  if (!project) {
    reply.status(404);
    return { error: 'Project not found' };
  }

  const viewer = await auth.getViewer(request);
  const viewerId = viewer.user?.id ?? null;
  if (project.external && viewerId && project.ownerUserId !== viewerId) {
    // External folders are local IDE resources. If an old anonymous/stale
    // record was restored after a runtime restart, let the current local viewer
    // reclaim it instead of permanently 403-locking their own folder.
    project.ownerUserId = viewerId;
  }
  projects.syncSandboxProject(project);
  const allowed = access === 'write'
    ? projects.canWriteSandbox(projectId, viewerId)
    : projects.canReadSandbox(projectId, viewerId);

  if (allowed) {
    return project;
  }

  if (!viewer.authenticated || !viewer.user) {
    reply.status(401);
    return { error: `Sign in to ${access} this sandbox project` };
  }

  reply.status(403);
  return { error: `You do not have permission to ${access} this sandbox project` };
}

export function registerSandboxRoutes(app: FastifyInstance, sandbox: SandboxManager, auth: PlatformAuthService, projects: ProjectService) {
  /* ── Stack-based template system ── */

  /** List all available stacks with their tiers */
  app.get('/api/sandbox/stacks', async () => {
    return getAllStacks().map((s) => ({
      id: s.id,
      name: s.name,
      tagline: s.tagline,
      description: s.description,
      techStack: s.techStack,
      icon: s.icon,
      color: s.color,
      templates: s.templates.map((t) => ({
        id: t.id,
        tier: t.tier,
        name: t.name,
        description: t.description,
        features: t.features,
        fileCount: t.files.length,
        hasDocker: t.hasDocker,
        hasTests: t.hasTests,
        comingSoon: t.comingSoon ?? false,
      })),
    }));
  });

  /** Get a specific stack */
  app.get<{ Params: { stackId: string } }>(
    '/api/sandbox/stacks/:stackId',
    async (request) => {
      const stack = getStack(request.params.stackId);
      if (!stack) return { error: 'Stack not found' };
      return {
        ...stack,
        templates: stack.templates.map((t) => ({
          id: t.id,
          tier: t.tier,
          name: t.name,
          description: t.description,
          features: t.features,
          fileCount: t.files.length,
          hasDocker: t.hasDocker,
          hasTests: t.hasTests,
          comingSoon: t.comingSoon ?? false,
        })),
      };
    },
  );

  /** Deploy a stack template — streams NDJSON progress events */
  app.post<{ Body: { stackId: string; tier: string; name?: string } }>(
    '/api/sandbox/deploy',
    async (request, reply) => {
      const parsed = sandboxDeployBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const { stackId, tier, name } = parsed.data;
      const ownerUserId = await getViewerUserId(auth, request);

      // Validate template exists
      const template = getStackTemplate(stackId, tier);
      if (!template) {
        return reply.status(400).send({ error: `Template not found: ${stackId}-${tier}` });
      }
      if (template.comingSoon) {
        return reply.status(400).send({ error: `${template.name} is coming soon` });
      }

      // Stream NDJSON progress
      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
        'X-Content-Type-Options': 'nosniff',
      });

      const emit = (event: DeployEvent) => {
        try {
          reply.raw.write(JSON.stringify(event) + '\n');
        } catch {
          /* connection closed */
        }
      };

      const result = await deployStack(sandbox, stackId, tier, name, emit, ownerUserId);
      if (result) {
        const deployedProject = sandbox.get(result.projectId);
        if (deployedProject) {
          projects.syncSandboxProject(deployedProject);
        }
      }

      reply.raw.end();
    },
  );

  /* ── Legacy template system (backward compat) ── */

  /** List available templates */
  app.get('/api/sandbox/templates', async () => {
    return sandbox.listTemplates().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      fileCount: t.files.length,
    }));
  });

  /** Create project from template */
  app.post<{ Body: { templateId: string; name?: string } }>(
    '/api/sandbox/from-template',
    async (request, reply) => {
      const parsed = sandboxFromTemplateBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const ownerUserId = await getViewerUserId(auth, request);
      const project = await sandbox.createFromTemplate(
        parsed.data.templateId,
        parsed.data.name,
        ownerUserId,
      );
      projects.syncSandboxProject(project);
      // CLI-scaffolded projects (e.g. create-next-app) already have deps installed
      const cliScaffolded = project.logs.some((l: string) => /Scaffolded via.*real CLI/i.test(l));
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        version: project.version,
        files: Object.keys(project.files),
        depsInstalled: cliScaffolded,
      };
    },
  );

  /** Scan a local folder WITHOUT opening it — powers the open-folder review step. */
  app.post<{ Body: { path: string } }>(
    '/api/sandbox/scan-folder',
    async (request, reply) => {
      const parsed = sandboxOpenFolderBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      try {
        const discovery = sandbox.discoverProjects(parsed.data.path);
        if (discovery.candidates.length === 1) {
          const [candidate] = discovery.candidates;
          return {
            requestedRootDir: discovery.requestedRootDir,
            rootDir: candidate.rootDir,
            profile: candidate.profile,
            candidates: discovery.candidates,
          };
        }
        return {
          requestedRootDir: discovery.requestedRootDir,
          rootDir: null,
          profile: null,
          candidates: discovery.candidates,
        };
      } catch (err) {
        reply.status(400);
        return { error: err instanceof Error ? err.message : 'Unable to scan folder' };
      }
    },
  );

  /** Open an existing local folder as an EXTERNAL project — the "real IDE" path.
   *  The folder is served in place (dev server + the user's own hot reload);
   *  destroy() never deletes external folders. */
  app.post<{ Body: { path: string } }>(
    '/api/sandbox/open-folder',
    async (request, reply) => {
      const parsed = sandboxOpenFolderBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const ownerUserId = await getViewerUserId(auth, request);
      try {
        const { project, profile } = await sandbox.openExternal(parsed.data.path, ownerUserId);
        projects.syncSandboxProject(project);
        return {
          id: project.id,
          name: project.name,
          rootDir: project.rootDir,
          status: project.status,
          devPort: project.devPort,
          live: Boolean(project.devProcess && project.devPort),
          envLane: project.envLane,
          laneState: project.laneState,
          version: project.version,
          external: true,
          profile,
        };
      } catch (err) {
        reply.status(400);
        return { error: err instanceof Error ? err.message : 'Unable to open folder' };
      }
    },
  );

  /** Switch the app between dev | preview | production.
   *  Long-running by design (gates + build) — the caller should poll GET /:id
   *  for laneState instead of holding this request open; we still return the
   *  final state for simple callers. */
  app.post<{ Params: { id: string }; Body: { lane: 'dev' | 'preview' | 'production' } }>(
    '/api/sandbox/:id/switch-lane',
    async (request, reply) => {
      const parsed = sandboxSwitchLaneBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'write');
      if ('error' in project) {
        return project;
      }
      try {
        // Conflict checks are sync-shaped: reject them honestly with a 409
        // instead of swallowing them in the fire-and-forget below.
        if (project.laneState?.status === 'switching') {
          reply.status(409);
          return { error: `Already switching to ${project.laneState.lane} — wait for it to finish` };
        }
        if (project.commandRun?.status === 'running') {
          reply.status(409);
          return { error: `A command is running (${project.commandRun.script}) — wait for it to finish` };
        }
        // Fire the switch; report "accepted" immediately so the UI polls laneState.
        void sandbox.switchLane(request.params.id, parsed.data.lane).catch(() => { /* recorded in laneState */ });
        return { ok: true, lane: parsed.data.lane, status: 'switching' };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to switch lanes';
        reply.status(/already switching|command is running/i.test(message) ? 409 : 400);
        return { error: message };
      }
    },
  );

  /** Run a package.json script (build / lint / test …) — one at a time per project.
   *  Output streams into project logs; poll GET /api/sandbox/:id for commandRun state. */
  app.post<{ Params: { id: string }; Body: { script: string } }>(
    '/api/sandbox/:id/run-command',
    async (request, reply) => {
      const parsed = sandboxRunCommandBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'write');
      if ('error' in project) {
        return project;
      }
      try {
        const run = sandbox.runCommand(request.params.id, parsed.data.script);
        return { ok: true, script: run.script, status: run.status, startedAt: run.startedAt };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to run command';
        reply.status(/already running/i.test(message) ? 409 : 400);
        return { error: message };
      }
    },
  );

  /** Inspect which env vars are configured/missing without returning secret values. */
  app.get<{ Params: { id: string } }>(
    '/api/sandbox/:id/env-local',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'read');
      if ('error' in project) {
        return project;
      }
      try {
        return sandbox.getEnvStatus(request.params.id);
      } catch (err) {
        reply.status(400);
        return { error: err instanceof Error ? err.message : 'Unable to inspect environment' };
      }
    },
  );

  /** Write user-provided env values to .env.local, optionally restarting the dev server. */
  app.post<{ Params: { id: string }; Body: { values: Record<string, string>; restart?: boolean } }>(
    '/api/sandbox/:id/env-local',
    async (request, reply) => {
      const parsed = sandboxEnvLocalBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'write');
      if ('error' in project) {
        return project;
      }
      try {
        const status = await sandbox.writeEnvLocal(request.params.id, parsed.data.values);
        let restarted = false;
        if (parsed.data.restart) {
          sandbox.stopDev(request.params.id);
          await sandbox.startDev(request.params.id);
          restarted = true;
        }
        projects.syncSandboxProject(sandbox.get(request.params.id)!);
        return { ok: true, restarted, status };
      } catch (err) {
        reply.status(400);
        return { error: err instanceof Error ? err.message : 'Unable to write .env.local' };
      }
    },
  );

  /** Create a new sandbox project */
  app.post<{ Body: { name: string } }>(
    '/api/sandbox',
    async (request, reply) => {
      const parsed = sandboxCreateBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const ownerUserId = await getViewerUserId(auth, request);
      const project = await sandbox.create(parsed.data.name, ownerUserId);
      projects.syncSandboxProject(project);
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        version: project.version,
      };
    },
  );

  /** List all sandbox projects */
  app.get('/api/sandbox', async (request) => {
    const ownerUserId = await getViewerUserId(auth, request);
    const sandboxProjects = sandbox.list();
    for (const project of sandboxProjects) {
      projects.syncSandboxProject(project);
    }
    const readableSandboxIds = new Set(
      projects.listProjectsForUser(ownerUserId).map((project) => project.sandboxProjectId),
    );

    return sandboxProjects
      .filter((project) => readableSandboxIds.has(project.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        devPort: p.devPort,
        version: p.version,
        createdAt: p.createdAt,
        owned: Boolean(p.ownerUserId),
      }));
  });

  /** Get sandbox project details */
  app.get<{ Params: { id: string } }>(
    '/api/sandbox/:id',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'read');
      if ('error' in project) {
        return project;
      }
      const viewer = await auth.getViewer(request);
      const persistedProject = projects.syncSandboxProject(project);
      const role = persistedProject
        ? projects.getProjectRole(persistedProject.id, viewer.user?.id ?? null)
        : null;

      // Always scan disk for the full file list — in-memory map may be stale or partial after rehydration
      const fileList = await sandbox.listFiles(request.params.id).catch(() => Object.keys(project.files));

      const hasNodeModules = existsSync(join(project.rootDir, 'node_modules'));
      const profile = detectProjectProfile(project.rootDir);

      return {
        id: project.id,
        name: project.name,
        files: fileList,
        status: project.status,
        devPort: project.devPort,
        version: project.version,
        hasNodeModules,
        logs: project.logs.slice(-30),
        devStderr: project.devStderr.slice(-20),
        persistentProjectId: persistedProject?.id ?? null,
        role,
        external: project.external,
        framework: project.framework ?? profile.framework,
        scripts: Object.keys(profile.scripts),
        envLane: project.envLane,
        laneState: project.laneState,
        commandRun: project.commandRun
          ? {
              script: project.commandRun.script,
              status: project.commandRun.status,
              exitCode: project.commandRun.exitCode,
              startedAt: project.commandRun.startedAt,
              finishedAt: project.commandRun.finishedAt,
              tail: project.commandRun.output.slice(-15),
            }
          : null,
      };
    },
  );

  /** Render the live app at three widths and audit relational layout geometry. */
  app.post<{ Params: { id: string } }>(
    '/api/sandbox/:id/visual-audit',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'read');
      if ('error' in project) return project;
      if (!project.devPort || !project.devProcess) {
        return reply.status(409).send({ error: 'The App must be running before visual layout audit.' });
      }
      try {
        return await runLocalVisualLayoutAudit(`http://localhost:${project.devPort}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(503).send({ error: `Visual layout audit unavailable: ${message.slice(0, 500)}` });
      }
    },
  );

  /** Write files to a sandbox project */
  app.post<{ Params: { id: string }; Body: { files: FileWrite[] } }>(
    '/api/sandbox/:id/files',
    async (request, reply) => {
      const parsed = sandboxWriteFilesBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'write');
      if ('error' in project) {
        return project;
      }
      const viewer = await auth.getViewer(request);
      const baseVersion = project.version;
      const beforeFiles = await Promise.all(parsed.data.files.map(async (file) => ({
        path: file.path,
        beforeContent: await sandbox.readFile(request.params.id, file.path).catch(() => null),
        afterContent: file.content,
      })));
      try {
        const version = await sandbox.writeFiles(request.params.id, parsed.data.files, {
          baseVersion: parsed.data.baseVersion,
        });
        projects.syncSandboxProject(sandbox.get(request.params.id)!);
        const revision = projects.recordSandboxRevision({
          sandboxProjectId: request.params.id,
          actorUserId: viewer.user?.id ?? null,
          baseVersion,
          version,
          summary: `Wrote ${parsed.data.files.length} file(s)`,
          files: beforeFiles,
        });
        return { ok: true, filesWritten: parsed.data.files.length, version, revisionId: revision?.id ?? null };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to write files';
        if (/version conflict/i.test(message)) {
          reply.code(409);
          return { error: message, code: 'version_conflict' };
        }
        throw err;
      }
    },
  );

  /** List durable file revisions for a sandbox project */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/sandbox/:id/revisions',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'read');
      if ('error' in project) {
        return project;
      }
      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
      return { revisions: projects.listSandboxRevisions(request.params.id, limit) };
    },
  );

  /** Revert a recorded sandbox revision */
  app.post<{ Params: { id: string; revisionId: string } }>(
    '/api/sandbox/:id/revisions/:revisionId/revert',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'write');
      if ('error' in project) {
        return project;
      }

      const revision = projects.getSandboxRevision(request.params.revisionId);
      if (!revision || revision.sandboxProjectId !== request.params.id) {
        reply.code(404);
        return { error: 'Revision not found' };
      }

      const viewer = await auth.getViewer(request);
      const baseVersion = project.version;
      const currentFiles = await Promise.all(revision.files.map(async (file) => ({
        path: file.path,
        beforeContent: await sandbox.readFile(request.params.id, file.path).catch(() => null),
        afterContent: file.beforeContent,
      })));

      try {
        const version = await sandbox.restoreFiles(
          request.params.id,
          revision.files.map((file) => ({ path: file.path, content: file.beforeContent })),
          { baseVersion },
        );
        projects.syncSandboxProject(sandbox.get(request.params.id)!);
        const revertRevision = projects.recordSandboxRevision({
          sandboxProjectId: request.params.id,
          actorUserId: viewer.user?.id ?? null,
          baseVersion,
          version,
          summary: `Reverted revision ${request.params.revisionId}`,
          files: currentFiles,
        });
        return { ok: true, version, revisionId: revertRevision?.id ?? null };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to revert revision';
        if (/version conflict/i.test(message)) {
          reply.code(409);
          return { error: message, code: 'version_conflict' };
        }
        throw err;
      }
    },
  );

  /** Per-file diff stats for a recorded revision — powers the chat FileChangesBar
   *  (true +added/−removed, no fabricated numbers). Reuses the before/after content
   *  already captured by recordSandboxRevision, so no new snapshot storage. */
  app.get<{ Params: { id: string; revisionId: string } }>(
    '/api/sandbox/:id/revisions/:revisionId/diff',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'read');
      if ('error' in project) {
        return project;
      }
      const revision = projects.getSandboxRevision(request.params.revisionId);
      if (!revision || revision.sandboxProjectId !== request.params.id) {
        reply.code(404);
        return { error: 'Revision not found' };
      }
      const files = revision.files.map((file) => {
        const { added, removed } = lineDiffStats(file.beforeContent, file.afterContent);
        return { path: file.path, changeType: file.changeType, added, removed };
      });
      const totals = files.reduce(
        (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
        { added: 0, removed: 0 },
      );
      return { revisionId: revision.id, version: revision.version, files, totals };
    },
  );

  /** List files in a sandbox project */
  app.get<{ Params: { id: string } }>(
    '/api/sandbox/:id/files',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'read');
      if ('error' in project) {
        return project;
      }
      const files = await sandbox.listFiles(request.params.id);
      return { files };
    },
  );

  /** Read a specific file */
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/sandbox/:id/file',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'read');
      if ('error' in project) {
        return project;
      }
      const content = await sandbox.readFile(request.params.id, request.query.path);
      return { path: request.query.path, content };
    },
  );

  /** Install dependencies */
  app.post<{ Params: { id: string } }>(
    '/api/sandbox/:id/install',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'write');
      if ('error' in project) {
        return project;
      }
      const result = await sandbox.install(request.params.id);
      const updated = sandbox.get(request.params.id);
      if (updated) projects.syncSandboxProject(updated);
      return result;
    },
  );

  /** Start dev server */
  app.post<{ Params: { id: string } }>(
    '/api/sandbox/:id/start',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'write');
      if ('error' in project) {
        return project;
      }
      const { port } = await sandbox.startDev(request.params.id);
      const updated = sandbox.get(request.params.id);
      if (updated) projects.syncSandboxProject(updated);
      return { ok: true, port };
    },
  );

  /** Stop dev server */
  app.post<{ Params: { id: string } }>(
    '/api/sandbox/:id/stop',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'write');
      if ('error' in project) {
        return project;
      }
      sandbox.stopDev(request.params.id);
      const updated = sandbox.get(request.params.id);
      if (updated) projects.syncSandboxProject(updated);
      return { ok: true };
    },
  );

  /** VS Code-style text search across project files */
  app.post<{ Params: { id: string } }>(
    '/api/sandbox/:id/search',
    async (request, reply) => {
      const parsed = sandboxSearchBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'read');
      if ('error' in project) {
        return project;
      }
      try {
        return await sandbox.searchFiles(request.params.id, parsed.data);
      } catch (err) {
        reply.status(400);
        return { error: err instanceof Error ? err.message : 'Search failed' };
      }
    },
  );

  /** Search & replace across project files — records a revertable revision */
  app.post<{ Params: { id: string } }>(
    '/api/sandbox/:id/replace',
    async (request, reply) => {
      const parsed = sandboxReplaceBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'write');
      if ('error' in project) {
        return project;
      }
      try {
        const { changes, replacements } = await sandbox.replaceInFiles(request.params.id, parsed.data);
        if (
          parsed.data.expectedReplacements !== undefined
          && replacements !== parsed.data.expectedReplacements
        ) {
          reply.status(409);
          return {
            error: `Expected ${parsed.data.expectedReplacements} replacement(s), found ${replacements}; no files were changed.`,
            code: 'replacement_count_mismatch',
          };
        }
        if (changes.length === 0) {
          return { ok: true, filesChanged: 0, replacements: 0, version: project.version, revisionId: null };
        }
        const viewer = await auth.getViewer(request);
        const baseVersion = project.version;
        const version = await sandbox.writeFiles(
          request.params.id,
          changes.map((c) => ({ path: c.path, content: c.afterContent })),
          { baseVersion },
        );
        projects.syncSandboxProject(sandbox.get(request.params.id)!);
        const revision = projects.recordSandboxRevision({
          sandboxProjectId: request.params.id,
          actorUserId: viewer.user?.id ?? null,
          baseVersion,
          version,
          summary: `Replaced ${replacements} match(es) of "${parsed.data.query}" in ${changes.length} file(s)`,
          files: changes.map((c) => ({ path: c.path, beforeContent: c.beforeContent, afterContent: c.afterContent })),
        });
        return { ok: true, filesChanged: changes.length, replacements, version, revisionId: revision?.id ?? null };
      } catch (err) {
        reply.status(400);
        return { error: err instanceof Error ? err.message : 'Replace failed' };
      }
    },
  );

  /** Get project logs */
  app.get<{ Params: { id: string } }>(
    '/api/sandbox/:id/logs',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'read');
      if ('error' in project) {
        return project;
      }
      const logs = sandbox.getLogs(request.params.id);
      return { logs };
    },
  );

  /** Get handoff metadata for local desktop/VS Code flows */
  app.get<{ Params: { id: string } }>(
    '/api/sandbox/:id/handoff',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'read');
      if ('error' in project) {
        return project;
      }

      const viewer = await auth.getViewer(request);
      const persistedProject = projects.getProjectForSandboxWithRole(project.id, viewer.user?.id ?? null);

      return {
        id: project.id,
        persistentProjectId: persistedProject?.id ?? null,
        name: project.name,
        rootDir: project.rootDir,
        devPort: project.devPort,
        devUrl: project.devPort ? `http://localhost:${project.devPort}` : null,
        version: project.version,
        fileCount: Object.keys(project.files).length,
        owned: Boolean(project.ownerUserId),
        role: persistedProject?.role ?? null,
        targets: {
          desktop: true,
          vscode: true,
        },
      };
    },
  );

  /** Delete a sandbox project */
  app.delete<{ Params: { id: string } }>(
    '/api/sandbox/:id',
    async (request, reply) => {
      const project = await getAuthorizedProject(auth, projects, sandbox, request, reply, request.params.id, 'write');
      if ('error' in project) {
        return project;
      }
      await sandbox.destroy(request.params.id);
      projects.removeProjectForSandbox(request.params.id);
      return { ok: true };
    },
  );

  /* ── Custom Stack Management ───────────────────────────────── */

  /** List all custom stacks */
  app.get('/api/sandbox/custom-stacks', async () => {
    return getCustomStacks().map((s) => ({
      id: s.id,
      name: s.name,
      tagline: s.tagline,
      description: s.description,
      techStack: s.techStack,
      icon: s.icon,
      color: s.color,
      templateCount: s.templates.length,
    }));
  });

  /** Register a new custom stack from config */
  app.post<{ Body: CustomStackConfig }>(
    '/api/sandbox/custom-stacks',
    async (request, reply) => {
      try {
        const stack = registerCustomStack(request.body);
        return {
          ok: true,
          stack: {
            id: stack.id,
            name: stack.name,
            tagline: stack.tagline,
            techStack: stack.techStack,
            templateCount: stack.templates.length,
          },
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid custom stack config';
        return reply.status(400).send({ error: msg });
      }
    },
  );

  /** Remove a custom stack */
  app.delete<{ Params: { stackId: string } }>(
    '/api/sandbox/custom-stacks/:stackId',
    async (request, reply) => {
      const { stackId } = request.params;
      if (!isCustomStack(stackId)) {
        return reply.status(400).send({ error: 'Cannot delete built-in stacks' });
      }
      const deleted = unregisterCustomStack(stackId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Custom stack not found' });
      }
      return { ok: true };
    },
  );
}
