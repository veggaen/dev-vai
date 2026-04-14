#!/usr/bin/env node
/**
 * parallel-query.mjs — Blazing-fast parallel query utility for VAI benchmarks.
 *
 * Sends N questions concurrently via WebSocket to the VAI runtime.
 * generateResponse is stateless & read-only → safe to run 50+ in parallel.
 *
 * Usage:
 *   import { queryParallel, querySingle, createConv } from './lib/parallel-query.mjs';
 *
 *   const results = await queryParallel(questions, { concurrency: 50 });
 *   // results: [{ question, answer, durationMs, error? }, ...]
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const API = process.env.VAI_API ?? 'http://localhost:3006';
const WS_URL = process.env.VAI_WS ?? 'ws://localhost:3006/api/chat';
const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_CONCURRENCY = 50;
const DEFAULT_IDLE_TIMEOUT = Number(process.env.VAI_IDLE_TIMEOUT_MS ?? DEFAULT_TIMEOUT);
const DEFAULT_TOTAL_TIMEOUT = Number(process.env.VAI_TOTAL_TIMEOUT_MS ?? 60_000);
const DEFAULT_CREATE_RETRIES = Number(process.env.VAI_CREATE_RETRIES ?? 2);
const DEFAULT_RETRY_DELAY_MS = Number(process.env.VAI_CREATE_RETRY_DELAY_MS ?? 750);

/** @typedef {import('../../packages/core/src/models/adapter.ts').ChatChunk} ChatChunk */
/** @typedef {import('../../packages/core/src/models/adapter.ts').SearchSource} SearchSource */

/**
 * @typedef {{
 *   id: string,
 *   title?: string,
 *   modelId?: string,
 *   sandboxProjectId?: string | null,
 * }} ConversationResponse
 */

/**
 * @typedef {{
 *   title?: string,
 *   modelId?: string,
 *   baseUrl?: string,
 *   retries?: number,
 *   retryDelayMs?: number,
 * }} CreateConversationOptions
 */

/**
 * @typedef {{
 *   idleTimeoutMs?: number,
 *   totalTimeoutMs?: number,
 *   wsUrl?: string,
 *   includeEvents?: boolean,
 *   eventLogPath?: string,
 * }} QueryOptions
 */

/**
 * @typedef {{
 *   answer: string,
 *   reasoning?: string,
 *   sources: SearchSource[],
 *   confidence: number | null,
 *   followUps: string[],
 *   timeout: boolean,
 *   closeCode?: number,
 *   closeReason?: string,
 *   requestId: string,
 *   durationMs: number,
 *   messageCount: number,
 *   modelId?: string,
 *   usage?: import('../../packages/core/src/models/adapter.ts').TokenUsage,
 *   events?: Array<{ type: string, keys?: string[] }>,
 * }} QuerySingleResult
 */

/**
 * @typedef {{
 *   requireAnswer?: boolean,
 *   requireSources?: boolean,
 *   forbidTimeout?: boolean,
 *   answerIncludes?: string[],
 * }} AssertionOptions
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function isConversationResponse(value) {
  return isRecord(value) && typeof value.id === 'string';
}

function safeParseJson(rawText, label) {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${String(error)}\n${rawText}`, { cause: error });
  }
}

function sourceKey(source) {
  return source.url || `${source.title ?? ''}::${source.domain ?? ''}::${source.snippet ?? ''}`;
}

function mergeSources(existing, incoming) {
  const merged = new Map();
  for (const source of existing) {
    merged.set(sourceKey(source), source);
  }
  for (const source of incoming) {
    const key = sourceKey(source);
    const previous = merged.get(key);
    merged.set(key, { ...previous, ...source });
  }
  return [...merged.values()];
}

function normalizeCreateOptions(titleOrOptions = 'Benchmark') {
  if (typeof titleOrOptions === 'string') {
    return {
      title: titleOrOptions,
      modelId: 'vai:v0',
      baseUrl: API,
      retries: DEFAULT_CREATE_RETRIES,
      retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    };
  }
  return {
    title: titleOrOptions.title ?? 'Benchmark',
    modelId: titleOrOptions.modelId ?? 'vai:v0',
    baseUrl: titleOrOptions.baseUrl ?? API,
    retries: titleOrOptions.retries ?? DEFAULT_CREATE_RETRIES,
    retryDelayMs: titleOrOptions.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  };
}

function normalizeQueryOptions(timeoutOrOptions = DEFAULT_TIMEOUT) {
  if (typeof timeoutOrOptions === 'number') {
    return {
      idleTimeoutMs: timeoutOrOptions,
      totalTimeoutMs: timeoutOrOptions,
      wsUrl: WS_URL,
      includeEvents: false,
      eventLogPath: undefined,
    };
  }
  return {
    idleTimeoutMs: timeoutOrOptions.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT,
    totalTimeoutMs: timeoutOrOptions.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT,
    wsUrl: timeoutOrOptions.wsUrl ?? WS_URL,
    includeEvents: timeoutOrOptions.includeEvents ?? false,
    eventLogPath: timeoutOrOptions.eventLogPath,
  };
}

function writeEventLog(path, payload) {
  if (!path) return;
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Create a conversation and return its ID.
 */
export async function createConv(titleOrOptions = 'Benchmark') {
  const options = normalizeCreateOptions(titleOrOptions);
  let lastError;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const res = await fetch(`${options.baseUrl}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: options.title, modelId: options.modelId }),
      });

      const rawText = await res.text();
      if (!res.ok) {
        throw new Error(`Failed to create conversation: ${res.status} ${res.statusText}\n${rawText}`);
      }

      const data = safeParseJson(rawText, 'Conversation endpoint');
      if (!isConversationResponse(data)) {
        throw new Error(`Unexpected conversation response shape: ${JSON.stringify(data, null, 2)}`);
      }

      return data.id;
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries) break;
      await sleep(options.retryDelayMs * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export const createConversation = createConv;

/**
 * Send a single message to VAI via WebSocket. Returns { answer, durationMs }.
 */
export function querySingle(conversationId, message, timeoutOrOptions = DEFAULT_TIMEOUT) {
  const options = normalizeQueryOptions(timeoutOrOptions);
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const requestId = randomUUID();
    const ws = new WebSocket(options.wsUrl);
    let answer = '';
    let reasoning = '';
    /** @type {SearchSource[]} */
    let sources = [];
    let confidence = null;
    let followUps = [];
    let modelId;
    let usage;
    let messageCount = 0;
    let settled = false;
    let done = false;
    /** @type {NodeJS.Timeout | null} */
    let idleTimer = null;
    /** @type {NodeJS.Timeout | null} */
    let totalTimer = null;
    /** @type {Array<{ type: string, keys?: string[] }>} */
    const events = [];

    const finalize = (result) => {
      writeEventLog(options.eventLogPath, {
        conversationId,
        question: message,
        ...result,
      });
      if (options.includeEvents) {
        result.events = events;
      }
      resolve(result);
    };

    const cleanup = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    const resolveOnce = (partial) => {
      if (settled) return;
      settled = true;
      const durationMs = Math.round(performance.now() - start);
      cleanup();
      finalize({
        answer,
        reasoning: reasoning || undefined,
        sources,
        confidence,
        followUps,
        timeout: false,
        requestId,
        durationMs,
        messageCount,
        modelId,
        usage,
        ...partial,
      });
    };

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const resetIdleTimeout = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        resolveOnce({
          timeout: true,
          closeReason: `Idle timeout exceeded (${options.idleTimeoutMs}ms)`,
        });
      }, options.idleTimeoutMs);
    };

    totalTimer = setTimeout(() => {
      resolveOnce({
        timeout: true,
        closeReason: `Total timeout exceeded (${options.totalTimeoutMs}ms)`,
      });
    }, options.totalTimeoutMs);

    ws.on('unexpected-response', (_request, response) => {
      rejectOnce(new Error(`Unexpected WebSocket handshake response: ${response.statusCode} ${response.statusMessage}`));
    });

    ws.on('open', () => {
      events.push({ type: 'open' });
      resetIdleTimeout();
      ws.send(JSON.stringify({ conversationId, content: message }));
    });

    ws.on('message', (data) => {
      resetIdleTimeout();
      messageCount += 1;

      /** @type {ChatChunk | ({ type: 'error', error?: string, modelId?: string } & Record<string, unknown>)} */
      let msg;
      try {
        msg = /** @type {typeof msg} */ (safeParseJson(data.toString(), 'WebSocket message'));
      } catch (error) {
        rejectOnce(error);
        return;
      }

      events.push({ type: msg.type, keys: Object.keys(msg) });
      if (typeof msg.modelId === 'string') modelId = msg.modelId;

      if (msg.type === 'text_delta' && msg.textDelta) {
        answer += msg.textDelta;
        return;
      }
      if (msg.type === 'reasoning_delta' && msg.reasoningDelta) {
        reasoning += msg.reasoningDelta;
        return;
      }
      if (msg.type === 'sources') {
        if (Array.isArray(msg.sources)) {
          sources = mergeSources(sources, /** @type {SearchSource[]} */ (msg.sources));
        }
        if (typeof msg.confidence === 'number') confidence = msg.confidence;
        if (Array.isArray(msg.followUps)) {
          followUps = msg.followUps.filter((item) => typeof item === 'string');
        }
        return;
      }
      if (msg.type === 'done') {
        done = true;
        usage = msg.usage;
        resolveOnce({ timeout: false, modelId: modelId ?? msg.modelId, durationMs: msg.durationMs });
        return;
      }
      if (msg.type === 'error') {
        rejectOnce(new Error(msg.error || 'Unknown WebSocket error'));
      }
    });

    ws.on('close', (code, reasonBuffer) => {
      if (settled) return;
      resolveOnce({
        timeout: false,
        closeCode: code,
        closeReason: reasonBuffer.toString() || (done ? undefined : 'Socket closed before done event'),
      });
    });

    ws.on('error', (err) => rejectOnce(err));
  });
}

export function assertResult(result, options = {}) {
  const requireAnswer = options.requireAnswer ?? true;
  const requireSources = options.requireSources ?? false;
  const forbidTimeout = options.forbidTimeout ?? true;

  if (forbidTimeout && result.timeout) {
    throw new Error(`Validation failed: request timed out (${result.closeReason ?? 'unknown'})`);
  }
  if (requireAnswer && !result.answer.trim()) {
    throw new Error('Validation failed: answer was empty');
  }
  if (requireSources && result.sources.length === 0) {
    throw new Error('Validation failed: expected at least one source');
  }
  if (Array.isArray(options.answerIncludes)) {
    for (const token of options.answerIncludes) {
      if (!result.answer.toLowerCase().includes(token.toLowerCase())) {
        throw new Error(`Validation failed: answer missing required token "${token}"`);
      }
    }
  }
}

/**
 * Run many questions in parallel with a concurrency limit (p-limit pattern).
 *
 * @param {Array<{ q: string, convId?: string, [key: string]: any }>} questions
 * @param {{ concurrency?: number, timeoutMs?: number, onResult?: Function }} opts
 * @returns {Promise<Array<{ question: string, answer: string, durationMs: number, error?: string, idx: number }>>}
 */
export async function queryParallel(questions, opts = {}) {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const onResult = opts.onResult ?? null;

  // Create a shared conversation if none provided per-question
  const sharedConvId = opts.sharedConvId ?? await createConv('Parallel-Bench');

  const results = new Array(questions.length);
  let running = 0;
  let nextIdx = 0;

  return new Promise((resolve) => {
    function scheduleNext() {
      while (running < concurrency && nextIdx < questions.length) {
        const idx = nextIdx++;
        const q = questions[idx];
        const convId = q.convId ?? sharedConvId;
        running++;

        querySingle(convId, q.q, timeoutMs)
          .then((result) => {
            results[idx] = { question: q.q, answer: result.answer, durationMs: result.durationMs, idx, ...result, ...q };
            if (onResult) onResult(results[idx], idx, questions.length);
          })
          .catch((err) => {
            results[idx] = { question: q.q, answer: '[error]', durationMs: 0, error: err.message, idx, ...q };
            if (onResult) onResult(results[idx], idx, questions.length);
          })
          .finally(() => {
            running--;
            if (nextIdx >= questions.length && running === 0) {
              resolve(results);
            } else {
              scheduleNext();
            }
          });
      }
    }
    scheduleNext();
  });
}

/**
 * Evaluate a result against keywords or a validate function.
 * Compatible with both mega-200 and precision test formats.
 */
export function evaluate(answer, question) {
  const lower = answer.toLowerCase();

  // Custom validation function (precision tests)
  if (typeof question.validate === 'function') {
    const pass = question.validate(answer);
    return { pass, reason: pass ? 'validate()' : 'validate() failed' };
  }

  // Keyword matching (mega-200 tests)
  if (question.keywords) {
    const matched = question.keywords.filter(kw => lower.includes(kw.toLowerCase()));
    const pass = matched.length > 0;
    return {
      pass,
      reason: pass
        ? `✓ [${matched.join(', ')}]`
        : `✗ missing [${question.keywords.join(', ')}]`,
    };
  }

  return { pass: false, reason: 'no validation' };
}

/**
 * Pretty-print a compact one-line result for streaming output.
 */
export function formatResult(result, evalResult) {
  const icon = evalResult.pass ? '✅' : '❌';
  const ms = `${result.durationMs}ms`.padStart(6);
  const q = result.question.slice(0, 55).padEnd(55);
  return `${icon} ${ms} ${q} ${evalResult.reason}`;
}
