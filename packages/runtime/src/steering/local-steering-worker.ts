import { createHash } from 'node:crypto';
import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { ResponseReviewInput, ResponseReviewResult } from '@vai/core';

const taskShapeSchema = z.enum([
  'short-fact',
  'explanation',
  'comparison',
  'debugging',
  'code-generation',
  'currentness',
  'unknown-risk',
  'instruction-contract',
  'context-followup',
  'build-action',
  'open-chat',
]);

const riskFlagSchema = z.enum([
  'possible-false-premise',
  'fictional-entity-risk',
  'freshness-needed',
  'generic-fallback-risk',
  'format-contract-risk',
  'topic-drift-risk',
  'unsafe-request-risk',
]);

export const steeringPacketSchema = z.object({
  schemaVersion: z.literal(1),
  actorId: z.string().min(1),
  promptHash: z.string().min(16),
  taskShape: taskShapeSchema,
  qualityContract: z.object({
    answerLength: z.enum(['literal', 'short', 'medium', 'structured']),
    mustBeGuiding: z.boolean(),
    mustBeCurrent: z.boolean(),
    mustUseJson: z.boolean(),
    shouldAskClarifyingQuestion: z.boolean(),
  }),
  routeGuidance: z.array(z.object({
    signal: z.enum(['prefer', 'avoid']),
    handler: z.string().min(1),
    reason: z.string().min(1),
  })).default([]),
  riskFlags: z.array(riskFlagSchema).default([]),
  retrievalHints: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export type SteeringPacket = z.infer<typeof steeringPacketSchema>;

export const candidateReviewSchema = z.object({
  schemaVersion: z.literal(1),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().min(1),
  requiresFreshEvidence: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
});

export interface LocalSteeringInput {
  readonly conversationId: string;
  readonly content: string;
  readonly mode?: string | null;
  readonly source: 'websocket' | 'direct-local';
  readonly recentContext?: readonly string[];
}

export interface LocalSteeringWorkerOptions {
  readonly enabled: boolean;
  readonly model: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly visibleWaitMs: number;
  readonly outFile: string;
  readonly fetchImpl?: typeof fetch;
}

interface OllamaGenerateResponse {
  readonly response?: string;
}

function hashPrompt(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function redactSteeringText(value: string): string {
  return value
    .replace(/\b(?:sk|pk|ghp|gho|github_pat|glpat|xox[baprs])[-_][-A-Za-z0-9_]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*[^\s'"`]+/gi, '$1=[REDACTED]')
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

const TASK_SHAPES = taskShapeSchema.options;
const RISK_FLAGS = riskFlagSchema.options;
const ANSWER_LENGTHS = ['literal', 'short', 'medium', 'structured'] as const;

/** Coerce a stringified/loose boolean ("true"/"yes"/1) to a real boolean, else undefined. */
function coerceBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'y'].includes(v)) return true;
    if (['false', 'no', '0', 'n'].includes(v)) return false;
  }
  return undefined;
}

/** Coerce a number-ish confidence into [0,1], else undefined. */
function coerceConfidence(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  if (n < 0) return 0;
  if (n > 1) return n > 1 && n <= 100 ? n / 100 : 1; // 70 → 0.7, 200 → 1
  return n;
}

/** Snap a free-text value to the nearest allowed enum member (case/space-insensitive substring). */
function snapEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const exact = allowed.find((a) => a.toLowerCase() === v);
  if (exact) return exact;
  return allowed.find((a) => v.includes(a.toLowerCase()) || a.toLowerCase().includes(v));
}

/**
 * Best-effort repair of a near-miss packet from a SMALL local model (e.g. qwen2.5:3b).
 * A 3b model reliably emits the right STRUCTURE but trips on the strict schema: booleans
 * as "true"/"yes", confidence as 70 instead of 0.7, a taskShape just outside the enum,
 * missing optional arrays. Rather than discard the whole packet (the live failure — invalid
 * every turn), we coerce only SHAPE/TYPE mistakes and snap enums to the nearest allowed
 * value. We never invent safety-bearing content: anything we can't confidently coerce is
 * left out and the strict schema rejects the result, so a truly garbage response still
 * yields null. promptHash/actorId, when absent, are not fabricated here — the caller owns
 * those, so we only repair them when the model echoed something usable.
 */
function coerceSteeringPacket(parsed: unknown, fallback: { promptHash?: string }): unknown {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const p = parsed as Record<string, unknown>;
  const qcRaw = (p.qualityContract && typeof p.qualityContract === 'object' && !Array.isArray(p.qualityContract))
    ? p.qualityContract as Record<string, unknown>
    : {};

  const qualityContract = {
    answerLength: snapEnum(qcRaw.answerLength, ANSWER_LENGTHS) ?? 'medium',
    mustBeGuiding: coerceBool(qcRaw.mustBeGuiding) ?? false,
    mustBeCurrent: coerceBool(qcRaw.mustBeCurrent) ?? false,
    mustUseJson: coerceBool(qcRaw.mustUseJson) ?? false,
    shouldAskClarifyingQuestion: coerceBool(qcRaw.shouldAskClarifyingQuestion) ?? false,
  };

  const riskFlags = Array.isArray(p.riskFlags)
    ? p.riskFlags.map((f) => snapEnum(f, RISK_FLAGS)).filter((f): f is typeof RISK_FLAGS[number] => Boolean(f))
    : [];
  const retrievalHints = Array.isArray(p.retrievalHints)
    ? p.retrievalHints.filter((h): h is string => typeof h === 'string')
    : [];
  const routeGuidance = Array.isArray(p.routeGuidance)
    ? p.routeGuidance.filter((g): g is Record<string, unknown> =>
        Boolean(g) && typeof g === 'object' && !Array.isArray(g))
      .map((g) => ({
        signal: snapEnum(g.signal, ['prefer', 'avoid'] as const),
        handler: typeof g.handler === 'string' ? g.handler : undefined,
        reason: typeof g.reason === 'string' ? g.reason : undefined,
      }))
      .filter((g) => g.signal && g.handler && g.reason)
    : [];

  const promptHash = typeof p.promptHash === 'string' && p.promptHash.length >= 16
    ? p.promptHash
    : fallback.promptHash;

  return {
    schemaVersion: 1,
    actorId: typeof p.actorId === 'string' && p.actorId.length > 0 ? p.actorId : 'local:steering',
    promptHash,
    taskShape: snapEnum(p.taskShape, TASK_SHAPES) ?? 'open-chat',
    qualityContract,
    routeGuidance,
    riskFlags,
    retrievalHints,
    confidence: coerceConfidence(p.confidence) ?? 0.5,
  };
}

/**
 * Parse a steering packet. Tries the strict schema first (a capable model's clean JSON
 * passes untouched), then falls back to a best-effort coercion that salvages a small
 * model's near-miss output. `fallback.promptHash` lets the caller supply the hash it already
 * computed, since a 3b model frequently omits or mangles it. Returns null only when the
 * response is unsalvageable.
 */
export function parseSteeringPacket(raw: string, fallback: { promptHash?: string } = {}): SteeringPacket | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    return null;
  }
  const strict = steeringPacketSchema.safeParse(parsed);
  if (strict.success) return strict.data;

  const coerced = steeringPacketSchema.safeParse(coerceSteeringPacket(parsed, fallback));
  return coerced.success ? coerced.data : null;
}

function defaultOutFile(): string {
  const cwd = process.cwd();
  const root = cwd.replace(/\\/g, '/').endsWith('/packages/runtime')
    ? resolve(cwd, '../..')
    : cwd;
  return resolve(root, 'Temporary_files', 'local-steering', 'steering.jsonl');
}

export function parseCandidateReview(raw: string): ResponseReviewResult | null {
  try {
    const parsed = JSON.parse(stripJsonFence(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    // Small local models occasionally copy their own model version into this
    // transport-only field (for example "2.5"). Keep the safety-bearing
    // verdict fields strict, but normalize the envelope version we own.
    const result = candidateReviewSchema.safeParse({ ...parsed, schemaVersion: 1 });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function durationFromEnv(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, Math.round(parsed)));
}

export function localSteeringOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): LocalSteeringWorkerOptions {
  return {
    enabled: ['1', 'true', 'yes'].includes((env.VAI_LOCAL_STEERING_ENABLED ?? '').toLowerCase()),
    // Role override → fast local role → capable local role → legacy default.
    // Following LOCAL_MODEL keeps this current when the operator upgrades the
    // local model instead of pinning a stale generation forever.
    model: env.VAI_LOCAL_STEERING_MODEL?.trim()
      || env.LOCAL_FAST_MODEL?.trim()
      || env.LOCAL_MODEL?.trim()
      || 'qwen2.5:7b',
    baseUrl: (env.VAI_LOCAL_STEERING_URL?.trim() || 'http://localhost:11434').replace(/\/$/, ''),
    timeoutMs: durationFromEnv(env.VAI_LOCAL_STEERING_TIMEOUT_MS, 8000, 60_000),
    visibleWaitMs: durationFromEnv(env.VAI_LOCAL_STEERING_VISIBLE_WAIT_MS, 1200, 5000),
    outFile: env.VAI_LOCAL_STEERING_OUT_FILE?.trim() || defaultOutFile(),
  };
}

export class LocalSteeringWorker {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LocalSteeringWorkerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get modelId(): string {
    return this.options.model;
  }

  get visibleWaitMs(): number {
    return this.options.visibleWaitMs;
  }

  isEnabled(): boolean {
    return this.options.enabled;
  }

  enqueue(input: LocalSteeringInput): void {
    if (!this.options.enabled) return;
    void this.run(input).catch((error) => {
      void this.writeRecord({
        type: 'local-steering-error',
        createdAt: new Date().toISOString(),
        conversationId: input.conversationId,
        source: input.source,
        model: this.options.model,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async run(input: LocalSteeringInput): Promise<SteeringPacket | null> {
    if (!this.options.enabled) return null;
    const redactedContent = redactSteeringText(input.content);
    const promptHash = hashPrompt(redactedContent);
    const startedAt = Date.now();
    const raw = await this.callModel(input, redactedContent, promptHash);
    const packet = parseSteeringPacket(raw, { promptHash });
    const durationMs = Date.now() - startedAt;

    await this.writeRecord({
      type: 'local-steering',
      createdAt: new Date().toISOString(),
      conversationId: input.conversationId,
      source: input.source,
      model: this.options.model,
      promptHash,
      mode: input.mode ?? null,
      durationMs,
      valid: Boolean(packet),
      packet,
      raw: packet ? undefined : raw.slice(0, 2000),
    });

    return packet;
  }

  async reviewCandidate(input: ResponseReviewInput): Promise<ResponseReviewResult | null> {
    if (!this.options.enabled) return null;
    const redactedInput: ResponseReviewInput = {
      ...input,
      prompt: redactSteeringText(input.prompt),
      draft: redactSteeringText(input.draft),
      sources: input.sources.map((source) => ({
        title: source.title ? redactSteeringText(source.title) : undefined,
        url: source.url,
        snippet: source.snippet ? redactSteeringText(source.snippet) : undefined,
      })),
    };
    const startedAt = Date.now();
    const raw = await this.callGeneratePrompt(buildCandidateReviewPrompt(redactedInput, this.options.model));
    const review = parseCandidateReview(raw);

    await this.writeRecord({
      type: 'local-response-review',
      createdAt: new Date().toISOString(),
      model: this.options.model,
      durationMs: Date.now() - startedAt,
      valid: Boolean(review),
      decision: review?.decision ?? null,
      reason: review?.reason ?? null,
      promptHash: hashPrompt(redactedInput.prompt),
      raw: review ? undefined : raw.slice(0, 2000),
    });

    return review;
  }

  private async callModel(input: LocalSteeringInput, redactedContent: string, promptHash: string): Promise<string> {
    return this.callGeneratePrompt(
      buildSteeringPrompt({ ...input, content: redactedContent }, promptHash, this.options.model),
    );
  }

  private async callGeneratePrompt(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.options.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          // Keep the steering model resident — a reload per guided turn costs
          // seconds and (for large models) evicts the chat model from VRAM.
          keep_alive: process.env.VAI_LOCAL_KEEP_ALIVE?.trim() || '30m',
          options: { temperature: 0 },
          prompt,
        }),
      });
      if (!res.ok) throw new Error(`ollama_generate_${res.status}`);
      const data = await res.json() as OllamaGenerateResponse;
      return String(data.response ?? '');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async writeRecord(record: unknown): Promise<void> {
    await mkdir(dirname(this.options.outFile), { recursive: true });
    await appendFile(this.options.outFile, `${JSON.stringify(record)}\n`, 'utf8');
  }
}

export function buildCandidateReviewPrompt(input: ResponseReviewInput, model: string): string {
  return [
    'You are a local response reviewer helping Vai decide whether a prepared draft is safe to show.',
    'You review only. Do not answer the user and do not rewrite the draft.',
    'Return STRICT JSON only with exactly: schemaVersion, decision, reason, requiresFreshEvidence, confidence.',
    'schemaVersion MUST be the JSON number 1. It is not the model version.',
    'Use decision "reject" when the draft is off-topic, answers a nearby but different question, invents unsupported facts, or gives current local recommendations without fresh evidence.',
    'A generic country or city description is never an acceptable answer to a request for local restaurants or services.',
    'Use decision "approve" only when the draft directly answers the question and current claims are supported by the supplied sources.',
    `reviewer: local:${model}`,
    `userQuestion: ${JSON.stringify(input.prompt)}`,
    `candidateDraft: ${JSON.stringify(input.draft)}`,
    `candidateModel: ${JSON.stringify(input.modelId)}`,
    `turnKind: ${JSON.stringify(input.turnKind)}`,
    `hasEvidence: ${input.hasEvidence}`,
    `sources: ${JSON.stringify(input.sources)}`,
  ].join('\n');
}

export function buildSteeringPrompt(input: LocalSteeringInput, promptHash: string, model: string): string {
  return [
    'You are a local background steering friend for Vai. You advise; you do not answer for Vai.',
    'Return STRICT JSON only. No markdown. No code fences. No prose.',
    'Use schemaVersion 1 and exactly these top-level keys: schemaVersion, actorId, promptHash, taskShape, qualityContract, routeGuidance, riskFlags, retrievalHints, confidence.',
    'qualityContract MUST be an object, never a string.',
    'Example qualityContract: {"answerLength":"structured","mustBeGuiding":true,"mustBeCurrent":false,"mustUseJson":false,"shouldAskClarifyingQuestion":false}',
    'Example full response: {"schemaVersion":1,"actorId":"local:model","promptHash":"abc123abc123abc123","taskShape":"debugging","qualityContract":{"answerLength":"structured","mustBeGuiding":true,"mustBeCurrent":false,"mustUseJson":false,"shouldAskClarifyingQuestion":false},"routeGuidance":[],"riskFlags":["generic-fallback-risk"],"retrievalHints":["blank page","React"],"confidence":0.7}',
    'Allowed taskShape values: short-fact, explanation, comparison, debugging, code-generation, currentness, unknown-risk, instruction-contract, context-followup, build-action, open-chat.',
    'Allowed answerLength values: literal, short, medium, structured.',
    'Allowed routeGuidance signal values: prefer, avoid. If unsure, use an empty routeGuidance array.',
    'Allowed riskFlags: possible-false-premise, fictional-entity-risk, freshness-needed, generic-fallback-risk, format-contract-risk, topic-drift-risk, unsafe-request-risk.',
    'Do not invent facts. If current evidence is needed, set mustBeCurrent and freshness-needed.',
    `actorId: local:${model}`,
    `promptHash: ${promptHash}`,
    `source: ${input.source}`,
    `mode: ${input.mode ?? 'unknown'}`,
    `userMessage: ${JSON.stringify(input.content)}`,
    `recentContext: ${JSON.stringify(input.recentContext ?? [])}`,
  ].join('\n');
}
