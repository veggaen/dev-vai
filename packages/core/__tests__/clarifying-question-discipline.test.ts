import { describe, expect, it } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

describe('clarifying question discipline', () => {
  it('asks exactly one endpoint question before proposing bridge architecture', async () => {
    const engine = new VaiEngine({ testMode: true });
    const response = await engine.chat({
      messages: [{
        role: 'user',
        content: 'I want Vai to bridge humans, AI, and tools. Ask me the single question whose answer would most reduce uncertainty before you propose the next implementation.',
      }],
      noLearn: true,
    });

    expect(response.message.content).toBe(
      'Which exact two endpoints should Vai connect first, and what concrete message must travel between them end to end?',
    );
    expect(response.message.content.match(/\?/g)).toHaveLength(1);
  });

  it('honors a natural one-question paraphrase', async () => {
    const engine = new VaiEngine({ testMode: true });
    const response = await engine.chat({
      messages: [{
        role: 'user',
        content: 'Before you design anything, ask one question only: what answer would reduce the most uncertainty about the first useful Vai bridge?',
      }],
      noLearn: true,
    });

    expect(response.message.content).toBe(
      'Which exact two endpoints should Vai connect first, and what concrete message must travel between them end to end?',
    );
    expect(response.message.content.match(/\?/g)).toHaveLength(1);
  });
});
