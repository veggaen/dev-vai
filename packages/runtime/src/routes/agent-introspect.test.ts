import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { ModelRegistry } from '@vai/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAgentIntrospectRoutes } from './agent-introspect.js';
import { findVaiSourceRoot, type VaiOperationalRoots } from '../operational-roots.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ROOTS: VaiOperationalRoots = {
  runtimeKind: 'source',
  source: { path: REPO_ROOT, origin: 'explicit' },
  buildEvidence: { origin: 'unavailable', error: 'not packaged' },
  userData: { path: path.join(REPO_ROOT, 'Temporary_files'), origin: 'database' },
};

describe('agent introspect route', () => {
  it('exposes the offline agent tooling map and bootstrap channel', async () => {
    const app = Fastify();
    registerAgentIntrospectRoutes(app, {
      models: new ModelRegistry(),
      fallbackChain: ['vai:v0'],
      roots: ROOTS,
      operationalEvidence: () => ({
        schemaVersion: 1,
        capturedAt: '2026-07-19T07:54:13.000Z',
        runtime: { sourceId: 'runtime:process', healthy: true, engine: 'vai:v0' },
        build: {
          sourceId: 'build:source-git', available: true, runtimeKind: 'source',
          commit: 'a'.repeat(40), branch: 'test', version: '0.2.0',
          builtAt: null, dirty: true,
        },
        repository: {
          sourceId: 'git:source-status', available: true, branch: 'test',
          changedFiles: 3, modifiedFiles: 2, untrackedFiles: 1,
        },
        verification: {
          sourceId: 'verification:source-receipt', available: true, status: 'pass',
          capturedAt: '2026-07-19T07:50:00.000Z', totalTestsPassed: 1179,
          typechecks: ['@vai/core', '@vai/runtime'], stale: false,
        },
        selfImprovement: {
          sourceId: 'self-improve:source-corpus', available: true, queuedFixes: 302,
          qualified: 86, adopted: 0, pendingNominations: 2, integratedNominations: 1,
          latestRunStatus: 'aborted-runtime-down', latestRunAt: '2026-07-02T05:46:56.677Z',
        },
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/agent/introspect' });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      channels?: { bootstrap?: string };
      agentTooling?: { commands?: Array<{ id?: string; command?: string }> };
      conversationIntelligence?: {
        owner?: string;
        pipeline?: string[];
        modelPolicy?: string;
        answerRevisionGate?: { owner?: string; checks?: string[] };
      };
      boundedReasoning?: {
        owner?: string;
        representations?: string[];
        modelPolicy?: string;
        competition?: {
          suite?: string;
          baseFingerprint?: string;
          fresh1Fingerprint?: string;
          fresh2Fingerprint?: string;
          fresh3Fingerprint?: string;
          v3SoundnessFingerprint?: string;
          v3FrontierFingerprint?: string;
          v3FreshFingerprint?: string;
          v4SealedFingerprint?: string;
          v4Wave2Fingerprint?: string;
        };
      };
      docs?: { agentsGuide?: string };
      operationalEvidence?: { selfImprovement?: { sourceId?: string; adopted?: number } };
    };
    expect(body.channels?.bootstrap).toBe('pnpm agent:bootstrap');
    expect(body.agentTooling?.commands?.some((cmd) => cmd.id === 'agent-bootstrap')).toBe(true);
    expect(body.agentTooling?.commands?.some((cmd) => cmd.command === 'pnpm vai:status')).toBe(true);
    expect(body.conversationIntelligence?.owner).toBe('vai:v0');
    expect(body.conversationIntelligence?.pipeline).toContain('preserve named relationships and attributed beliefs');
    expect(body.conversationIntelligence?.pipeline).toContain('answer broad Vai self-assessment from explicit operational-evidence boundaries');
    expect(body.conversationIntelligence?.modelPolicy).toMatch(/without Council/i);
    expect(body.conversationIntelligence?.answerRevisionGate?.owner).toBe('vai:v0');
    expect(body.conversationIntelligence?.answerRevisionGate?.checks).toContain('reject material deterministic answer-quality regressions');
    expect(body.boundedReasoning?.owner).toBe('vai:v0');
    expect(body.boundedReasoning?.representations).toContain('Bayes, throughput, and recurrence equations');
    expect(body.boundedReasoning?.representations).toContain('per-iteration closure bindings, confounding controls, constructive counterexamples, and corrected event ledgers');
    expect(body.boundedReasoning?.representations).toContain('linear underdetermination witnesses, expected-cost objectives, count-posterior policy decisions, and Boolean consistency search');
    expect(body.boundedReasoning?.modelPolicy).toMatch(/bypass Council and response models/i);
    expect(body.boundedReasoning?.competition?.baseFingerprint).toHaveLength(64);
    expect(body.boundedReasoning?.competition?.fresh1Fingerprint).toHaveLength(64);
    expect(body.boundedReasoning?.competition?.fresh2Fingerprint).toHaveLength(64);
    expect(body.boundedReasoning?.competition?.fresh3Fingerprint).toHaveLength(64);
    expect(body.boundedReasoning?.competition?.suite).toBe('reasoning-spectrum-v4');
    expect(body.boundedReasoning?.competition?.v3SoundnessFingerprint).toHaveLength(64);
    expect(body.boundedReasoning?.competition?.v3FrontierFingerprint).toHaveLength(64);
    expect(body.boundedReasoning?.competition?.v3FreshFingerprint).toHaveLength(64);
    expect(body.boundedReasoning?.competition?.v4SealedFingerprint).toHaveLength(64);
    expect(body.boundedReasoning?.competition?.v4Wave2Fingerprint).toHaveLength(64);
    expect(body.operationalEvidence?.selfImprovement).toMatchObject({
      sourceId: 'self-improve:source-corpus',
      adopted: 0,
    });
    expect(body.docs?.agentsGuide).toContain('Working on Vai');
  });

  it('finds the repo root from nested runtime paths', () => {
    expect(findVaiSourceRoot(__dirname)).toBe(REPO_ROOT);
  });
});
