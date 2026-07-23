import { describe, expect, it } from 'vitest';
import { JsonStore } from '../persistence/json-store.js';
import { LinkIndexService } from './service.js';

class MemoryStore<T> extends JsonStore<T> {
  constructor(private value: T) { super('unused', value); }
  override read(): T { return structuredClone(this.value); }
  override write(value: T): void { this.value = structuredClone(value); }
}

describe('LinkIndexService', () => {
  it('incrementally replaces one object edges and exposes backlinks', () => {
    const service = new LinkIndexService(new MemoryStore({ objects: [], edges: [] }), () => 50);
    const object = { id: 'file:a', kind: 'file' as const, label: 'A', path: 'a.md', updatedAt: 50 };
    service.update('w1', object, 'See [[b.md|B]] and [C](c.md).');
    expect(service.backlinks('w1', 'b.md')[0]?.source?.id).toBe('file:a');
    expect(service.graph('w1').edges).toHaveLength(2);

    service.update('w1', { ...object, updatedAt: 51 }, 'Now only [[d.md]].');
    expect(service.backlinks('w1', 'b.md')).toHaveLength(0);
    expect(service.graph('w1').edges.map((edge) => edge.targetRef)).toEqual(['d.md']);
  });
});
