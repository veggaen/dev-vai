import {
  capabilityGrantSchema,
  type CapabilityGrant,
  type CapabilityScope,
} from '@vai/contracts/adoption';
import { JsonStore } from '../persistence/json-store.js';

function normalizeWorkspaceId(value: string): string {
  return value.trim().replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
}

export class CapabilityGrantService {
  private grants: CapabilityGrant[];
  constructor(private readonly store: JsonStore<CapabilityGrant[]>, private readonly now = () => Date.now()) {
    this.grants = store.read().flatMap((value) => {
      const parsed = capabilityGrantSchema.safeParse(value); return parsed.success ? [parsed.data] : [];
    });
  }

  list(workspaceId?: string): CapabilityGrant[] {
    const normalized = workspaceId ? normalizeWorkspaceId(workspaceId) : null;
    return this.grants.filter((grant) => !normalized || normalizeWorkspaceId(grant.workspaceId) === normalized);
  }

  resolve(workspaceId: string, sessionId?: string): { workspaceScope: CapabilityScope; sessionScope: CapabilityScope } {
    const relevant = this.list(workspaceId);
    const workspace = relevant.find((grant) => !grant.sessionId);
    const session = sessionId ? relevant.find((grant) => grant.sessionId === sessionId) : undefined;
    return { workspaceScope: workspace?.workspaceScope ?? 'read-only', sessionScope: session?.sessionScope ?? workspace?.workspaceScope ?? 'read-only' };
  }

  grant(input: { workspaceId: string; sessionId?: string; scope: CapabilityScope }, grantedBy: string): CapabilityGrant {
    const normalized = normalizeWorkspaceId(input.workspaceId);
    const record = capabilityGrantSchema.parse({
      workspaceId: normalized, ...(input.sessionId ? { sessionId: input.sessionId, sessionScope: input.scope } : {}),
      workspaceScope: input.sessionId ? this.resolve(normalized).workspaceScope : input.scope,
      grantedBy: 'user', grantedById: grantedBy, grantedAt: this.now(),
    });
    this.grants = [
      ...this.grants.filter((grant) => !(normalizeWorkspaceId(grant.workspaceId) === normalized && grant.sessionId === input.sessionId)),
      record,
    ];
    this.store.write(this.grants);
    return record;
  }
}
