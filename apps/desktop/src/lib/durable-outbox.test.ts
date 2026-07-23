import { describe, expect, it, vi } from 'vitest';
import { DurableOutbox } from './durable-outbox.js';

function memoryStorage(seed?: string) {
  const values = new Map<string, string>();
  if (seed) values.set('vai-outbox.jsonl:v1', seed);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('DurableOutbox', () => {
  it('persists local work before transport and acknowledges only after send', async () => {
    const storage = memoryStorage();
    const outbox = new DurableOutbox(storage, () => 7);
    outbox.enqueue('local', 'edit', { path: 'a.ts' }, 'one');
    const send = vi.fn(async () => undefined);
    await outbox.flush({ send });
    expect(send).toHaveBeenCalledOnce();
    expect(outbox.list()).toHaveLength(0);
  });

  it('keeps a failed item with a visible error and resumes sending items after reload', async () => {
    const storage = memoryStorage();
    const outbox = new DurableOutbox(storage);
    outbox.enqueue('remote', 'turn', { text: 'hello' }, 'one');
    await outbox.flush({ send: async () => { throw new Error('offline'); } });
    expect(outbox.list()[0]).toMatchObject({ state: 'failed', lastError: 'offline', attempts: 1 });
    const restored = new DurableOutbox(storage);
    await restored.flush({ send: async () => undefined });
    expect(restored.list()).toHaveLength(0);
  });
});
