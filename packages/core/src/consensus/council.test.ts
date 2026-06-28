import { describe, expect, it, vi } from 'vitest';
import { reachConsensus, runCouncil, convene, toCouncilThinking, runCouncilStreaming, conveneStreaming } from './council.js';
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

  it('surfaces a serious minority dissent even when the modal verdict ships', () => {
    // Split panel: 3 'good' (answer-directly) ship the draft, but 1 strong member returns
    // 'bad' with a real concern. The outcome still ships (modal logic unchanged), yet the
    // objection must be AUDITABLE on consensus.dissent — never silently buried in notes[].
    const c = reachConsensus([
      note({ verdict: 'good', memberId: 'a', suggestedAction: 'answer-directly' }),
      note({ verdict: 'good', memberId: 'b', suggestedAction: 'answer-directly' }),
      note({ verdict: 'good', memberId: 'c', suggestedAction: 'answer-directly' }),
      note({ verdict: 'bad', memberId: 'd', memberName: 'Skeptic', confidence: 0.9, concerns: ['unsupported claim about latency'] }),
    ]);
    expect(c.outcome).toBe('ship'); // modal logic intentionally unchanged
    expect(c.dissent?.hasDissent).toBe(true);
    expect(c.dissent?.dissentingMembers).toHaveLength(1);
    expect(c.dissent?.dissentingMembers[0].memberId).toBe('d');
    expect(c.dissent?.dissentingMembers[0].concerns).toContain('unsupported claim about latency');
    expect(c.dissent?.dissentStrength).toBeCloseTo(0.25, 2); // 1 of 4 equal-weight members
  });

  it('does NOT surface dissent below the weight threshold (noise floor)', () => {
    // A lone low-share dissenter among many shippers stays below DISSENT_MIN_WEIGHT (0.2).
    const c = reachConsensus([
      note({ verdict: 'good', memberId: 'a' }), note({ verdict: 'good', memberId: 'b' }),
      note({ verdict: 'good', memberId: 'c' }), note({ verdict: 'good', memberId: 'e' }),
      note({ verdict: 'good', memberId: 'f' }),
      note({ verdict: 'bad', memberId: 'd' }), // 1 of 6 = 0.167 < 0.2
    ]);
    expect(c.dissent).toBeUndefined();
  });

  it('omits dissent entirely when the panel is unanimous good', () => {
    const c = reachConsensus([note({ verdict: 'good', memberId: 'a' }), note({ verdict: 'good', memberId: 'b' })]);
    expect(c.dissent).toBeUndefined();
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

  it('extends the outer per-member timeout for a slowThinking member (deepseek fix)', async () => {
    vi.useFakeTimers();
    try {
      // A reasoning member that resolves at 50s — past the 30s base cap, but within the 60s
      // slow-thinking floor. A non-thinking member with the same base cap would be aborted.
      const deep: CouncilMember = {
        id: 'deepseek-r1:8b', displayName: 'DeepSeek-R1', topic: 'reasoning', slowThinking: true,
        review: () => new Promise((resolve) => setTimeout(() => resolve(note({ verdict: 'needs-work', memberId: 'deepseek-r1:8b', topic: 'reasoning' })), 50_000)),
      };
      const p = runCouncil([deep], INPUT, { timeoutMs: 30_000 });
      await vi.advanceTimersByTimeAsync(55_000);
      const c = await p;
      expect(c.notes[0].error).toBeUndefined();
      expect(c.memberIds).toContain('deepseek-r1:8b');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT extend the outer timeout for a non-thinking member (stays bounded)', async () => {
    vi.useFakeTimers();
    try {
      const slow: CouncilMember = {
        id: 'qwen', displayName: 'Qwen', topic: 'local', // no slowThinking
        review: () => new Promise((resolve) => setTimeout(() => resolve(note({ verdict: 'good', memberId: 'qwen' })), 50_000)),
      };
      const p = runCouncil([slow], INPUT, { timeoutMs: 30_000 });
      await vi.advanceTimersByTimeAsync(35_000);
      const c = await p;
      expect(c.notes[0].error).toMatch(/timed out after 30000ms/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('convene routes the topic and runs the roster', async () => {
    const member: CouncilMember = { id: 'q', displayName: 'Q', topic: 'local', review: async () => note({ verdict: 'needs-work', memberId: 'q', suggestedAction: 'local-business-search', searchQuery: 'x' }) };
    const { topic, consensus } = await convene(INPUT, { default: [member] });
    expect(topic).toBe('local');
    expect(consensus.outcome).toBe('act');
  });

  it('overall deadline stops asking new members but always hears the first (anti-stall)', async () => {
    // A controllable clock: each note bumps the clock past the deadline so member 2+ is
    // skipped — the buffered answer ships from member 1 instead of waiting on the panel.
    let clock = 1000;
    const advancingReview = (id: string) => async () => { clock += 100; return note({ verdict: 'good', memberId: id }); };
    const members: CouncilMember[] = [
      { id: 'm1', displayName: 'M1', topic: 'local', review: advancingReview('m1') },
      { id: 'm2', displayName: 'M2', topic: 'local', review: advancingReview('m2') },
      { id: 'm3', displayName: 'M3', topic: 'local', review: advancingReview('m3') },
    ];
    const stream = runCouncilStreaming(members, INPUT, { now: () => clock, overallDeadlineMs: 50 });
    let iter = await stream.next();
    while (!iter.done) iter = await stream.next();
    const consensus = iter.value;
    // First member always heard; the deadline (50ms, already blown after m1's +100) cuts the rest.
    expect(consensus.memberIds).toEqual(['m1']);
  });

  it('fast-first ordering: a slow-thinking member placed first does not starve faster ones', async () => {
    // Under a budget, a slowThinking member listed first must be deferred so the fast members are
    // heard within the deadline (the measured "configured 3, only 2 ever speak" gap). The slow one
    // runs last if time remains. We model cost via the clock: slow advances past the deadline.
    let clock = 1000;
    const fastReview = (id: string) => async () => { clock += 10; return note({ verdict: 'good', memberId: id }); };
    const slowReview = (id: string) => async () => { clock += 1000; return note({ verdict: 'good', memberId: id }); };
    const members: CouncilMember[] = [
      { id: 'slow', displayName: 'Slow', topic: 'reasoning', slowThinking: true, review: slowReview('slow') },
      { id: 'fast1', displayName: 'Fast1', topic: 'code', review: fastReview('fast1') },
      { id: 'fast2', displayName: 'Fast2', topic: 'local', review: fastReview('fast2') },
    ];
    const stream = runCouncilStreaming(members, INPUT, { now: () => clock, overallDeadlineMs: 100 });
    let iter = await stream.next();
    while (!iter.done) iter = await stream.next();
    // Both fast members are heard first; the slow one runs last (and here still fits before the
    // deadline check for the NEXT member, which there is none of). Crucially fast1+fast2 are in.
    expect(iter.value.memberIds).toContain('fast1');
    expect(iter.value.memberIds).toContain('fast2');
    // The slow member no longer monopolizes the budget and exclude the others.
    expect(iter.value.memberIds.length).toBeGreaterThanOrEqual(2);
  });

  it('with no overall deadline, every member is heard', async () => {
    let clock = 1000;
    const advancingReview = (id: string) => async () => { clock += 100; return note({ verdict: 'good', memberId: id }); };
    const members: CouncilMember[] = [
      { id: 'm1', displayName: 'M1', topic: 'local', review: advancingReview('m1') },
      { id: 'm2', displayName: 'M2', topic: 'local', review: advancingReview('m2') },
    ];
    const stream = runCouncilStreaming(members, INPUT, { now: () => clock });
    let iter = await stream.next();
    while (!iter.done) iter = await stream.next();
    expect([...iter.value.memberIds].sort()).toEqual(['m1', 'm2']);
  });

  describe('conveneStreaming deliberation (live path, flag-gated)', () => {
    // A split 2-member roster: m1 'good', m2 'bad' on round 1 → triggers a peer-aware round 2.
    const splitRoster = () => {
      const peerSeen: Record<string, boolean> = {};
      const member = (id: string, verdict: 'good' | 'bad'): CouncilMember => ({
        id, displayName: id, topic: 'local',
        async review(input) { peerSeen[id] = Boolean(input.peerNotes?.length); return note({ memberId: id, verdict }); },
      });
      return { roster: { default: [member('m1', 'good'), member('m2', 'bad')] }, peerSeen };
    };
    const drain = async (gen: ReturnType<typeof conveneStreaming>) => {
      let pendingEvents = 0; let it = await gen.next();
      while (!it.done) { if (it.value.pendingMember) pendingEvents++; it = await gen.next(); }
      return { pendingEvents, result: it.value };
    };

    it('OFF by default: a split panel runs ONE round only (no peer round)', async () => {
      delete process.env.VAI_COUNCIL_DELIBERATE;
      const { roster, peerSeen } = splitRoster();
      const { pendingEvents } = await drain(conveneStreaming(INPUT, roster));
      expect(pendingEvents).toBe(2);             // 2 members, one round
      expect(peerSeen.m1).toBe(false);           // nobody saw peers
      expect(peerSeen.m2).toBe(false);
    });

    it('ON: a split panel runs a SECOND peer-aware round (members see peerNotes), streamed', async () => {
      const prev = process.env.VAI_COUNCIL_DELIBERATE;
      process.env.VAI_COUNCIL_DELIBERATE = '1';
      try {
        const { roster, peerSeen } = splitRoster();
        const { pendingEvents } = await drain(conveneStreaming(INPUT, roster));
        expect(pendingEvents).toBe(4);           // 2 members × 2 rounds, all streamed
        expect(peerSeen.m1).toBe(true);          // round 2 injected peer notes
        expect(peerSeen.m2).toBe(true);
      } finally {
        if (prev === undefined) delete process.env.VAI_COUNCIL_DELIBERATE; else process.env.VAI_COUNCIL_DELIBERATE = prev;
      }
    });

    it('ON but unanimous: no second round (nothing to deliberate)', async () => {
      const prev = process.env.VAI_COUNCIL_DELIBERATE;
      process.env.VAI_COUNCIL_DELIBERATE = '1';
      try {
        const m = (id: string): CouncilMember => ({ id, displayName: id, topic: 'local', review: async () => note({ memberId: id, verdict: 'good' }) });
        const { pendingEvents } = await drain(conveneStreaming(INPUT, { default: [m('m1'), m('m2')] }));
        expect(pendingEvents).toBe(2);           // unanimous → single round
      } finally {
        if (prev === undefined) delete process.env.VAI_COUNCIL_DELIBERATE; else process.env.VAI_COUNCIL_DELIBERATE = prev;
      }
    });
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

  it('attaches the verification spine (provenance) when members fetched context', () => {
    const grounded = { ...note({ verdict: 'good', memberId: 'a' }), contextLedger: {
      used: 1, unused: 1, unavailable: 0,
      items: [
        { label: 'readFile src/x.ts', state: 'used', reason: '' },
        { label: 'grep /Y/', state: 'unused', reason: '' },
      ],
    } } as any;
    const ui = toCouncilThinking('other', reachConsensus([grounded]));
    expect(ui.provenance).toBeTruthy();
    expect(ui.provenance!.total).toBe(2);
    expect(ui.provenance!.counts.used).toBe(1);
    expect(ui.provenance!.verdict).toBe('grounded'); // 1/2 used >= 0.34
  });

  it('omits provenance when no member fetched context (prompt-only review)', () => {
    const ui = toCouncilThinking('other', reachConsensus([note({ verdict: 'good' })]));
    expect(ui.provenance).toBeUndefined();
  });

  it('spine is advisory-only — never changes the outcome (no second gate)', () => {
    // A grounded ledger; the spine reports provenance but must NOT touch outcome. The
    // ship/refuse decision on a web contradiction is owned upstream by applyCrossCheck.
    const n = { ...note({ verdict: 'good', memberId: 'a' }), contextLedger: {
      used: 1, unused: 0, unavailable: 0, items: [{ label: 'readFile x.ts', state: 'used', reason: '' }],
    } } as any;
    const consensus = reachConsensus([n]);
    const ui = toCouncilThinking('other', consensus);
    expect(ui.provenance?.verdict).toBe('grounded');
    expect(ui.outcome).toBe(consensus.outcome); // outcome is passed through unchanged
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

  // The "council not working" bug: members ANSWERED but a variant verdict word or wrapping made the
  // strict parse discard the whole note → 0 usable → council rubber-stamped the draft.
  const meta = { memberId: 'x', memberName: 'X', topic: 'factual' as const, durationMs: 1 };
  it('SALVAGE: a variant verdict word is normalised, not discarded', () => {
    expect(parseCouncilNote('{"verdict":"ok","confidence":0.8}', meta)?.verdict).toBe('good');
    expect(parseCouncilNote('{"verdict":"approve"}', meta)?.verdict).toBe('good');
    expect(parseCouncilNote('{"verdict":"reject"}', meta)?.verdict).toBe('bad');
    expect(parseCouncilNote('{"verdict":"meh"}', meta)?.verdict).toBe('needs-work');
  });
  it('SALVAGE: a note with a MISSING verdict still counts (defaults needs-work, not null)', () => {
    const n = parseCouncilNote('{"confidence":0.7,"realIntent":"compare frameworks"}', meta);
    expect(n).not.toBeNull();
    expect(n?.verdict).toBe('needs-work');
    expect(n?.realIntent).toBe('compare frameworks');
  });
  it('SALVAGE: JSON wrapped in <think> blocks and prose is still extracted', () => {
    const raw = '<think>I should rate this good because the draft is solid {not this brace}</think>\nHere is my note:\n```json\n{"verdict":"good","confidence":0.9}\n```';
    const n = parseCouncilNote(raw, meta);
    expect(n?.verdict).toBe('good');
    expect(n?.confidence).toBe(0.9);
  });
});
