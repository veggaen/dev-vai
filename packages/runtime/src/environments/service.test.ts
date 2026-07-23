import { describe, expect, it } from 'vitest';
import { EnvironmentService } from './service.js';
import { JsonStore } from '../persistence/json-store.js';

class MemoryStore<T> extends JsonStore<T> {
  constructor(private value: T) { super('unused', value); }
  override read(): T { return structuredClone(this.value); }
  override write(value: T): void { this.value = structuredClone(value); }
}

describe('EnvironmentService pairing', () => {
  it('stores only token digests, exchanges once, and revokes sessions', () => {
    const store = new MemoryStore({ environments: [], tokens: [], sessions: [] });
    const service = new EnvironmentService(store, () => 100);
    const environment = service.saveEnvironment({ name: 'Laptop', transport: 'loopback', endpoint: 'http://127.0.0.1', deviceLabel: 'local', exposed: false });
    const pairing = service.createPairingToken(environment.id, 'desktop', ['chat']);
    expect(JSON.stringify(store.read())).not.toContain(pairing.token);
    expect(pairing.pairingFragment.startsWith('#pair=')).toBe(true);
    const exchanged = service.exchange(pairing.token, 'Phone');
    expect(exchanged.sessionSecret).toHaveLength(43);
    expect(() => service.exchange(pairing.token, 'Again')).toThrow('already used');
    expect(service.revokeSession(exchanged.session.id).revokedAt).toBe(100);
  });
});
