import { describe, expect, it } from 'vitest';
import {
  ModelRegistry,
  type ChatChunk,
  type ModelAdapter,
} from '@vai/core';
import type { EnvironmentService } from '../environments/service.js';
import {
  DetailedHealthService,
  type DetailedHealthProbe,
} from './service.js';

function environmentService(
  environments: ReturnType<EnvironmentService['listEnvironments']> = [],
): EnvironmentService {
  return {
    listEnvironments: () => environments,
  } as EnvironmentService;
}

function probe(
  id: string,
  optional: boolean,
  check: () => void | Promise<void>,
): DetailedHealthProbe {
  return {
    id,
    label: id,
    optional,
    check,
    healthyImpact: `${id} works.`,
    failureImpact: `${id} is unavailable.`,
    nextAction: `Repair ${id}.`,
    evidenceRef: `${id}:probe`,
  };
}

function adapter(
  id: string,
  healthCheck: () => Promise<boolean>,
): ModelAdapter {
  return {
    id,
    displayName: id,
    provider: 'local',
    supportsStreaming: true,
    supportsToolUse: false,
    healthCheck,
    async chat() {
      return {
        message: { role: 'assistant', content: '' },
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: 'stop',
        modelId: id,
      };
    },
    async *chatStream(): AsyncIterable<ChatChunk> {
      yield { type: 'done' };
    },
  };
}

describe('DetailedHealthService', () => {
  it('derives database and indexer health from their owning probes', async () => {
    const service = new DetailedHealthService(
      new ModelRegistry(),
      environmentService(),
      [
        probe('database', false, () => undefined),
        probe('indexer', true, () => undefined),
      ],
    );

    const snapshot = await service.snapshot();

    expect(snapshot.subsystems.find((item) => item.id === 'runtime')).toMatchObject({
      state: 'healthy',
      evidenceRef: 'runtime:health-request',
    });
    expect(snapshot.subsystems.find((item) => item.id === 'database')).toMatchObject({
      state: 'healthy',
      evidenceRef: 'database:probe',
    });
    expect(snapshot.subsystems.find((item) => item.id === 'indexer')).toMatchObject({
      state: 'healthy',
      evidenceRef: 'indexer:probe',
    });
  });

  it('contains a required database failure to its row and aggregate state', async () => {
    const service = new DetailedHealthService(
      new ModelRegistry(),
      environmentService(),
      [
        probe('database', false, () => { throw new Error('database read failed'); }),
        probe('indexer', true, () => undefined),
      ],
    );

    const snapshot = await service.snapshot();

    expect(snapshot.overall).toBe('offline');
    expect(snapshot.subsystems.find((item) => item.id === 'database')).toMatchObject({
      state: 'offline',
      cause: 'database read failed',
    });
    expect(snapshot.subsystems.find((item) => item.id === 'indexer')?.state).toBe('healthy');
    expect(snapshot.subsystems.find((item) => item.id === 'runtime')?.state).toBe('healthy');
  });

  it('reports optional indexer, provider, and remote failures without collapsing runtime health', async () => {
    const models = new ModelRegistry();
    models.register(adapter('local:offline', async () => false));
    const service = new DetailedHealthService(
      models,
      environmentService([{
        id: 'remote-1',
        name: 'Remote',
        transport: 'ssh',
        endpoint: 'http://127.0.0.1:3006',
        deviceLabel: 'test',
        trust: 'paired',
        exposed: false,
        createdAt: 1,
        updatedAt: 1,
      }]),
      [
        probe('database', false, () => undefined),
        probe('indexer', true, () => { throw new Error('index unavailable'); }),
      ],
    );

    const snapshot = await service.snapshot();

    expect(snapshot.overall).toBe('degraded');
    expect(snapshot.subsystems.find((item) => item.id === 'runtime')?.state).toBe('healthy');
    expect(snapshot.subsystems.find((item) => item.id === 'database')?.state).toBe('healthy');
    expect(snapshot.subsystems.find((item) => item.id === 'indexer')?.state).toBe('degraded');
    expect(snapshot.subsystems.find((item) => item.id === 'provider:local:offline')?.state).toBe('degraded');
    expect(snapshot.subsystems.find((item) => item.id === 'environment:remote-1')?.state).toBe('unknown');
  });
});
