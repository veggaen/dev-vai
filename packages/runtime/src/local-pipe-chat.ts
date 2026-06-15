/**
 * Low-overhead local chat transport for trusted same-machine collaborators.
 *
 * Both the Windows named pipe and TCP loopback listener use a four-byte,
 * big-endian length prefix followed by a UTF-8 JSON payload. The transport
 * exercises the same ChatService path as desktop chat.
 */

import * as net from 'node:net';
import type { ChatChunk, ChatService } from '@vai/core';
import type { LocalSteeringWorker } from './steering/local-steering-worker.js';

const DIRECT_HOST = '127.0.0.1';
const DIRECT_PORT = 48765;
const DEFAULT_DIRECT_TURN_TIMEOUT_MS = 60_000;
const MIN_DIRECT_TURN_TIMEOUT_MS = 5_000;
const MAX_DIRECT_TURN_TIMEOUT_MS = 300_000;

export const PIPE_PATH = '\\\\.\\pipe\\vai-grok-direct';

export interface DirectChatOptions {
  chatService: ChatService;
  localSteeringWorker?: Pick<LocalSteeringWorker, 'enqueue'>;
}

function sendFramed(socket: net.Socket, obj: unknown) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  socket.write(header);
  socket.write(payload);
}

export function resolveDirectTurnTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number.parseInt(env.VAI_DIRECT_TURN_TIMEOUT_MS ?? '', 10);
  if (!Number.isFinite(configured)) return DEFAULT_DIRECT_TURN_TIMEOUT_MS;
  return Math.min(MAX_DIRECT_TURN_TIMEOUT_MS, Math.max(MIN_DIRECT_TURN_TIMEOUT_MS, configured));
}

interface StreamDirectChatTurnOptions {
  readonly createChunks: (signal: AbortSignal) => AsyncIterable<ChatChunk>;
  readonly send: (frame: Record<string, unknown>) => void;
  readonly timeoutMs: number;
}

export async function streamDirectChatTurn({
  createChunks,
  send,
  timeoutMs,
}: StreamDirectChatTurnOptions): Promise<{ timedOut: boolean; terminalType: 'done' | 'error' }> {
  const controller = new AbortController();
  let terminalSent = false;
  let timedOut = false;
  let terminalType: 'done' | 'error' = 'done';

  const timeout = setTimeout(() => {
    if (terminalSent) return;
    timedOut = true;
    terminalSent = true;
    terminalType = 'error';
    const timeoutSeconds = Math.ceil(timeoutMs / 1_000);
    controller.abort(new Error(`Direct chat turn exceeded ${timeoutSeconds}s`));
    send({
      type: 'error',
      code: 'turn_timeout',
      retryable: true,
      error: `Vai did not finish within ${timeoutSeconds} seconds. The turn was cancelled so the channel stays responsive.`,
    });
  }, timeoutMs);

  try {
    for await (const chunk of createChunks(controller.signal)) {
      if (terminalSent) break;
      const current = chunk as ChatChunk & {
        reasoningDelta?: string;
        thinking?: Record<string, unknown>;
      };

      if (current.type === 'text_delta' && current.textDelta) {
        send({ type: 'delta', textDelta: current.textDelta });
      } else if (current.type === 'reasoning_delta' && current.reasoningDelta) {
        send({ type: 'delta', textDelta: current.reasoningDelta });
      } else if (current.type === 'done') {
        if (current.thinking) {
          send({ ...current.thinking, type: 'thinking' });
        }
        terminalSent = true;
        send({
          type: 'done',
          usage: current.usage,
          durationMs: current.durationMs,
          thinking: current.thinking,
        });
      } else if (current.thinking) {
        send({ ...current.thinking, type: 'thinking' });
      } else if (current.type === 'sources') {
        send({ ...current, type: 'sources' });
      } else if (current.type === 'turn_kind') {
        send({ type: 'turn_kind', turnKind: current.turnKind });
      }
    }
  } catch (error) {
    if (!terminalSent) {
      terminalSent = true;
      terminalType = 'error';
      send({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    clearTimeout(timeout);
    if (!terminalSent) {
      terminalSent = true;
      send({
        type: 'done',
        note: 'Chat stream ended without a terminal chunk.',
        partial: true,
      });
    }
  }

  return { timedOut, terminalType };
}

function createFramedMessageHandler(
  chatService: ChatService,
  socket: net.Socket,
  localSteeringWorker?: Pick<LocalSteeringWorker, 'enqueue'>,
) {
  let buffer = Buffer.alloc(0);

  return async (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) break;

      const payload = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);

      let message: any;
      try {
        message = JSON.parse(payload.toString('utf8'));
      } catch {
        sendFramed(socket, { type: 'error', error: 'bad json' });
        continue;
      }

      if (message.type !== 'message' || typeof message.content !== 'string') {
        sendFramed(socket, {
          type: 'error',
          error: 'need {type:"message", conversationId?, content}',
        });
        continue;
      }

      const conversationId = message.conversationId || `direct-${Date.now()}`;
      const content = message.content;
      localSteeringWorker?.enqueue({
        conversationId,
        content,
        mode: 'chat',
        source: 'direct-local',
      });

      await streamDirectChatTurn({
        createChunks: (signal) => chatService.sendMessage(
          conversationId,
          content,
          undefined,
          undefined,
          true,
          undefined,
          { signal },
        ),
        send: (frame) => sendFramed(socket, frame),
        timeoutMs: resolveDirectTurnTimeoutMs(),
      });
    }
  };
}

export function startLocalDirectChatListener({
  chatService,
  localSteeringWorker,
}: DirectChatOptions) {
  const serverTcp = net.createServer((socket) => {
    const onData = createFramedMessageHandler(chatService, socket, localSteeringWorker);
    socket.on('data', onData as any);
    socket.on('error', () => {});
    socket.on('end', () => {});
  });

  serverTcp.on('error', (error) => console.error('[VAI direct-tcp] listener error', error));
  serverTcp.listen(DIRECT_PORT, DIRECT_HOST, () => {
    console.log(`[VAI] Direct local fast channel (TCP) ready for this Grok window: ${DIRECT_HOST}:${DIRECT_PORT}`);
  });

  const serverPipe = net.createServer((socket) => {
    const onData = createFramedMessageHandler(chatService, socket, localSteeringWorker);
    socket.on('data', onData as any);
    socket.on('error', () => {});
    socket.on('end', () => {});
  });

  serverPipe.on('error', (error) => console.error('[VAI direct-pipe] listener error', error));
  serverPipe.listen(PIPE_PATH, () => {
    console.log(`[VAI] Direct local pipe channel ready (PRIMARY, low-overhead named pipe): ${PIPE_PATH}`);
    console.log('[VAI] Preferred for Grok <-> Vai real conversations and self-improvement. Full ChatService intelligence, explicit framing, platform-efficient on Win10.');
  });

  return serverTcp;
}

export function startLocalNamedPipeChatListener({
  chatService,
  localSteeringWorker,
}: DirectChatOptions) {
  const server = net.createServer((socket) => {
    const onData = createFramedMessageHandler(chatService, socket, localSteeringWorker);
    socket.on('data', onData as any);
    socket.on('error', () => {});
    socket.on('end', () => {});
  });
  server.on('error', (error) => console.error('[VAI pipe-only] listener error', error));
  server.listen(PIPE_PATH, () => {
    console.log(`[VAI] Named pipe direct channel (standalone): ${PIPE_PATH}`);
  });
  return server;
}

export const VAI_DIRECT_HOST = DIRECT_HOST;
export const VAI_DIRECT_PORT = DIRECT_PORT;
export const VAI_PIPE_PATH = PIPE_PATH;
