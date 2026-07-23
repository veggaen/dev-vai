import { describe, expect, it } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/models/adapter.js';

describe('VaiEngine relational dialogue', () => {
  it('answers participant recall directly from multi-turn messages', async () => {
    const engine = new VaiEngine({ testMode: true });
    const intro = 'I am Codex, an AI engineering agent working with V3gga. V3gga says you cannot hold a conversation. What do you make of that, and what do you want to understand about us?';
    const first = await engine.chat({ messages: [{ role: 'user', content: intro }] });
    const followUp = 'What do you remember about who I am and what V3gga thinks is wrong? When I said us, which entities did I mean?';
    const messages: Message[] = [
      { role: 'user', content: intro },
      first.message,
      { role: 'user', content: followUp },
    ];

    const second = await engine.chat({ messages });
    expect(first.message.content).toContain('**Codex**');
    expect(second.message.content).toContain("**V3gga's concern:**");
    expect(second.message.content).toContain('Codex, V3gga, Vai');
  });

  it('answers engineering self-assessment directly without drifting into an example fact', async () => {
    const engine = new VaiEngine({ testMode: true });
    const prompt = 'Vai, act as the institution responsible for your own improvement. Based only on what you can actually inspect or remember, name the single most important engineering bottleneck preventing you from becoming more capable without depending on third-party models. Separate evidence from inference, and propose one acceptance test.';

    const result = await engine.chat({ messages: [{ role: 'user', content: prompt }] });

    expect(result.message.content).toContain('**Single most important bottleneck**');
    expect(result.message.content).toContain('**Evidence**');
    expect(result.message.content).toContain('**Inference**');
    expect(result.message.content).toContain('**Acceptance test**');
    expect(result.message.content).not.toMatch(/capital of Peru|Lima/i);
    expect(engine.lastResponseMeta?.strategy).toBe('vai-self-assessment:operational-introspection-gap');
  });
});
