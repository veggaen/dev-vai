/**
 * Local Direct Chat channel for fast same-machine communication between this Grok
 * session (the .grok TUI window / grok.exe) and the Vai runtime.
 *
 * Upgraded with methodology from Andrew Kelley (andrewrk @ https://codeberg.org/andrewrk):
 * - p2pchat: direct minimal peer-to-peer chat experiment (UDP/STUN for NAT chat collab) — we apply "direct local chat primitive" using named pipe for Grok<->Vai friendship/collaboration.
 * - Zig's New Async I/O (std.Io, async/concurrent, cancellation): explicit costs (length-prefixed framing vs naive newlines; no hidden scanning/partial bugs), setup long-lived listener once (Io-like), resource safety via proper ends, cancellation patterns for sockets.
 * - git-collab: collab features using git's own internal data — we use .vai-agent-dialogue.log + mailbox files as shared explicit storage for dialogue state.
 * - Named pipes on Windows + node evented net (IOCP) for minimal-overhead local duplex IPC. Simple, robust, optimal.
 *
 * - Primary: \\.\pipe\vai-grok-direct with length-prefixed (4B BE + JSON) framing.
 * - Also TCP 127.0.0.1:48765 for compat.
 * - Raw net (no Fastify, platform-auth, full HTTP/WS overhead).
 * - 100% real intelligence via chatService.sendMessage (voice norm, compound split/combine, turn-class 'vai-chat-quality-direction', context, risk, epistemic honesty, verification, adaptive, all).
 * - Local-only trusted channel for this .grok session.
 *
 * Started in index.ts after main HTTP. Clients use vai-pipe-client / direct-client / agent-speak / vai-collab.
 */

import * as net from 'node:net';
import type { ChatService } from '@vai/core';
import type { LocalSteeringWorker } from './steering/local-steering-worker.js';

const DIRECT_HOST = '127.0.0.1';
const DIRECT_PORT = 48765;
export const PIPE_PATH = '\\\\.\\pipe\\vai-grok-direct';

export interface DirectChatOptions {
  chatService: ChatService;
  localSteeringWorker?: Pick<LocalSteeringWorker, 'enqueue'>;
}

function sendFramed(socket: net.Socket, obj: any) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  socket.write(header);
  socket.write(payload);
}

function createFramedMessageHandler(
  chatService: ChatService,
  socket: net.Socket,
  localSteeringWorker?: Pick<LocalSteeringWorker, 'enqueue'>,
) {
  let buf = Buffer.alloc(0);

  return async (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);

    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (buf.length < 4 + len) {
        break; // need more data
      }
      const payloadBuf = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);

      let msg: any;
      try {
        msg = JSON.parse(payloadBuf.toString('utf8'));
      } catch {
        sendFramed(socket, { type: 'error', error: 'bad json' });
        continue;
      }

      if (msg.type !== 'message' || typeof msg.content !== 'string') {
        sendFramed(socket, { type: 'error', error: 'need {type:"message", conversationId?, content}' });
        continue;
      }

      const convId = msg.conversationId || `direct-${Date.now()}`;
      const content = msg.content;
      localSteeringWorker?.enqueue({
        conversationId: convId,
        content,
        mode: 'chat',
        source: 'direct-local',
      });

      let sawDone = false;
      try {
        // Full real path — same as user chat in the desktop. Exercises 100% of intelligence layers (normalization, turn-class, compounds, context, risk, verify, vai-chat-quality-direction etc).
        for await (const ch of chatService.sendMessage(convId, content, undefined, undefined, true)) {
          const c: any = ch;
          if (c.type === 'text_delta' && c.textDelta) {
            sendFramed(socket, { type: 'delta', textDelta: c.textDelta });
          } else if (c.type === 'reasoning_delta' && c.reasoningDelta) {
            sendFramed(socket, { type: 'delta', textDelta: c.reasoningDelta });
          } else if (c.type === 'done') {
            sawDone = true;
            sendFramed(socket, { type: 'done', usage: c.usage, durationMs: c.durationMs, thinking: c.thinking });
            // Also emit thinking event for clients that expect separate 'thinking' (compat with old direct/WS listeners)
            if (c.thinking) {
              const thinkingPayload = { ...(c.thinking || {}), type: 'thinking' as const };
              sendFramed(socket, thinkingPayload);
            }
          } else if (c.thinking || c.type === 'thinking') {
            const t = c.thinking || c;
            const thinkingPayload = { ...(t || {}), type: 'thinking' as const };
            sendFramed(socket, thinkingPayload);
          } else if (c.type === 'sources') {
            sendFramed(socket, { type: 'sources', ...c });
          } else if (c.type === 'turn_kind') {
            sendFramed(socket, { type: 'turn_kind', turnKind: c.turnKind });
          }
        }
      } catch (e: any) {
        sendFramed(socket, { type: 'error', error: e?.message || String(e) });
      } finally {
        // Genius loop robustness for self-improvement / council turns (which may stream long or have complex council progress):
        // Always emit a terminal 'done' frame so clients (bridge, agent-speak, direct) don't timeout waiting.
        // This fixes the [timeout] we see on meta/self-review prompts that trigger council.
        if (!sawDone) {
          sendFramed(socket, { type: 'done', note: 'guaranteed terminal for self-improvement council turn (genius loop)', partial: true });
        }
      }
    }
  };
}

export function startLocalDirectChatListener({ chatService, localSteeringWorker }: DirectChatOptions) {
  // TCP loopback (for compat / other local clients)
  const serverTcp = net.createServer((socket) => {
    const onData = createFramedMessageHandler(chatService, socket, localSteeringWorker);
    socket.on('data', onData as any);
    socket.on('error', () => {});
    socket.on('end', () => {});
  });

  serverTcp.on('error', (e) => console.error('[VAI direct-tcp] listener error', e));

  serverTcp.listen(DIRECT_PORT, DIRECT_HOST, () => {
    console.log(`[VAI] Direct local fast channel (TCP) ready for this Grok window: ${DIRECT_HOST}:${DIRECT_PORT}`);
  });

  // PRIMARY efficient channel: Windows Named Pipe (kernel direct IPC, IOCP evented under node net).
  // Andrew Kelley inspired: explicit length-prefixed framing (simple primitive, no hidden \n costs like in p2p experiments), long-lived listener (like Io setup once), direct local for chat/collaboration loop.
  const serverPipe = net.createServer((socket) => {
    const onData = createFramedMessageHandler(chatService, socket, localSteeringWorker);
    socket.on('data', onData as any);
    socket.on('error', () => {});
    socket.on('end', () => {});
  });

  serverPipe.on('error', (e) => console.error('[VAI direct-pipe] listener error', e));

  serverPipe.listen(PIPE_PATH, () => {
    console.log(`[VAI] Direct local pipe channel ready (PRIMARY, low-overhead named pipe): ${PIPE_PATH}`);
    console.log(`[VAI] Preferred for Grok <-> Vai real conversations and self-improvement. Full ChatService intelligence, explicit framing, platform-efficient on Win10.`);
  });

  // Return the tcp one for existing refs; both servers live for lifetime of process.
  return serverTcp;
}

export function startLocalNamedPipeChatListener({ chatService, localSteeringWorker }: DirectChatOptions) {
  // If only-pipe startup desired.
  const server = net.createServer((socket) => {
    const onData = createFramedMessageHandler(chatService, socket, localSteeringWorker);
    socket.on('data', onData as any);
    socket.on('error', () => {});
    socket.on('end', () => {});
  });
  server.on('error', (e) => console.error('[VAI pipe-only] listener error', e));
  server.listen(PIPE_PATH, () => {
    console.log(`[VAI] Named pipe direct channel (standalone): ${PIPE_PATH}`);
  });
  return server;
}

export const VAI_DIRECT_HOST = DIRECT_HOST;
export const VAI_DIRECT_PORT = DIRECT_PORT;
export const VAI_PIPE_PATH = PIPE_PATH;
