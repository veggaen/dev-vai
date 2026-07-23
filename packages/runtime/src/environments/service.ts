import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  environmentSchema,
  pairedSessionSchema,
  type PairedSession,
  type SavedEnvironment,
} from '@vai/contracts/adoption';
import { TIMEOUTS_MS } from '@vai/constants';
import { JsonStore } from '../persistence/json-store.js';

interface PairingTokenRecord {
  id: string; digest: string; integrationId: string; environmentId: string; scopes: string[];
  expiresAt: number; usedAt?: number;
}
interface PairedSessionRecord extends PairedSession { secretDigest: string; deviceLabel: string; }
interface EnvironmentDocument { environments: SavedEnvironment[]; tokens: PairingTokenRecord[]; sessions: PairedSessionRecord[]; }

function digest(secret: string): string { return createHash('sha256').update(secret, 'utf8').digest('hex'); }
function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class EnvironmentService {
  private document: EnvironmentDocument;
  constructor(private readonly store: JsonStore<EnvironmentDocument>, private readonly now = () => Date.now()) {
    const raw = store.read();
    this.document = {
      environments: raw.environments.flatMap((value) => { const parsed = environmentSchema.safeParse(value); return parsed.success ? [parsed.data] : []; }),
      tokens: Array.isArray(raw.tokens) ? raw.tokens : [], sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    };
  }
  listEnvironments(): SavedEnvironment[] { return [...this.document.environments]; }
  saveEnvironment(input: Omit<SavedEnvironment, 'id' | 'trust' | 'createdAt' | 'updatedAt'>): SavedEnvironment {
    const now = this.now();
    const environment = environmentSchema.parse({ ...input, id: randomUUID(), trust: input.transport === 'loopback' ? 'local' : 'unverified', createdAt: now, updatedAt: now });
    this.document.environments.push(environment); this.persist(); return environment;
  }
  removeEnvironment(id: string): void {
    this.document.environments = this.document.environments.filter((environment) => environment.id !== id);
    this.document.sessions = this.document.sessions.map((session) => session.environmentId === id ? { ...session, revokedAt: this.now() } : session);
    this.persist();
  }
  restoreEnvironments(records: readonly SavedEnvironment[], overwrite: boolean): number {
    const existing = new Set(this.document.environments.map((environment) => environment.id));
    const accepted = records.map((record) => environmentSchema.parse({
      ...record,
      credentialId: undefined,
      trust: record.transport === 'loopback' ? 'local' : 'unverified',
    })).filter((record) => overwrite || !existing.has(record.id));
    if (overwrite) {
      const ids = new Set(accepted.map((record) => record.id));
      this.document.environments = this.document.environments.filter((record) => !ids.has(record.id));
    }
    this.document.environments.push(...accepted); this.persist(); return accepted.length;
  }
  createPairingToken(environmentId: string, integrationId: string, scopes: string[]): { token: string; id: string; expiresAt: number; pairingFragment: string } {
    if (!this.document.environments.some((environment) => environment.id === environmentId)) throw new Error(`Environment not found: ${environmentId}`);
    const secret = randomBytes(32).toString('base64url');
    const record: PairingTokenRecord = { id: randomUUID(), digest: digest(secret), integrationId, environmentId, scopes, expiresAt: this.now() + TIMEOUTS_MS.pairingToken };
    this.document.tokens.push(record); this.persist();
    return { token: secret, id: record.id, expiresAt: record.expiresAt, pairingFragment: `#pair=${encodeURIComponent(secret)}` };
  }
  exchange(token: string, deviceLabel: string): { session: PairedSession; sessionSecret: string } {
    const tokenDigest = digest(token);
    const record = this.document.tokens.find((candidate) => sameDigest(candidate.digest, tokenDigest));
    if (!record || record.usedAt || record.expiresAt <= this.now()) throw new Error('Pairing token is invalid, expired, or already used');
    record.usedAt = this.now();
    const sessionSecret = randomBytes(32).toString('base64url');
    const session: PairedSessionRecord = {
      id: randomUUID(), environmentId: record.environmentId, integrationId: record.integrationId,
      credentialId: randomUUID(), scopes: record.scopes, createdAt: this.now(), secretDigest: digest(sessionSecret), deviceLabel,
    };
    this.document.sessions.push(session);
    this.document.environments = this.document.environments.map((environment) => environment.id === record.environmentId
      ? { ...environment, trust: 'paired', credentialId: session.credentialId, updatedAt: this.now() }
      : environment);
    this.persist();
    const { secretDigest: _secretDigest, deviceLabel: _deviceLabel, ...publicSession } = session;
    return { session: pairedSessionSchema.parse(publicSession), sessionSecret };
  }
  listSessions(): Array<PairedSession & { deviceLabel: string }> {
    return this.document.sessions.map(({ secretDigest: _secretDigest, ...session }) => session);
  }
  revokeSession(id: string): PairedSession {
    const session = this.document.sessions.find((candidate) => candidate.id === id); if (!session) throw new Error(`Session not found: ${id}`);
    session.revokedAt = this.now(); this.persist();
    const { secretDigest: _secretDigest, deviceLabel: _deviceLabel, ...publicSession } = session;
    return pairedSessionSchema.parse(publicSession);
  }
  private persist(): void { this.store.write(this.document); }
}
