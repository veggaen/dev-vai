import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

function secureEquals(left: string, right: string): boolean {
  const a = createHmac('sha256', 'vai-request-trust').update(left).digest();
  const b = createHmac('sha256', 'vai-request-trust').update(right).digest();
  return timingSafeEqual(a, b);
}

function extractHeaderValue(request: FastifyRequest, headerName: string): string | null {
  const value = request.headers[headerName];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = extractHeaderValue(request, 'authorization');
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0]?.toLowerCase() === 'bearer' && parts[1]) {
    return parts[1];
  }
  return null;
}

export function isLocalRequest(request: FastifyRequest): boolean {
  return LOCAL_HOSTS.has(request.ip);
}

export function isLocalDevMutationAllowed(
  request: FastifyRequest,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isLocalRequest(request) && env.NODE_ENV !== 'production';
}

export function hasTrustedCaptureAccess(
  request: FastifyRequest,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isLocalRequest(request)) return true;

  const configured = env.VAI_CAPTURE_API_KEY?.trim();
  if (!configured) return false;

  const provided =
    extractHeaderValue(request, 'x-vai-capture-key') ??
    extractHeaderValue(request, 'x-api-key') ??
    extractBearerToken(request);

  return Boolean(provided && secureEquals(provided, configured));
}
