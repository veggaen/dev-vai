import type { FastifyInstance } from 'fastify';
import type { SandboxManager, FileWrite } from '../sandbox/manager.js';

export function registerSandboxRoutes(app: FastifyInstance, sandbox: SandboxManager) {
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
    async (request) => {
      const project = await sandbox.createFromTemplate(
        request.body.templateId,
        request.body.name,
      );
      return {
        id: project.id,
        name: project.name,
        rootDir: project.rootDir,
        status: project.status,
        files: Object.keys(project.files),
      };
    },
  );

  /** Create a new sandbox project */
  app.post<{ Body: { name: string } }>(
    '/api/sandbox',
    async (request) => {
      const project = await sandbox.create(request.body.name);
      return {
        id: project.id,
        name: project.name,
        rootDir: project.rootDir,
        status: project.status,
      };
    },
  );

  /** List all sandbox projects */
  app.get('/api/sandbox', async () => {
    return sandbox.list().map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      devPort: p.devPort,
      createdAt: p.createdAt,
    }));
  });

  /** Get sandbox project details */
  app.get<{ Params: { id: string } }>(
    '/api/sandbox/:id',
    async (request) => {
      const project = sandbox.get(request.params.id);
      if (!project) {
        return { error: 'Project not found' };
      }
      return {
        id: project.id,
        name: project.name,
        rootDir: project.rootDir,
        files: Object.keys(project.files),
        status: project.status,
        devPort: project.devPort,
        logs: project.logs.slice(-30),
      };
    },
  );

  /** Write files to a sandbox project */
  app.post<{ Params: { id: string }; Body: { files: FileWrite[] } }>(
    '/api/sandbox/:id/files',
    async (request) => {
      await sandbox.writeFiles(request.params.id, request.body.files);
      return { ok: true, filesWritten: request.body.files.length };
    },
  );

  /** List files in a sandbox project */
  app.get<{ Params: { id: string } }>(
    '/api/sandbox/:id/files',
    async (request) => {
      const files = await sandbox.listFiles(request.params.id);
      return { files };
    },
  );

  /** Read a specific file */
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/sandbox/:id/file',
    async (request) => {
      const content = await sandbox.readFile(request.params.id, request.query.path);
      return { path: request.query.path, content };
    },
  );

  /** Install dependencies */
  app.post<{ Params: { id: string } }>(
    '/api/sandbox/:id/install',
    async (request) => {
      const result = await sandbox.install(request.params.id);
      return result;
    },
  );

  /** Start dev server */
  app.post<{ Params: { id: string } }>(
    '/api/sandbox/:id/start',
    async (request) => {
      const { port } = await sandbox.startDev(request.params.id);
      return { ok: true, port };
    },
  );

  /** Stop dev server */
  app.post<{ Params: { id: string } }>(
    '/api/sandbox/:id/stop',
    async (request) => {
      sandbox.stopDev(request.params.id);
      return { ok: true };
    },
  );

  /** Get project logs */
  app.get<{ Params: { id: string } }>(
    '/api/sandbox/:id/logs',
    async (request) => {
      const logs = sandbox.getLogs(request.params.id);
      return { logs };
    },
  );

  /** Delete a sandbox project */
  app.delete<{ Params: { id: string } }>(
    '/api/sandbox/:id',
    async (request) => {
      await sandbox.destroy(request.params.id);
      return { ok: true };
    },
  );
}
