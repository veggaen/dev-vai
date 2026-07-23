import type { FastifyInstance } from 'fastify';
import { hardwareModelReportSchema, healthSnapshotSchema } from '@vai/contracts/adoption';
import type { DetailedHealthService } from '../health/service.js';
import type { HardwareModelService } from '../health/hardware.js';
import { assertResponseContract } from '../validation/response-contract.js';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import { requireHostAuthority } from '../auth/route-authority.js';

export function registerDetailedHealthRoutes(app: FastifyInstance, health: DetailedHealthService, hardware: HardwareModelService, auth: PlatformAuthService): void {
  app.get('/api/health/detail', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    return assertResponseContract(healthSnapshotSchema, await health.snapshot(), 'GET /api/health/detail');
  });
  app.get('/api/hardware/models', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    return assertResponseContract(hardwareModelReportSchema, await hardware.report(), 'GET /api/hardware/models');
  });
}
