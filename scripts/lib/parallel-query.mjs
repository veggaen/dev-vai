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

import WebSocket from 'ws';

const API = process.env.VAI_API ?? 'http://localhost:3006';
const WS_URL = process.env.VAI_WS ?? 'ws://localhost:3006/api/chat';
const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_CONCURRENCY = 50;

/**
 * Create a conversation and return its ID.
 */
export async function createConv(title = 'Benchmark') {
  const res = await fetch(`${API}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, modelId: 'vai:v0' }),
  });
  return (await res.json()).id;
}

/**
 * Send a single message to VAI via WebSocket. Returns { answer, durationMs }.
 */
export function querySingle(conversationId, message, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const ws = new WebSocket(WS_URL);
    let response = '';
    let gotDone = false;

    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content: message })));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'text_delta' && msg.textDelta) response += msg.textDelta;
      else if (msg.type === 'done') { gotDone = true; ws.close(); }
      else if (msg.type === 'error') { ws.close(); reject(new Error(msg.error)); }
    });

    ws.on('close', () => {
      const durationMs = Math.round(performance.now() - start);
      resolve({ answer: response || '[no response]', durationMs });
    });

    ws.on('error', (err) => reject(err));

    setTimeout(() => {
      if (!gotDone) {
        ws.close();
        const durationMs = Math.round(performance.now() - start);
        resolve({ answer: response || '[timeout]', durationMs });
      }
    }, timeoutMs);
  });
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
          .then(({ answer, durationMs }) => {
            results[idx] = { question: q.q, answer, durationMs, idx, ...q };
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
