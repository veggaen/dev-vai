import { describe, expect, it } from 'vitest';
import { JsonStore } from '../persistence/json-store.js';
import { CapabilityGrantService } from './capability-grants.js';

class MemoryStore<T> extends JsonStore<T> {
  constructor(private value: T) { super('unused', value); }
  override read(): T { return structuredClone(this.value); }
  override write(value: T): void { this.value = structuredClone(value); }
}

describe('CapabilityGrantService', () => {
  it('defaults to read-only and never derives grants from repository input', () => {
    const service = new CapabilityGrantService(new MemoryStore([]), () => 100);
    expect(service.resolve('C:\\untrusted-repo', 's1')).toEqual({ workspaceScope: 'read-only', sessionScope: 'read-only' });
    service.grant({ workspaceId: 'C:\\untrusted-repo', scope: 'full' }, 'owner-1');
    service.grant({ workspaceId: 'C:/untrusted-repo', sessionId: 's1', scope: 'no-network' }, 'owner-1');
    expect(service.resolve('c:/UNTRUSTED-repo', 's1')).toEqual({ workspaceScope: 'full', sessionScope: 'no-network' });
    expect(service.resolve('c:/untrusted-repo', 'other')).toEqual({ workspaceScope: 'full', sessionScope: 'full' });
    expect(service.list('c:/untrusted-repo').every((grant) => grant.grantedById === 'owner-1')).toBe(true);
  });
});
