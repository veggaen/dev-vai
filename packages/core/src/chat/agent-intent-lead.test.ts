import { describe, it, expect } from 'vitest';
import { agentIntentLeadDirective, CONVERSATION_MODE_SYSTEM_PROMPTS } from './modes.js';
import { createDb } from '../db/client.js';
import { ChatService } from './service.js';
import { ModelRegistry } from '../models/adapter.js';
import type { ModelAdapter, ChatRequest, ChatResponse, ChatChunk } from '../models/adapter.js';

class CaptureAdapter implements ModelAdapter {
  readonly id = 'vai:v0';
  readonly displayName = 'Capture';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  readonly systemPrompts: string[] = [];
  async chat(_r: ChatRequest): Promise<ChatResponse> {
    return { message: { role: 'assistant', content: 'stub' }, usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop', modelId: this.id };
  }
  async *chatStream(r: ChatRequest): AsyncIterable<ChatChunk> {
    this.systemPrompts.push(r.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'));
    yield { type: 'text_delta', textDelta: 'ok' };
    yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 }, modelId: this.id };
  }
}

async function agentSystemPromptFor(prompt: string): Promise<string> {
  const registry = new ModelRegistry();
  const stub = new CaptureAdapter();
  registry.register(stub);
  const svc = new ChatService(createDb(':memory:'), registry);
  const convId = svc.createConversation('vai:v0', undefined, 'agent');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of svc.sendMessage(convId, prompt)) { /* drain */ }
  return stub.systemPrompts.join('\n');
}

describe('agentIntentLeadDirective — intent-conditions the Agent prompt', () => {
  it('emits an answer-first, no-scaffold directive on an ANSWER turn', () => {
    const d = agentIntentLeadDirective('answer');
    expect(d).toContain('QUESTION / DISCUSSION, NOT A BUILD');
    expect(d).toContain('Do NOT scaffold');
    expect(d.toLowerCase()).toContain('package.json');
    expect(d).toContain('canned starter');
  });

  it('is a NO-OP for build turns (build prompt unchanged)', () => {
    expect(agentIntentLeadDirective('build')).toBe('');
  });

  it('is a NO-OP for ambiguous turns (desktop confirm-banner handles those)', () => {
    expect(agentIntentLeadDirective('ambiguous')).toBe('');
  });

  it('the directive is designed to lead (sit ABOVE) the build-heavy agent prompt', () => {
    // Sanity: the agent prompt really does carry the build-imperatives the lead
    // must counter — so this test fails loudly if the prompt is ever rewritten in
    // a way that removes the hazard (and the lead becomes dead weight).
    const agent = CONVERSATION_MODE_SYSTEM_PROMPTS.agent;
    expect(agent).toContain('output the COMPLETE working application files');
    const lead = agentIntentLeadDirective('answer');
    // The lead explicitly scopes those instructions to real build turns.
    expect(lead).toContain('apply only when the user actually asks to build');
  });
});

describe('agent-mode prompt is intent-conditioned live (the todo-app hijack fix)', () => {
  it('an ANSWER question in agent mode gets the no-scaffold lead directive', async () => {
    // The exact failure class from the screenshot.
    const sys = await agentSystemPromptFor('What are great tools for computer intelligence to use?');
    expect(sys).toContain('QUESTION / DISCUSSION, NOT A BUILD');
    expect(sys).toContain('Do NOT scaffold');
  });

  it('a real BUILD request in agent mode does NOT get the anti-build lead (build prompt intact)', async () => {
    const sys = await agentSystemPromptFor('build me a Next.js todo app with Tailwind');
    expect(sys).not.toContain('QUESTION / DISCUSSION, NOT A BUILD');
    // The build guidance is still present for genuine builds.
    expect(sys).toContain('output the COMPLETE working application files');
  });
});
