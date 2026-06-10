import { randomUUID } from 'node:crypto';
import type {
  CompanionContextEvidence,
  CompanionContextField,
  CompanionContextWorkItem,
} from '@vai/api-types/companion-context';

interface PendingContextRequest {
  requestId: string;
  requestedFields: CompanionContextField[];
  targetUserId: string | null;
  createdAt: number;
  expiresAt: number;
  claimedByClientId: string | null;
  claimExpiresAt: number | null;
  resolve: (evidence: CompanionContextEvidence | undefined) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface CompanionContextRequestOptions {
  requestedFields: CompanionContextField[];
  targetUserId?: string | null;
  timeoutMs?: number;
}

export interface CompanionContextPollOptions {
  clientId: string;
  userId?: string | null;
}

const DEFAULT_TIMEOUT_MS = 2_000;
const CLAIM_TIMEOUT_MS = 1_500;

export class CompanionContextBroker {
  private readonly pending = new Map<string, PendingContextRequest>();

  request(options: CompanionContextRequestOptions): Promise<CompanionContextEvidence | undefined> {
    if (options.requestedFields.length === 0) {
      return Promise.resolve(undefined);
    }

    const now = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const requestId = randomUUID();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.finish(requestId, undefined);
      }, timeoutMs);

      this.pending.set(requestId, {
        requestId,
        requestedFields: [...new Set(options.requestedFields)],
        targetUserId: options.targetUserId ?? null,
        createdAt: now,
        expiresAt: now + timeoutMs,
        claimedByClientId: null,
        claimExpiresAt: null,
        resolve,
        timeout,
      });
    });
  }

  poll(options: CompanionContextPollOptions): CompanionContextWorkItem | null {
    const now = Date.now();
    this.purgeExpired(now);

    for (const request of this.pending.values()) {
      if (request.targetUserId && request.targetUserId !== options.userId) continue;

      if (request.claimedByClientId && request.claimExpiresAt && request.claimExpiresAt > now) {
        continue;
      }

      request.claimedByClientId = options.clientId;
      request.claimExpiresAt = Math.min(request.expiresAt, now + CLAIM_TIMEOUT_MS);

      return {
        requestId: request.requestId,
        requestedFields: request.requestedFields,
        createdAt: new Date(request.createdAt).toISOString(),
        expiresAt: new Date(request.expiresAt).toISOString(),
      };
    }

    return null;
  }

  respond(
    requestId: string,
    clientId: string,
    evidence: CompanionContextEvidence,
  ): void {
    const request = this.pending.get(requestId);
    if (!request) {
      throw new Error('Companion context request is missing or expired');
    }
    if (request.claimedByClientId !== clientId) {
      throw new Error('Companion context request was not claimed by this client');
    }

    this.finish(requestId, evidence);
  }

  getPendingCount(): number {
    this.purgeExpired(Date.now());
    return this.pending.size;
  }

  private purgeExpired(now: number): void {
    for (const request of this.pending.values()) {
      if (request.expiresAt <= now) {
        this.finish(request.requestId, undefined);
      }
    }
  }

  private finish(requestId: string, evidence: CompanionContextEvidence | undefined): void {
    const request = this.pending.get(requestId);
    if (!request) return;

    clearTimeout(request.timeout);
    this.pending.delete(requestId);
    request.resolve(evidence);
  }
}
