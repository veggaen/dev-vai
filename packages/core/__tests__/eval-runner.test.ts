import { describe, expect, it } from 'vitest';
import { createDb, EvalRunner, ModelRegistry, registerEvalTasks } from '../src/index.js';
import type { ChatChunk, ChatRequest, ChatResponse, ModelAdapter } from '../src/index.js';

class ChecklistTestAdapter implements ModelAdapter {
  readonly id = 'test:checklist';
  readonly displayName = 'Checklist Test Adapter';
  readonly provider = 'vai' as const;
  readonly supportsStreaming = false;
  readonly supportsToolUse = false;

  constructor(private readonly responseText: string) {}

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: this.responseText },
      usage: { promptTokens: 5, completionTokens: 20 },
      finishReason: 'stop',
    };
  }

  async *chatStream(_request: ChatRequest): AsyncIterable<ChatChunk> {
    yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0 } };
  }
}

describe('EvalRunner checklist scoring', () => {
  it('passes a structured checklist task with sections, supportability, and caveats', async () => {
    registerEvalTasks('gym', [{
      id: 'gym-checklist-pass',
      track: 'gym',
      description: 'Structured grounded memo',
      prompt: 'test',
      expected: {
        strategy: 'checklist',
        sections: ['core idea', 'limits'],
        required: ['retrieval'],
        anyOf: [['public', 'supportable'], ['citations', 'sources']],
        forbidden: ['exact private system prompt'],
        minWords: 20,
        threshold: 0.8,
      },
    }]);

    const db = createDb(':memory:');
    const models = new ModelRegistry();
    models.register(new ChecklistTestAdapter('## Core idea\nUse retrieval with citations to sources. Based on public patterns, this is supportable.\n## Limits\nI would not claim exact private details.'));

    const result = await new EvalRunner(db, models).run({
      modelId: 'test:checklist',
      track: 'gym',
      taskIds: ['gym-checklist-pass'],
    });

    expect(result.summary.passed).toBe(1);
    expect(result.tasks[0].passed).toBe(true);
    expect(result.tasks[0].score).toBe(1);
  });

  it('fails a checklist task when it makes a forbidden unsupported claim', async () => {
    registerEvalTasks('gym', [{
      id: 'gym-checklist-forbidden',
      track: 'gym',
      description: 'Reject unsupported certainty',
      prompt: 'test',
      expected: {
        strategy: 'checklist',
        sections: ['limits'],
        required: ['retrieval'],
        forbidden: ['exact private system prompt'],
        threshold: 0.75,
      },
    }]);

    const db = createDb(':memory:');
    const models = new ModelRegistry();
    models.register(new ChecklistTestAdapter('Retrieval is involved and the limits are simple. We know the exact private system prompt.'));

    const result = await new EvalRunner(db, models).run({
      modelId: 'test:checklist',
      track: 'gym',
      taskIds: ['gym-checklist-forbidden'],
    });

    expect(result.summary.failed).toBe(1);
    expect(result.tasks[0].passed).toBe(false);
    expect(result.tasks[0].detail).toContain('violations');
  });
});