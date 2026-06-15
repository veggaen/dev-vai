import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveDirectTurnTimeoutMs,
  streamDirectChatTurn,
} from '../src/local-pipe-chat.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveDirectTurnTimeoutMs', () => {
  it('uses a bounded default and clamps configuration', () => {
    expect(resolveDirectTurnTimeoutMs({})).toBe(60_000);
    expect(resolveDirectTurnTimeoutMs({ VAI_DIRECT_TURN_TIMEOUT_MS: '1000' })).toBe(5_000);
    expect(resolveDirectTurnTimeoutMs({ VAI_DIRECT_TURN_TIMEOUT_MS: '900000' })).toBe(300_000);
  });
});

describe('streamDirectChatTurn', () => {
  it('forwards thinking before a successful terminal frame', async () => {
    const frames: Array<Record<string, unknown>> = [];

    const result = await streamDirectChatTurn({
      createChunks: async function* () {
        yield { type: 'text_delta', textDelta: 'Hello' };
        yield {
          type: 'done',
          durationMs: 12,
          thinking: { strategy: 'deterministic', confidence: 0.9 },
        };
      },
      send: (frame) => frames.push(frame),
      timeoutMs: 100,
    });

    expect(result).toEqual({ timedOut: false, terminalType: 'done' });
    expect(frames.map((frame) => frame.type)).toEqual(['delta', 'thinking', 'done']);
  });

  it('aborts a stalled turn and emits one structured terminal error', async () => {
    vi.useFakeTimers();
    const frames: Array<Record<string, unknown>> = [];
    let observedSignal: AbortSignal | undefined;

    const turn = streamDirectChatTurn({
      createChunks: async function* (signal) {
        observedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      send: (frame) => frames.push(frame),
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    await expect(turn).resolves.toEqual({ timedOut: true, terminalType: 'error' });
    expect(observedSignal?.aborted).toBe(true);
    expect(frames).toEqual([
      expect.objectContaining({
        type: 'error',
        code: 'turn_timeout',
        retryable: true,
      }),
    ]);
  });

  it('adds a partial done frame when a stream ends without one', async () => {
    const frames: Array<Record<string, unknown>> = [];

    await streamDirectChatTurn({
      createChunks: async function* () {
        yield { type: 'text_delta', textDelta: 'Partial' };
      },
      send: (frame) => frames.push(frame),
      timeoutMs: 100,
    });

    expect(frames.at(-1)).toMatchObject({ type: 'done', partial: true });
  });
});
