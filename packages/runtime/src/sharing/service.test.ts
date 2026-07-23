import { describe, expect, it } from 'vitest';
import { JsonStore } from '../persistence/json-store.js';
import { ShareService } from './service.js';

class MemoryStore<T> extends JsonStore<T> {
  constructor(private value: T) { super('unused', value); }
  override read(): T { return structuredClone(this.value); }
  override write(value: T): void { this.value = structuredClone(value); }
}

describe('ShareService', () => {
  it('keeps a permalink slug stable when the underlying object is renamed', () => {
    const service = new ShareService(new MemoryStore([]), () => 100);
    const first = service.publish({ workspaceId: 'w1', items: [{
      objectId: 'object-1', path: 'docs/old-name.md', slug: 'durable-link', protection: 'public', included: true,
    }] }, '/s/');
    const renamed = service.publish({ workspaceId: 'w1', items: [{
      objectId: 'object-1', path: 'docs/new-name.md', slug: 'tempting-new-link', protection: 'authenticated', included: true,
    }] }, '/s/');

    expect(renamed.manifest.items[0]?.slug).toBe(first.manifest.items[0]?.slug);
    expect(renamed.manifest.items[0]?.path).toBe('docs/new-name.md');
    expect(renamed.manifest.revision).toBe(2);
  });
});
