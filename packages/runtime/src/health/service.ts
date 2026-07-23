import { healthSnapshotSchema, subsystemHealthSchema, type HealthSnapshot, type SubsystemHealth } from '@vai/contracts/adoption';
import type { ModelRegistry } from '@vai/core';
import type { EnvironmentService } from '../environments/service.js';
import { TIMEOUTS_MS } from '@vai/constants';

export class DetailedHealthService {
  constructor(private readonly models: ModelRegistry, private readonly environments: EnvironmentService) {}
  async snapshot(): Promise<HealthSnapshot> {
    const now = Date.now();
    const subsystems: SubsystemHealth[] = [
      subsystemHealthSchema.parse({ id: 'runtime', label: 'Vai runtime', state: 'healthy', optional: false, checkedAt: now, impact: 'Core chat and local workspace APIs are available.' }),
      subsystemHealthSchema.parse({ id: 'lsp', label: 'Language servers', state: 'unknown', optional: true, checkedAt: now, cause: 'No language-server heartbeat has been registered.', impact: 'Code intelligence may be reduced; editing and chat remain available.', nextAction: 'Open a code workspace to start its language server.' }),
      subsystemHealthSchema.parse({ id: 'indexer', label: 'Incremental indexer', state: 'healthy', optional: true, checkedAt: now, impact: 'Changed-file indexing and ignore-aware lookup are available.' }),
    ];
    for (const model of this.models.list()) {
      const started = performance.now();
      let state: SubsystemHealth['state'] = 'healthy'; let cause: string | undefined;
      if (model.healthCheck) {
        try { if (!(await model.healthCheck())) { state = 'degraded'; cause = 'Provider health check returned false.'; } }
        catch (error) { state = 'offline'; cause = error instanceof Error ? error.message : String(error); }
      }
      subsystems.push(subsystemHealthSchema.parse({
        id: `provider:${model.id}`, label: model.displayName, state, optional: model.id !== 'vai:v0',
        checkedAt: now, latencyMs: Math.round(performance.now() - started), cause,
        impact: state === 'healthy' ? 'Provider can accept routed work.' : 'Vai will use another available provider and say that it degraded.',
        ...(state !== 'healthy' ? { nextAction: `Check the ${model.id} provider configuration and logs.` } : {}),
      }));
    }
    for (const environment of this.environments.listEnvironments().filter((item) => item.transport !== 'loopback')) {
      const stale = !environment.lastHealthAt || now - environment.lastHealthAt > TIMEOUTS_MS.healthStale;
      subsystems.push(subsystemHealthSchema.parse({
        id: `environment:${environment.id}`, label: environment.name, state: stale ? 'unknown' : 'healthy', optional: true,
        checkedAt: now, cause: stale ? 'No recent authenticated heartbeat.' : undefined,
        impact: stale ? 'Remote actions are paused; local editing and composers stay available.' : 'Remote environment is ready.',
        ...(stale ? { nextAction: 'Reconnect or run the environment diagnostic.' } : {}),
      }));
    }
    const requiredFailure = subsystems.some((item) => !item.optional && (item.state === 'offline' || item.state === 'degraded'));
    const anyFailure = subsystems.some((item) => item.state !== 'healthy');
    return healthSnapshotSchema.parse({ generatedAt: now, overall: requiredFailure ? 'offline' : anyFailure ? 'degraded' : 'healthy', subsystems });
  }
}
