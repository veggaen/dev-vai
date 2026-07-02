import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db/client.js';
import { ChatService } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import { createCouncilMember } from '../src/consensus/member.js';
import type { CouncilRoster } from '../src/consensus/topic-router.js';

/**
 * Guards the VRAM-aware council residency fix.
 *
 * Bug: on a 12GB GPU (~4.5GB free) a full 3-model sequential council cold-loads each
 * ~8GB model after evicting the previous one — 60-90s of pure model-swapping, which
 * made balanced chat turns TIME OUT with empty answers. Fix: cap balanced turns to a
 * single (fastest-resident) council member; keep the full panel only for 'deep'.
 */

// A registry that reports the 3 local council models so createCouncilMember can build them.
function makeRoster(): CouncilRoster {
  const reg = new ModelRegistry();
  // slowThinking is derived from the model id (deepseek/qwen3-thinking etc.) inside member.ts;
  // we build members directly with the adapter-less form used elsewhere in tests.
  const mk = (id: string, thinking = false) => createCouncilMember({
    adapter: {
      id, displayName: id, supportsStreaming: false, supportsToolUse: false,
      // Thinking models (DeepSeek-R1) advertise extendedThinking — that's what flags them
      // slowThinking, which the balanced cap deprioritizes.
      capabilities: { extendedThinking: thinking },
      async chat() { return { message: { role: 'assistant', content: '{}' }, usage: { promptTokens: 0, completionTokens: 0 }, finishReason: 'stop' }; },
    } as never,
    topic: 'reasoning',
  });
  void reg;
  return {
    default: [
      mk('local:deepseek-r1:8b', true), // slow-thinking (heaviest) — listed FIRST
      mk('local:qwen3:8b'),
      mk('local:qwen2.5:7b'),
    ],
  };
}

function svcWithRoster(): ChatService {
  const svc = new ChatService(createDb(':memory:'), new ModelRegistry());
  (svc as unknown as { councilRoster: CouncilRoster }).councilRoster = makeRoster();
  return svc;
}

const selectionForDepth = (svc: ChatService, depth: 'quick' | 'balanced' | 'deep', prompt = 'Explain this tradeoff') => {
  (svc as unknown as { turnProcessDepth: string }).turnProcessDepth = depth;
  return (svc as unknown as {
    councilRosterSelectionForDepth(prompt?: string): {
      roster: CouncilRoster;
      delegationLog?: readonly { label: string; body?: string }[];
    };
  }).councilRosterSelectionForDepth(prompt);
};

const rosterForDepth = (svc: ChatService, depth: 'quick' | 'balanced' | 'deep', prompt?: string) =>
  selectionForDepth(svc, depth, prompt).roster;

describe('councilRosterSelectionForDepth (VRAM-aware residency)', () => {
  it('deep keeps the full 3-model panel', () => {
    const svc = svcWithRoster();
    expect(rosterForDepth(svc, 'deep').default.length).toBe(3);
  });

  it('balanced caps to a single member (no multi-model cold-cycle)', () => {
    const svc = svcWithRoster();
    const roster = rosterForDepth(svc, 'balanced');
    expect(roster.default.length).toBe(1);
  });

  it('balanced prefers a NON-slow-thinking model (fastest to keep resident)', () => {
    const svc = svcWithRoster();
    const only = rosterForDepth(svc, 'balanced').default[0];
    // deepseek-r1 is the slow-thinking one; it must NOT be the single balanced reviewer.
    expect(only.slowThinking ?? false).toBe(false);
    expect(only.id).not.toContain('deepseek');
  });

  it('respects VAI_COUNCIL_BALANCED_MEMBERS override', () => {
    const prev = process.env.VAI_COUNCIL_BALANCED_MEMBERS;
    process.env.VAI_COUNCIL_BALANCED_MEMBERS = '2';
    try {
      const svc = svcWithRoster();
      expect(rosterForDepth(svc, 'balanced').default.length).toBe(2);
    } finally {
      if (prev === undefined) delete process.env.VAI_COUNCIL_BALANCED_MEMBERS;
      else process.env.VAI_COUNCIL_BALANCED_MEMBERS = prev;
    }
  });

  it('balanced exposes a visible delegation reason for the process trace', () => {
    const svc = svcWithRoster();
    const selection = selectionForDepth(svc, 'balanced', 'Please explain the code tradeoff');
    expect(selection.delegationLog?.[0]?.label).toBe('Reviewer delegation');
    expect(selection.delegationLog?.[0]?.body).toContain('Routed this turn as code');
    expect(selection.delegationLog?.[0]?.body).toContain('asked 1/3 reviewers');
  });
});
