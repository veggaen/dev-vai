import { describe, expect, it, vi, afterEach } from 'vitest';
import { OpenAIAdapter } from '../src/models/provider-adapters.js';
import { getModelProfile } from '../src/config/model-profiles.js';

function makeStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('OpenAIAdapter streaming', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams text deltas from OpenAI SSE responses', async () => {
    const profile = getModelProfile('openai:gpt-5.4-mini');
    expect(profile).toBeDefined();

    const adapter = new OpenAIAdapter(profile!, {
      id: 'openai',
      enabled: true,
      apiKey: 'test-key',
    });

    vi.stubGlobal('fetch', vi.fn(async () => makeStreamResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ])));

    const chunks: Array<{ type: string; textDelta?: string }> = [];
    for await (const chunk of adapter.chatStream({
      messages: [{ role: 'user', content: 'Say hello' }],
    })) {
      chunks.push(chunk);
    }

    const text = chunks
      .filter((chunk) => chunk.type === 'text_delta')
      .map((chunk) => chunk.textDelta ?? '')
      .join('');

    expect(text).toBe('Hello world');
    expect(chunks.at(-1)?.type).toBe('done');
  });
});
