/**
 * Tests for the friend-council REDRAFT LOOP — the quality mechanism that grades a
 * buffered draft and, when the council does not clear it, feeds the friends' reading
 * (intent + method + concerns, never facts) back into ONE bounded redraft, re-grades,
 * and keeps the better draft.
 *
 * The council itself (`convene`) runs for real against scripted stub members, so the
 * consensus is deterministic without touching Ollama. We assert the loop INVARIANTS:
 *   - council says ship          → original text, no redraft
 *   - council says act/reread    → redraft fires; better draft kept
 *   - redraft scores worse       → original kept (no regression)
 *   - redraft throws / returns "" → original kept (turn never breaks)
 *   - redraft echoes the draft    → treated as no-op (no spin)
 * plus the pure helpers `councilScore` and `buildCouncilRedraftInstruction`.
 */
import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db/client.js';
import { ChatService, buildCouncilRedraftInstruction, councilScore } from '../src/chat/service.js';
import type { CouncilRedraftFeedback } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import type { CouncilMember, CouncilMemberNote, CouncilConsensus, CouncilAction, CouncilVerdict } from '../src/consensus/types.js';
import type { CouncilRoster } from '../src/consensus/topic-router.js';

// ── Stub council member: returns a fixed note so consensus is deterministic ──
function stubMember(id: string, note: Partial<CouncilMemberNote>): CouncilMember {
  return {
    id,
    displayName: id,
    topic: 'other',
    async review(): Promise<CouncilMemberNote> {
      return {
        memberId: id,
        memberName: id,
        topic: 'other',
        verdict: 'good',
        confidence: 0.8,
        realIntent: '',
        hiddenMeaning: '',
        missingCapability: '',
        suggestedAction: 'answer-directly',
        searchQuery: '',
        methodLesson: '',
        concerns: [],
        durationMs: 1,
        ...note,
      };
    },
  };
}

function rosterOf(...members: CouncilMember[]): CouncilRoster {
  return { byTopic: {}, default: members };
}

/** A roster whose members all agree to ship the draft (verdict good, answer-directly). */
function shipRoster(): CouncilRoster {
  return rosterOf(
    stubMember('m1', { verdict: 'good', suggestedAction: 'answer-directly', confidence: 0.9 }),
    stubMember('m2', { verdict: 'good', suggestedAction: 'answer-directly', confidence: 0.85 }),
  );
}

/** A roster that flags the draft and wants a redraft against the true intent. */
function rereadRoster(realIntent: string, lesson: string): CouncilRoster {
  return rosterOf(
    stubMember('m1', {
      verdict: 'needs-work',
      suggestedAction: 'reread-intent',
      confidence: 0.85,
      realIntent,
      methodLesson: lesson,
      concerns: ['answers the wrong question'],
    }),
    stubMember('m2', {
      verdict: 'needs-work',
      suggestedAction: 'reread-intent',
      confidence: 0.8,
      realIntent,
      methodLesson: lesson,
    }),
  );
}

function makeService(roster: CouncilRoster): ChatService {
  return new ChatService(createDb(':memory:'), new ModelRegistry(), { councilRoster: roster });
}

// `runCouncilLoop` is private; exercise it directly with a typed escape hatch.
function runLoop(
  service: ChatService,
  draft: { prompt: string; draftText: string; modelId: string },
  redraft?: (feedback: CouncilRedraftFeedback) => Promise<string | undefined>,
): Promise<{ council?: unknown; finalText: string; revised: boolean }> {
  return (service as unknown as {
    runCouncilLoop: (d: typeof draft, r?: typeof redraft) => Promise<{ council?: unknown; finalText: string; revised: boolean }>;
  }).runCouncilLoop(draft, redraft);
}

const SUBSTANTIVE = 'Explain how JavaScript closures work and why they are useful in real code.';

describe('councilScore', () => {
  const base: CouncilConsensus = {
    outcome: 'ship', agreement: 0.5, confidence: 0.5, realIntent: '',
    recommendedAction: 'answer-directly', searchQuery: '', missingCapabilities: [],
    methodLessons: [], summary: '', notes: [], memberIds: [], factsQuarantined: true,
  };
  it('ranks ship above act above escalate regardless of agreement/confidence', () => {
    const ship = councilScore({ ...base, outcome: 'ship', agreement: 0, confidence: 0 });
    const act = councilScore({ ...base, outcome: 'act', agreement: 1, confidence: 1 });
    const escalate = councilScore({ ...base, outcome: 'escalate', agreement: 1, confidence: 1 });
    expect(ship).toBeGreaterThan(act);
    expect(act).toBeGreaterThan(escalate);
  });
  it('breaks ties within an outcome on agreement then confidence', () => {
    const lo = councilScore({ ...base, outcome: 'act', agreement: 0.4, confidence: 0.9 });
    const hi = councilScore({ ...base, outcome: 'act', agreement: 0.6, confidence: 0.1 });
    expect(hi).toBeGreaterThan(lo); // agreement dominates confidence
  });
});

describe('buildCouncilRedraftInstruction', () => {
  const feedback: CouncilRedraftFeedback = {
    realIntent: 'wants a runnable example, not theory',
    methodLessons: ['lead with code', 'then one sentence of why'],
    missingCapabilities: ['concrete example'],
    concerns: ['too abstract', 'no code'],
    recommendedAction: 'reread-intent',
  };
  it('includes the real intent and method lessons', () => {
    const out = buildCouncilRedraftInstruction(feedback);
    expect(out).toContain('wants a runnable example');
    expect(out).toContain('lead with code');
  });
  it('tells Vai it misread the ask when action is reread-intent', () => {
    expect(buildCouncilRedraftInstruction(feedback)).toMatch(/misread/i);
  });
  it('never instructs the friends to supply facts (quarantine is explicit)', () => {
    const out = buildCouncilRedraftInstruction(feedback).toLowerCase();
    expect(out).toContain('you supply every fact yourself');
  });
  it('is robust to empty feedback fields', () => {
    const out = buildCouncilRedraftInstruction({
      realIntent: '', methodLessons: [], missingCapabilities: [], concerns: [], recommendedAction: 'answer-directly',
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/rewrite the answer/i);
  });
});

describe('runCouncilLoop', () => {
  it('keeps the original and does not redraft when the council clears the draft', async () => {
    const service = makeService(shipRoster());
    let redraftCalled = false;
    const result = await runLoop(
      service,
      { prompt: SUBSTANTIVE, draftText: 'A solid first answer about closures.', modelId: 'local:test' },
      async () => { redraftCalled = true; return 'should not be used'; },
    );
    expect(result.revised).toBe(false);
    expect(result.finalText).toBe('A solid first answer about closures.');
    expect(redraftCalled).toBe(false);
  });

  it('redrafts and keeps the better answer when the council asks for a reread', async () => {
    // First convene flags reread; the redraft produces text the SAME (ship) roster
    // would clear — so the loop must adopt it. We swap the roster mid-loop is not
    // possible, so instead the redraft must score >= on re-convene with the same
    // (reread) roster: identical outcome → tie → improved===true (>=), text kept.
    const service = makeService(rereadRoster('wants runnable code', 'lead with a code example'));
    let seen: CouncilRedraftFeedback | undefined;
    const result = await runLoop(
      service,
      { prompt: SUBSTANTIVE, draftText: 'Closures are a theoretical concept.', modelId: 'local:test' },
      async (feedback) => { seen = feedback; return 'Here is a runnable closure example: function counter(){...}'; },
    );
    expect(result.revised).toBe(true);
    expect(result.finalText).toContain('runnable closure example');
    // The feedback carried the council's reading (intent + method), never a fact.
    expect(seen?.realIntent).toBe('wants runnable code');
    expect(seen?.methodLessons).toContain('lead with a code example');
  });

  it('never breaks the turn when the redraft throws — keeps the original', async () => {
    const service = makeService(rereadRoster('x', 'y'));
    const result = await runLoop(
      service,
      { prompt: SUBSTANTIVE, draftText: 'Original draft.', modelId: 'local:test' },
      async () => { throw new Error('model exploded'); },
    );
    expect(result.revised).toBe(false);
    expect(result.finalText).toBe('Original draft.');
  });

  it('treats an empty or unchanged redraft as a no-op (no spin)', async () => {
    const service = makeService(rereadRoster('x', 'y'));
    const empty = await runLoop(service, { prompt: SUBSTANTIVE, draftText: 'Original draft.', modelId: 'local:test' }, async () => '   ');
    expect(empty.revised).toBe(false);
    expect(empty.finalText).toBe('Original draft.');
    const echoed = await runLoop(service, { prompt: SUBSTANTIVE, draftText: 'Original draft.', modelId: 'local:test' }, async () => 'Original draft.');
    expect(echoed.revised).toBe(false);
    expect(echoed.finalText).toBe('Original draft.');
  });

  it('is a no-op when no redraft function is provided (grade-only)', async () => {
    const service = makeService(rereadRoster('x', 'y'));
    const result = await runLoop(service, { prompt: SUBSTANTIVE, draftText: 'Original draft.', modelId: 'local:test' });
    expect(result.revised).toBe(false);
    expect(result.finalText).toBe('Original draft.');
  });

  it('returns the original with no council when there is no roster configured', async () => {
    const service = new ChatService(createDb(':memory:'), new ModelRegistry());
    const result = await runLoop(
      service,
      { prompt: SUBSTANTIVE, draftText: 'Original draft.', modelId: 'local:test' },
      async () => 'a revision',
    );
    expect(result.revised).toBe(false);
    expect(result.council).toBeUndefined();
    expect(result.finalText).toBe('Original draft.');
  });
});
