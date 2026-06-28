/**
 * turn-serializer — a process-wide async mutex for engine turns.
 *
 * WHY: the runtime registers ONE shared VaiEngine (server.ts) whose chat()/chatStream() paths
 * mutate instance fields (_lastCitedAnswer, _lastSearchResponse, _lastMeta, …). Those are reset
 * per-turn, but they are NOT safe across CONCURRENT turns: if two requests (e.g. the improve-loop's
 * observe sweep and a real chat, or two browser tabs) interleave on the single instance, one turn's
 * curated/cited answer bleeds into the other's response. Reproduced live: "tell me about Norway as a
 * travel destination" returned the ORM answer that a concurrent request had just produced.
 *
 * The per-conversation guard (activeConversationTurns) only blocks the SAME conversation. This gate
 * serializes engine turns GLOBALLY so the shared mutable state can't be corrupted by interleaving —
 * which also matches the hardware reality that only one local model inference should run at a time.
 *
 * It QUEUES (does not reject): callers await their turn, run exclusively, then release. A turn that
 * throws still releases the lock (finally), so one failure can't wedge the queue forever.
 *
 * Pure (no deps), so it unit-tests deterministically.
 */
export class TurnSerializer {
  private tail: Promise<void> = Promise.resolve();
  private depth = 0;

  /** Number of turns currently queued or running (0 = idle). For observability/tests. */
  get pending(): number {
    return this.depth;
  }

  /**
   * Run `fn` exclusively: it does not start until all previously-enqueued turns have finished, and
   * the next queued turn does not start until `fn` settles. Returns fn's result; rethrows its error
   * (after releasing the lock).
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.depth += 1;
    // Chain onto the current tail. `release` resolves the gate the NEXT caller awaits.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const prev = this.tail;
    this.tail = prev.then(() => gate);

    try {
      await prev;            // wait for everyone ahead of us to finish
      return await fn();     // our exclusive turn
    } finally {
      this.depth -= 1;
      release();             // let the next queued turn proceed
    }
  }

  /**
   * Serialize an async-iterable (the streaming chat path). Acquires the lock before the first item
   * and holds it until the generator is fully drained (or the consumer stops early / throws), so a
   * streamed turn never interleaves with another turn's mutations.
   */
  async *runIterable<T>(make: () => AsyncIterable<T>): AsyncIterable<T> {
    this.depth += 1;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const prev = this.tail;
    this.tail = prev.then(() => gate);

    try {
      await prev;
      for await (const item of make()) {
        yield item;
      }
    } finally {
      this.depth -= 1;
      release();
    }
  }
}
