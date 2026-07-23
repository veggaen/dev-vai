import type { FastifyInstance } from 'fastify';
import { sshLaunchRequestSchema, sshLaunchResultSchema } from '@vai/contracts/adoption';
import type { SshLauncher } from '../environments/ssh-launcher.js';
import { invalidRequestBody } from '../validation/http-validation.js';
import { assertResponseContract } from '../validation/response-contract.js';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import { requireHostAuthority } from '../auth/route-authority.js';

export function registerSshLaunchRoutes(app: FastifyInstance, launcher: SshLauncher, auth: PlatformAuthService): void {
  app.post('/api/environments/ssh/launch', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    const parsed = sshLaunchRequestSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    const result = await launcher.launch(parsed.data);
    return assertResponseContract(sshLaunchResultSchema, result, 'POST /api/environments/ssh/launch');
  });
}
