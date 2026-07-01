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
import { ChatService, buildCouncilRedraftInstruction, councilScore, redraftResolvedConcern } from '../src/chat/service.js';
import type { CouncilRedraftFeedback } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import { InMemoryGuidanceStore, salientTokens, selectApplicableGuidance } from '../src/chat/route-guidance.js';
import type { CouncilMember, CouncilMemberNote, CouncilConsensus } from '../src/consensus/types.js';
import type { CouncilRoster } from '../src/consensus/topic-router.js';

// ── Stub council member: returns a fixed note so consensus is deterministic ──
function stubMember(id: string, note: Partial<CouncilMemberNote>, delayMs = 0): CouncilMember {
  return {
    id,
    displayName: id,
    topic: 'other',
    async review(): Promise<CouncilMemberNote> {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
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
const COUNCIL_LOOP_TIMEOUT_MS = 20_000;

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

describe('redraftResolvedConcern — outcome-aware acceptance (council self-eval upgrade)', () => {
  const base: CouncilConsensus = {
    outcome: 'act', agreement: 0.6, confidence: 0.6, realIntent: '',
    recommendedAction: 'reread-intent', searchQuery: '', missingCapabilities: [],
    methodLessons: [], summary: '', notes: [], memberIds: [], factsQuarantined: true,
  };

  it('falls back to score comparison when no specific gap was flagged', () => {
    const first = { ...base, missingCapabilities: [], agreement: 0.5 };
    const better = { ...base, missingCapabilities: [], agreement: 0.9 };
    const worse = { ...base, missingCapabilities: [], outcome: 'escalate' as const };
    expect(redraftResolvedConcern(first, better)).toBe(true);
    expect(redraftResolvedConcern(first, worse)).toBe(false);
  });

  it('REJECTS a redraft that raised agreement but left the flagged gap unresolved', () => {
    const first = { ...base, missingCapabilities: ['concrete code example'], agreement: 0.5 };
    // Higher score (agreement up) but the SAME gap is still named → must not win.
    const second = { ...base, missingCapabilities: ['concrete code example'], agreement: 0.95 };
    expect(councilScore(second)).toBeGreaterThan(councilScore(first)); // would have won under old rule
    expect(redraftResolvedConcern(first, second)).toBe(false);          // but not under outcome-aware rule
  });

  it('ACCEPTS a redraft that dropped the flagged gap without regressing', () => {
    const first = { ...base, missingCapabilities: ['concrete code example'], agreement: 0.6 };
    const second = { ...base, missingCapabilities: [], agreement: 0.6 };
    expect(redraftResolvedConcern(first, second)).toBe(true);
  });

  it('ACCEPTS when the redraft reached ship even if a gap was flagged', () => {
    const first = { ...base, missingCapabilities: ['x'], outcome: 'act' as const };
    const second = { ...base, missingCapabilities: [], outcome: 'ship' as const };
    expect(redraftResolvedConcern(first, second)).toBe(true);
  });

  it('REJECTS when the redraft escalated, regardless of gap state', () => {
    const first = { ...base, missingCapabilities: ['x'] };
    const second = { ...base, missingCapabilities: [], outcome: 'escalate' as const };
    expect(redraftResolvedConcern(first, second)).toBe(false);
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
  it('forbids re-hijacking the redraft into another scaffold/template on reread-intent', () => {
    // The screenshot bug: a mis-scaffolded todo app was "fixed" by swapping in a
    // jest-tests tutorial — still not the answer. The redraft must ban scaffolds.
    const out = buildCouncilRedraftInstruction(feedback).toLowerCase();
    expect(out).toContain('do not answer with a scaffolded app');
    expect(out).toContain('actually answers it');
  });
  it('does NOT add the anti-scaffold ban when the action is not reread-intent', () => {
    const out = buildCouncilRedraftInstruction({
      ...feedback, recommendedAction: 'web-search',
    }).toLowerCase();
    expect(out).not.toContain('scaffolded app');
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
  }, COUNCIL_LOOP_TIMEOUT_MS);

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
  }, COUNCIL_LOOP_TIMEOUT_MS);

  it('never breaks the turn when the redraft throws — keeps the original', async () => {
    const service = makeService(rereadRoster('x', 'y'));
    const result = await runLoop(
      service,
      { prompt: SUBSTANTIVE, draftText: 'Original draft.', modelId: 'local:test' },
      async () => { throw new Error('model exploded'); },
    );
    expect(result.revised).toBe(false);
    expect(result.finalText).toBe('Original draft.');
  }, COUNCIL_LOOP_TIMEOUT_MS);

  it('treats an empty or unchanged redraft as a no-op (no spin)', async () => {
    const service = makeService(rereadRoster('x', 'y'));
    const empty = await runLoop(service, { prompt: SUBSTANTIVE, draftText: 'Original draft.', modelId: 'local:test' }, async () => '   ');
    expect(empty.revised).toBe(false);
    expect(empty.finalText).toBe('Original draft.');
    const echoed = await runLoop(service, { prompt: SUBSTANTIVE, draftText: 'Original draft.', modelId: 'local:test' }, async () => 'Original draft.');
    expect(echoed.revised).toBe(false);
    expect(echoed.finalText).toBe('Original draft.');
  }, COUNCIL_LOOP_TIMEOUT_MS);

  it('is a no-op when no redraft function is provided (grade-only)', async () => {
    const service = makeService(rereadRoster('x', 'y'));
    const result = await runLoop(service, { prompt: SUBSTANTIVE, draftText: 'Original draft.', modelId: 'local:test' });
    expect(result.revised).toBe(false);
    expect(result.finalText).toBe('Original draft.');
  }, COUNCIL_LOOP_TIMEOUT_MS);

  it('redrafts a dropped multi-intent deliverable even when round 1 spends the budget', async () => {
    const previousBudget = process.env.VAI_COUNCIL_LOOP_BUDGET_MS;
    process.env.VAI_COUNCIL_LOOP_BUDGET_MS = '1';
    try {
      const service = makeService(rosterOf(
        stubMember('m1', { verdict: 'good', suggestedAction: 'answer-directly', confidence: 0.9 }, 10),
      ));
      let seen: CouncilRedraftFeedback | undefined;
      const jwtOnly = [
        '**JWT (JSON Web Token):**',
        'A JWT is a compact token. Structure: header.payload.signature.',
        'Flow: login -> server creates JWT -> client stores it -> sends Authorization: Bearer.',
      ].join('\n');
      const result = await runLoop(
        service,
        {
          prompt: 'Explain how JWT auth works and how to use it, and then build me a photographer portfolio app with nature images only and a social page when logged in.',
          draftText: jwtOnly,
          modelId: 'local:test',
        },
        async (feedback) => {
          seen = feedback;
          return `${jwtOnly}\n\npackage.json\nsrc/App.tsx\n\`\`\`tsx\nexport default function App() { return <main>Nature photographer portfolio with a logged-in social page</main>; }\n\`\`\``;
        },
      );

      expect(result.revised).toBe(true);
      expect(result.finalText).toContain('src/App.tsx');
      expect(result.finalText).toMatch(/photographer portfolio/i);
      expect(seen?.concerns[0]).toMatch(/draft did not address.*build/i);
    } finally {
      if (previousBudget === undefined) {
        delete process.env.VAI_COUNCIL_LOOP_BUDGET_MS;
      } else {
        process.env.VAI_COUNCIL_LOOP_BUDGET_MS = previousBudget;
      }
    }
  }, COUNCIL_LOOP_TIMEOUT_MS);

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
  }, COUNCIL_LOOP_TIMEOUT_MS);
});

// ── The closed loop: council lessons become self-applying guidance ──
// A non-ship council turn must persist its method lesson as class-scope
// RouteGuidance so a LATER similar turn is steered by it before the model writes.
// This is what makes Vai actually grow across turns rather than re-learning each time.
function makeServiceWithStore(roster: CouncilRoster, store: InMemoryGuidanceStore): ChatService {
  return new ChatService(createDb(':memory:'), new ModelRegistry(), {
    councilRoster: roster,
    guidanceStore: store,
  });
}

describe('council lesson persistence (closed self-improvement loop)', () => {
  const TURN = 'How do I make my React table re-render less often on filter changes?';

  it('persists a non-ship council lesson as class-scope AI guidance', async () => {
    const store = new InMemoryGuidanceStore();
    const service = makeServiceWithStore(
      rereadRoster('wants the actual re-render fix, not theory', 'profile first with React DevTools, then memoize the row'),
      store,
    );
    await runLoop(service, { prompt: TURN, draftText: 'Re-renders happen for many reasons.', modelId: 'local:test' });

    const saved = store.loadActive(null);
    expect(saved.length).toBeGreaterThan(0);
    const lesson = saved[0];
    expect(lesson.scope).toBe('class');
    expect(lesson.from).toBe('ai');
    expect(lesson.note).toMatch(/profile first|memoize/i);
    expect(lesson.matchTokens && lesson.matchTokens.length).toBeGreaterThan(0);
  }, COUNCIL_LOOP_TIMEOUT_MS);

  it('a persisted lesson is selected on a later similar turn', async () => {
    const store = new InMemoryGuidanceStore();
    const service = makeServiceWithStore(
      rereadRoster('wants the actual re-render fix', 'profile first with React DevTools, then memoize the row'),
      store,
    );
    // Turn 1 teaches the lesson.
    await runLoop(service, { prompt: TURN, draftText: 'A weak first draft.', modelId: 'local:test' });

    // Turn 2 is a same-class question (shares ≥half the originating turn's
    // distinctive tokens) — the loader must surface the stored lesson.
    const similar = 'How do I make my React table re-render less often when filter changes happen?';
    const selected = selectApplicableGuidance(
      { tokens: salientTokens(similar) },
      store.loadActive(null),
    );
    expect(selected.length).toBeGreaterThan(0);
    expect(selected[0].note).toMatch(/profile first|memoize/i);
  }, COUNCIL_LOOP_TIMEOUT_MS);

  it('does NOT persist when the council ships the draft (nothing to fix)', async () => {
    const store = new InMemoryGuidanceStore();
    const service = makeServiceWithStore(shipRoster(), store);
    await runLoop(service, { prompt: TURN, draftText: 'A good draft.', modelId: 'local:test' });
    expect(store.loadActive(null).length).toBe(0);
  }, COUNCIL_LOOP_TIMEOUT_MS);

  it('dedupes: a second similar non-ship turn does not stack a duplicate hint', async () => {
    const store = new InMemoryGuidanceStore();
    const service = makeServiceWithStore(
      rereadRoster('wants the fix', 'profile first with React DevTools, then memoize the row'),
      store,
    );
    await runLoop(service, { prompt: TURN, draftText: 'draft one', modelId: 'local:test' });
    await runLoop(service, { prompt: TURN, draftText: 'draft two', modelId: 'local:test' });
    // Same handler + overlapping tokens → second turn must be absorbed, not stacked.
    expect(store.loadActive(null).length).toBe(1);
  }, COUNCIL_LOOP_TIMEOUT_MS);

  it('is a no-op when no guidance store is configured (back-compat)', async () => {
    const service = makeService(rereadRoster('x', 'lesson y'));
    // Must not throw and must still grade/redraft normally.
    const result = await runLoop(service, { prompt: TURN, draftText: 'draft', modelId: 'local:test' });
    expect(result.finalText).toBe('draft');
  }, COUNCIL_LOOP_TIMEOUT_MS);
});
