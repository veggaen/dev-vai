import { describe, expect, it, vi } from 'vitest';
import { reachConsensus, runCouncil, convene, toCouncilThinking } from './council.js';
import { routeTopic, selectMembers } from './topic-router.js';
import { createCouncilMember, parseCouncilNote } from './member.js';
import type { CouncilInput, CouncilMember, CouncilMemberNote } from './types.js';
import type { ChatRequest, ChatResponse, ModelAdapter } from '../models/adapter.js';

const INPUT: CouncilInput = {
  prompt: 'can you give me number for pb hommersåk?',
  draft: "I'm sorry, \"pb hommersåk\" doesn't provide enough context. Could you specify what it refers to?",
  modelId: 'local:qwen2.5:7b',
  turnKind: 'other',
  hasEvidence: false,
  sources: [],
};

function note(p: Partial<CouncilMemberNote> & Pick<CouncilMemberNote, 'verdict'>): CouncilMemberNote {
  return {
    memberId: p.memberId ?? 'm',
    memberName: p.memberName ?? 'Member',
    topic: p.topic ?? 'local',
    verdict: p.verdict,
    confidence: p.confidence ?? 0.8,
    realIntent: p.realIntent ?? '',
    hiddenMeaning: p.hiddenMeaning ?? '',
    missingCapability: p.missingCapability ?? '',
    suggestedAction: p.suggestedAction ?? 'answer-directly',
    searchQuery: p.searchQuery ?? '',
    methodLesson: p.methodLesson ?? '',
    concerns: p.concerns ?? [],
    durationMs: p.durationMs ?? 1,
    error: p.error,
  };
}

function stubAdapter(reply: string, onReq?: (r: ChatRequest) => void): ModelAdapter {
  return {
    id: 'local:qwen2.5:7b',
    displayName: 'Qwen 2.5 7B',
    supportsStreaming: false,
    supportsToolUse: false,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      onReq?.(request);
      return { message: { role: 'assistant', content: reply }, usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' };
    },
    async *chatStream() { yield { type: 'done' as const }; },
  };
}

describe('routeTopic', () => {
  it('routes a local-business contact ask to "local"', () => {
    expect(routeTopic('can you give me number for pb hommersåk?')).toBe('local');
    expect(routeTopic('best pizza near me')).toBe('local');
  });
  it('routes code, reasoning, factual, chitchat', () => {
    expect(routeTopic('why does my async function throw a null pointer in typescript?')).toBe('code');
    expect(routeTopic('explain the difference between TCP and UDP')).toBe('reasoning');
    expect(routeTopic('what is the capital of Norway?')).toBe('factual');
    expect(routeTopic('hey')).toBe('chitchat');
  });
});

describe('selectMembers', () => {
  const a = note({ verdict: 'good' });
  const m = (id: string): CouncilMember => ({ id, displayName: id, topic: 'local', review: async () => ({ ...a, memberId: id }) });
  it('prefers the topic roster, then default, de-duping by id', () => {
    const roster = { byTopic: { local: [m('local-1')] }, default: [m('local-1'), m('base')] };
    expect(selectMembers('local', roster).map((x) => x.id)).toEqual(['local-1', 'base']);
    expect(selectMembers('code', roster).map((x) => x.id)).toEqual(['local-1', 'base']); // falls back to default
  });
});

describe('reachConsensus', () => {
  it('ships when members agree the draft is good and no action is needed', () => {
    const c = reachConsensus([note({ verdict: 'good' }), note({ verdict: 'good', memberId: 'm2' })]);
    expect(c.outcome).toBe('ship');
    expect(c.agreement).toBe(1);
    expect(c.memberIds).toEqual(['m', 'm2']);
  });

  it('says ACT with a search query when members agree a lookup is needed', () => {
    const c = reachConsensus([
      note({ verdict: 'needs-work', confidence: 0.6, suggestedAction: 'local-business-search', searchQuery: 'pizzabakeren hommersåk phone', realIntent: 'phone number of a local pizza place', missingCapability: 'local listing search', methodLesson: 'search for local references' }),
      note({ verdict: 'needs-work', memberId: 'm2', confidence: 0.8, suggestedAction: 'local-business-search', searchQuery: 'pb hommersåk number' }),
    ]);
    expect(c.outcome).toBe('act');
    expect(c.recommendedAction).toBe('local-business-search');
    expect(c.searchQuery).toBe('pb hommersåk number'); // highest-confidence member's query
    expect(c.realIntent).toMatch(/phone number/i);
    expect(c.missingCapabilities).toContain('local listing search');
  });

  it('escalates when the council is split (low agreement)', () => {
    const c = reachConsensus([
      note({ verdict: 'good', suggestedAction: 'answer-directly' }),
      note({ verdict: 'bad', memberId: 'm2', suggestedAction: 'answer-directly' }),
    ]);
    expect(c.outcome).toBe('escalate');
  });

  it('escalates when members agree it is not good but offer no concrete fix', () => {
    const c = reachConsensus([
      note({ verdict: 'bad', suggestedAction: 'answer-directly' }),
      note({ verdict: 'bad', memberId: 'm2', suggestedAction: 'answer-directly' }),
    ]);
    expect(c.outcome).toBe('escalate');
  });

  it('quarantines facts: only routing/method fields surface, never a member answer', () => {
    const c = reachConsensus([
      note({ verdict: 'needs-work', suggestedAction: 'local-business-search', searchQuery: 'q', methodLesson: 'fish', missingCapability: 'search' }),
    ]);
    // The consensus object exposes no field that could carry a member-authored answer.
    expect(Object.keys(c)).not.toContain('answer');
    expect(c.methodLessons).toEqual(['fish']);
  });

  it('ships honestly when no member returned a usable note', () => {
    const c = reachConsensus([note({ verdict: 'bad', error: 'timeout' })]);
    expect(c.outcome).toBe('ship');
    expect(c.memberIds).toEqual([]);
    expect(c.summary).toMatch(/no council member returned a usable view/i);
  });

  it('an errored leader note does NOT pollute realIntent or the action (BTC-trace fix)', () => {
    // A failed Grok leader emitting "advisor unavailable" must be excluded; the LOCAL
    // members' real verdict + web-search recommendation must win.
    const c = reachConsensus([
      note({ verdict: 'needs-work', memberId: 'grok', error: 'grok-direct unavailable: 403', realIntent: 'Grok direct advisor unavailable for this review' }),
      note({ verdict: 'needs-work', memberId: 'qwen3', confidence: 0.9, realIntent: 'User wants the current price of Bitcoin', suggestedAction: 'web-search', searchQuery: 'btc price today' }),
    ]);
    expect(c.realIntent).toBe('User wants the current price of Bitcoin');
    expect(c.realIntent).not.toMatch(/unavailable/i);
    expect(c.recommendedAction).toBe('web-search');
    expect(c.searchQuery).toBe('btc price today');
  });

  it('surfaces a member searchQuery even when the modal action is not web-search', () => {
    // One member wants web-search; the consensus exposes its searchQuery so the service
    // can ACT on it (the directed-search trigger broadened in fetchCouncilDirectedEvidence).
    const c = reachConsensus([
      note({ verdict: 'needs-work', memberId: 'a', confidence: 0.9, suggestedAction: 'answer-directly' }),
      note({ verdict: 'needs-work', memberId: 'b', confidence: 0.6, suggestedAction: 'web-search', searchQuery: 'btc price now' }),
    ]);
    expect(c.searchQuery).toBe('btc price now');
  });
});

describe('runCouncil / convene', () => {
  it('runs members in parallel and tolerates one throwing', async () => {
    const good: CouncilMember = { id: 'g', displayName: 'G', topic: 'local', review: async () => note({ verdict: 'good', memberId: 'g' }) };
    const bad: CouncilMember = { id: 'b', displayName: 'B', topic: 'local', review: async () => { throw new Error('boom'); } };
    const onConsensus = vi.fn();
    const c = await runCouncil([good, bad], INPUT, { onConsensus });
    expect(c.memberIds).toEqual(['g']);
    expect(c.notes.find((n) => n.memberId === 'b')?.error).toBe('boom');
    expect(onConsensus).toHaveBeenCalledOnce();
  });

  it('records a member timeout as a non-blocking failure', async () => {
    const slow: CouncilMember = { id: 's', displayName: 'S', topic: 'local', review: () => new Promise(() => {}) };
    const c = await runCouncil([slow], INPUT, { timeoutMs: 10 });
    expect(c.memberIds).toEqual([]);
    expect(c.notes[0].error).toMatch(/timed out/i);
    expect(c.outcome).toBe('ship'); // a member that didn't answer can't block
  });

  it('convene routes the topic and runs the roster', async () => {
    const member: CouncilMember = { id: 'q', displayName: 'Q', topic: 'local', review: async () => note({ verdict: 'needs-work', memberId: 'q', suggestedAction: 'local-business-search', searchQuery: 'x' }) };
    const { topic, consensus } = await convene(INPUT, { default: [member] });
    expect(topic).toBe('local');
    expect(consensus.outcome).toBe('act');
  });
});

describe('toCouncilThinking', () => {
  it('projects a consensus into the UI block without leaking member facts', () => {
    const c = reachConsensus([note({ verdict: 'needs-work', memberName: 'Qwen 2.5 7B', suggestedAction: 'local-business-search', searchQuery: 'x', realIntent: 'wants a phone number' })]);
    const ui = toCouncilThinking('local', c);
    expect(ui.topic).toBe('local');
    expect(ui.members[0]).toMatchObject({ name: 'Qwen 2.5 7B', action: 'local-business-search', verdict: 'needs-work' });
    expect(ui.recommendedAction).toBe('local-business-search');
  });
});

describe('createCouncilMember', () => {
  it('asks the model to review-only and parses its JSON note', async () => {
    let seen: ChatRequest | undefined;
    const adapter = stubAdapter(JSON.stringify({
      verdict: 'needs-work', confidence: 0.8,
      realIntent: 'phone number of a local pizza place', hiddenMeaning: '',
      missingCapability: 'local listing search', suggestedAction: 'local-business-search',
      searchQuery: 'pizzabakeren hommersåk phone', methodLesson: 'search for local references', concerns: ['off-topic'],
    }), (r) => { seen = r; });
    const member = createCouncilMember({ adapter, topic: 'local' });
    const n = await member.review(INPUT);
    expect(seen?.messages[0].content).toMatch(/do NOT assert facts/i);
    expect(n).toMatchObject({ verdict: 'needs-work', suggestedAction: 'local-business-search', topic: 'local' });
    expect(n?.searchQuery).toMatch(/pizzabakeren/i);
  });

  it('returns null on unparseable output and tolerates a fenced block', async () => {
    expect(await createCouncilMember({ adapter: stubAdapter('no idea, sorry'), topic: 'local' }).review(INPUT)).toBeNull();
    const fenced = '```json\n{"verdict":"good","confidence":0.9,"suggestedAction":"answer-directly"}\n```';
    expect((await createCouncilMember({ adapter: stubAdapter(fenced), topic: 'local' }).review(INPUT))?.verdict).toBe('good');
  });

  it('clamps an out-of-range confidence', () => {
    const n = parseCouncilNote('{"verdict":"good","confidence":9,"suggestedAction":"answer-directly"}', { memberId: 'x', memberName: 'X', topic: 'factual', durationMs: 1 });
    expect(n?.confidence).toBe(1);
  });
});
