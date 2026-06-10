import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import {
  LocalSteeringWorker,
  localSteeringOptionsFromEnv,
  parseCandidateReview,
  parseSteeringPacket,
  redactSteeringText,
} from '../src/steering/local-steering-worker.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('LocalSteeringWorker', () => {
  it('uses a bounded visibility wait that is independent from the model timeout', () => {
    const options = localSteeringOptionsFromEnv({
      VAI_LOCAL_STEERING_TIMEOUT_MS: '9000',
      VAI_LOCAL_STEERING_VISIBLE_WAIT_MS: '1750',
    });

    expect(options.timeoutMs).toBe(9000);
    expect(options.visibleWaitMs).toBe(1750);
    expect(localSteeringOptionsFromEnv({
      VAI_LOCAL_STEERING_VISIBLE_WAIT_MS: '999999',
    }).visibleWaitMs).toBe(5000);
  });

  it('parses strict JSON packets even when the local model wraps them in a code fence', () => {
    const packet = parseSteeringPacket('```json\n{"schemaVersion":1,"actorId":"local:qwen2.5:7b","promptHash":"1234567890abcdef","taskShape":"debugging","qualityContract":{"answerLength":"structured","mustBeGuiding":true,"mustBeCurrent":false,"mustUseJson":false,"shouldAskClarifyingQuestion":false},"routeGuidance":[],"riskFlags":["generic-fallback-risk"],"retrievalHints":["React blank page"],"confidence":0.72}\n```');

    expect(packet?.taskShape).toBe('debugging');
    expect(packet?.riskFlags).toContain('generic-fallback-risk');
  });

  it('redacts common secrets before building steering prompts', () => {
    const redacted = redactSteeringText('api_key=abc123SECRET and ghp_1234567890abcdefghijklmnop');

    expect(redacted).toContain('api_key=[REDACTED]');
    expect(redacted).toContain('[REDACTED_TOKEN]');
    expect(redacted).not.toContain('abc123SECRET');
  });

  it('parses strict candidate-review decisions', () => {
    const review = parseCandidateReview('{"schemaVersion":1,"decision":"reject","reason":"The draft answers Norway, not restaurants in Hommersak.","requiresFreshEvidence":true,"confidence":0.96}');

    expect(review?.decision).toBe('reject');
    expect(review?.requiresFreshEvidence).toBe(true);
  });

  it('normalizes a model-version leak without relaxing the review verdict', () => {
    const review = parseCandidateReview('```json\n{"schemaVersion":"2.5","decision":"approve","reason":"The cited local listings answer the question.","requiresFreshEvidence":false,"confidence":0.9}\n```');

    expect(review).toEqual({
      schemaVersion: 1,
      decision: 'approve',
      reason: 'The cited local listings answer the question.',
      requiresFreshEvidence: false,
      confidence: 0.9,
    });
    expect(parseCandidateReview('{"schemaVersion":"2.5","decision":"maybe","reason":"Unsure","requiresFreshEvidence":false,"confidence":0.9}')).toBeNull();
  });

  it('writes valid shadow steering records without affecting the chat path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vai-steering-'));
    tempDirs.push(dir);
    const outFile = join(dir, 'steering.jsonl');
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const prompt = String(body.prompt ?? '');
      const promptHash = /promptHash:\s*([a-f0-9]+)/i.exec(prompt)?.[1] ?? '1234567890abcdef';
      return new Response(JSON.stringify({
        response: JSON.stringify({
          schemaVersion: 1,
          actorId: 'local:qwen2.5:7b',
          promptHash,
          taskShape: 'debugging',
          qualityContract: {
            answerLength: 'structured',
            mustBeGuiding: true,
            mustBeCurrent: false,
            mustUseJson: false,
            shouldAskClarifyingQuestion: false,
          },
          routeGuidance: [{ signal: 'prefer', handler: 'conversation-reasoning', reason: 'debugging prompt' }],
          riskFlags: ['generic-fallback-risk'],
          retrievalHints: ['blank React page'],
          confidence: 0.81,
        }),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const worker = new LocalSteeringWorker({
      enabled: true,
      model: 'qwen2.5:7b',
      baseUrl: 'http://ollama.test',
      timeoutMs: 1000,
      visibleWaitMs: 200,
      outFile,
      fetchImpl,
    });

    const packet = await worker.run({
      conversationId: 'conv-1',
      content: 'I am overwhelmed debugging a blank React page. Where should I start?',
      mode: 'chat',
      source: 'websocket',
    });

    expect(packet?.taskShape).toBe('debugging');
    const lines = (await readFile(outFile, 'utf8')).trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record.valid).toBe(true);
    expect(record.packet.riskFlags).toContain('generic-fallback-risk');
    expect(record.conversationId).toBe('conv-1');
  });

  it('reviews a candidate draft before release', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vai-review-'));
    tempDirs.push(dir);
    const outFile = join(dir, 'steering.jsonl');
    const fetchImpl = (async () => new Response(JSON.stringify({
      response: JSON.stringify({
        schemaVersion: 1,
        decision: 'reject',
        reason: 'The draft describes Norway instead of recommending restaurants in Hommersak.',
        requiresFreshEvidence: true,
        confidence: 0.99,
      }),
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const worker = new LocalSteeringWorker({
      enabled: true,
      model: 'qwen2.5:7b',
      baseUrl: 'http://ollama.test',
      timeoutMs: 1000,
      visibleWaitMs: 200,
      outFile,
      fetchImpl,
    });

    const review = await worker.reviewCandidate({
      prompt: 'what are good resturants in hommersak norway?',
      draft: 'Norway is a country in Northern Europe. Its capital is Oslo.',
      modelId: 'vai:v0',
      turnKind: 'research',
      hasEvidence: false,
      sources: [],
    });

    expect(review?.decision).toBe('reject');
    expect(review?.requiresFreshEvidence).toBe(true);
    expect((await readFile(outFile, 'utf8'))).toContain('local-response-review');
  });
});
