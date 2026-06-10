/**
 * Build the friend-review panel from environment configuration.
 *
 * Mirrors `localSteeringOptionsFromEnv` in style: read a handful of env vars,
 * construct a panel of reviewers (local Qwen-style models via Ollama, plus the
 * optional Grok friend channel), and adapt the whole panel onto the chat
 * service's `ResponseReviewer` seam.
 *
 * Default-OFF. With `VAI_FRIEND_REVIEW_ENABLED` unset, this returns an empty
 * array and the runtime behaves exactly as before.
 *
 * Env:
 *   VAI_FRIEND_REVIEW_ENABLED     1|true|yes  (default off)
 *   VAI_FRIEND_REVIEW_MODELS      comma list  (default "qwen2.5:7b")
 *   VAI_FRIEND_REVIEW_URL         Ollama base (default http://localhost:11434)
 *   VAI_FRIEND_REVIEW_GROK        1|true|yes  include the Grok friend channel
 *   VAI_FRIEND_REVIEW_TIMEOUT_MS  per-reviewer timeout (default 12000)
 *   VAI_FRIEND_REVIEW_OUT_FILE    optional JSONL sink for the consolidated notices
 */
import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  LocalOpenAICompatibleAdapter,
  createGrokFriendReviewer,
  createModelReviewer,
  friendPanelToResponseReviewer,
} from '@vai/core';
import type { FriendChannelAsk, FriendReviewNotice, FriendReviewer, ResponseReviewer } from '@vai/core';

const ENABLED_VALUES = ['1', 'true', 'yes'];

export interface FriendReviewEnvOptions {
  /** Optional Grok friend-channel call, included only when VAI_FRIEND_REVIEW_GROK is on. */
  readonly grokAsk?: FriendChannelAsk;
}

function isEnabled(value: string | undefined): boolean {
  return ENABLED_VALUES.includes((value ?? '').toLowerCase());
}

function timeoutFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 12_000;
  return Math.min(120_000, Math.max(1_000, Math.round(parsed)));
}

function defaultOutFile(): string {
  const cwd = process.cwd();
  const root = cwd.replace(/\\/g, '/').endsWith('/packages/runtime') ? resolve(cwd, '../..') : cwd;
  return resolve(root, 'Temporary_files', 'friend-review', 'notices.jsonl');
}

function buildLocalReviewer(modelName: string, baseUrl: string, timeoutMs: number): FriendReviewer {
  const adapter = new LocalOpenAICompatibleAdapter(
    {
      id: `local:${modelName}`,
      provider: 'local',
      modelName,
      displayName: modelName,
      description: 'Ollama local model (friend reviewer)',
      contextWindow: 32768,
      maxOutputTokens: 8192,
      capabilities: {
        streaming: false, toolUse: false, vision: false, extendedThinking: false,
        embeddings: false, structuredOutput: false, systemPrompts: true, multiTurn: true,
      },
      cost: { inputPer1M: 0, outputPer1M: 0 },
      speedTier: 'medium',
      qualityTier: 'local',
    },
    { id: 'local', enabled: true, baseUrl, defaultModel: modelName },
  );
  return createModelReviewer({ adapter, timeoutMs });
}

/**
 * Construct the friend-review reviewers from env. Returns `[]` when disabled or
 * when no reviewer could be configured — safe to spread straight into
 * `ChatService`'s `responseReviewers`.
 */
export function friendReviewReviewersFromEnv(
  options: FriendReviewEnvOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ResponseReviewer[] {
  if (!isEnabled(env.VAI_FRIEND_REVIEW_ENABLED)) return [];

  const baseUrl = (env.VAI_FRIEND_REVIEW_URL?.trim() || 'http://localhost:11434').replace(/\/$/, '');
  const timeoutMs = timeoutFromEnv(env.VAI_FRIEND_REVIEW_TIMEOUT_MS);
  const modelNames = (env.VAI_FRIEND_REVIEW_MODELS?.trim() || 'qwen2.5:7b')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const reviewers: FriendReviewer[] = modelNames.map((m) => buildLocalReviewer(m, baseUrl, timeoutMs));

  if (isEnabled(env.VAI_FRIEND_REVIEW_GROK) && options.grokAsk) {
    reviewers.push(createGrokFriendReviewer({ ask: options.grokAsk }));
  }

  if (reviewers.length === 0) return [];

  const outFile = env.VAI_FRIEND_REVIEW_OUT_FILE?.trim() || defaultOutFile();
  const panel = friendPanelToResponseReviewer(reviewers, {
    timeoutMs,
    onNotice: (notice) => {
      void writeNotice(outFile, notice);
    },
  });

  console.log(
    `[VAI] Friend-review panel enabled: ${reviewers.map((r) => r.id).join(', ')} (notices → ${outFile})`,
  );
  return [panel];
}

async function writeNotice(outFile: string, notice: FriendReviewNotice): Promise<void> {
  try {
    await mkdir(dirname(outFile), { recursive: true });
    const record = {
      type: 'friend-review-notice',
      createdAt: new Date().toISOString(),
      outcome: notice.outcome,
      score: notice.score,
      consensus: notice.consensus,
      reviewerIds: notice.reviewerIds,
      requiresFreshEvidence: notice.requiresFreshEvidence,
      topConcerns: notice.topConcerns,
      topSuggestions: notice.topSuggestions,
      verdicts: notice.verdicts.map((v) => ({
        reviewerId: v.reviewerId,
        verdict: v.verdict,
        confidence: v.confidence,
        summary: v.summary,
        durationMs: v.durationMs,
        error: v.error,
      })),
    };
    await appendFile(outFile, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Logging the notice must never break a turn.
  }
}
