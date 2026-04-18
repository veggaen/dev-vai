import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SandboxManager, FileWrite } from '../sandbox/manager.js';
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
} from '@vai/api-types/sandbox';
import { invalidRequestBody } from '../validation/http-validation.js';

async function getViewerUserId(auth: PlatformAuthService, request: FastifyRequest): Promise<string | null> {
  const viewer = await auth.getViewer(request);
  return viewer.user?.id ?? null;
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
      // CLI-scaffolded projects (e.g. create-next-app) already have deps installed
      const cliScaffolded = project.logs.some((l: string) => /Scaffolded via.*real CLI/i.test(l));
      return {
        id: project.id,
        name: project.name,
        rootDir: project.rootDir,
        status: project.status,
        files: Object.keys(project.files),
        depsInstalled: cliScaffolded,
      };
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
      return {
        id: project.id,
        name: project.name,
        rootDir: project.rootDir,
        status: project.status,
      };
    },
  );

  /** List all sandbox projects */
  app.get('/api/sandbox', async (request) => {
    const ownerUserId = await getViewerUserId(auth, request);
    return sandbox.list().filter((project) => projects.canReadSandbox(project.id, ownerUserId)).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      devPort: p.devPort,
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

      return {
        id: project.id,
        name: project.name,
        rootDir: project.rootDir,
        files: fileList,
        status: project.status,
        devPort: project.devPort,
        hasNodeModules,
        logs: project.logs.slice(-30),
        devStderr: project.devStderr.slice(-20),
        persistentProjectId: persistedProject?.id ?? null,
        role,
      };
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
      await sandbox.writeFiles(request.params.id, parsed.data.files);
      projects.syncSandboxProject(sandbox.get(request.params.id)!);
      return { ok: true, filesWritten: parsed.data.files.length };
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
