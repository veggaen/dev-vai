import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { ModelRegistry } from '@vai/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findVaiRepoRoot, registerAgentIntrospectRoutes } from './agent-introspect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

describe('agent introspect route', () => {
  it('exposes the offline agent tooling map and bootstrap channel', async () => {
    const app = Fastify();
    registerAgentIntrospectRoutes(app, {
      models: new ModelRegistry(),
      fallbackChain: ['vai:v0'],
      repoRoot: REPO_ROOT,
    });

    const res = await app.inject({ method: 'GET', url: '/api/agent/introspect' });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      channels?: { bootstrap?: string };
      agentTooling?: { commands?: Array<{ id?: string; command?: string }> };
      docs?: { agentsGuide?: string };
    };
    expect(body.channels?.bootstrap).toBe('pnpm agent:bootstrap');
    expect(body.agentTooling?.commands?.some((cmd) => cmd.id === 'agent-bootstrap')).toBe(true);
    expect(body.agentTooling?.commands?.some((cmd) => cmd.command === 'pnpm vai:status')).toBe(true);
    expect(body.docs?.agentsGuide).toContain('Working on Vai');
  });

  it('finds the repo root from nested runtime paths', () => {
    expect(findVaiRepoRoot(__dirname)).toBe(REPO_ROOT);
  });
});
