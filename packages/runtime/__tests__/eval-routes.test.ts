import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDb, EvalRunner, ModelRegistry } from '@vai/core';
import type { ChatChunk, ChatRequest, ChatResponse, ModelAdapter, VaiDatabase } from '@vai/core';
import { seedVaiEvalTasks } from '../src/eval/vai-tasks.js';
import { registerEvalRoutes } from '../src/routes/eval.js';

class EvalTestAdapter implements ModelAdapter {
  readonly id = 'test:mock';
  readonly displayName = 'Eval Test Mock';
  readonly provider = 'vai' as const;
  readonly supportsStreaming = false;
  readonly supportsToolUse = false;

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const prompt = request.messages[request.messages.length - 1]?.content ?? '';

    const content = prompt.includes('15 + 27')
      ? '42'
      : prompt.includes('What are you?')
        ? 'I am VeggaAI, a local-first assistant.'
        : prompt.trim().toLowerCase() === 'build an ai app.'
          ? '## AI app direction without shallow defaults\nTreat this as a product-boundary decision first: a chat-first assistant, generation tool, or workflow copilot.\n## Recommended architecture\nUse a product shell with auth, teams, billing, and history, add retrieval only where source grounding helps, and keep an approval boundary before actions.\n## Pragmatic default\nStart with one AI workflow that saves real time instead of an assistant-everywhere surface.'
          : ((prompt.includes('Explain predictive context prefetch for a code assistant in plain language')) || (prompt.includes('Explain predictive context prefetch for a repo-native code assistant in plain language')) || (prompt.includes('A repo-native code assistant can proactively load likely files, tests, or docs before the developer asks.')))
            ? '## Idea\nPredictive context prefetch means the assistant loads likely callers, tests, or docs before the developer asks for them.\n## Inputs\nUse recent edits, cursor movement, or git history as signals to decide what to prefetch into cache or nearby context.\n## Guardrails\nKeep fallback retrieval available, track wrong predictions or misses, and avoid acting as if a guess was certain when the prediction fails.'
          : prompt.includes('Improve the response so it is more solid, tested, and free of obvious architecture mistakes')
            ? '## How to improve that kind of AI response\nStop pretending a serious chat workspace can be solved by a few magic files and name the architecture, layout model, and state boundaries directly.\n## What a stronger answer should do\nCall out risky shortcuts, explain what should be tested, and cover permission boundaries plus keyboard accessibility.\n## Stronger rewrite direction\nTreat the original answer as a concept sketch, then upgrade it into a domain model, validation plan, and implementation slices.'
        : ((prompt.includes('Perplexity-style answer engine works')) || (prompt.includes('web answer engine like Perplexity generally works')))
          ? '## Core idea\nRetrieval first and synthesis second, with citations to sources.\n## Likely pipeline\nThe system uses query rewriting, ranking, and reranking before synthesis. Based on public patterns, that is the supportable shape.\n## Limits\nI would not claim exact private internals or a private system prompt.'
          : ((prompt.includes('Design a layered retrieval-reasoning answer engine')) || (prompt.includes('Give a grounded design memo for a layered answer engine')))
            ? '## Retrieval\nUse query rewriting first, then hybrid retrieval that combines lexical matching with dense retrieval so the system can find both exact API references and semantically related material.\n## Ranking\nApply reranking with a stronger evidence-focused model so the most relevant passages rise to the top.\n## Synthesis\nCompose the answer from the best evidence and include citations or source references for each major claim.\n## Verification\nRun contradiction checks, attach explicit uncertainty notes, and flag when evidence is thin or mixed.\n## Failure modes\nWeak retrieval, stale documentation, poor query rewrites, or overconfident synthesis can all reduce answer quality.'
            : prompt.includes('Design a benchmark rubric for Vai')
              ? '## Dimensions\nMeasure factual support, groundedness, structure, uncertainty handling, and instruction following so the rubric rewards useful answers instead of just fluent wording.\n## Pass conditions\nA passing response should follow the prompt, stay organized, make supportable claims, and clearly state limits when evidence is incomplete.\n## Penalties\nHallucination risk, unsupported claims, missing caveats, and broken structure should all reduce the score.\n## Example signals\nLook for citations, confidence notes, explicit uncertainty, concrete structure, and language that shows whether the answer is well supported or only partially supported.'
        : 'hello from eval test mock';

    return {
      message: { role: 'assistant', content },
      usage: { promptTokens: 4, completionTokens: 8 },
      finishReason: 'stop',
    };
  }

  async *chatStream(_request: ChatRequest): AsyncIterable<ChatChunk> {
    yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0 } };
  }
}

describe('Eval Routes', () => {
  let app: FastifyInstance;
  let db: VaiDatabase;

  beforeEach(async () => {
    db = createDb(':memory:');
    const models = new ModelRegistry();
    models.register(new EvalTestAdapter());
    seedVaiEvalTasks();

    app = Fastify({ logger: false });
    registerEvalRoutes(app, new EvalRunner(db, models));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists seeded tracks and tasks without duplicating task registrations', async () => {
    seedVaiEvalTasks();

    const tracksRes = await app.inject({ method: 'GET', url: '/api/eval/tracks' });
    expect(tracksRes.statusCode).toBe(200);

    const tracksBody = tracksRes.json() as { tracks: Array<{ track: string; taskCount: number }> };
    expect(tracksBody.tracks).toEqual(expect.arrayContaining([
      { track: 'comprehension', taskCount: 12 },
      { track: 'casual', taskCount: 5 },
      { track: 'creative', taskCount: 3 },
      { track: 'complex', taskCount: 4 },
    ]));

    const tasksRes = await app.inject({ method: 'GET', url: '/api/eval/tracks/comprehension/tasks' });
    expect(tasksRes.statusCode).toBe(200);

    const tasksBody = tasksRes.json() as { tasks: Array<{ id: string }> };
    expect(tasksBody.tasks.some((task) => task.id === 'math-basic-add')).toBe(true);
    expect(new Set(tasksBody.tasks.map((task) => task.id)).size).toBe(tasksBody.tasks.length);

    const casualTasksRes = await app.inject({ method: 'GET', url: '/api/eval/tracks/casual/tasks' });
    expect(casualTasksRes.statusCode).toBe(200);
    const casualTasksBody = casualTasksRes.json() as { tasks: Array<{ id: string }> };
    expect(casualTasksBody.tasks).toHaveLength(5);
    expect(new Set(casualTasksBody.tasks.map((task) => task.id)).size).toBe(casualTasksBody.tasks.length);
  });

  it('runs a filtered creative eval track and returns structured results', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/eval/run',
      payload: {
        modelId: 'test:mock',
        track: 'creative',
        taskIds: ['creative-answer-engine-brief'],
        maxAttempts: 1,
        temperature: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tasks: Array<{ taskId: string; passed: boolean; score: number }>;
      summary: { totalTasks: number; passed: number; failed: number; grade: string };
    };

    expect(body.summary.totalTasks).toBe(1);
    expect(body.summary.passed).toBe(1);
    expect(body.summary.failed).toBe(0);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks.every((task) => task.passed)).toBe(true);
    expect(body.tasks.map((task) => task.taskId)).toEqual(['creative-answer-engine-brief']);
  });

  it('runs a filtered casual eval track and returns practical grounded results', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/eval/run',
      payload: {
        modelId: 'test:mock',
        track: 'casual',
        taskIds: ['casual-grounded-plan-triage', 'casual-predictive-context-prefetch'],
        maxAttempts: 1,
        temperature: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tasks: Array<{ taskId: string; passed: boolean; score: number }>;
      summary: { totalTasks: number; passed: number; failed: number; avgScore: number; grade: string };
    };

    expect(body.summary.totalTasks).toBe(2);
    expect(body.summary.passed).toBe(2);
    expect(body.summary.failed).toBe(0);
    expect(body.summary.avgScore).toBeGreaterThanOrEqual(0.85);
    expect(body.tasks.every((task) => task.passed)).toBe(true);
    expect(body.tasks.map((task) => task.taskId)).toEqual(['casual-grounded-plan-triage', 'casual-predictive-context-prefetch']);
  });

  it('runs a filtered complex eval track and persists a new complex track run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/eval/run',
      payload: {
        modelId: 'test:mock',
        track: 'complex',
        taskIds: ['complex-layered-answer-engine-design', 'complex-vai-eval-rubric'],
        maxAttempts: 1,
        temperature: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tasks: Array<{ taskId: string; passed: boolean; score: number }>;
      summary: { totalTasks: number; passed: number; failed: number; avgScore: number; grade: string };
    };

    expect(body.summary.totalTasks).toBe(2);
    expect(body.summary.passed).toBe(2);
    expect(body.summary.failed).toBe(0);
    expect(body.summary.avgScore).toBeGreaterThanOrEqual(0.85);
    expect(body.tasks.every((task) => task.passed)).toBe(true);
    expect(body.tasks.map((task) => task.taskId)).toEqual(['complex-layered-answer-engine-design', 'complex-vai-eval-rubric']);
  });
});
