import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PlatformAuthService, PlatformViewer } from './platform-auth.js';

/**
 * Resolve the host authority for sensitive adoption routes.
 *
 * A local-only runtime may deliberately run without platform auth; in that
 * configuration the operating-system user is the authority. Once platform
 * auth is enabled, an anonymous request must never mutate host policy or
 * persisted user data, even if it originates from loopback.
 */
export async function requireHostAuthority(
  auth: PlatformAuthService,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PlatformViewer | null> {
  const viewer = await auth.getViewer(request);
  if (auth.isEnabled() && (!viewer.authenticated || !viewer.user)) {
    reply.status(401).send({ error: 'Sign in to change host-owned settings.', code: 'authentication_required' });
    return null;
  }
  return viewer;
}
