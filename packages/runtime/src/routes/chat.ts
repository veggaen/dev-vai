import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_CONVERSATION_MODE,
  getExplicitGrokFriendPrompt,
  getRequestedLiveContextFields,
  isWorkspaceDeltaQuestion,
  tryEmitAttachedLiveContextResponse,
  tryEmitPrivateLiveContextResponse,
  type ChatService,
  type ChatPromptRewriteOverrides,
} from '@vai/core';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import type { CompanionContextBroker } from '../companion-context/broker.js';
import type { GrokFriendClient, GrokFriendResult } from '../grok-friend/client.js';
import type { WorkspaceStatusEvidence, WorkspaceStatusReader } from '../workspace-status/reader.js';
import type { ProjectService } from '../projects/service.js';
import type { LocalSteeringInput, SteeringPacket } from '../steering/local-steering-worker.js';
import { authorizeConversationAccess } from '../access/conversations.js';
import { chatWebSocketInboundSchema } from '@vai/api-types/chat-ws';
import type { AdvisorTrace, ChatProgressStep } from '@vai/api-types/chat-ws';

export interface RegisterChatRoutesOptions {
  /** Email that may use owner-only features (e.g. allowLearn). Set via VAI_OWNER_EMAIL. */
  ownerEmail: string;
  contextBroker?: CompanionContextBroker;
  contextRequestTimeoutMs?: number;
  grokFriendClient?: Pick<GrokFriendClient, 'ask'>;
  workspaceStatusReader?: Pick<WorkspaceStatusReader, 'read'>;
  localSteeringWorker?: {
    readonly modelId: string;
    readonly visibleWaitMs: number;
    isEnabled(): boolean;
    run(input: LocalSteeringInput): Promise<SteeringPacket | null>;
  };
}

const SOCKET_OPEN = 1;
const MAX_SOCKET_BUFFERED_BYTES = 1_000_000;

function formatGrokFriendResult(result: GrokFriendResult): string {
  return [
    '**Grok friend-channel result.**',
    result.response,
    `**Evidence:** \`${result.source}\`, captured \`${result.capturedAt}\`, request \`${result.requestId}\`, ${result.durationMs}ms.`,
  ].join('\n\n');
}

function formatGrokFriendUnavailable(error: unknown): string {
  const reason = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'No attributed result returned';
  return [
    '**Grok friend-channel unavailable.**',
    `I attempted the explicit Grok friend-channel call, but no attributed result completed: \`${reason}\`.`,
  ].join('\n\n');
}

function formatWorkspaceStatusResult(result: WorkspaceStatusEvidence): string {
  const visibleEntries = result.entries.slice(0, 80);
  const omittedCount = result.entries.length - visibleEntries.length;
  const lines = visibleEntries.length > 0
    ? visibleEntries.map((entry) => `- \`${entry.replace(/`/g, '\\`')}\``)
    : ['`git status --short` returned no changed files.'];
  if (omittedCount > 0) {
    lines.push(`- ... ${omittedCount} more changed files omitted from this chat bubble.`);
  }

  return [
    '**Live workspace delta.**',
    lines.join('\n'),
    `**Evidence:** \`${result.source}\`, root \`${result.workspaceRoot.replace(/`/g, '\\`')}\`, captured \`${result.capturedAt}\`, ${result.durationMs}ms.`,
  ].join('\n\n');
}

function formatWorkspaceStatusUnavailable(error: unknown): string {
  const reason = error instanceof Error ? error.message : 'No git-status result returned';
  return [
    '**Live workspace delta unavailable.**',
    `I attempted a read-only \`git status --short\`, but no timestamped result completed: \`${reason}\`.`,
  ].join('\n\n');
}

async function sendJson(socket: { readyState: number; bufferedAmount: number; send: (data: string) => void }, payload: unknown): Promise<boolean> {
  if (socket.readyState !== SOCKET_OPEN) {
    return false;
  }

  while (socket.bufferedAmount > MAX_SOCKET_BUFFERED_BYTES) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (socket.readyState !== SOCKET_OPEN) {
      return false;
    }
  }

  socket.send(JSON.stringify(payload));
  return true;
}

function summarizeSteeringPacket(packet: SteeringPacket | null): string {
  if (!packet) return 'No valid steering packet was produced; Vai ignored it.';
  const bits: string[] = [packet.taskShape];
  if (packet.riskFlags.length > 0) bits.push(`risks: ${packet.riskFlags.join(', ')}`);
  if (packet.qualityContract.mustBeGuiding) bits.push('guiding answer needed');
  if (packet.qualityContract.mustBeCurrent) bits.push('fresh evidence needed');
  if (packet.qualityContract.mustUseJson) bits.push('JSON contract');
  bits.push(`confidence ${Math.round(packet.confidence * 100)}%`);
  return bits.join(' | ');
}

function advisorTraceFromPacket(
  packet: SteeringPacket | null,
  modelId: string,
  durationMs: number,
): AdvisorTrace {
  if (!packet) {
    return {
      schemaVersion: 1,
      actorId: `local:${modelId}`,
      modelId,
      state: 'invalid',
      routeGuidance: [],
      riskFlags: [],
      retrievalHints: [],
      durationMs,
    };
  }

  return {
    schemaVersion: 1,
    actorId: packet.actorId,
    modelId,
    state: 'ready',
    taskShape: packet.taskShape,
    qualityContract: packet.qualityContract,
    routeGuidance: packet.routeGuidance,
    riskFlags: packet.riskFlags,
    retrievalHints: packet.retrievalHints,
    confidence: packet.confidence,
    durationMs,
  };
}

function advisorProgressFromPacket(
  packet: SteeringPacket | null,
  modelId: string,
  durationMs: number,
): ChatProgressStep {
  return {
    stage: 'local-steering',
    label: packet ? 'Local model friend returned advice' : 'Local model friend returned invalid advice',
    detail: summarizeSteeringPacket(packet),
    status: 'done',
    advisor: advisorTraceFromPacket(packet, modelId, durationMs),
  };
}

function advisorUnavailableProgress(modelId: string, error: unknown, durationMs: number): ChatProgressStep {
  const reason = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  return {
    stage: 'local-steering',
    label: 'Local model friend unavailable',
    detail: reason,
    status: 'done',
    advisor: {
      schemaVersion: 1,
      actorId: `local:${modelId}`,
      modelId,
      state: 'unavailable',
      routeGuidance: [],
      riskFlags: [],
      retrievalHints: [],
      durationMs,
      error: reason,
    },
  };
}

function advisorBackgroundProgress(modelId: string): ChatProgressStep {
  return {
    stage: 'local-steering',
    label: 'Local model friend continued in the background',
    detail: 'The answer was ready first. Advice will still be recorded for evaluation, but it did not delay or alter this turn.',
    status: 'done',
    advisor: {
      schemaVersion: 1,
      actorId: `local:${modelId}`,
      modelId,
      state: 'background',
      routeGuidance: [],
      riskFlags: [],
      retrievalHints: [],
    },
  };
}

async function waitForAdvisor<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  if (timeoutMs <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function registerChatRoutes(
  app: FastifyInstance,
  chatService: ChatService,
  auth: PlatformAuthService,
  projects: ProjectService,
  options: RegisterChatRoutesOptions,
) {
  const ownerNorm = options.ownerEmail.trim().toLowerCase();
  const activeConversationTurns = new Set<string>();

  function isOwnerEmail(email: string | null | undefined): boolean {
    return email?.trim().toLowerCase() === ownerNorm;
  }

  app.register(async (fastify) => {
    fastify.get('/api/chat', { websocket: true }, (socket, request) => {
      socket.on('message', async (raw: Buffer) => {
        try {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            await sendJson(socket, { type: 'error', error: 'Invalid JSON', code: 'validation' });
            return;
          }

          const validated = chatWebSocketInboundSchema.safeParse(parsed);
          if (!validated.success) {
            const issues = validated.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
            await sendJson(
              socket,
              {
                type: 'error',
                error: 'Invalid message format',
                code: 'validation',
                detail: issues,
              },
            );
            console.error('[chat-ws] inbound validation failed', { issues, receivedKeys: Object.keys(parsed || {}) });
            return;
          }

          const data = validated.data;
          const grokFriendPrompt = !data.image ? getExplicitGrokFriendPrompt(data.content) : null;
          if (grokFriendPrompt) {
            const startedAt = Date.now();
            let response: string;
            if (!options.grokFriendClient) {
              response = formatGrokFriendUnavailable('The Grok friend-channel client is not configured');
            } else {
              try {
                response = formatGrokFriendResult(await options.grokFriendClient.ask(grokFriendPrompt));
              } catch (error) {
                response = formatGrokFriendUnavailable(error);
              }
            }

            await sendJson(socket, { type: 'turn_kind', turnKind: 'analysis' } as any);
            await sendJson(socket, { type: 'text_delta', textDelta: response } as any);
            await sendJson(socket, {
              type: 'done',
              usage: { promptTokens: 0, completionTokens: 0 },
              durationMs: Date.now() - startedAt,
              thinking: {
                strategy: 'grok-friend-channel',
                modelTag: 'grok-cli',
                confidence: response.startsWith('**Grok friend-channel result.**') ? 0.9 : 0.2,
              },
            } as any);
            return;
          }

          if (!data.image && isWorkspaceDeltaQuestion(data.content) && options.workspaceStatusReader) {
            const startedAt = Date.now();
            let response: string;
            try {
              response = formatWorkspaceStatusResult(await options.workspaceStatusReader.read());
            } catch (error) {
              response = formatWorkspaceStatusUnavailable(error);
            }

            await sendJson(socket, { type: 'turn_kind', turnKind: 'analysis' } as any);
            await sendJson(socket, { type: 'text_delta', textDelta: response } as any);
            await sendJson(socket, {
              type: 'done',
              usage: { promptTokens: 0, completionTokens: 0 },
              durationMs: Date.now() - startedAt,
              thinking: {
                strategy: 'workspace-status-readonly',
                modelTag: 'git-status',
                confidence: response.startsWith('**Live workspace delta.**') ? 0.99 : 0.2,
              },
            } as any);
            return;
          }

          let routeLiveContextResponse = tryEmitAttachedLiveContextResponse(data.content, data.editorContext);
          let viewer: Awaited<ReturnType<PlatformAuthService['getViewer']>> | null = null;

          if (!data.image && !routeLiveContextResponse && options.contextBroker) {
            const requestedFields = getRequestedLiveContextFields(data.content);
            if (requestedFields.length > 0) {
              viewer = await auth.getViewer(request);
              const brokerEvidence = await options.contextBroker.request({
                requestedFields,
                targetUserId: auth.isEnabled() && viewer.authenticated
                  ? viewer.user?.id ?? null
                  : null,
                timeoutMs: options.contextRequestTimeoutMs,
              });
              routeLiveContextResponse = tryEmitAttachedLiveContextResponse(data.content, brokerEvidence);
            }
          }

          routeLiveContextResponse ??= tryEmitPrivateLiveContextResponse(data.content);
          if (!data.image && routeLiveContextResponse) {
            const startedAt = Date.now();
            await sendJson(socket, { type: 'turn_kind', turnKind: 'analysis' } as any);
            await sendJson(socket, { type: 'text_delta', textDelta: routeLiveContextResponse } as any);
            await sendJson(socket, {
              type: 'done',
              usage: { promptTokens: 0, completionTokens: 0 },
              durationMs: Date.now() - startedAt,
              thinking: {
                strategy: 'bridge-evidence-discipline',
                modelTag: 'route-live-context',
                confidence: 0.99,
              },
            } as any);
            return;
          }

          const promptRewriteOverrides: ChatPromptRewriteOverrides | undefined =
            data.profile || data.responseDepth !== undefined || data.enabled !== undefined
              ? {
                  profile: data.profile,
                  responseDepth: data.responseDepth,
                  enabled: data.enabled,
                }
              : undefined;

          const image = data.image;

          viewer ??= await auth.getViewer(request);

          let noLearn = true;
          if (!auth.isEnabled()) {
            noLearn = data.allowLearn !== true;
          } else {
            const ownerMayTeach = Boolean(viewer.authenticated && isOwnerEmail(viewer.user?.email) && data.allowLearn === true);
            noLearn = !ownerMayTeach;
          }

          let conversationId = data.conversationId;
          let conversation = chatService.getConversation(conversationId);
          if (!conversation) {
            if (auth.isEnabled() && !viewer.authenticated) {
              await sendJson(socket, { type: 'error', error: 'Sign in to create a conversation', code: 'unauthorized' });
              return;
            }

            const fallbackModel = data.modelId ?? 'vai:v0';
            const fallbackMode = data.mode ?? DEFAULT_CONVERSATION_MODE;
            conversationId = chatService.createConversation(
              fallbackModel,
              undefined,
              fallbackMode,
              viewer.user?.id ?? null,
            );
            conversation = chatService.getConversation(conversationId);
            fastify.log.warn(
              { requested: data.conversationId, resolved: conversationId },
              'chat: route-created conversation for missing id',
            );
            await sendJson(socket, { type: 'conversation_resolved', conversationId });
          }

          // Claim legacy (pre-auth, no ownerUserId) conversations for the current signed-in user.
          // This fixes "Sign in to update this conversation" after browser sign-in on old dev convos.
          if (auth.isEnabled() && viewer.authenticated && viewer.user?.id && conversation && !conversation.ownerUserId) {
            chatService.assignOwnerIfLegacy(conversationId, viewer.user.id);
            conversation = chatService.getConversation(conversationId)!;
          }

          const access = authorizeConversationAccess({
            conversation,
            viewer,
            projects,
            access: 'write',
            authEnabled: auth.isEnabled(),
          });
          if (!access.allowed) {
            await sendJson(socket, {
              type: 'error',
              error: access.error ?? 'Not your conversation',
              code: access.statusCode === 401 ? 'unauthorized' : 'forbidden',
            });
            return;
          }

          if (activeConversationTurns.has(conversationId)) {
            await sendJson(socket, {
              type: 'error',
              error: 'A response is already in progress for this conversation',
              code: 'conflict',
            });
            return;
          }

          const localSteeringWorker = options.localSteeringWorker;
          let steeringOutcomePromise: Promise<ChatProgressStep> | null = null;
          let steeringPublishPromise: Promise<void> | null = null;
          let steeringPublished = false;
          let turnFinalized = false;

          const publishSteering = (progress: ChatProgressStep): Promise<void> => {
            if (turnFinalized || steeringPublished) {
              return steeringPublishPromise ?? Promise.resolve();
            }
            steeringPublished = true;
            steeringPublishPromise = sendJson(socket, { type: 'progress', progress }).then(() => undefined);
            return steeringPublishPromise;
          };

          if (localSteeringWorker?.isEnabled()) {
            await sendJson(socket, {
              type: 'progress',
              progress: {
                stage: 'local-steering',
                label: 'Asking local model friend',
                detail: `${localSteeringWorker.modelId} is producing shadow steering in the background. Vai will not let it answer directly.`,
                status: 'running',
                advisor: {
                  schemaVersion: 1,
                  actorId: `local:${localSteeringWorker.modelId}`,
                  modelId: localSteeringWorker.modelId,
                  state: 'running',
                  routeGuidance: [],
                  riskFlags: [],
                  retrievalHints: [],
                },
              },
            });
            const steeringStartedAt = Date.now();
            steeringOutcomePromise = localSteeringWorker.run({
              conversationId,
              content: data.content,
              mode: conversation?.mode ?? data.mode ?? DEFAULT_CONVERSATION_MODE,
              source: 'websocket',
            }).then((packet) => advisorProgressFromPacket(
              packet,
              localSteeringWorker.modelId,
              Date.now() - steeringStartedAt,
            )).catch((error) => advisorUnavailableProgress(
              localSteeringWorker.modelId,
              error,
              Date.now() - steeringStartedAt,
            ));
            void steeringOutcomePromise.then((progress) => publishSteering(progress));
          }

          activeConversationTurns.add(conversationId);
          try {
            for await (const chunk of chatService.sendMessage(
              conversationId,
              data.content,
              image,
              data.systemPrompt,
              noLearn,
              promptRewriteOverrides,
            )) {
              if (chunk.type === 'conversation_resolved' && chunk.conversationId) {
                fastify.log.warn(
                  { requested: data.conversationId, resolved: chunk.conversationId },
                  'chat: auto-created conversation for missing id',
                );
              }
              if (chunk.type === 'done' && steeringOutcomePromise && localSteeringWorker) {
                if (!steeringPublished) {
                  const outcome = await waitForAdvisor(
                    steeringOutcomePromise,
                    localSteeringWorker.visibleWaitMs,
                  );
                  await publishSteering(
                    outcome ?? advisorBackgroundProgress(localSteeringWorker.modelId),
                  );
                }
                if (steeringPublishPromise) {
                  await steeringPublishPromise;
                }
                turnFinalized = true;
              }
              const sent = await sendJson(socket, chunk);
              if (!sent) break;
            }
          } finally {
            activeConversationTurns.delete(conversationId);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          await sendJson(socket, { type: 'error', error: message, code: 'unknown' });
        }
      });
    });
  });
}
