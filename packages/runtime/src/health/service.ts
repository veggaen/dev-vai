import {
  healthSnapshotSchema,
  subsystemHealthSchema,
  type HealthSnapshot,
  type SubsystemHealth,
} from '@vai/contracts/adoption';
import type { ModelRegistry } from '@vai/core';
import type { EnvironmentService } from '../environments/service.js';
import { TIMEOUTS_MS } from '@vai/constants';

export interface DetailedHealthProbe {
  readonly id: string;
  readonly label: string;
  readonly optional: boolean;
  readonly check: () => void | Promise<void>;
  readonly healthyImpact: string;
  readonly failureImpact: string;
  readonly nextAction: string;
  readonly evidenceRef: string;
  readonly failureState?: Extract<SubsystemHealth['state'], 'degraded' | 'offline'>;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || 'Unknown probe failure.';
}

export class DetailedHealthService {
  constructor(
    private readonly models: ModelRegistry,
    private readonly environments: EnvironmentService,
    private readonly probes: readonly DetailedHealthProbe[] = [],
  ) {}

  private async runProbe(
    probe: DetailedHealthProbe,
    checkedAt: number,
  ): Promise<SubsystemHealth> {
    const started = performance.now();
    try {
      await probe.check();
      return subsystemHealthSchema.parse({
        id: probe.id,
        label: probe.label,
        state: 'healthy',
        optional: probe.optional,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        impact: probe.healthyImpact,
        evidenceRef: probe.evidenceRef,
      });
    } catch (error) {
      return subsystemHealthSchema.parse({
        id: probe.id,
        label: probe.label,
        state: probe.failureState ?? (probe.optional ? 'degraded' : 'offline'),
        optional: probe.optional,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        cause: errorText(error),
        impact: probe.failureImpact,
        nextAction: probe.nextAction,
        evidenceRef: probe.evidenceRef,
      });
    }
  }

  async snapshot(): Promise<HealthSnapshot> {
    const now = Date.now();
    const subsystems: SubsystemHealth[] = [
      subsystemHealthSchema.parse({
        id: 'runtime',
        label: 'Vai runtime',
        state: 'healthy',
        optional: false,
        checkedAt: now,
        latencyMs: 0,
        impact: 'This authenticated health request is executing in the core runtime.',
        evidenceRef: 'runtime:health-request',
      }),
      ...await Promise.all(this.probes.map((probe) => this.runProbe(probe, now))),
      subsystemHealthSchema.parse({
        id: 'lsp',
        label: 'Language servers',
        state: 'unknown',
        optional: true,
        checkedAt: now,
        cause: 'No language-server heartbeat has been registered.',
        impact: 'Code intelligence may be reduced; editing and chat remain available.',
        nextAction: 'Open a code workspace to start its language server.',
        evidenceRef: 'lsp:heartbeat',
      }),
    ];

    for (const model of this.models.list()) {
      const started = performance.now();
      let state: SubsystemHealth['state'] = 'healthy';
      let cause: string | undefined;
      if (model.healthCheck) {
        try {
          if (!(await model.healthCheck())) {
            state = 'degraded';
            cause = 'Provider health check returned false.';
          }
        } catch (error) {
          state = 'offline';
          cause = errorText(error);
        }
      }
      subsystems.push(subsystemHealthSchema.parse({
        id: `provider:${model.id}`,
        label: model.displayName,
        state,
        optional: model.id !== 'vai:v0',
        checkedAt: now,
        latencyMs: Math.round(performance.now() - started),
        cause,
        impact: state === 'healthy'
          ? 'Provider can accept routed work.'
          : 'Vai will use another available provider and say that it degraded.',
        evidenceRef: `provider:${model.id}:health-check`,
        ...(state !== 'healthy'
          ? { nextAction: `Check the ${model.id} provider configuration and logs.` }
          : {}),
      }));
    }

    for (const environment of this.environments.listEnvironments()
      .filter((item) => item.transport !== 'loopback')) {
      const stale = !environment.lastHealthAt
        || now - environment.lastHealthAt > TIMEOUTS_MS.healthStale;
      subsystems.push(subsystemHealthSchema.parse({
        id: `environment:${environment.id}`,
        label: environment.name,
        state: stale ? 'unknown' : 'healthy',
        optional: true,
        checkedAt: now,
        cause: stale ? 'No recent authenticated heartbeat.' : undefined,
        impact: stale
          ? 'Remote actions are paused; local editing and composers stay available.'
          : 'Remote environment is ready.',
        evidenceRef: `environment:${environment.id}:authenticated-heartbeat`,
        ...(stale
          ? { nextAction: 'Reconnect or run the environment diagnostic.' }
          : {}),
      }));
    }

    const requiredFailure = subsystems.some(
      (item) => !item.optional
        && (item.state === 'offline' || item.state === 'degraded'),
    );
    const anyFailure = subsystems.some((item) => item.state !== 'healthy');
    return healthSnapshotSchema.parse({
      generatedAt: now,
      overall: requiredFailure ? 'offline' : anyFailure ? 'degraded' : 'healthy',
      subsystems,
    });
  }
}
