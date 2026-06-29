import { describe, expect, it } from 'vitest';
import { TurnSerializer } from './turn-serializer.js';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('TurnSerializer', () => {
  it('runs queued turns strictly one-at-a-time (no interleave)', async () => {
    const s = new TurnSerializer();
    const events: string[] = [];
    const turn = (id: string, ms: number) => s.run(async () => {
      events.push(`${id}:start`);
      await tick(ms);
      events.push(`${id}:end`);
      return id;
    });
    // Launch three concurrently; they must execute serially in enqueue order.
    const all = await Promise.all([turn('A', 30), turn('B', 5), turn('C', 1)]);
    expect(all).toEqual(['A', 'B', 'C']);
    expect(events).toEqual(['A:start', 'A:end', 'B:start', 'B:end', 'C:start', 'C:end']);
  });

  it('the shared-state bleed scenario: a fast turn cannot overwrite a slow turn mid-flight', async () => {
    const s = new TurnSerializer();
    let shared = '';
    const turn = (val: string, ms: number) => s.run(async () => {
      shared = val;          // "write _lastCitedAnswer"
      await tick(ms);        // simulate slow generation
      return shared;         // must still read OUR value, not a concurrent turn's
    });
    const [a, b] = await Promise.all([turn('Norway', 25), turn('ORM', 1)]);
    expect(a).toBe('Norway'); // the slow turn read back its own write — no bleed
    expect(b).toBe('ORM');
  });

  it('releases the lock when a turn throws (one failure does not wedge the queue)', async () => {
    const s = new TurnSerializer();
    const order: string[] = [];
    const bad = s.run(async () => { order.push('bad'); throw new Error('boom'); });
    const good = s.run(async () => { order.push('good'); return 'ok'; });
    await expect(bad).rejects.toThrow('boom');
    await expect(good).resolves.toBe('ok');
    expect(order).toEqual(['bad', 'good']);
  });

  it('tracks pending depth and returns to 0 when idle', async () => {
    const s = new TurnSerializer();
    expect(s.pending).toBe(0);
    const p1 = s.run(() => tick(10).then(() => 1));
    const p2 = s.run(() => tick(10).then(() => 2));
    expect(s.pending).toBe(2);
    await Promise.all([p1, p2]);
    expect(s.pending).toBe(0);
  });

  it('serializes async-iterables and holds the lock until fully drained', async () => {
    const s = new TurnSerializer();
    const events: string[] = [];
    async function* gen(id: string): AsyncIterable<string> {
      events.push(`${id}:1`);
      await tick(10);
      events.push(`${id}:2`);
      yield `${id}-a`;
      await tick(10);
      yield `${id}-b`;
    }
    const drain = async (id: string) => {
      const out: string[] = [];
      for await (const x of s.runIterable(() => gen(id))) out.push(x);
      return out;
    };
    const [r1, r2] = await Promise.all([drain('X'), drain('Y')]);
    expect(r1).toEqual(['X-a', 'X-b']);
    expect(r2).toEqual(['Y-a', 'Y-b']);
    // Y must not start until X is fully drained.
    expect(events).toEqual(['X:1', 'X:2', 'Y:1', 'Y:2']);
  });
});
